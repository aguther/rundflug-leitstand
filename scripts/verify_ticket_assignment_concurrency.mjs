import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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

const pin = "0000";
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
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);

const base = "http://127.0.0.1:8787";
const eventId = "demo-2026";
const actors = {
  admin: {
    deviceId: "technical-scaffold",
    token: ["demo", "admin", "device", "token"].join("-"),
  },
  cashier: {
    deviceId: "cashier-tablet-1",
    token: ["demo", "cashier", "device", "token"].join("-"),
  },
  flightLine: {
    deviceId: "flight-line-tablet-1",
    token: ["demo", "flight", "line", "device", "token"].join("-"),
  },
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

const postCommand = async (actor, expectedVersion, type, payload) => {
  const response = await fetch(`${base}/api/events/${eventId}/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-token": actors[actor].token,
    },
    body: JSON.stringify({
      commandId: randomUUID(),
      eventId,
      deviceId: actors[actor].deviceId,
      expectedVersion,
      issuedAt: new Date().toISOString(),
      type,
      payload,
    }),
  });
  return { status: response.status, body: await response.json() };
};

const accept = async (actor, version, type, payload) => {
  const result = await postCommand(actor, version, type, payload);
  if (result.status !== 200) {
    throw new Error(`${type} wurde unerwartet abgewiesen: ${JSON.stringify(result)}`);
  }
  return result.body;
};

const board = async () => {
  const response = await fetch(`${base}/api/events/${eventId}/operations`, {
    headers: {
      "x-device-id": actors.admin.deviceId,
      "x-device-token": actors.admin.token,
    },
  });
  if (!response.ok) throw new Error(`Leitstand konnte nicht geladen werden (${response.status}).`);
  return response.json();
};

const history = async () => {
  const response = await fetch(`${base}/api/events/${eventId}/history?limit=50`, {
    headers: {
      "x-device-id": actors.admin.deviceId,
      "x-device-token": actors.admin.token,
    },
  });
  if (!response.ok) throw new Error(`Historie konnte nicht geladen werden (${response.status}).`);
  return response.json();
};

const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");

try {
  await waitForWorker();
  let current = await board();
  let result = await accept("admin", current.event.version, "CONFIGURE_EVENT_PARAMETERS", {
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
    reason: "Synthetischer Parallelitätstest",
    adminPin: pin,
  });
  result = await accept("admin", result.event.version, "SET_EVENT_LIFECYCLE", {
    status: "ACTIVE",
    reason: "Synthetischer Parallelitätstest",
    adminPin: pin,
  });
  const sold = await accept("cashier", result.event.version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicTicketCodes: [ticketCode()],
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });

  current = await board();
  const rotation = current.rotations.find(
    (entry) => entry.id === sold.aggregate?.relatedRotationId,
  );
  const ticketId = rotation?.tickets[0]?.id;
  if (!rotation || !ticketId) throw new Error("Verkaufter Testumlauf wurde nicht gefunden.");

  const [callAttempt, deferAttempt] = await Promise.all([
    postCommand("admin", sold.event.version, "CALL_NEXT", {
      ticketGroupIds: [sold.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    }),
    postCommand("flightLine", sold.event.version, "DEFER_TICKET_GROUP", {
      ticketGroupId: rotation.ticketGroupId,
      reason: "Synthetischer konkurrierender Bedienversuch",
    }),
  ]);
  const attempts = [callAttempt, deferAttempt];
  if (
    attempts.filter((attempt) => attempt.status === 200).length !== 1 ||
    attempts.filter(
      (attempt) => attempt.status === 409 && attempt.body.error?.code === "STALE_VERSION",
    ).length !== 1
  ) {
    throw new Error(
      `Parallelkommandos wurden nicht exakt einmal akzeptiert: ${JSON.stringify(attempts)}`,
    );
  }

  current = await board();
  const activeOccurrences = current.rotations
    .filter((entry) => entry.status !== "COMPLETED")
    .flatMap((entry) => entry.tickets)
    .filter((ticket) => ticket.id === ticketId).length;
  if (activeOccurrences !== 1) {
    throw new Error(`Ticket ist ${activeOccurrences}-mal in offenen Umläufen aktiv.`);
  }
  const ledger = await history();
  const acceptedEvents = ledger.entries.filter((entry) =>
    ["FLIGHT_GROUP_CALLED", "TICKET_GROUP_DEFERRED"].includes(entry.eventType),
  );
  if (acceptedEvents.length !== 1) {
    throw new Error("Der Parallelkonflikt erzeugte nicht exakt ein fachliches Audit-Ereignis.");
  }

  process.stdout.write(
    JSON.stringify({
      parallelDevices: [actors.admin.deviceId, actors.flightLine.deviceId],
      oneCommandAccepted: true,
      staleWriteRejected: true,
      activeTicketAssignments: activeOccurrences,
      auditEvents: acceptedEvents.length,
    }),
  );
} finally {
  server.kill();
}
