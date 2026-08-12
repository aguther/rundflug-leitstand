import { randomUUID } from "node:crypto";
import {
  createWorkerTestHarness,
  TEST_ADMIN_PIN,
  TEST_DEVICE_TOKENS,
  TEST_DEVICES,
} from "./lib/worker-test-harness.mjs";

const harness = await createWorkerTestHarness({ name: "emergency-mode" });
const pin = TEST_ADMIN_PIN;
const tokens = TEST_DEVICE_TOKENS;
const devices = TEST_DEVICES;
const board = (deviceId, token) => harness.board({ deviceId, token });
const command = (deviceId, token, expectedVersion, type, payload, expectedStatus = 200) =>
  harness.command({
    deviceId,
    token,
    expectedVersion,
    type,
    payload,
    expectedStatus,
    commandId: randomUUID(),
  });
const publicJson = (path) => harness.fetchJson(path);
const history = () =>
  harness.fetchJson("/api/control/demo-2026/history?aggregateType=OPERATION_DAY", {
    headers: { "x-device-id": devices.admin, "x-device-token": tokens.admin },
  });

try {
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
  const firstSale = await command(
    devices.cashier,
    tokens.cashier,
    activated.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-20",
      ticketCount: 1,
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  );
  const activeTicketCode = firstSale.saleReceipt.ticketCodes[0];
  const waitingSale = await command(
    devices.cashier,
    tokens.cashier,
    firstSale.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-20",
      ticketCount: 1,
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  );
  const activeRotationId = firstSale.aggregate.relatedRotationId;
  const called = await command(
    devices.flightLine,
    tokens.flightLine,
    waitingSale.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [firstSale.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  const started = await command(
    devices.flightLine,
    tokens.flightLine,
    called.event.version,
    "MARK_OFF_BLOCK",
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
      ticketCount: 1,
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
      ticketGroupIds: [waitingSale.aggregate.id],
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
    "MARK_ON_BLOCK",
    { rotationId: activeRotationId },
  );
  const completed = await command(
    devices.flightLine,
    tokens.flightLine,
    landed.event.version,
    "COMPLETE_TURNAROUND",
    { rotationId: activeRotationId, nextAircraftState: "AVAILABLE" },
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
    "invalid-device-token",
    completed.event.version,
    "CLEAR_EMERGENCY",
    { reason: "Aufhebungsversuch ohne gültige Sitzung", adminPin: pin },
    401,
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
      requirements: ["F-PRG-130"],
      triggeredByLead: true,
      saleBlocked: true,
      callBlocked: true,
      publicBoardNeutral: true,
      publicTicketNeutral: true,
      activeFlightCompleted: true,
      clearRequiresAdminSession: true,
      auditComplete: true,
      finalVersion: current.event.version,
    }),
  );
} finally {
  await harness.dispose();
}
