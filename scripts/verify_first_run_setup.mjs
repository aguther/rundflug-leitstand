import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
await rm(resolve(root, ".wrangler", "state"), { recursive: true, force: true });
const migrate = spawnSync(process.execPath, [npmCli, "run", "db:migrate:local"], {
  cwd: root,
  stdio: "ignore",
});
if (migrate.status !== 0)
  throw new Error("Leere lokale Testdatenbank konnte nicht migriert werden.");
const pin = String.fromCharCode(48).repeat(4);
const setupCode = ["synthetic", "first", "run", "setup", "code"].join("-");
const deviceToken = ["synthetic", "bootstrap", "admin", "device", "token", "value"].join("-");
const server = spawn(
  process.execPath,
  [
    resolve(root, "node_modules", "wrangler", "bin", "wrangler.js"),
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
const setupStatus = async () => {
  const response = await fetch(`${base}/api/setup/status`);
  if (!response.ok) throw new Error(`Setup-Status fehlgeschlagen (${response.status}).`);
  return response.json();
};
const setup = async (body, expectedStatus) => {
  const response = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(`Setup lieferte ${response.status} statt ${expectedStatus}.`);
  }
  return result;
};

try {
  await waitForWorker();
  const before = await setupStatus();
  if (!before.setupRequired || !before.setupConfigured) {
    throw new Error("Leeres System meldet keinen konfigurierten Erststart.");
  }
  const adminDeviceId = randomUUID();
  const request = {
    setupCode,
    adminPin: pin,
    eventId: "synthetic-first-run",
    name: "Synthetischer Erststart",
    eventDate: "2026-07-12",
    aerodrome: "EDQA",
    timeZone: "Europe/Berlin",
    adminDeviceId,
    adminCredentialHash: createHash("sha256").update(deviceToken).digest("hex"),
  };
  const denied = await setup({ ...request, setupCode: "invalid-synthetic-setup-code" }, 403);
  if (denied.error?.code !== "SETUP_CREDENTIALS_INVALID") {
    throw new Error("Falscher Einrichtungscode wurde nicht generisch abgewiesen.");
  }
  const created = await setup(request, 201);
  if (created.eventId !== request.eventId || created.adminDeviceId !== adminDeviceId) {
    throw new Error("Erststart lieferte abweichende technische IDs.");
  }
  const duplicate = await setup(
    { ...request, eventId: "synthetic-second-run", adminDeviceId: randomUUID() },
    409,
  );
  if (duplicate.error?.code !== "SETUP_ALREADY_COMPLETED") {
    throw new Error("Zweite Ersteinrichtung wurde nicht dauerhaft gesperrt.");
  }
  const after = await setupStatus();
  if (after.setupRequired) throw new Error("Setup-Status blieb nach Erststart offen.");
  const boardResponse = await fetch(`${base}/api/events/${request.eventId}/operations`, {
    headers: { "x-device-id": adminDeviceId, "x-device-token": deviceToken },
  });
  const board = await boardResponse.json();
  if (
    !boardResponse.ok ||
    board.currentDeviceRole !== "ADMIN" ||
    board.event.status !== "PREPARATION" ||
    board.event.aerodrome !== request.aerodrome ||
    board.products.length !== 0
  ) {
    throw new Error(
      "Erstes anonymes Administrationsgerät erhält keinen sauberen Vorbereitungsstand.",
    );
  }
  const recoveredToken = ["synthetic", "recovered", "admin", "device", "token"].join("-");
  const rejectedRecovery = await fetch(
    `${base}/api/admin/events/${request.eventId}/recover-device`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": adminDeviceId },
      body: JSON.stringify({
        adminPin: "9999",
        credentialHash: createHash("sha256").update(recoveredToken).digest("hex"),
      }),
    },
  );
  if (rejectedRecovery.status !== 403) {
    throw new Error("Falsche PIN wurde bei der Admin-Wiederherstellung nicht abgewiesen.");
  }
  const recovered = await fetch(`${base}/api/admin/events/${request.eventId}/recover-device`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": adminDeviceId },
    body: JSON.stringify({
      adminPin: pin,
      credentialHash: createHash("sha256").update(recoveredToken).digest("hex"),
    }),
  });
  const recoveredBody = await recovered.json();
  if (
    !recovered.ok ||
    recoveredBody.adminDeviceId !== adminDeviceId ||
    recoveredBody.role !== "ADMIN"
  ) {
    throw new Error("Administrationsgerät konnte nicht mit der PIN erneuert werden.");
  }
  const oldCredentialResponse = await fetch(`${base}/api/events/${request.eventId}/operations`, {
    headers: { "x-device-id": adminDeviceId, "x-device-token": deviceToken },
  });
  if (oldCredentialResponse.status !== 403) {
    throw new Error("Der ersetzte Geräteschlüssel blieb nach der Wiederherstellung gültig.");
  }
  const recoveredBoardResponse = await fetch(`${base}/api/events/${request.eventId}/operations`, {
    headers: { "x-device-id": adminDeviceId, "x-device-token": recoveredToken },
  });
  if (!recoveredBoardResponse.ok) {
    throw new Error("Der erneuerte Geräteschlüssel lädt keinen bestätigten Betriebsstand.");
  }
  const additionalAdminDeviceId = randomUUID();
  const additionalAdminToken = ["synthetic", "additional", "admin", "device", "token"].join("-");
  const additionalRecovery = await fetch(
    `${base}/api/admin/events/${request.eventId}/recover-device`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": additionalAdminDeviceId },
      body: JSON.stringify({
        adminPin: pin,
        credentialHash: createHash("sha256").update(additionalAdminToken).digest("hex"),
      }),
    },
  );
  if (!additionalRecovery.ok) {
    throw new Error("Ein neuer Browser konnte keinen PIN-geschützten Adminzugang erhalten.");
  }
  const additionalBoardResponse = await fetch(`${base}/api/events/${request.eventId}/operations`, {
    headers: { "x-device-id": additionalAdminDeviceId, "x-device-token": additionalAdminToken },
  });
  if (!additionalBoardResponse.ok) {
    throw new Error("Der neue PIN-geschützte Adminzugang lädt keinen Betriebsstand.");
  }
  const recoveryHistoryResponse = await fetch(
    `${base}/api/events/${request.eventId}/history?eventType=ADMIN_DEVICE_CREDENTIAL_RECOVERED`,
    { headers: { "x-device-id": adminDeviceId, "x-device-token": recoveredToken } },
  );
  const recoveryHistory = await recoveryHistoryResponse.json();
  if (!recoveryHistoryResponse.ok || recoveryHistory.entries?.length !== 2) {
    throw new Error("Die Admin-Wiederherstellungen wurden nicht vollständig auditiert.");
  }
  console.log(
    JSON.stringify({
      ok: true,
      emptyDatabaseDetected: true,
      invalidCredentialsRejected: true,
      bootstrapAtomic: true,
      duplicateBootstrapRejected: true,
      anonymousAdminAuthorized: true,
      adminCredentialRecoveryVerified: true,
      newBrowserAdminLoginVerified: true,
      replacedCredentialRejected: true,
      recoveryAudited: true,
      preparationStartsWithoutMasterData: true,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
