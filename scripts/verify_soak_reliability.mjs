import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  requestJson as executeJsonRequest,
  runSoakReliabilityScenario,
  soakConfigFromEnvironment,
} from "./lib/soak-reliability-scenario.mjs";
import { WINDOWS_TASKKILL_EXECUTABLE } from "./lib/tool-executables.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const soakConfig = soakConfigFromEnvironment();
const { port } = soakConfig;

const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const persistPath = resolve(root, process.env.SOAK_PERSIST_TO ?? ".wrangler/soak-state");
const runtimePath = resolve(root, process.env.SOAK_RUNTIME_TO ?? ".wrangler/soak-runtime");
const bundlePath = resolve(runtimePath, "bundle");
const bundledWorkerPath = resolve(bundlePath, "index.js");
const runtimeConfigPath = resolve(runtimePath, "wrangler.json");
await rm(persistPath, { recursive: true, force: true });
await rm(runtimePath, { recursive: true, force: true });
await mkdir(runtimePath, { recursive: true });
const runtimeConfig = JSON.parse(await readFile(resolve(root, "wrangler.jsonc"), "utf8"));
runtimeConfig.name = `${runtimeConfig.name}-soak`;
delete runtimeConfig.main;
delete runtimeConfig.assets;
delete runtimeConfig.triggers;
delete runtimeConfig.observability;
for (const database of runtimeConfig.d1_databases ?? []) delete database.migrations_dir;
await writeFile(runtimeConfigPath, JSON.stringify(runtimeConfig, null, 2));
const bundle = spawnSync(
  process.execPath,
  [
    wranglerCli,
    "deploy",
    resolve(root, "apps/worker/src/index.ts"),
    "--dry-run",
    "--outdir",
    bundlePath,
    "--config",
    runtimeConfigPath,
  ],
  { cwd: root, stdio: "ignore" },
);
if (bundle.status !== 0)
  throw new Error("Isoliertes Worker-Bundle für den Langlauf konnte nicht erzeugt werden.");
const wranglerBaseArguments = [
  "--local",
  "--persist-to",
  persistPath,
  "--config",
  "wrangler.jsonc",
];
const migrate = spawnSync(
  process.execPath,
  [wranglerCli, "d1", "migrations", "apply", "DB", ...wranglerBaseArguments],
  { cwd: root, stdio: "ignore" },
);
if (migrate.status !== 0)
  throw new Error("Isolierte Langlaufdatenbank konnte nicht migriert werden.");
const seed = spawnSync(
  process.execPath,
  [
    wranglerCli,
    "d1",
    "execute",
    "DB",
    ...wranglerBaseArguments,
    "--file",
    "apps/worker/seed/demo.sql",
    "--yes",
  ],
  { cwd: root, stdio: "ignore" },
);
if (seed.status !== 0)
  throw new Error("Isolierte Langlaufdatenbank konnte nicht synthetisch befüllt werden.");

const prepare = spawnSync(
  process.execPath,
  [
    wranglerCli,
    "d1",
    "execute",
    "DB",
    ...wranglerBaseArguments,
    "--command",
    `UPDATE operation_days
        SET status = 'ACTIVE', operations_end_at = '2099-07-14T22:00:00.000Z',
            operational_interrupted = 0, updated_at = '2026-07-14T06:00:00.000Z'
      WHERE id = 'demo-2026';`,
  ],
  { cwd: root, encoding: "utf8" },
);
if (prepare.status !== 0) {
  throw new Error(
    `Synthetischer Langlaufstand fehlgeschlagen: ${prepare.stderr || prepare.stdout}`,
  );
}

const pin = String.fromCodePoint(48).repeat(4);
const deviceId = "cashier-tablet-1";
const deviceToken = ["demo", "cashier", "device", "token"].join("-");
const eventId = "demo-2026";
const base = `http://127.0.0.1:${port}`;
let workerDiagnostic = "";
const server = spawn(
  process.execPath,
  [
    wranglerCli,
    "dev",
    bundledWorkerPath,
    "--no-bundle",
    "--config",
    runtimeConfigPath,
    "--port",
    String(port),
    "--inspector-port",
    String(port + 1_000),
    "--persist-to",
    persistPath,
    "--var",
    "APP_ENV:development",
    "--var",
    "DATA_JURISDICTION:eu",
    "--var",
    `ADMIN_PIN_HASH:${createHash("sha256").update(pin).digest("hex")}`,
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);
for (const output of [server.stdout, server.stderr]) {
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    const diagnostic = String(chunk)
      .split(/\r?\n/)
      .find((line) => line.includes("COMMAND_PROCESSING_FAILED"));
    if (diagnostic) workerDiagnostic = diagnostic.slice(-1_000);
  });
}

const stopServer = () => {
  if (server.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync(WINDOWS_TASKKILL_EXECUTABLE, ["/pid", String(server.pid), "/t", "/f"], {
      stdio: "ignore",
    });
  } else {
    server.kill("SIGTERM");
  }
};

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const waitForWorker = async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig für den Langlauf bereit.");
};
const requestJson = async (url, init, maximumMilliseconds = 2_000) => {
  return executeJsonRequest(
    { url, init, maximumMilliseconds },
    {
      diagnostic: () => workerDiagnostic,
      fetch,
      performanceNow: () => performance.now(),
      sleep,
      timeoutSignal: AbortSignal.timeout,
    },
  );
};
const headers = {
  "content-type": "application/json",
  "x-device-id": deviceId,
  "x-device-token": deviceToken,
};
const board = () =>
  requestJson(`${base}/api/control/${eventId}/operations`, {
    headers: { "x-device-id": deviceId, "x-device-token": deviceToken },
  });
const command = (version, type, payload) =>
  requestJson(`${base}/api/control/${eventId}/commands`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      commandId: randomUUID(),
      eventId,
      deviceId,
      expectedVersion: version,
      issuedAt: new Date().toISOString(),
      type,
      payload,
    }),
  });
const waitForRealtimeIncrease = async (
  previousCount,
  readCount,
  failureMessage,
  timeoutMilliseconds = 2_000,
) => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (readCount() > previousCount) return;
    await sleep(25);
  }
  throw new Error(failureMessage);
};

let socket;
try {
  await waitForWorker();
  let realtimeMessages = 0;
  let realtimeStateChanges = 0;
  let realtimePongs = 0;
  let realtimeReconnects = 0;
  let realtimeCloses = 0;
  let lastRealtimeClose = null;
  const openRealtimeSocket = async (reconnect) => {
    const candidate = new WebSocket(`ws://127.0.0.1:${port}/api/public/events/${eventId}/live`);
    candidate.addEventListener("message", (event) => {
      realtimeMessages += 1;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "event-state-changed") realtimeStateChanges += 1;
        if (message.type === "pong") realtimePongs += 1;
      } catch {}
    });
    candidate.addEventListener("close", (event) => {
      realtimeCloses += 1;
      lastRealtimeClose = {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      };
    });
    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(
        () => rejectPromise(new Error("Realtime-Verbindung wurde nicht rechtzeitig geöffnet.")),
        5_000,
      );
      candidate.addEventListener("open", () => {
        clearTimeout(timeout);
        resolvePromise();
      });
      candidate.addEventListener("error", () => {
        clearTimeout(timeout);
        rejectPromise(new Error("Realtime-Verbindung des Langlaufs ist fehlgeschlagen."));
      });
    });
    socket = candidate;
    if (reconnect) realtimeReconnects += 1;
  };
  const ensureRealtimeHealthy = async () => {
    if (socket?.readyState !== WebSocket.OPEN) {
      await openRealtimeSocket(true);
    }
    let previousPongs = realtimePongs;
    socket.send("ping");
    try {
      await waitForRealtimeIncrease(
        previousPongs,
        () => realtimePongs,
        "Realtime-Heartbeat wurde nicht beantwortet.",
      );
    } catch {
      socket.close();
      await openRealtimeSocket(true);
      previousPongs = realtimePongs;
      socket.send("ping");
      await waitForRealtimeIncrease(
        previousPongs,
        () => realtimePongs,
        "Realtime-Heartbeat blieb auch nach automatischer Wiederverbindung aus.",
      );
    }
  };
  await openRealtimeSocket(false);

  const report = await runSoakReliabilityScenario(soakConfig, {
    adminPin: pin,
    http: {
      board,
      command,
      health: () => requestJson(`${base}/api/health`),
    },
    now: Date.now,
    onProgress: (progress) => console.log(JSON.stringify(progress)),
    process: { isAlive: () => server.exitCode === null },
    realtime: {
      ensureHealthy: ensureRealtimeHealthy,
      metrics: () => ({
        realtimeMessages,
        realtimeStateChanges,
        realtimePongs,
        realtimeReconnects,
        realtimeCloses,
      }),
      stateChanges: () => realtimeStateChanges,
      waitForStateChange: (previousCount) =>
        waitForRealtimeIncrease(
          previousCount,
          () => realtimeStateChanges,
          `Im Langlauf wurde nach Zustandsänderungen kein Realtime-Ereignis empfangen: ${JSON.stringify({ readyState: socket?.readyState, realtimeCloses, lastRealtimeClose })}`,
        ),
    },
    sleep,
  });
  console.log(JSON.stringify(report));
} finally {
  socket?.close();
  stopServer();
}
