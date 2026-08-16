import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WINDOWS_TASKKILL_EXECUTABLE } from "./tool-executables.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wranglerCli = resolve(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");

export const TEST_EVENT_ID = "demo-2026";
export const TEST_ADMIN_PIN = "0000";
export const TEST_DEVICES = Object.freeze({
  admin: "technical-scaffold",
  cashier: "cashier-tablet-1",
  flightLine: "flight-line-tablet-1",
  flightLead: "recovery-flight-lead",
});
export const TEST_DEVICE_TOKENS = Object.freeze({
  admin: "demo-admin-device-token",
  cashier: "demo-cashier-device-token",
  flightLine: "demo-flight-line-device-token",
  flightLead: "lead-device-credential",
});

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("No isolated worker port was allocated.")));
        return;
      }
      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function runWrangler(stateDirectory, arguments_, stdio = "ignore") {
  return spawnSync(
    process.execPath,
    [
      wranglerCli,
      ...arguments_,
      "--local",
      "--persist-to",
      stateDirectory,
      "--config",
      "wrangler.jsonc",
    ],
    { cwd: repositoryRoot, stdio, windowsHide: true },
  );
}

async function stopProcessTree(processHandle) {
  if (processHandle?.exitCode !== null || !processHandle.pid) return;
  if (process.platform === "win32") {
    spawnSync(WINDOWS_TASKKILL_EXECUTABLE, ["/pid", String(processHandle.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (processHandle.exitCode === null) {
      await new Promise((resolvePromise) => {
        const timeout = setTimeout(resolvePromise, 2_000);
        processHandle.once("exit", () => {
          clearTimeout(timeout);
          resolvePromise();
        });
      });
    }
    return;
  }
  processHandle.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      processHandle.kill("SIGKILL");
      resolvePromise();
    }, 2_000);
    processHandle.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

function prepareD1State(stateDirectory, seedFiles, d1Commands) {
  const migration = runWrangler(stateDirectory, ["d1", "migrations", "apply", "DB"]);
  if (migration.status !== 0) throw new Error("Isolated D1 migrations failed.");
  for (const seedFile of seedFiles) {
    const seed = runWrangler(stateDirectory, ["d1", "execute", "DB", "--file", seedFile]);
    if (seed.status !== 0) throw new Error(`Isolated D1 seed failed: ${seedFile}`);
  }
  for (const command of d1Commands) {
    const result = runWrangler(stateDirectory, ["d1", "execute", "DB", "--command", command]);
    if (result.status !== 0) throw new Error("Isolated D1 preparation command failed.");
  }
}

export async function createWorkerTestHarness(options) {
  const {
    name,
    adminPin = TEST_ADMIN_PIN,
    seedFiles = ["apps/worker/seed/demo.sql"],
    d1Commands = [],
    variables = {},
    workerStdio = "pipe",
    startupAttempts = 120,
  } = options;
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    throw new Error("Worker harness name must use lowercase kebab-case.");
  }
  const stateDirectory = await mkdtemp(join(tmpdir(), `rundflug-${name}-`));
  const assetsDirectory = join(stateDirectory, "assets");
  let server = null;
  let workerOutput = "";
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await stopProcessTree(server);
    await rm(stateDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  try {
    await mkdir(assetsDirectory);
    await writeFile(
      join(assetsDirectory, "index.html"),
      '<!doctype html><html lang="en"><title>Worker test harness</title></html>\n',
    );
    prepareD1State(stateDirectory, seedFiles, d1Commands);

    const port = await availablePort();
    const adminPinHash = createHash("sha256").update(adminPin).digest("hex");
    const variableArguments = Object.entries({
      APP_ENV: "development",
      DATA_JURISDICTION: "eu",
      ADMIN_PIN_HASH: adminPinHash,
      ...variables,
    }).flatMap(([key, value]) => ["--var", `${key}:${value}`]);
    server = spawn(
      process.execPath,
      [
        wranglerCli,
        "dev",
        "--config",
        "wrangler.jsonc",
        "--persist-to",
        stateDirectory,
        "--assets",
        assetsDirectory,
        "--port",
        String(port),
        ...variableArguments,
      ],
      { cwd: repositoryRoot, stdio: workerStdio, windowsHide: true },
    );
    const captureWorkerOutput = (chunk) => {
      workerOutput = `${workerOutput}${chunk.toString()}`.slice(-16_384);
    };
    server.stdout?.on("data", captureWorkerOutput);
    server.stderr?.on("data", captureWorkerOutput);
    const baseUrl = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < startupAttempts; attempt += 1) {
      if (server.exitCode !== null) {
        throw new Error(
          `Isolated worker exited with code ${server.exitCode}.\n${workerOutput.trim()}`,
        );
      }
      try {
        if ((await fetch(`${baseUrl}/api/health`)).ok) {
          return createHarnessApi({ baseUrl, dispose });
        }
      } catch {}
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    throw new Error(`Isolated worker did not become ready in time.\n${workerOutput.trim()}`);
  } catch (error) {
    await dispose();
    throw error;
  }
}

function createHarnessApi({ baseUrl, dispose }) {
  const fetchJson = async (path, init = {}, expectedStatus = 200) => {
    const response = await fetch(`${baseUrl}${path}`, init);
    const body = await response.json();
    if (response.status !== expectedStatus) {
      throw new Error(
        `${init.method ?? "GET"} ${path} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  };
  const board = ({
    eventId = TEST_EVENT_ID,
    deviceId = TEST_DEVICES.admin,
    token = TEST_DEVICE_TOKENS.admin,
  } = {}) =>
    fetchJson(`/api/control/${encodeURIComponent(eventId)}/operations`, {
      headers: { "x-device-id": deviceId, "x-device-token": token },
    });
  const command = ({
    eventId = TEST_EVENT_ID,
    deviceId,
    token,
    expectedVersion,
    type,
    payload,
    expectedStatus = 200,
    commandId = randomUUID(),
  }) =>
    fetchJson(
      `/api/control/${encodeURIComponent(eventId)}/commands`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-token": token },
        body: JSON.stringify({
          commandId,
          eventId,
          deviceId,
          expectedVersion,
          issuedAt: new Date().toISOString(),
          type,
          payload,
        }),
      },
      expectedStatus,
    );
  return Object.freeze({ baseUrl, board, command, dispose, fetchJson });
}

export async function withWorkerTestHarness(options, callback) {
  const harness = await createWorkerTestHarness(options);
  try {
    return await callback(harness);
  } finally {
    await harness.dispose();
  }
}
