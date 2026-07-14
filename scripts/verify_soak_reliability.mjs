import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const durationSeconds = Number(process.env.SOAK_DURATION_SECONDS ?? 12 * 60 * 60);
const intervalSeconds = Number(process.env.SOAK_INTERVAL_SECONDS ?? 60);
const port = Number(process.env.SOAK_PORT ?? 8_797);
if (!Number.isFinite(durationSeconds) || durationSeconds < 20) {
  throw new Error("SOAK_DURATION_SECONDS muss mindestens 20 Sekunden betragen.");
}
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > durationSeconds) {
  throw new Error("SOAK_INTERVAL_SECONDS muss zwischen 1 und der Laufzeit liegen.");
}
if (!Number.isInteger(port) || port < 1_024 || port > 55_000) {
  throw new Error("SOAK_PORT muss eine freie Portnummer zwischen 1024 und 55000 sein.");
}

const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const persistPath = resolve(root, process.env.SOAK_PERSIST_TO ?? ".wrangler/soak-state");
await rm(persistPath, { recursive: true, force: true });
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

const pin = String.fromCharCode(48).repeat(4);
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
    "--config",
    "wrangler.jsonc",
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
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
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
  const started = performance.now();
  const response = await fetch(url, init);
  const elapsedMilliseconds = performance.now() - started;
  const body = await response.json();
  if (!response.ok) {
    await sleep(100);
    throw new Error(
      `Langlauf-Request ${response.status}: ${body?.error?.code ?? "UNKNOWN_ERROR"}${workerDiagnostic ? ` · ${workerDiagnostic}` : ""}`,
    );
  }
  if (elapsedMilliseconds >= maximumMilliseconds) {
    throw new Error(
      `Langlauf-Request überschritt ${maximumMilliseconds} ms: ${elapsedMilliseconds.toFixed(1)} ms`,
    );
  }
  return { body, elapsedMilliseconds };
};
const headers = {
  "content-type": "application/json",
  "x-device-id": deviceId,
  "x-device-token": deviceToken,
};
const ticketCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const createTicketCode = () =>
  Array.from(
    randomBytes(16),
    (value) => ticketCodeAlphabet[value % ticketCodeAlphabet.length],
  ).join("");
const board = () =>
  requestJson(`${base}/api/events/${eventId}/operations`, {
    headers: { "x-device-id": deviceId, "x-device-token": deviceToken },
  });
const command = (version, type, payload) =>
  requestJson(`${base}/api/events/${eventId}/commands`, {
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
const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};
const waitForRealtimeIncrease = async (previousCount, readCount, timeoutMilliseconds = 2_000) => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (readCount() > previousCount) return;
    await sleep(25);
  }
  throw new Error("Im Langlauf wurde nach Zustandsänderungen kein Realtime-Ereignis empfangen.");
};

let socket;
try {
  await waitForWorker();
  let realtimeMessages = 0;
  socket = new WebSocket(`ws://127.0.0.1:${port}/api/public/events/${eventId}/live`);
  socket.addEventListener("message", () => {
    realtimeMessages += 1;
  });
  await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () => rejectPromise(new Error("Realtime-Verbindung wurde nicht rechtzeitig geöffnet.")),
      5_000,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      rejectPromise(new Error("Realtime-Verbindung des Langlaufs ist fehlgeschlagen."));
    });
  });

  const startedAt = Date.now();
  const deadline = startedAt + durationSeconds * 1_000;
  const latencies = [];
  let cycles = 0;
  let previousRealtimeMessages = realtimeMessages;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error("Worker-Prozess wurde während des Langlaufs beendet.");
    const cycleStartedAt = Date.now();
    const health = await requestJson(`${base}/api/health`);
    const current = await board();
    const sale = await command(current.body.event.version, "SELL_TICKET_GROUP", {
      productId: "panorama-20",
      publicTicketCodes: [createTicketCode()],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      oversizeSplitAcknowledged: false,
    });
    const cancellation = await command(sale.body.event.version, "CANCEL_TICKET_GROUP", {
      ticketGroupId: sale.body.aggregate.id,
      reason: "Synthetischer Langlaufzyklus",
      adminPin: pin,
    });
    const confirmed = await board();
    if (confirmed.body.event.version !== cancellation.body.event.version) {
      throw new Error("Bestätigter Langlaufstand stimmt nicht mit der Kommando-Version überein.");
    }
    latencies.push(
      health.elapsedMilliseconds,
      current.elapsedMilliseconds,
      sale.elapsedMilliseconds,
      cancellation.elapsedMilliseconds,
      confirmed.elapsedMilliseconds,
    );
    cycles += 1;
    await waitForRealtimeIncrease(previousRealtimeMessages, () => realtimeMessages);
    previousRealtimeMessages = realtimeMessages;
    if (cycles === 1 || cycles % 60 === 0) {
      console.log(
        JSON.stringify({
          progress: true,
          cycles,
          elapsedMinutes: Number(((Date.now() - startedAt) / 60_000).toFixed(1)),
          p95Milliseconds: Number(percentile(latencies, 0.95).toFixed(1)),
          realtimeMessages,
        }),
      );
    }
    const remainingCycleDelay = intervalSeconds * 1_000 - (Date.now() - cycleStartedAt);
    const remainingRunTime = deadline - Date.now();
    if (remainingCycleDelay > 0 && remainingRunTime > 0) {
      await sleep(Math.min(remainingCycleDelay, remainingRunTime));
    }
  }

  if (cycles < 1) throw new Error("Langlauf hat keinen vollständigen Zyklus ausgeführt.");
  console.log(
    JSON.stringify({
      ok: true,
      requirement: "Q-ZUV-050",
      configuredDurationSeconds: durationSeconds,
      actualDurationSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
      intervalSeconds,
      port,
      cycles,
      requests: latencies.length,
      medianMilliseconds: Number(percentile(latencies, 0.5).toFixed(1)),
      p95Milliseconds: Number(percentile(latencies, 0.95).toFixed(1)),
      maximumMilliseconds: Number(Math.max(...latencies).toFixed(1)),
      realtimeMessages,
      workerRestarted: false,
      anonymousSyntheticDataOnly: true,
    }),
  );
} finally {
  socket?.close();
  stopServer();
}
