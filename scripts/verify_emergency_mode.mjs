import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const reset = spawnSync(process.execPath, [npmCli, "run", "db:reset:local"], {
  cwd: root,
  stdio: "ignore",
});
if (reset.status !== 0) throw new Error("Lokale Testdatenbank konnte nicht initialisiert werden.");

const pin = String.fromCharCode(48).repeat(4);
const pinHash = createHash("sha256").update(pin).digest("hex");
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
    `ADMIN_PIN_HASH:${pinHash}`,
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = "http://127.0.0.1:8787";
const tokens = {
  admin: ["demo", "admin", "device", "token"].join("-"),
  cashier: ["demo", "cashier", "device", "token"].join("-"),
  flightLine: ["demo", "flight", "line", "device", "token"].join("-"),
  flightLead: ["lead", "device", "credential"].join("-"),
};
const devices = {
  admin: "technical-scaffold",
  cashier: "cashier-tablet-1",
  flightLine: "flight-line-tablet-1",
  flightLead: "recovery-flight-lead",
};

const waitForWorker = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig bereit.");
};
const board = async (device, token) => {
  const response = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": device, "x-device-token": token },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const command = async (device, token, expectedVersion, type, payload, expectedStatus = 200) => {
  const response = await fetch(`${base}/api/events/demo-2026/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": token },
    body: JSON.stringify({
      commandId: randomUUID(),
      eventId: "demo-2026",
      deviceId: device,
      expectedVersion,
      issuedAt: new Date().toISOString(),
      type,
      payload,
    }),
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${type} lieferte ${response.status} statt ${expectedStatus}.`);
  }
  return response.json();
};
const publicJson = async (path) => {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`Öffentlicher Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const history = async () => {
  const response = await fetch(`${base}/api/events/demo-2026/history?aggregateType=OPERATION_DAY`, {
    headers: { "x-device-id": devices.admin, "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Historien-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");

try {
  await waitForWorker();
  let current = await board(devices.admin, tokens.admin);
  const configured = await command(
    devices.admin,
    tokens.admin,
    current.event.version,
    "CONFIGURE_EVENT_PARAMETERS",
    {
      saleOpensAt: null,
      operationsEndAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      noShowAfterMinutes: 10,
      notificationLeadMinutes: 20,
      childReferenceWeightKg: 35,
      normalReferenceWeightKg: 80,
      heavyReferenceWeightKg: 110,
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 5,
      plannedBufferMinutes: 5,
      reason: "Synthetischer Notfalltest",
      adminPin: pin,
    },
  );
  const activated = await command(
    devices.admin,
    tokens.admin,
    configured.event.version,
    "SET_EVENT_LIFECYCLE",
    { status: "ACTIVE", reason: "Synthetischer Notfalltest", adminPin: pin },
  );
  const activeTicketCode = ticketCode();
  const firstSale = await command(
    devices.cashier,
    tokens.cashier,
    activated.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-20",
      publicTicketCodes: [activeTicketCode],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  );
  const waitingSale = await command(
    devices.cashier,
    tokens.cashier,
    firstSale.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-20",
      publicTicketCodes: [ticketCode()],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  );
  const activeRotationId = firstSale.aggregate.relatedRotationId;
  const waitingRotationId = waitingSale.aggregate.relatedRotationId;
  const called = await command(
    devices.flightLine,
    tokens.flightLine,
    waitingSale.event.version,
    "CALL_NEXT",
    {
      rotationId: activeRotationId,
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  const started = await command(
    devices.flightLine,
    tokens.flightLine,
    called.event.version,
    "MARK_IN_FLIGHT",
    { rotationId: activeRotationId },
  );
  const triggered = await command(
    devices.flightLead,
    tokens.flightLead,
    started.event.version,
    "TRIGGER_EMERGENCY",
    { reason: "Synthetische organisatorische Notfallübung" },
  );
  if (!triggered.event.emergencyMode) throw new Error("Notfallmodus wurde nicht aktiviert.");

  await command(
    devices.cashier,
    tokens.cashier,
    triggered.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-20",
      publicTicketCodes: [ticketCode()],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
    409,
  );
  await command(
    devices.flightLine,
    tokens.flightLine,
    triggered.event.version,
    "CALL_NEXT",
    {
      rotationId: waitingRotationId,
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    409,
  );
  current = await board(devices.cashier, tokens.cashier);
  if (!current.event.emergencyMode || current.event.version !== triggered.event.version) {
    throw new Error("Gesperrte Kommandos haben den bestätigten Notfallzustand verändert.");
  }
  const publicBoard = await publicJson("/api/public/events/demo-2026/board");
  const publicTicket = await publicJson(`/api/public/tickets/${activeTicketCode}`);
  if (
    !publicBoard.emergencyMode ||
    publicBoard.groups.length !== 0 ||
    publicTicket.status !== "SERVICE_PAUSED" ||
    publicTicket.queuePosition !== null ||
    publicTicket.waitLowerMinutes !== 0 ||
    publicTicket.waitUpperMinutes !== 0
  ) {
    throw new Error("Öffentliche Ansichten sind im Notfallmodus nicht vollständig neutral.");
  }

  const landed = await command(
    devices.flightLine,
    tokens.flightLine,
    triggered.event.version,
    "MARK_LANDED",
    { rotationId: activeRotationId },
  );
  const completed = await command(
    devices.flightLine,
    tokens.flightLine,
    landed.event.version,
    "MARK_COMPLETED",
    { rotationId: activeRotationId },
  );
  await command(
    devices.flightLead,
    tokens.flightLead,
    completed.event.version,
    "CLEAR_EMERGENCY",
    { reason: "Nicht berechtigter Aufhebungsversuch", adminPin: pin },
    403,
  );
  await command(
    devices.admin,
    tokens.admin,
    completed.event.version,
    "CLEAR_EMERGENCY",
    { reason: "Falsche PIN in der Notfallübung", adminPin: "9999" },
    403,
  );
  const cleared = await command(
    devices.admin,
    tokens.admin,
    completed.event.version,
    "CLEAR_EMERGENCY",
    { reason: "Synthetische Notfallübung beendet", adminPin: pin },
  );
  const ledger = await history();
  const triggerEvent = ledger.entries.find(
    (entry) => entry.eventType === "EMERGENCY_MODE_TRIGGERED",
  );
  const clearEvent = ledger.entries.find((entry) => entry.eventType === "EMERGENCY_MODE_CLEARED");
  if (
    triggerEvent?.deviceId !== devices.flightLead ||
    clearEvent?.deviceId !== devices.admin ||
    typeof triggerEvent.payload.reason !== "string" ||
    typeof clearEvent.payload.reason !== "string"
  ) {
    throw new Error("Auslösung oder Aufhebung fehlt im append-only Ereignisprotokoll.");
  }
  current = await board(devices.flightLine, tokens.flightLine);
  const activeRotation = current.rotations.find((rotation) => rotation.id === activeRotationId);
  if (cleared.event.emergencyMode || activeRotation?.status !== "COMPLETED") {
    throw new Error("Notfallmodus oder laufender Umlauf endete nicht im erwarteten Zustand.");
  }
  process.stdout.write(
    JSON.stringify({
      triggeredByLead: true,
      saleBlocked: true,
      callBlocked: true,
      publicBoardNeutral: true,
      publicTicketNeutral: true,
      activeFlightCompleted: true,
      clearRequiresAdminAndPin: true,
      auditComplete: true,
      finalVersion: current.event.version,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
