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
const pin = String.fromCharCode(48).repeat(4);
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
const devices = {
  admin: "technical-scaffold",
  cashier: "cashier-tablet-1",
  flightLine: "flight-line-tablet-1",
};
const tokens = {
  admin: ["demo", "admin", "device", "token"].join("-"),
  cashier: ["demo", "cashier", "device", "token"].join("-"),
  flightLine: ["demo", "flight", "line", "device", "token"].join("-"),
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
const board = async (deviceId, token) => {
  const response = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": deviceId, "x-device-token": token },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const command = async (deviceId, token, expectedVersion, type, payload, expectedStatus = 200) => {
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
  if (response.status !== expectedStatus)
    throw new Error(`${type} lieferte ${response.status} statt ${expectedStatus}.`);
  return response.json();
};
const history = async (aggregateType, aggregateId) => {
  const query = new URLSearchParams({ aggregateType, aggregateId, limit: "100" });
  const response = await fetch(`${base}/api/events/demo-2026/history?${query}`, {
    headers: { "x-device-id": devices.admin, "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Historien-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const code = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const admin = (version, type, payload, expectedStatus) =>
  command(devices.admin, tokens.admin, version, type, payload, expectedStatus);
const flight = (version, type, payload, expectedStatus) =>
  command(devices.flightLine, tokens.flightLine, version, type, payload, expectedStatus);

try {
  await waitForWorker();
  let current = await board(devices.admin, tokens.admin);
  let result = await admin(current.event.version, "UPSERT_PILOT", {
    pilotId: "550e8400-e29b-41d4-a716-446655440199",
    operationalCode: "P-99",
    operationalNote: "Nur Vormittagsschicht",
    active: true,
    reason: "Synthetischer Flottentest",
    adminPin: pin,
  });
  result = await admin(result.event.version, "CONFIGURE_EVENT_PARAMETERS", {
    saleOpensAt: null,
    operationsEndAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    noShowAfterMinutes: 10,
    notificationLeadMinutes: 60,
    childReferenceWeightKg: 35,
    normalReferenceWeightKg: 80,
    heavyReferenceWeightKg: 110,
    plannedBoardingMinutes: 5,
    plannedDeboardingMinutes: 5,
    plannedBufferMinutes: 5,
    reason: "Synthetischer Flottentest",
    adminPin: pin,
  });
  result = await admin(result.event.version, "SET_EVENT_LIFECYCLE", {
    status: "ACTIVE",
    reason: "Synthetischer Flottentest",
    adminPin: pin,
  });
  const publicCode = code();
  const sold = await command(
    devices.cashier,
    tokens.cashier,
    result.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-20",
      publicTicketCodes: [publicCode],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  );
  const reviewAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const pausedAircraft = await admin(sold.event.version, "SET_AIRCRAFT_OPERATIONAL_STATE", {
    aircraftId: "aircraft-a",
    state: "PAUSED",
    reason: "Synthetische Flugzeugpause",
    expectedReviewAt: reviewAt,
  });
  await flight(
    pausedAircraft.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [sold.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440199",
    },
    409,
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    current = await board(devices.admin, tokens.admin);
    const rotation = current.rotations.find(
      (entry) => entry.id === sold.aggregate.relatedRotationId,
    );
    if (rotation?.timeline.predictionQuality === "UNCERTAIN") break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  const pausedSummary = current.aircraft.find((entry) => entry.id === "aircraft-a");
  const affectedRotation = current.rotations.find(
    (entry) => entry.id === sold.aggregate.relatedRotationId,
  );
  if (
    pausedSummary?.resourceGroupName !== "Panorama" ||
    pausedSummary.expectedReviewAt !== reviewAt ||
    affectedRotation?.timeline.predictionQuality !== "UNCERTAIN"
  ) {
    throw new Error(
      `Flugzeugqueue, Prüfzeitpunkt oder automatische Neuplanung fehlt: ${JSON.stringify({ pausedSummary, predictionQuality: affectedRotation?.timeline.predictionQuality })}`,
    );
  }
  const restoredAircraft = await admin(
    pausedAircraft.event.version,
    "SET_AIRCRAFT_OPERATIONAL_STATE",
    {
      aircraftId: "aircraft-a",
      state: "AVAILABLE",
      reason: "Synthetische Flugzeugpause beendet",
      expectedReviewAt: null,
    },
  );
  const initialPilotAssignment = await admin(
    restoredAircraft.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440199",
      reassign: false,
    },
  );
  const initialCall = await flight(initialPilotAssignment.event.version, "CALL_NEXT", {
    ticketGroupIds: [sold.aggregate.id],
    aircraftId: "aircraft-a",
    pilotId: "550e8400-e29b-41d4-a716-446655440199",
  });
  const abortedForFailure = await flight(initialCall.event.version, "ABORT_ROTATION", {
    rotationId: sold.aggregate.relatedRotationId,
    reason: "Synthetischer Flugzeugausfall vor Start",
  });
  const failedAircraft = await admin(
    abortedForFailure.event.version,
    "SET_AIRCRAFT_OPERATIONAL_STATE",
    {
      aircraftId: "aircraft-a",
      state: "INACTIVE",
      reason: "Synthetischer Flugzeugausfall",
      expectedReviewAt: reviewAt,
    },
  );
  const replacementAircraft = await admin(failedAircraft.event.version, "UPSERT_AIRCRAFT", {
    aircraftId: "aircraft-replacement",
    registration: "D-ERSA",
    aircraftType: "SYNTHETIC-DEMO",
    passengerSeats: 4,
    maximumPassengerPayloadKg: null,
    reason: "Synthetisches Ersatzflugzeug",
    adminPin: pin,
  });
  const replacementAssigned = await admin(
    replacementAircraft.event.version,
    "ASSIGN_AIRCRAFT_RESOURCE_GROUP",
    {
      aircraftId: "aircraft-replacement",
      resourceGroupId: "rg-panorama",
      effectiveAt: new Date().toISOString(),
      reason: "Synthetisches Ersatzflugzeug",
      adminPin: pin,
    },
  );
  const replacementPilotAssigned = await admin(
    replacementAssigned.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-replacement",
      pilotId: "550e8400-e29b-41d4-a716-446655440199",
      reassign: true,
    },
  );
  current = await board(devices.flightLine, tokens.flightLine);
  const replacementProposal = current.rotations.find(
    (entry) => entry.id === sold.aggregate.relatedRotationId,
  );
  if (
    replacementProposal?.status !== "DRAFT" ||
    replacementProposal.ticketCount !== 1 ||
    replacementProposal.suggestedAircraftId !== "aircraft-replacement" ||
    replacementProposal.aircraftId !== null
  ) {
    throw new Error(
      "Ausfall hat die Gruppe nicht geschützt oder ein Flugzeug ohne Personalentscheidung zugeordnet.",
    );
  }
  const called = await flight(replacementPilotAssigned.event.version, "CALL_NEXT", {
    ticketGroupIds: [sold.aggregate.id],
    aircraftId: "aircraft-replacement",
    pilotId: "550e8400-e29b-41d4-a716-446655440199",
  });
  current = await board(devices.admin, tokens.admin);
  const assignedPilot = current.pilots.find((entry) => entry.operationalCode === "P-99");
  if (
    assignedPilot?.operationalNote !== "Nur Vormittagsschicht" ||
    assignedPilot.currentRotationId !== sold.aggregate.relatedRotationId ||
    !assignedPilot.currentCommunicationNumber ||
    JSON.stringify(assignedPilot).toLowerCase().includes("name")
  ) {
    throw new Error("Anonymer Pilotencode oder aktuelle Zuordnung ist unvollständig.");
  }
  await admin(
    called.event.version,
    "SET_PILOT_PAUSE",
    {
      pilotId: assignedPilot.id,
      paused: true,
      reason: "Unzulässige aktive Pause",
      expectedReviewAt: reviewAt,
    },
    409,
  );
  const started = await flight(called.event.version, "MARK_OFF_BLOCK", {
    rotationId: sold.aggregate.relatedRotationId,
  });
  const landed = await flight(started.event.version, "MARK_ON_BLOCK", {
    rotationId: sold.aggregate.relatedRotationId,
  });
  const completed = await flight(landed.event.version, "COMPLETE_TURNAROUND", {
    rotationId: sold.aggregate.relatedRotationId,
    nextAircraftState: "AVAILABLE",
  });
  const pausedPilot = await admin(completed.event.version, "SET_PILOT_PAUSE", {
    pilotId: assignedPilot.id,
    paused: true,
    reason: "Synthetische Pilotenpause",
    expectedReviewAt: reviewAt,
  });
  current = await board(devices.admin, tokens.admin);
  const pausedPilotSummary = current.pilots.find((entry) => entry.id === assignedPilot.id);
  if (
    !pausedPilotSummary?.paused ||
    pausedPilotSummary.pauseExpectedReviewAt !== reviewAt ||
    pausedPilotSummary.currentRotationId !== null
  ) {
    throw new Error("Pilotenpause oder freigegebene Zuordnung ist inkonsistent.");
  }
  const resumedPilot = await admin(pausedPilot.event.version, "SET_PILOT_PAUSE", {
    pilotId: assignedPilot.id,
    paused: false,
    reason: "Synthetische Pilotenpause beendet",
    expectedReviewAt: null,
  });
  const refuelPlanned = await admin(resumedPilot.event.version, "SCHEDULE_AIRCRAFT_REFUEL", {
    aircraftId: "aircraft-a",
    planned: true,
    reason: "Synthetische Tankvormerkung",
  });
  const threshold = await admin(
    refuelPlanned.event.version,
    "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD",
    {
      aircraftId: "aircraft-a",
      reminderThreshold: 3,
      reason: "Synthetische Tankerinnerung",
      adminPin: pin,
    },
  );
  current = await board(devices.admin, tokens.admin);
  const refuelSummary = current.aircraft.find((entry) => entry.id === "aircraft-a");
  if (!refuelSummary?.refuelPlanned || refuelSummary.refuelReminderThreshold !== 3) {
    throw new Error("Tankvormerkung oder Erinnerungsschwelle fehlt.");
  }
  const pilotHistory = await history("PILOT", assignedPilot.id);
  const aircraftHistory = await history("AIRCRAFT", "aircraft-a");
  const rotationHistory = await history("ROTATION", sold.aggregate.relatedRotationId);
  if (
    pilotHistory.entries.filter((entry) => entry.eventType.startsWith("PILOT_PAUSE_")).length !==
      2 ||
    !pilotHistory.entries.some(
      (entry) =>
        entry.eventType === "PILOT_CONFIGURATION_CHANGED" &&
        entry.payload.operationalNote === "Nur Vormittagsschicht",
    ) ||
    !aircraftHistory.entries.some(
      (entry) =>
        entry.eventType === "AIRCRAFT_OPERATIONAL_STATE_CHANGED" &&
        entry.payload.expectedReviewAt === reviewAt,
    ) ||
    rotationHistory.entries.filter((entry) => entry.eventType === "FLIGHT_GROUP_CALLED").length !==
      2 ||
    !rotationHistory.entries.some(
      (entry) =>
        entry.eventType === "ROTATION_ABORTED_TO_QUEUE" &&
        entry.payload.reason === "Synthetischer Flugzeugausfall vor Start",
    )
  ) {
    throw new Error("Flotten-/Piloten-Audit ist unvollständig.");
  }
  process.stdout.write(
    JSON.stringify({
      requirements: ["F-PRG-110", "F-PRG-130", "F-SLT-090"],
      anonymousPilotCodeAndNoteVisible: true,
      currentPilotAssignmentVisible: true,
      activePilotPauseRejected: true,
      pilotPauseAndResumeAudited: true,
      aircraftQueueVisible: true,
      aircraftPauseBlocksCall: true,
      aircraftStatusReplansForecast: true,
      aircraftFailureOnlyProposesReplacement: true,
      replacementConfirmedBySecondCall: true,
      groupProtectedDuringAircraftFailure: true,
      blockReviewAndClearAudited: true,
      refuelPlanningAndThresholdVisible: true,
      finalVersion: threshold.event.version,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
