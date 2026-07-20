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
const admin = (version, type, payload) =>
  command("technical-scaffold", tokens.admin, version, type, payload);
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const sell = (version) =>
  command("cashier-tablet-1", tokens.cashier, version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicTicketCodes: Array.from({ length: 4 }, ticketCode),
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });
const history = async (aggregateType, aggregateId) => {
  const query = new URLSearchParams({ aggregateType, aggregateId });
  const response = await fetch(`${base}/api/events/demo-2026/history?${query}`, {
    headers: { "x-device-id": "technical-scaffold", "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Historien-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};

try {
  await waitForWorker();
  let current = await board();
  let result = await admin(current.event.version, "UPSERT_AIRCRAFT", {
    aircraftId: "aircraft-too-small",
    registration: "D-AAAA",
    aircraftType: "SYNTHETIC-DEMO",
    passengerSeats: 2,
    maximumPassengerPayloadKg: null,
    reason: "Synthetischer Kapazitätsvorschlagstest",
    adminPin: pin,
  });
  result = await admin(result.event.version, "ASSIGN_AIRCRAFT_RESOURCE_GROUP", {
    aircraftId: "aircraft-too-small",
    resourceGroupId: "rg-panorama",
    effectiveAt: new Date().toISOString(),
    reason: "Synthetischer Kapazitätsvorschlagstest",
    adminPin: pin,
  });
  result = await admin(result.event.version, "UPSERT_AIRCRAFT", {
    aircraftId: "aircraft-b",
    registration: "D-TEST",
    aircraftType: "Synthetic-4",
    passengerSeats: 4,
    maximumPassengerPayloadKg: null,
    reason: "Synthetischer Pilotenkonflikttest",
    adminPin: pin,
  });
  result = await admin(result.event.version, "ASSIGN_AIRCRAFT_RESOURCE_GROUP", {
    aircraftId: "aircraft-b",
    resourceGroupId: "rg-panorama",
    effectiveAt: new Date().toISOString(),
    reason: "Synthetischer Pilotenkonflikttest",
    adminPin: pin,
  });
  result = await admin(result.event.version, "UPSERT_PILOT", {
    pilotId: "550e8400-e29b-41d4-a716-446655440200",
    operationalCode: "P-02",
    operationalNote: "",
    active: true,
    reason: "Synthetischer Pilotenkonflikttest",
    adminPin: pin,
  });
  result = await admin(result.event.version, "UPSERT_PILOT", {
    pilotId: "550e8400-e29b-41d4-a716-446655440300",
    operationalCode: "P-03",
    operationalNote: "",
    active: false,
    reason: "Synthetischer Pilotenkonflikttest",
    adminPin: pin,
  });
  current = await board();
  const stateChangedAtBeforeMasterData = current.aircraft.find(
    (aircraft) => aircraft.id === "aircraft-a",
  )?.operationalStateChangedAt;
  if (!stateChangedAtBeforeMasterData) {
    throw new Error("Zeitpunkt des operativen Flugzeugstatus fehlt in der Operationssicht.");
  }
  result = await admin(result.event.version, "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD", {
    aircraftId: "aircraft-a",
    reminderThreshold: 4,
    reason: "Synthetischer Stammdaten-Zeitstempeltest",
    adminPin: pin,
  });
  current = await board();
  if (
    current.aircraft.find((aircraft) => aircraft.id === "aircraft-a")?.operationalStateChangedAt !==
    stateChangedAtBeforeMasterData
  ) {
    throw new Error("Reine Stammdatenänderung hat den operativen Statuszeitpunkt verändert.");
  }
  result = await admin(result.event.version, "CONFIGURE_EVENT_PARAMETERS", {
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
    reason: "Synthetischer Pilotenkonflikttest",
    adminPin: pin,
  });
  result = await admin(result.event.version, "SET_EVENT_LIFECYCLE", {
    status: "ACTIVE",
    reason: "Synthetischer Pilotenkonflikttest",
    adminPin: pin,
  });
  const inactivePilot = await command(
    "technical-scaffold",
    tokens.admin,
    result.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440300",
      reassign: false,
    },
    409,
  );
  if (inactivePilot.error?.code !== "PILOT_NOT_AVAILABLE") {
    throw new Error("Inaktiver Pilotencode wurde nicht abgewiesen.");
  }
  result = await admin(result.event.version, "SET_PILOT_PAUSE", {
    pilotId: "550e8400-e29b-41d4-a716-446655440200",
    paused: true,
    reason: "Synthetischer Pausentest",
    expectedReviewAt: null,
  });
  const pausedPilot = await command(
    "technical-scaffold",
    tokens.admin,
    result.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440200",
      reassign: false,
    },
    409,
  );
  if (pausedPilot.error?.code !== "PILOT_NOT_AVAILABLE") {
    throw new Error("Pausierter Pilotencode wurde nicht abgewiesen.");
  }
  result = await admin(result.event.version, "SET_PILOT_PAUSE", {
    pilotId: "550e8400-e29b-41d4-a716-446655440200",
    paused: false,
    reason: "Synthetischer Pausentest beendet",
    expectedReviewAt: null,
  });
  const firstSale = await sell(result.event.version);
  current = await board();
  const capacitySafeProposal = current.rotations.find(
    (rotation) => rotation.id === firstSale.aggregate.relatedRotationId,
  );
  if (capacitySafeProposal?.suggestedAircraftId !== "aircraft-a") {
    throw new Error("Zu kleines Flugzeug wurde für eine Vierergruppe vorgeschlagen.");
  }
  const undersizedCall = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    firstSale.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [firstSale.aggregate.id],
      aircraftId: "aircraft-too-small",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    409,
  );
  if (undersizedCall.error?.code !== "AIRCRAFT_CAPACITY_EXCEEDED") {
    throw new Error("Konkrete Flugzeugkapazität wurde beim NEXT nicht hart durchgesetzt.");
  }
  const secondSale = await sell(firstSale.event.version);
  const firstPilotAssignment = await admin(secondSale.event.version, "ASSIGN_AIRCRAFT_PILOT", {
    aircraftId: "aircraft-b",
    pilotId: "550e8400-e29b-41d4-a716-446655440100",
    reassign: true,
  });
  const firstCall = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    firstPilotAssignment.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [secondSale.aggregate.id],
      aircraftId: "aircraft-b",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  const conflict = await command(
    "technical-scaffold",
    tokens.admin,
    firstCall.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
      reassign: false,
    },
    409,
  );
  if (conflict.error?.code !== "PILOT_ASSIGNED_ACTIVE_ROTATION") {
    throw new Error(
      "Parallele Pilotenzuordnung wurde nicht mit dem erwarteten Konflikt abgewiesen.",
    );
  }
  const secondPilotAssignment = await admin(firstCall.event.version, "ASSIGN_AIRCRAFT_PILOT", {
    aircraftId: "aircraft-a",
    pilotId: "550e8400-e29b-41d4-a716-446655440200",
    reassign: false,
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  const secondCall = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    secondPilotAssignment.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [firstSale.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440200",
    },
  );
  current = await board();
  const active = current.rotations.filter((rotation) => rotation.status === "CALLED");
  if (
    secondCall.event.version !== current.event.version ||
    active.length !== 2 ||
    new Set(active.map((rotation) => rotation.pilotId)).size !== 2
  ) {
    throw new Error("Konfliktfreie Pilotenzuordnungen sind in der Operationssicht inkonsistent.");
  }
  const busySale = await sell(secondCall.event.version);
  current = await board();
  const earliestBusyProposal = current.rotations.find(
    (rotation) => rotation.id === busySale.aggregate.relatedRotationId,
  );
  if (earliestBusyProposal?.suggestedAircraftId !== "aircraft-b") {
    throw new Error("Das zeitlich früher verfügbare laufende Flugzeug wurde nicht vorgeschlagen.");
  }
  let transition = busySale;
  for (const rotationId of [
    firstSale.aggregate.relatedRotationId,
    secondSale.aggregate.relatedRotationId,
  ]) {
    for (const type of ["MARK_OFF_BLOCK", "MARK_ON_BLOCK", "COMPLETE_TURNAROUND"]) {
      transition = await command(
        "flight-line-tablet-1",
        tokens.flightLine,
        transition.event.version,
        type,
        {
          rotationId,
          ...(type === "COMPLETE_TURNAROUND" ? { nextAircraftState: "AVAILABLE" } : {}),
        },
      );
    }
  }
  const thirdSale = await sell(transition.event.version);
  current = await board();
  const thirdProposal = current.rotations.find(
    (rotation) => rotation.id === thirdSale.aggregate.relatedRotationId,
  );
  if (
    thirdProposal?.suggestedAircraftId !== "aircraft-a" ||
    thirdProposal.suggestedPilotId !== "550e8400-e29b-41d4-a716-446655440200"
  ) {
    throw new Error("Zuletzt bestätigter Pilotencode wird für das Flugzeug nicht vorgeschlagen.");
  }
  const mismatchedCall = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    thirdSale.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [thirdSale.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    409,
  );
  if (mismatchedCall.error?.code !== "AIRCRAFT_PILOT_ASSIGNMENT_MISMATCH") {
    throw new Error("NEXT hat einen nicht am Flugzeug zugewiesenen Pilotencode akzeptiert.");
  }
  const beforeAssignmentHistory = await history("AIRCRAFT", "aircraft-a");
  const unconfirmedReassignment = await command(
    "technical-scaffold",
    tokens.admin,
    thirdSale.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
      reassign: false,
    },
    409,
  );
  if (unconfirmedReassignment.error?.code !== "PILOT_REASSIGN_CONFIRMATION_REQUIRED") {
    throw new Error("Pilotenumhängen wurde ohne separate Bestätigung zugelassen.");
  }
  const assignmentCommandId = randomUUID();
  const confirmedReassignment = await command(
    "technical-scaffold",
    tokens.admin,
    thirdSale.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
      reassign: true,
    },
    200,
    assignmentCommandId,
  );
  const assignmentReplay = await command(
    "technical-scaffold",
    tokens.admin,
    thirdSale.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
      reassign: true,
    },
    200,
    assignmentCommandId,
  );
  if (
    assignmentReplay.duplicate !== true ||
    assignmentReplay.event.version !== confirmedReassignment.event.version
  ) {
    throw new Error("Wiederholte Pilotenzuweisung war nicht idempotent.");
  }
  const afterAssignmentHistory = await history("AIRCRAFT", "aircraft-a");
  const pilotAuditCountBefore = beforeAssignmentHistory.entries.filter(
    (entry) => entry.eventType === "AIRCRAFT_PILOT_CHANGED",
  ).length;
  const pilotAuditCountAfter = afterAssignmentHistory.entries.filter(
    (entry) => entry.eventType === "AIRCRAFT_PILOT_CHANGED",
  ).length;
  if (pilotAuditCountAfter !== pilotAuditCountBefore + 1) {
    throw new Error("Pilotenzuweisung erzeugte nicht genau einen Audit-Eintrag.");
  }
  const staleAssignment = await command(
    "technical-scaffold",
    tokens.admin,
    thirdSale.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440200",
      reassign: false,
    },
    409,
  );
  if (staleAssignment.error?.code !== "STALE_VERSION") {
    throw new Error("Veraltete Pilotenzuweisung wurde nicht als stale write abgewiesen.");
  }
  const changedPilot = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    confirmedReassignment.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [thirdSale.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  current = await board();
  const changedAircraft = current.aircraft.find((aircraft) => aircraft.id === "aircraft-a");
  if (
    changedPilot.event.version !== current.event.version ||
    changedAircraft?.currentPilotId !== "550e8400-e29b-41d4-a716-446655440100"
  ) {
    throw new Error("Bestätigter Pilotencode wurde beim Boarding nicht fortgeführt.");
  }
  const boardingPilotChange = await admin(changedPilot.event.version, "ASSIGN_AIRCRAFT_PILOT", {
    aircraftId: "aircraft-a",
    pilotId: "550e8400-e29b-41d4-a716-446655440200",
    reassign: false,
  });
  current = await board();
  const boardingRotation = current.rotations.find(
    (rotation) => rotation.id === thirdSale.aggregate.relatedRotationId,
  );
  if (
    boardingRotation?.pilotId !== "550e8400-e29b-41d4-a716-446655440200" ||
    current.aircraft.find((aircraft) => aircraft.id === "aircraft-a")?.currentPilotId !==
      "550e8400-e29b-41d4-a716-446655440200"
  ) {
    throw new Error("Pilotwechsel während Boarding wurde nicht atomar fortgeführt.");
  }
  const offblock = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    boardingPilotChange.event.version,
    "MARK_OFF_BLOCK",
    { rotationId: thirdSale.aggregate.relatedRotationId },
  );
  const blockedAfterOffblock = await command(
    "technical-scaffold",
    tokens.admin,
    offblock.event.version,
    "ASSIGN_AIRCRAFT_PILOT",
    {
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
      reassign: false,
    },
    409,
  );
  if (blockedAfterOffblock.error?.code !== "AIRCRAFT_PILOT_CHANGE_BLOCKED") {
    throw new Error("Pilotwechsel wurde ab Offblock nicht gesperrt.");
  }
  transition = offblock;
  for (const type of ["MARK_ON_BLOCK", "COMPLETE_TURNAROUND"]) {
    transition = await command(
      "flight-line-tablet-1",
      tokens.flightLine,
      transition.event.version,
      type,
      {
        rotationId: thirdSale.aggregate.relatedRotationId,
        ...(type === "COMPLETE_TURNAROUND" ? { nextAircraftState: "AVAILABLE" } : {}),
      },
    );
  }
  const fourthSale = await sell(transition.event.version);
  current = await board();
  const fourthProposal = current.rotations.find(
    (rotation) => rotation.id === fourthSale.aggregate.relatedRotationId,
  );
  if (
    fourthProposal?.suggestedAircraftId !== "aircraft-a" ||
    fourthProposal.suggestedPilotId !== "550e8400-e29b-41d4-a716-446655440200"
  ) {
    throw new Error(
      "Geänderter Pilotencode wird beim Folgeumlauf nicht fortgeführt vorgeschlagen.",
    );
  }
  console.log(
    JSON.stringify({
      ok: true,
      requirements: [
        "F-BRD-030",
        "F-BRD-040",
        "F-PRG-110",
        "F-SLT-070",
        "F-SLT-120",
        "V161-FL-030",
      ],
      samePilotConflictRejected: true,
      inactivePilotRejected: true,
      pausedPilotRejected: true,
      undersizedAircraftNotSuggested: true,
      undersizedAircraftCallRejected: true,
      differentPilotsAccepted: true,
      activeRotations: active.length,
      earliestBusyAircraftSuggested: true,
      rememberedPilotSuggested: true,
      reassignConfirmationRequired: true,
      reassignReplayIdempotent: true,
      exactlyOnePilotAuditEvent: true,
      stalePilotWriteRejected: true,
      callNextAssignmentMismatchRejected: true,
      boardingPilotChangeAccepted: true,
      offblockPilotChangeBlocked: true,
      masterDataPreservesStateTimestamp: true,
      changedPilotSuggestedNext: true,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
