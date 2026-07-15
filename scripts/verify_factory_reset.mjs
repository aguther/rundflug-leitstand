import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
const reset = spawnSync(process.execPath, [npmCli, "run", "db:reset:local"], {
  cwd: root,
  stdio: "ignore",
});
if (reset.status !== 0) throw new Error("Lokale Testdatenbank konnte nicht initialisiert werden.");

const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const forecastFixture = spawnSync(
  process.execPath,
  [
    wrangler,
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--command",
    `INSERT INTO flight_groups
      (id, operation_day_id, resource_group_id, communication_number, status, version, created_at, updated_at)
     VALUES ('factory-reset-flight-group', 'demo-2026', 'rg-panorama', 999, 'PLANNED', 0,
             '2026-07-11T09:00:00.000Z', '2026-07-11T09:00:00.000Z');
     INSERT INTO rotations
      (id, operation_day_id, flight_group_id, aircraft_id, status, version, created_at, updated_at)
     VALUES ('factory-reset-rotation', 'demo-2026', 'factory-reset-flight-group', 'aircraft-a',
             'PLANNED', 0, '2026-07-11T09:00:00.000Z', '2026-07-11T09:00:00.000Z');
     INSERT INTO forecast_snapshots
      (id, operation_day_id, rotation_id, operation_day_version, captured_at, quality,
       lower_minutes, upper_minutes)
     VALUES ('factory-reset-forecast', 'demo-2026', 'factory-reset-rotation', 0,
             '2026-07-11T09:00:00.000Z', 'STABLE', 10, 20);`,
  ],
  { cwd: root, stdio: "ignore" },
);
if (forecastFixture.status !== 0) {
  throw new Error("Prognosehistorie für den Werksreset-Test konnte nicht angelegt werden.");
}

const pin = String.fromCharCode(48).repeat(4);
const setupCode = ["synthetic", "factory", "reset", "setup", "code"].join("-");
const server = spawn(
  process.execPath,
  [
    wrangler,
    "dev",
    "--config",
    "wrangler.jsonc",
    "--var",
    "APP_ENV:development",
    "--var",
    "DATA_JURISDICTION:eu",
    "--var",
    `ADMIN_PIN_HASH:${createHash("sha256").update(pin).digest("hex")}`,
    "--var",
    `BOOTSTRAP_TOKEN:${setupCode}`,
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = "http://127.0.0.1:8787";
const waitForWorker = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig bereit.");
};

try {
  await waitForWorker();
  const commandId = randomUUID();
  const request = {
    commandId,
    eventId: "demo-2026",
    reason: "Synthetischer vollständiger Entwicklungsreset",
    adminPin: pin,
    confirmation: "WERKSZUSTAND",
    retainRecoveryBackup: true,
    deleteAllBackups: false,
  };
  const executeReset = async () =>
    fetch(`${base}/api/admin/events/demo-2026/factory-reset`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "technical-scaffold",
        "x-device-token": "demo-admin-device-token",
      },
      body: JSON.stringify(request),
    });
  const first = await executeReset();
  const firstBody = await first.json();
  if (!first.ok || !firstBody.resetComplete || !firstBody.recoveryBackupKey) {
    throw new Error(`Werksreset fehlgeschlagen (${first.status}).`);
  }
  const statusAfterReset = await fetch(`${base}/api/setup/status`).then((response) =>
    response.json(),
  );
  if (!statusAfterReset.setupRequired) {
    throw new Error("System verlangt nach dem Werksreset keine Ersteinrichtung.");
  }
  const duplicate = await executeReset();
  if (!duplicate.ok || !(await duplicate.json()).resetComplete) {
    throw new Error("Idempotente Wiederholung des Werksresets ist fehlgeschlagen.");
  }

  const adminDeviceId = randomUUID();
  const adminDeviceToken = ["synthetic", "new", "admin", "device", "token"].join("-");
  const setup = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      setupCode,
      adminPin: pin,
      eventId: "synthetic-after-reset",
      name: "Synthetischer Neustart",
      eventDate: "2026-07-14",
      aerodrome: "EDQA",
      timeZone: "Europe/Berlin",
      adminDeviceId,
      adminCredentialHash: createHash("sha256").update(adminDeviceToken).digest("hex"),
    }),
  });
  if (setup.status !== 201) {
    throw new Error(`Ersteinrichtung nach Werksreset fehlgeschlagen (${setup.status}).`);
  }
  console.log(
    JSON.stringify({
      resetComplete: true,
      recoveryBackupCreated: true,
      forecastHistoryDeleted: true,
      duplicateResetIdempotent: true,
      setupRequiredAfterReset: true,
      setupCompletedAgain: true,
    }),
  );
} finally {
  server.kill();
}
