import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const stateDirectory = resolve(root, ".wrangler", "queue-grouping-state");
await rm(stateDirectory, { force: true, recursive: true });
const initializeD1 = (args) =>
  spawnSync(
    process.execPath,
    [
      wranglerBin,
      "d1",
      ...args,
      "--local",
      "--persist-to",
      stateDirectory,
      "--config",
      "wrangler.jsonc",
    ],
    { cwd: root, stdio: "ignore" },
  );
const migrate = initializeD1(["migrations", "apply", "DB"]);
const seed = initializeD1(["execute", "DB", "--file", "apps/worker/seed/demo.sql"]);
if (migrate.status !== 0 || seed.status !== 0) {
  throw new Error("Isolierte lokale Testdatenbank konnte nicht initialisiert werden.");
}
const constrainAircraft = spawnSync(
  process.execPath,
  [
    wranglerBin,
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    stateDirectory,
    "--config",
    "wrangler.jsonc",
    "--command",
    "UPDATE aircraft SET passenger_seats = 3 WHERE id = 'aircraft-a'",
  ],
  { cwd: root, stdio: "ignore" },
);
if (constrainAircraft.status !== 0) {
  throw new Error("Synthetische Flugzeugkapazität konnte nicht auf drei Plätze gesetzt werden.");
}
const pin = "0000";
const server = spawn(
  process.execPath,
  [
    wranglerBin,
    "dev",
    "--config",
    "wrangler.jsonc",
    "--var",
    "APP_ENV:development",
    "--var",
    "DATA_JURISDICTION:eu",
    "--var",
    `ADMIN_PIN_HASH:${createHash("sha256").update(pin).digest("hex")}`,
    "--persist-to",
    stateDirectory,
    "--port",
    "8794",
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = "http://127.0.0.1:8794";
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
const ticketGroupSearch = async (ticketGroupId) => {
  const query = new URLSearchParams({ id: ticketGroupId, limit: "20", q: "", status: "ACTIVE" });
  const response = await fetch(`${base}/api/control/demo-2026/tickets/search?${query}`, {
    headers: { "x-device-id": "cashier-tablet-1", "x-device-token": tokens.cashier },
  });
  if (!response.ok) throw new Error(`Ticketsuche fehlgeschlagen (${response.status}).`);
  const result = await response.json();
  return result.results.find((entry) => entry.ticketGroupId === ticketGroupId);
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
const sell = (version, size, oversizeSplitAcknowledged = false) =>
  command("cashier-tablet-1", tokens.cashier, version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicTicketCodes: Array.from({ length: size }, ticketCode),
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
    oversizeSplitAcknowledged,
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
      reason: "Synthetischer V1.7-Gruppentest",
      adminPin: pin,
    },
  );
  result = await command(
    "technical-scaffold",
    tokens.admin,
    result.event.version,
    "SET_EVENT_LIFECYCLE",
    { status: "ACTIVE", reason: "Synthetischer V1.7-Gruppentest", adminPin: pin },
  );

  const oversized = await sell(result.event.version, 4, true);
  current = await board();
  const initialOversizedQueue = current.queueGroups.find(
    (group) => group.id === oversized.aggregate.id,
  );
  if (
    initialOversizedQueue?.ticketCount !== 4 ||
    initialOversizedQueue.nextSegmentTicketCount !== 3 ||
    initialOversizedQueue.segmentIndex !== 1 ||
    initialOversizedQueue.segmentCount !== 2
  ) {
    throw new Error(
      `Die Vierergruppe wird nicht als nächster Abschnitt 3 von 4 angeboten: ${JSON.stringify(initialOversizedQueue)}`,
    );
  }

  const firstSegmentCalled = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    oversized.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [oversized.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  current = await board();
  const oversizedRotationsAfterFirstCall = current.rotations.filter((rotation) =>
    rotation.bookingGroups.some((group) => group.id === oversized.aggregate.id),
  );
  const calledOversizedSegment = oversizedRotationsAfterFirstCall.find(
    (rotation) => rotation.status === "CALLED",
  );
  const draftOversizedSegment = oversizedRotationsAfterFirstCall.find(
    (rotation) => rotation.status === "DRAFT",
  );
  const remainingOversizedQueue = current.queueGroups.find(
    (group) => group.id === oversized.aggregate.id,
  );
  if (
    calledOversizedSegment?.ticketCount !== 3 ||
    draftOversizedSegment?.ticketCount !== 1 ||
    remainingOversizedQueue?.ticketCount !== 4 ||
    remainingOversizedQueue.nextSegmentTicketCount !== 1 ||
    remainingOversizedQueue.segmentIndex !== 2 ||
    remainingOversizedQueue.segmentCount !== 2 ||
    remainingOversizedQueue.status !== "QUEUED"
  ) {
    throw new Error(
      "Nach dem ersten Aufruf bleibt die verbundene Restgruppe 1 von 4 inkonsistent.",
    );
  }

  const firstSegmentStarted = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    firstSegmentCalled.event.version,
    "MARK_OFF_BLOCK",
    { rotationId: calledOversizedSegment.id },
  );
  const firstSegmentLanded = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    firstSegmentStarted.event.version,
    "MARK_ON_BLOCK",
    { rotationId: calledOversizedSegment.id },
  );
  const firstSegmentCompleted = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    firstSegmentLanded.event.version,
    "COMPLETE_TURNAROUND",
    { rotationId: calledOversizedSegment.id, nextAircraftState: "AVAILABLE" },
  );
  const secondSegmentCalled = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    firstSegmentCompleted.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [oversized.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  current = await board();
  const secondCalledOversizedSegment = current.rotations.find(
    (rotation) =>
      rotation.status === "CALLED" &&
      rotation.bookingGroups.some((group) => group.id === oversized.aggregate.id),
  );
  const oversizedTicketGroupAfterSecondCall = await ticketGroupSearch(oversized.aggregate.id);
  if (
    secondCalledOversizedSegment?.ticketCount !== 1 ||
    current.queueGroups.some((group) => group.id === oversized.aggregate.id) ||
    oversizedTicketGroupAfterSecondCall?.groupStatus !== "BOARDING"
  ) {
    throw new Error(
      `Der zweite Abschnitt 1 von 4 wurde nicht mit verbundenem Gruppenstatus aufgerufen: ${JSON.stringify({ secondCalledOversizedSegment, oversizedTicketGroupAfterSecondCall, queue: current.queueGroups.filter((group) => group.id === oversized.aggregate.id) })}`,
    );
  }
  const secondSegmentStarted = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    secondSegmentCalled.event.version,
    "MARK_OFF_BLOCK",
    { rotationId: secondCalledOversizedSegment.id },
  );
  const secondSegmentLanded = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    secondSegmentStarted.event.version,
    "MARK_ON_BLOCK",
    { rotationId: secondCalledOversizedSegment.id },
  );
  result = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    secondSegmentLanded.event.version,
    "COMPLETE_TURNAROUND",
    { rotationId: secondCalledOversizedSegment.id, nextAircraftState: "AVAILABLE" },
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
      oversizedGroupThreePlusOne: true,
      connectedStatusAcrossSegments: true,
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
