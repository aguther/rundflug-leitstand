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
const tokens = {
  admin: "demo-admin-device-token",
  cashier: "demo-cashier-device-token",
  flightLine: "demo-flight-line-device-token",
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
const board = async () => {
  const response = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": "technical-scaffold", "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const command = async (
  deviceId,
  token,
  expectedVersion,
  type,
  payload,
  expectedStatus = 200,
  commandId = randomUUID(),
) => {
  const response = await fetch(`${base}/api/events/demo-2026/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": token },
    body: JSON.stringify({
      commandId,
      eventId: "demo-2026",
      deviceId,
      expectedVersion,
      issuedAt: new Date().toISOString(),
      type,
      payload,
    }),
  });
  const result = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${type} lieferte ${response.status} statt ${expectedStatus}: ${JSON.stringify(result)}`,
    );
  }
  return result;
};
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const sell = (version, size) =>
  command("cashier-tablet-1", tokens.cashier, version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicTicketCodes: Array.from({ length: size }, ticketCode),
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
    oversizeSplitAcknowledged: false,
  });
const history = async (aggregateType, aggregateId) => {
  const query = new URLSearchParams({ aggregateType, aggregateId });
  const response = await fetch(`${base}/api/events/demo-2026/history?${query}`, {
    headers: { "x-device-id": "technical-scaffold", "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Historienabruf fehlgeschlagen (${response.status}).`);
  return response.json();
};

try {
  await waitForWorker();
  let current = await board();
  let result = await command(
    "technical-scaffold",
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
      reason: "Synthetischer V1.5-Gruppentest",
      adminPin: pin,
    },
  );
  result = await command(
    "technical-scaffold",
    tokens.admin,
    result.event.version,
    "SET_EVENT_LIFECYCLE",
    { status: "ACTIVE", reason: "Synthetischer V1.5-Gruppentest", adminPin: pin },
  );

  const pair = await sell(result.event.version, 2);
  const single = await sell(pair.event.version, 1);
  const triple = await sell(single.event.version, 3);
  current = await board();
  const groupIds = [pair.aggregate.id, single.aggregate.id, triple.aggregate.id];
  const rotations = groupIds.map((groupId) =>
    current.rotations.find((rotation) =>
      rotation.bookingGroups.some((group) => group.id === groupId),
    ),
  );
  if (
    new Set(rotations.map((rotation) => rotation?.id)).size !== 3 ||
    rotations.map((rotation) => rotation?.ticketCount).join(",") !== "2,1,3" ||
    current.queueGroups.filter((group) => groupIds.includes(group.id)).length !== 3
  ) {
    throw new Error("Verkäufe 2/1/3 blieben nicht als explizite ganze Gruppen sichtbar.");
  }

  const wrongRole = await command(
    "cashier-tablet-1",
    tokens.cashier,
    triple.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [pair.aggregate.id, single.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    403,
  );
  const overCapacity = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    triple.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [pair.aggregate.id, triple.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    409,
  );
  if (
    wrongRole.error?.code !== "ROLE_NOT_AUTHORIZED" ||
    overCapacity.error?.code !== "AIRCRAFT_CAPACITY_EXCEEDED"
  ) {
    throw new Error("Rolle oder Kapazität schützt die Gruppenkombination nicht.");
  }

  const callCommandId = randomUUID();
  const called = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    triple.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [pair.aggregate.id, single.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    200,
    callCommandId,
  );
  const duplicate = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    triple.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [pair.aggregate.id, single.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    200,
    callCommandId,
  );
  const stale = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    triple.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [triple.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    409,
  );
  current = await board();
  const combined = current.rotations.find(
    (rotation) => rotation.id === pair.aggregate.relatedRotationId,
  );
  if (
    combined?.ticketCount !== 3 ||
    combined.bookingGroups.length !== 2 ||
    combined.tickets.some((ticket) => ticket.status !== "BOARDING") ||
    current.rotations.some((rotation) => rotation.id === single.aggregate.relatedRotationId) ||
    duplicate.duplicate !== true ||
    stale.error?.code !== "STALE_VERSION"
  ) {
    throw new Error(
      "Atomare Kombination 2+1, Idempotenz oder stale-write-Schutz ist inkonsistent.",
    );
  }

  const attendance = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    called.event.version,
    "SET_TICKET_GROUP_ATTENDANCE",
    { ticketGroupId: pair.aggregate.id, checkedIn: true },
  );
  const recalled = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    attendance.event.version,
    "RECALL_TICKET_GROUP",
    { ticketGroupId: single.aggregate.id },
  );
  const missing = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    recalled.event.version,
    "MARK_TICKET_GROUP_MISSING",
    { ticketGroupId: single.aggregate.id, reason: "Synthetisch nicht am Gate" },
  );
  const attendanceHistory = await history("TICKET_GROUP", single.aggregate.id);
  if (
    !attendanceHistory.entries.some((entry) => entry.eventType === "TICKET_GROUP_RECALLED") ||
    !attendanceHistory.entries.some((entry) => entry.eventType === "TICKET_GROUP_MARKED_MISSING")
  ) {
    throw new Error("Manuelle Anwesenheit, Nachruf oder Nicht-da-Audit fehlt.");
  }

  const started = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    missing.event.version,
    "MARK_OFF_BLOCK",
    { rotationId: combined.id },
  );
  const rejectedLateComposition = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    started.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [triple.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    409,
  );
  if (rejectedLateComposition.error?.code !== "AIRCRAFT_NOT_AVAILABLE") {
    throw new Error("Belegtes Flugzeug wurde für eine parallele Gruppe nicht gesperrt.");
  }

  console.log(
    JSON.stringify({
      explicitQueueGroups: true,
      stableCommunicationIds: true,
      wholeGroupCombination2Plus1: true,
      capacityProtected: true,
      wrongRoleRejected: true,
      idempotentCall: true,
      staleWriteRejected: true,
      manualAttendanceAudited: true,
      finalVersion: started.event.version,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
