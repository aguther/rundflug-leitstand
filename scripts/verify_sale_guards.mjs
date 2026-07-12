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

const pin = "0000";
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
    `ADMIN_PIN_HASH:${createHash("sha256").update(pin).digest("hex")}`,
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);

const base = "http://127.0.0.1:8787";
const eventId = "demo-2026";
const devices = { admin: "technical-scaffold", cashier: "cashier-tablet-1" };
const tokens = {
  admin: ["demo", "admin", "device", "token"].join("-"),
  cashier: ["demo", "cashier", "device", "token"].join("-"),
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

const command = async (actor, expectedVersion, type, payload, expectedStatus = 200) => {
  const response = await fetch(`${base}/api/events/${eventId}/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-token": tokens[actor],
    },
    body: JSON.stringify({
      commandId: randomUUID(),
      eventId,
      deviceId: devices[actor],
      expectedVersion,
      issuedAt: new Date().toISOString(),
      type,
      payload,
    }),
  });
  const body = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${type} lieferte ${response.status} statt ${expectedStatus}: ${JSON.stringify(body)}`,
    );
  }
  return body;
};

const board = async () => {
  const response = await fetch(`${base}/api/events/${eventId}/operations`, {
    headers: {
      "x-device-id": devices.cashier,
      "x-device-token": tokens.cashier,
    },
  });
  if (!response.ok) throw new Error(`Kassenlage konnte nicht geladen werden (${response.status}).`);
  return response.json();
};

const code = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const salePayload = () => ({
  productId: "panorama-20",
  publicTicketCodes: [code()],
  standby: false,
  paymentStatus: "PAID",
  paymentMethod: "CASH",
  // Absichtlicher Fremdinput: Die Kasse darf keine operative Zuordnung festlegen.
  aircraftId: "aircraft-a",
  pilotId: "550e8400-e29b-41d4-a716-446655440100",
});
const expectBlocked = async (version, expectedCode) => {
  const result = await command("cashier", version, "SELL_TICKET_GROUP", salePayload(), 409);
  if (result.error?.code !== expectedCode) {
    throw new Error(
      `Erwartete Verkaufssperre ${expectedCode}, erhalten: ${JSON.stringify(result)}`,
    );
  }
};
const eventParameters = (overrides = {}) => ({
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
  reason: "Synthetischer Verkaufsschutztest",
  adminPin: pin,
  ...overrides,
});
const salesConfiguration = (overrides = {}) => ({
  productId: "panorama-20",
  saleEnabled: true,
  saleClosesAt: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
  warningThreshold: 8,
  criticalThreshold: 3,
  reason: "Synthetischer Verkaufsschutztest",
  adminPin: pin,
  ...overrides,
});

try {
  await waitForWorker();
  let current = await board();
  await expectBlocked(current.event.version, "SALE_BLOCKED_EVENT_STATUS");

  let result = await command(
    "admin",
    current.event.version,
    "CONFIGURE_EVENT_PARAMETERS",
    eventParameters({ saleOpensAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
  );
  result = await command("admin", result.event.version, "SET_EVENT_LIFECYCLE", {
    status: "ACTIVE",
    reason: "Synthetischer Verkaufsschutztest",
    adminPin: pin,
  });
  await expectBlocked(result.event.version, "SALE_NOT_OPEN");

  result = await command(
    "admin",
    result.event.version,
    "CONFIGURE_EVENT_PARAMETERS",
    eventParameters(),
  );
  result = await command(
    "admin",
    result.event.version,
    "CONFIGURE_PRODUCT_SALES",
    salesConfiguration({ saleEnabled: false, saleClosesAt: null }),
  );
  await expectBlocked(result.event.version, "SALE_BLOCKED_PRODUCT");

  result = await command(
    "admin",
    result.event.version,
    "CONFIGURE_PRODUCT_SALES",
    salesConfiguration({ saleClosesAt: new Date(Date.now() - 60_000).toISOString() }),
  );
  await expectBlocked(result.event.version, "SALE_BLOCKED_CLOSING");

  result = await command(
    "admin",
    result.event.version,
    "CONFIGURE_PRODUCT_SALES",
    salesConfiguration(),
  );
  result = await command("admin", result.event.version, "SET_RESOURCE_GROUP_STATUS", {
    resourceGroupId: "rg-panorama",
    status: "PAUSED",
    reason: "Synthetischer Verkaufsschutztest",
    expectedReviewAt: null,
  });
  await expectBlocked(result.event.version, "SALE_BLOCKED_RESOURCE_GROUP");

  result = await command("admin", result.event.version, "SET_RESOURCE_GROUP_STATUS", {
    resourceGroupId: "rg-panorama",
    status: "ACTIVE",
    reason: "Synthetischer Verkaufsschutztest",
    expectedReviewAt: null,
  });
  result = await command("admin", result.event.version, "SET_EVENT_INTERRUPTION", {
    interrupted: true,
    reason: "Synthetischer Verkaufsschutztest",
    expectedReviewAt: null,
  });
  await expectBlocked(result.event.version, "SALE_BLOCKED_INTERRUPTION");

  result = await command("admin", result.event.version, "SET_EVENT_INTERRUPTION", {
    interrupted: false,
    reason: "Synthetischer Verkaufsschutztest",
    expectedReviewAt: null,
  });
  result = await command("admin", result.event.version, "TRIGGER_EMERGENCY", {
    reason: "Synthetischer Verkaufsschutztest",
  });
  await expectBlocked(result.event.version, "SALE_BLOCKED_EMERGENCY");
  result = await command("admin", result.event.version, "CLEAR_EMERGENCY", {
    reason: "Synthetischer Verkaufsschutztest",
    adminPin: pin,
  });

  result = await command(
    "admin",
    result.event.version,
    "CONFIGURE_EVENT_PARAMETERS",
    eventParameters({ operationsEndAt: new Date(Date.now() + 60_000).toISOString() }),
  );
  await expectBlocked(result.event.version, "SALE_BLOCKED_CAPACITY");

  result = await command(
    "admin",
    result.event.version,
    "CONFIGURE_EVENT_PARAMETERS",
    eventParameters(),
  );
  const sold = await command("cashier", result.event.version, "SELL_TICKET_GROUP", salePayload());
  current = await board();
  const rotation = current.rotations.find(
    (entry) => entry.id === sold.aggregate?.relatedRotationId,
  );
  if (!rotation || rotation.aircraftId !== null || rotation.pilotId !== null) {
    throw new Error("Kassenverkauf hat unzulässig Flugzeug oder Pilot fest zugeordnet.");
  }

  process.stdout.write(
    JSON.stringify({
      eventLifecycleBlocked: true,
      saleOpeningBlocked: true,
      productBlocked: true,
      saleClosingBlocked: true,
      resourceGroupBlocked: true,
      interruptionBlocked: true,
      emergencyBlocked: true,
      insufficientCapacityBlocked: true,
      validSaleAccepted: true,
      cashierCannotAssignAircraftOrPilot: true,
    }),
  );
} finally {
  server.kill();
}
