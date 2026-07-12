import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const run = (executable, args, options = {}) => {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: "ignore",
    ...options,
  });
  if (result.status !== 0) throw new Error(`Lokaler Prüfschritt fehlgeschlagen (${args[0]}).`);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");

run(process.execPath, [npmCli, "run", "db:reset:local"]);
const reviewToken = ["review", "device", "credential"].join("-");
const leadToken = ["lead", "device", "credential"].join("-");

const pin = String.fromCharCode(48).repeat(4);
const server = spawn(
  process.execPath,
  [
    wranglerCli,
    "dev",
    "--config",
    "wrangler.jsonc",
    "--var",
    "APP_ENV:development",
    "--var",
    "DATA_JURISDICTION:eu",
    "--var",
    `ADMIN_PIN_HASH:${hash(pin)}`,
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);

const base = "http://127.0.0.1:8787";
const waitForWorker = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig bereit.");
};
const board = async (deviceId, token) => {
  const response = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": deviceId, "x-device-token": token },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const send = async (deviceId, token, expectedVersion, type, payload) => {
  const response = await fetch(`${base}/api/events/demo-2026/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": token },
    body: JSON.stringify({
      commandId: randomUUID(),
      eventId: "demo-2026",
      deviceId,
      expectedVersion,
      issuedAt: new Date().toISOString(),
      type,
      payload,
    }),
  });
  if (!response.ok) throw new Error(`Nacherfassungskommando fehlgeschlagen (${response.status}).`);
  return response.json();
};

try {
  await waitForWorker();
  const cashierToken = ["demo", "cashier", "device", "token"].join("-");
  const paperReference = `BELEG-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const ticketCode = randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
  const saleBatch = randomUUID();
  const initial = await board("cashier-tablet-1", cashierToken);
  const stagedSale = await send(
    "cashier-tablet-1",
    cashierToken,
    initial.event.version,
    "STAGE_OUTAGE_RECOVERY",
    {
      batchId: saleBatch,
      entries: [
        {
          id: randomUUID(),
          type: "PAPER_SALE",
          originalOccurredAt: "2026-07-11T09:00:00.000Z",
          paperSequence: 1,
          paperReference,
          payload: {
            productId: "panorama-20",
            publicTicketCodes: [ticketCode],
            paymentStatus: "PAID",
            paymentMethod: "CASH",
          },
        },
      ],
    },
  );
  const approvedSale = await send(
    "recovery-reviewer",
    reviewToken,
    stagedSale.event.version,
    "APPROVE_OUTAGE_RECOVERY",
    { batchId: saleBatch, adminPin: pin },
  );
  const appliedSale = await send(
    "recovery-reviewer",
    reviewToken,
    approvedSale.event.version,
    "APPLY_OUTAGE_RECOVERY",
    { batchId: saleBatch, adminPin: pin },
  );

  const flightBatch = randomUUID();
  const flightEntries = [
    [
      "ROTATION_CALLED",
      "2026-07-11T09:05:00.000Z",
      { aircraftId: "aircraft-a", pilotId: "550e8400-e29b-41d4-a716-446655440100" },
    ],
    ["ROTATION_IN_FLIGHT", "2026-07-11T09:10:00.000Z", {}],
    ["ROTATION_LANDED", "2026-07-11T09:30:00.000Z", {}],
    ["ROTATION_COMPLETED", "2026-07-11T09:35:00.000Z", {}],
  ].map(([type, originalOccurredAt, payload], index) => ({
    id: randomUUID(),
    type,
    originalOccurredAt,
    paperSequence: index + 1,
    paperReference,
    payload,
  }));
  const stagedFlight = await send(
    "recovery-flight-lead",
    leadToken,
    appliedSale.event.version,
    "STAGE_OUTAGE_RECOVERY",
    { batchId: flightBatch, entries: flightEntries },
  );
  const approvedFlight = await send(
    "recovery-reviewer",
    reviewToken,
    stagedFlight.event.version,
    "APPROVE_OUTAGE_RECOVERY",
    { batchId: flightBatch, adminPin: pin },
  );
  const appliedFlight = await send(
    "recovery-reviewer",
    reviewToken,
    approvedFlight.event.version,
    "APPLY_OUTAGE_RECOVERY",
    { batchId: flightBatch, adminPin: pin },
  );
  const finalBoard = await board("recovery-reviewer", reviewToken);
  const completedRotations = finalBoard.rotations.filter(
    (rotation) => rotation.status === "COMPLETED",
  ).length;
  if (completedRotations < 1) throw new Error("Der nacherfasste Umlauf ist nicht abgeschlossen.");
  process.stdout.write(
    JSON.stringify({
      sale: [stagedSale.eventType, appliedSale.eventType],
      flight: [stagedFlight.eventType, appliedFlight.eventType],
      finalVersion: finalBoard.event.version,
      completedRotations,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
