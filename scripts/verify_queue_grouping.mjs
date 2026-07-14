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
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const sell = (version, productId, size, oversizeSplitAcknowledged = false, expectedStatus = 200) =>
  command(
    "cashier-tablet-1",
    tokens.cashier,
    version,
    "SELL_TICKET_GROUP",
    {
      productId,
      publicTicketCodes: Array.from({ length: size }, ticketCode),
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      oversizeSplitAcknowledged,
    },
    expectedStatus,
  );
const search = async (groupId) => {
  const query = new URLSearchParams({ q: groupId });
  const response = await fetch(`${base}/api/events/demo-2026/tickets/search?${query}`, {
    headers: { "x-device-id": "cashier-tablet-1", "x-device-token": tokens.cashier },
  });
  if (!response.ok) throw new Error(`Ticketsuche fehlgeschlagen (${response.status}).`);
  return response.json();
};
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
      reason: "Synthetischer Queue-Test",
      adminPin: pin,
    },
  );
  result = await command(
    "technical-scaffold",
    tokens.admin,
    result.event.version,
    "SET_EVENT_LIFECYCLE",
    { status: "ACTIVE", reason: "Synthetischer Queue-Test", adminPin: pin },
  );

  const first = await sell(result.event.version, "panorama-20", 3);
  const second = await sell(first.event.version, "panorama-20", 1);
  const overflow = await sell(second.event.version, "panorama-20", 1);
  const otherProduct = await sell(overflow.event.version, "panorama-30", 1);
  if (first.aggregate.relatedRotationId !== second.aggregate.relatedRotationId) {
    throw new Error("Passende ganze Buchungsgruppe wurde nicht in den freien Platz aufgenommen.");
  }
  if (
    overflow.aggregate.relatedRotationId === first.aggregate.relatedRotationId ||
    otherProduct.aggregate.relatedRotationId === first.aggregate.relatedRotationId
  ) {
    throw new Error("Kapazitätsgrenze oder Produktbindung der Fluggruppe wurde verletzt.");
  }

  current = await board();
  const packed = current.rotations.find(
    (rotation) => rotation.id === first.aggregate.relatedRotationId,
  );
  const overflowRotation = current.rotations.find(
    (rotation) => rotation.id === overflow.aggregate.relatedRotationId,
  );
  const otherRotation = current.rotations.find(
    (rotation) => rotation.id === otherProduct.aggregate.relatedRotationId,
  );
  if (
    packed?.ticketCount !== 4 ||
    packed.communicationLabel !== "PAN20-101" ||
    overflowRotation?.ticketCount !== 1 ||
    otherRotation?.ticketCount !== 1
  ) {
    throw new Error("Ticketanzahl der automatisch gebildeten Fluggruppen ist inkonsistent.");
  }
  const [firstSearch, secondSearch] = await Promise.all([
    search(first.aggregate.id),
    search(second.aggregate.id),
  ]);
  const firstMatch = firstSearch.results.find(
    (entry) => entry.ticketGroupId === first.aggregate.id,
  );
  const secondMatch = secondSearch.results.find(
    (entry) => entry.ticketGroupId === second.aggregate.id,
  );
  if (
    !firstMatch?.communicationLabel ||
    firstMatch.communicationLabel !== secondMatch?.communicationLabel ||
    firstMatch.communicationLabel !== packed.communicationLabel ||
    firstMatch.groupSize !== 3 ||
    secondMatch.groupSize !== 1
  ) {
    throw new Error(
      "Stabile Kennung oder Gruppenschutz ist in der Ticketsuche nicht nachvollziehbar.",
    );
  }
  const rejectedCashierMove = await command(
    "cashier-tablet-1",
    tokens.cashier,
    otherProduct.event.version,
    "MOVE_TICKET_GROUP",
    {
      ticketGroupId: overflow.aggregate.id,
      targetRotationId: first.aggregate.relatedRotationId,
      reason: "Unzulässiger Kassentest",
    },
    403,
  );
  const rejectedCapacityMove = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    otherProduct.event.version,
    "MOVE_TICKET_GROUP",
    {
      ticketGroupId: overflow.aggregate.id,
      targetRotationId: first.aggregate.relatedRotationId,
      reason: "Unzulässiger Kapazitätstest",
    },
    409,
  );
  if (
    rejectedCashierMove.error?.code !== "ROLE_NOT_AUTHORIZED" ||
    rejectedCapacityMove.error?.code !== "MANUAL_GROUP_MOVE_CAPACITY_EXCEEDED"
  ) {
    throw new Error("Rolle oder Gruppenkapazität wurde bei manueller Umbesetzung nicht geschützt.");
  }
  const canceledPackedGroup = await command(
    "cashier-tablet-1",
    tokens.cashier,
    otherProduct.event.version,
    "CANCEL_TICKET_GROUP",
    {
      ticketGroupId: second.aggregate.id,
      reason: "Synthetische Teilgruppen-Korrektur",
      adminPin: pin,
    },
  );
  current = await board();
  const protectedRotation = current.rotations.find(
    (rotation) => rotation.id === first.aggregate.relatedRotationId,
  );
  if (
    canceledPackedGroup.event.version !== current.event.version ||
    protectedRotation?.status !== "DRAFT" ||
    protectedRotation.ticketCount !== 3
  ) {
    throw new Error("Korrektur einer Teilgruppe hat eine andere Buchungsgruppe mitgelöst.");
  }
  const calledTarget = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    canceledPackedGroup.event.version,
    "CALL_NEXT",
    {
      rotationId: first.aggregate.relatedRotationId,
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  const moveCommandId = randomUUID();
  const movedAfterCall = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    calledTarget.event.version,
    "MOVE_TICKET_GROUP",
    {
      ticketGroupId: overflow.aggregate.id,
      targetRotationId: first.aggregate.relatedRotationId,
      reason: "Bestätigte manuelle Nachbesetzung",
    },
    200,
    moveCommandId,
  );
  const duplicateMove = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    calledTarget.event.version,
    "MOVE_TICKET_GROUP",
    {
      ticketGroupId: overflow.aggregate.id,
      targetRotationId: first.aggregate.relatedRotationId,
      reason: "Bestätigte manuelle Nachbesetzung",
    },
    200,
    moveCommandId,
  );
  const staleMove = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    calledTarget.event.version,
    "MOVE_TICKET_GROUP",
    {
      ticketGroupId: overflow.aggregate.id,
      targetRotationId: first.aggregate.relatedRotationId,
      reason: "Veralteter Parallelversuch",
    },
    409,
  );
  current = await board();
  const manuallyFilledTarget = current.rotations.find(
    (rotation) => rotation.id === first.aggregate.relatedRotationId,
  );
  const moveHistory = await history("TICKET_GROUP", overflow.aggregate.id);
  const moveAudit = moveHistory.entries.find((entry) => entry.eventType === "TICKET_GROUP_MOVED");
  if (
    manuallyFilledTarget?.status !== "CALLED" ||
    manuallyFilledTarget.ticketCount !== 4 ||
    current.rotations.some((rotation) => rotation.id === overflow.aggregate.relatedRotationId) ||
    moveAudit?.payload.reason !== "Bestätigte manuelle Nachbesetzung" ||
    moveAudit.payload.changedAfterCall !== true ||
    moveAudit.payload.manualDeviationFromAutomaticQueue !== true ||
    duplicateMove.duplicate !== true ||
    staleMove.error?.code !== "STALE_VERSION"
  ) {
    throw new Error("Bestätigte manuelle Nachbesetzung wurde nicht vollständig protokolliert.");
  }
  const presentTicketId = manuallyFilledTarget.tickets[0]?.id;
  const missingTicketId = manuallyFilledTarget.tickets[1]?.id;
  if (!presentTicketId || !missingTicketId) {
    throw new Error("Synthetische Anwesenheitstickets fehlen.");
  }
  const checkedIn = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    movedAfterCall.event.version,
    "SET_TICKET_ATTENDANCE",
    { ticketId: presentTicketId, checkedIn: true },
  );
  const attendanceDecisionId = randomUUID();
  const attendanceDecision = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    checkedIn.event.version,
    "CONFIRM_ATTENDANCE_DECISION",
    { rotationId: first.aggregate.relatedRotationId, decision: "LEAVE_SEAT_EMPTY" },
    200,
    attendanceDecisionId,
  );
  const duplicateAttendanceDecision = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    checkedIn.event.version,
    "CONFIRM_ATTENDANCE_DECISION",
    { rotationId: first.aggregate.relatedRotationId, decision: "LEAVE_SEAT_EMPTY" },
    200,
    attendanceDecisionId,
  );
  const conflictingAttendanceDecision = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    attendanceDecision.event.version,
    "CONFIRM_ATTENDANCE_DECISION",
    { rotationId: first.aggregate.relatedRotationId, decision: "FLY_WITH_PRESENT" },
    409,
  );
  const earlyNoShow = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    attendanceDecision.event.version,
    "MARK_TICKET_NO_SHOW",
    { ticketId: missingTicketId, reason: "Synthetischer Fristtest" },
    409,
  );
  const attendanceHistory = await history("ROTATION", first.aggregate.relatedRotationId);
  const attendanceAudit = attendanceHistory.entries.find(
    (entry) => entry.eventType === "ATTENDANCE_EMPTY_SEAT_CONFIRMED",
  );
  if (
    attendanceAudit?.payload.presentCount !== 1 ||
    attendanceAudit.payload.missingCount !== 3 ||
    attendanceAudit.payload.automaticReplacement !== false ||
    duplicateAttendanceDecision.duplicate !== true ||
    conflictingAttendanceDecision.error?.code !== "ATTENDANCE_DECISION_ALREADY_CONFIRMED" ||
    earlyNoShow.error?.code !== "NO_SHOW_DEADLINE_NOT_REACHED"
  ) {
    throw new Error("Anwesenheitsentscheidung oder No-Show-Frist wurde nicht korrekt auditiert.");
  }
  const startedTarget = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    attendanceDecision.event.version,
    "MARK_IN_FLIGHT",
    { rotationId: first.aggregate.relatedRotationId },
  );
  const lateMoveSource = await sell(startedTarget.event.version, "panorama-20", 1);
  const rejectedLateMove = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    lateMoveSource.event.version,
    "MOVE_TICKET_GROUP",
    {
      ticketGroupId: lateMoveSource.aggregate.id,
      targetRotationId: first.aggregate.relatedRotationId,
      reason: "Unzulässiger später Test",
    },
    409,
  );
  if (rejectedLateMove.error?.code !== "MANUAL_GROUP_MOVE_TOO_LATE") {
    throw new Error("Umbesetzung nach IM FLUG wurde nicht fachlich abgelehnt.");
  }
  const rejectedOversize = await sell(lateMoveSource.event.version, "panorama-20", 5, false, 409);
  if (
    rejectedOversize.error?.code !== "OVERSIZE_GROUP_SPLIT_CONFIRMATION_REQUIRED" ||
    rejectedOversize.error.referenceCapacity !== 4 ||
    rejectedOversize.error.requiredFlightGroupCount !== 2
  ) {
    throw new Error("Übergröße wurde ohne verständliche Bestätigungsvorgabe verarbeitet.");
  }
  const splitGroup = await sell(lateMoveSource.event.version, "panorama-20", 5, true);
  current = await board();
  const splitRotations = current.rotations
    .filter((rotation) => rotation.ticketGroupId === splitGroup.aggregate.id)
    .sort((left, right) => left.communicationNumber - right.communicationNumber);
  if (
    splitRotations.length !== 2 ||
    splitRotations[0]?.ticketCount !== 4 ||
    splitRotations[1]?.ticketCount !== 1 ||
    splitRotations[1].communicationNumber !== splitRotations[0].communicationNumber + 1
  ) {
    throw new Error("Bestätigte Übergröße wurde nicht auf unmittelbar folgende Slots verteilt.");
  }
  const splitSearch = await search(splitGroup.aggregate.id);
  const splitMatch = splitSearch.results.find(
    (entry) => entry.ticketGroupId === splitGroup.aggregate.id,
  );
  if (
    splitSearch.results.length !== 1 ||
    splitMatch?.groupSize !== 5 ||
    splitMatch.communicationLabels.length !== 2 ||
    splitMatch.communicationNumbers[1] !== splitMatch.communicationNumbers[0] + 1
  ) {
    throw new Error("Aufgeteilte Buchungsgruppe ist in der Ticketsuche nicht vollständig.");
  }
  const deferredSplit = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    splitGroup.event.version,
    "DEFER_TICKET_GROUP",
    {
      ticketGroupId: splitGroup.aggregate.id,
      reason: "Synthetischer Gruppenschutztest",
    },
  );
  current = await board();
  const reassignedSplitRotations = current.rotations
    .filter((rotation) => rotation.ticketGroupId === splitGroup.aggregate.id)
    .sort((left, right) => left.communicationNumber - right.communicationNumber);
  if (
    reassignedSplitRotations.length !== 2 ||
    reassignedSplitRotations[0]?.ticketCount !== 4 ||
    reassignedSplitRotations[1]?.ticketCount !== 1 ||
    reassignedSplitRotations[1].communicationNumber !==
      reassignedSplitRotations[0].communicationNumber + 1
  ) {
    throw new Error("Zurückstellung hat den Schutz der aufgeteilten Buchungsgruppe verletzt.");
  }
  const canceledSplit = await command(
    "cashier-tablet-1",
    tokens.cashier,
    deferredSplit.event.version,
    "CANCEL_TICKET_GROUP",
    {
      ticketGroupId: splitGroup.aggregate.id,
      reason: "Synthetischer Gruppenschutztest",
      adminPin: pin,
    },
  );
  current = await board();
  const canceledSplitSearch = await search(splitGroup.aggregate.id);
  const canceledSplitMatch = canceledSplitSearch.results.find(
    (entry) => entry.ticketGroupId === splitGroup.aggregate.id,
  );
  if (
    current.event.version !== canceledSplit.event.version ||
    current.rotations.some((rotation) => rotation.ticketGroupId === splitGroup.aggregate.id) ||
    canceledSplitMatch?.groupStatus !== "CANCELED" ||
    canceledSplitMatch.communicationLabels.length !== 0
  ) {
    throw new Error("Stornierung hat aktive Zuordnungen der aufgeteilten Gruppe hinterlassen.");
  }
  const capacityFill = await sell(canceledSplit.event.version, "panorama-20", 2);
  const capacityOverflow = await sell(capacityFill.event.version, "panorama-20", 1);
  if (
    capacityFill.aggregate.relatedRotationId !== lateMoveSource.aggregate.relatedRotationId ||
    capacityOverflow.aggregate.relatedRotationId !== lateMoveSource.aggregate.relatedRotationId
  ) {
    throw new Error("Synthetischer Kapazitätsumlauf wurde nicht wie erwartet gefüllt.");
  }
  const capacityCommandId = randomUUID();
  const reducedCapacity = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    capacityOverflow.event.version,
    "SET_ROTATION_CAPACITY",
    {
      rotationId: lateMoveSource.aggregate.relatedRotationId,
      usableCapacity: 3,
      reason: "Organisatorisch nur drei Plätze nutzbar",
    },
    200,
    capacityCommandId,
  );
  const duplicateCapacity = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    capacityOverflow.event.version,
    "SET_ROTATION_CAPACITY",
    {
      rotationId: lateMoveSource.aggregate.relatedRotationId,
      usableCapacity: 3,
      reason: "Organisatorisch nur drei Plätze nutzbar",
    },
    200,
    capacityCommandId,
  );
  const staleCapacity = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    capacityOverflow.event.version,
    "SET_ROTATION_CAPACITY",
    {
      rotationId: lateMoveSource.aggregate.relatedRotationId,
      usableCapacity: 2,
      reason: "Veralteter Kapazitätsversuch",
    },
    409,
  );
  const rejectedCashierCapacity = await command(
    "cashier-tablet-1",
    tokens.cashier,
    reducedCapacity.event.version,
    "SET_ROTATION_CAPACITY",
    {
      rotationId: lateMoveSource.aggregate.relatedRotationId,
      usableCapacity: 2,
      reason: "Unzulässiger Kassentest",
    },
    403,
  );
  const rejectedLateCapacity = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    reducedCapacity.event.version,
    "SET_ROTATION_CAPACITY",
    {
      rotationId: first.aggregate.relatedRotationId,
      usableCapacity: 3,
      reason: "Unzulässiger später Kapazitätstest",
    },
    409,
  );
  current = await board();
  const reducedRotation = current.rotations.find(
    (rotation) => rotation.id === lateMoveSource.aggregate.relatedRotationId,
  );
  const requeuedCapacityGroup = current.rotations.find(
    (rotation) => rotation.ticketGroupId === capacityOverflow.aggregate.id,
  );
  const capacityHistory = await history("ROTATION", lateMoveSource.aggregate.relatedRotationId);
  const capacityAudit = capacityHistory.entries.find(
    (entry) => entry.eventType === "ROTATION_CAPACITY_CHANGED",
  );
  const capacitySearch = await search(capacityOverflow.aggregate.id);
  const capacitySearchMatch = capacitySearch.results.find(
    (entry) => entry.ticketGroupId === capacityOverflow.aggregate.id,
  );
  if (
    reducedRotation?.ticketCount !== 3 ||
    reducedRotation.baselineCapacity !== 4 ||
    reducedRotation.usableCapacity !== 3 ||
    reducedRotation.capacityReduced !== true ||
    requeuedCapacityGroup?.ticketCount !== 1 ||
    requeuedCapacityGroup.queuePosition >= reducedRotation.queuePosition ||
    capacitySearchMatch?.queueSequence !== 1 ||
    capacityAudit?.payload.reason !== "Organisatorisch nur drei Plätze nutzbar" ||
    capacityAudit.payload.requeuedTicketGroupIds?.[0] !== capacityOverflow.aggregate.id ||
    duplicateCapacity.duplicate !== true ||
    staleCapacity.error?.code !== "STALE_VERSION" ||
    rejectedCashierCapacity.error?.code !== "ROLE_NOT_AUTHORIZED" ||
    rejectedLateCapacity.error?.code !== "ROTATION_CAPACITY_CHANGE_TOO_LATE"
  ) {
    throw new Error(
      "Kapazitätsreduktion oder gruppenschützende Wiedereinreihung ist inkonsistent.",
    );
  }
  console.log(
    JSON.stringify({
      ok: true,
      requirements: [
        "F-SLT-010",
        "F-SLT-020",
        "F-SLT-030",
        "F-SLT-040",
        "F-SLT-050",
        "F-SLT-060",
        "F-SLT-100",
        "F-BRD-080",
        "F-BRD-085",
      ],
      packedTicketCount: packed.ticketCount,
      remainingTicketsAfterPartialCancellation: protectedRotation.ticketCount,
      stableCommunicationLabel: firstMatch.communicationLabel,
      groupSizes: [firstMatch.groupSize, secondMatch.groupSize],
      overflowSeparated: true,
      differentProductSeparated: true,
      manualMoveAfterCallConfirmed: true,
      manualMoveAuditRecorded: true,
      manualMoveAfterTakeoffRejected: true,
      manualMoveRoleProtected: true,
      manualMoveCapacityProtected: true,
      manualMoveIdempotent: true,
      manualMoveStaleWriteRejected: true,
      attendanceDecisionAudited: true,
      attendanceDecisionIdempotent: true,
      conflictingAttendanceDecisionRejected: true,
      earlyNoShowRejected: true,
      oversizeSplitRequiresConfirmation: true,
      oversizeSplitSlotSizes: splitRotations.map((rotation) => rotation.ticketCount),
      oversizeSplitCommunicationLabels: splitMatch.communicationLabels,
      splitPreservedAfterDeferral: true,
      splitCancellationReleasedAllAssignments: true,
      usableCapacityReducedBeforeCall: true,
      capacityQueueSuffixRequeuedAsWholeGroup: true,
      capacityRequeueMovedToFront: true,
      capacityChangeAuditRecorded: true,
      capacityChangeIdempotent: true,
      capacityChangeStaleWriteRejected: true,
      capacityChangeAfterCallRejected: true,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
