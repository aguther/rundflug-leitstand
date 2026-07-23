import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.VERTICAL_SLICE_TEST_PORT ?? "18786");
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
    "--port",
    String(port),
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}`;
const waitForWorker = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig bereit.");
};
const tokens = {
  admin: ["demo", "admin", "device", "token"].join("-"),
  cashier: ["demo", "cashier", "device", "token"].join("-"),
  flightLine: ["demo", "flight", "line", "device", "token"].join("-"),
};
const board = async (deviceId, token) => {
  const response = await fetch(`${base}/api/control/demo-2026/operations`, {
    headers: { "x-device-id": deviceId, "x-device-token": token },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const history = async (aggregateId) => {
  const query = new URLSearchParams({ aggregateType: "ROTATION", aggregateId });
  const response = await fetch(`${base}/api/control/demo-2026/history?${query}`, {
    headers: { "x-device-id": "technical-scaffold", "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Historien-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const forecastHistory = async (filters, deviceId = "technical-scaffold", token = tokens.admin) => {
  const query = new URLSearchParams(filters);
  const response = await fetch(`${base}/api/control/demo-2026/history/forecasts?${query}`, {
    headers: { "x-device-id": deviceId, "x-device-token": token },
  });
  return { response, body: await response.json() };
};
const envelope = (deviceId, expectedVersion, type, payload) => ({
  commandId: randomUUID(),
  eventId: "demo-2026",
  deviceId,
  expectedVersion,
  issuedAt: new Date().toISOString(),
  type,
  payload,
});
const post = async (token, body, expectedStatus = 200) => {
  const response = await fetch(`${base}/api/control/demo-2026/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": token },
    body: JSON.stringify(body),
  });
  if (response.status !== expectedStatus) {
    throw new Error(
      `Kommando lieferte ${response.status} statt ${expectedStatus}: ${await response.text()}`,
    );
  }
  return response.json();
};
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const connectRealtime = () =>
  new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(`${wsBase}/api/public/events/demo-2026/live`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Realtime-Verbindung wurde nicht rechtzeitig hergestellt."));
    }, 2_000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type !== "connected") return;
      clearTimeout(timeout);
      resolvePromise(socket);
    });
    socket.addEventListener(
      "error",
      () => reject(new Error("Realtime-Verbindung fehlgeschlagen.")),
      {
        once: true,
      },
    );
  });
const nextRealtimeVersion = (socket) =>
  new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    const timeout = setTimeout(
      () =>
        reject(
          new Error("Paralleles Gerät erhielt die Änderung nicht innerhalb von zwei Sekunden."),
        ),
      2_000,
    );
    socket.addEventListener(
      "message",
      (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type !== "event-state-changed") return;
        clearTimeout(timeout);
        resolvePromise({ version: message.eventVersion, elapsedMs: Date.now() - startedAt });
      },
      { once: true },
    );
  });
const nextForecastVersion = (socket) =>
  new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("Gerät erhielt die neue Prognose nicht innerhalb von zwei Sekunden."));
    }, 2_000);
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type !== "forecast-updated") return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolvePromise({
        version: message.eventVersion,
        updatedAt: message.updatedAt,
        elapsedMs: Date.now() - startedAt,
      });
    };
    socket.addEventListener("message", onMessage);
  });

let cashierSocket;
let flightLineSocket;
try {
  await waitForWorker();
  let current = await board("technical-scaffold", tokens.admin);
  const configured = await post(
    tokens.admin,
    envelope("technical-scaffold", current.event.version, "CONFIGURE_EVENT_PARAMETERS", {
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
      reason: "Synthetischer Vertical-Slice-Test",
      adminPin: pin,
    }),
  );
  const configuredProduct = await post(
    tokens.admin,
    envelope("technical-scaffold", configured.event.version, "UPSERT_PRODUCT", {
      productId: "panorama-20",
      resourceGroupId: "rg-panorama",
      gateId: "demo-2026-gate-main",
      name: "20 Min. Panorama",
      code: "PAN20",
      publicDescription: "Synthetisches Testprodukt",
      priceCents: 4500,
      referenceCapacity: 4,
      referenceDurationMinutes: 20,
      promisedFlightMinutes: 20,
      childCompanionRequired: false,
      weightClasses: ["CHILD", "NORMAL", "HEAVY", "INDIVIDUAL"],
      sortOrder: 10,
      reason: "Synthetischer Zuladungstest",
      adminPin: pin,
    }),
  );
  const activated = await post(
    tokens.admin,
    envelope("technical-scaffold", configuredProduct.event.version, "SET_EVENT_LIFECYCLE", {
      status: "ACTIVE",
      reason: "Synthetischer Vertical-Slice-Test",
      adminPin: pin,
    }),
  );
  const cashierProducts = (await board("cashier-tablet-1", tokens.cashier)).products;
  if (
    cashierProducts.length === 0 ||
    cashierProducts.some(
      (product) =>
        !["AVAILABLE", "LIMITED", "MANUAL_REVIEW", "SOLD_OUT"].includes(product.capacityStatus) ||
        product.remainingSellableSeats < 0 ||
        product.estimatedWaitUpperMinutes < product.estimatedWaitLowerMinutes ||
        !product.nextBoardingWindowLowerAt ||
        !product.nextBoardingWindowUpperAt ||
        Date.parse(product.nextBoardingWindowUpperAt) <
          Date.parse(product.nextBoardingWindowLowerAt),
    )
  ) {
    throw new Error("Verkaufskachel erhält kein vollständiges vorsichtiges Prognosefenster.");
  }
  cashierSocket = await connectRealtime();
  flightLineSocket = await connectRealtime();
  const cashierSaleSignal = nextRealtimeVersion(cashierSocket);
  const flightLineSaleSignal = nextRealtimeVersion(flightLineSocket);
  const cashierSaleForecast = nextForecastVersion(cashierSocket);
  const flightLineSaleForecast = nextForecastVersion(flightLineSocket);
  const saleEnvelope = envelope("cashier-tablet-1", activated.event.version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicTicketCodes: [ticketCode(), ticketCode()],
    ticketDetails: [
      { weightClass: "CHILD", individualWeightKg: null },
      { weightClass: "INDIVIDUAL", individualWeightKg: 72 },
    ],
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });
  const sold = await post(tokens.cashier, saleEnvelope);
  const [cashierRealtime, flightLineRealtime] = await Promise.all([
    cashierSaleSignal,
    flightLineSaleSignal,
  ]);
  const [cashierForecast, flightLineForecast] = await Promise.all([
    cashierSaleForecast,
    flightLineSaleForecast,
  ]);
  if (
    cashierRealtime.version !== sold.event.version ||
    flightLineRealtime.version !== sold.event.version ||
    cashierForecast.version !== sold.event.version ||
    flightLineForecast.version !== sold.event.version
  ) {
    throw new Error("Parallele Geräte erhielten Zustand oder Prognose in abweichender Version.");
  }
  const [cashierForecastBoard, flightLineForecastBoard] = await Promise.all([
    board("cashier-tablet-1", tokens.cashier),
    board("flight-line-tablet-1", tokens.flightLine),
  ]);
  const cashierForecastRotation = cashierForecastBoard.rotations.find(
    (rotation) => rotation.id === sold.aggregate.relatedRotationId,
  );
  const flightLineForecastRotation = flightLineForecastBoard.rotations.find(
    (rotation) => rotation.id === sold.aggregate.relatedRotationId,
  );
  if (
    cashierForecastBoard.event.version !== sold.event.version ||
    flightLineForecastBoard.event.version !== sold.event.version ||
    !cashierForecastRotation?.timeline.predictionUpdatedAt ||
    cashierForecastRotation.timeline.predictionUpdatedAt !==
      flightLineForecastRotation?.timeline.predictionUpdatedAt ||
    cashierForecastRotation.predictedUpperMinutes < cashierForecastRotation.predictedLowerMinutes
  ) {
    throw new Error("Persistierte Mehrgeräte-Prognose ist nach dem Verkauf inkonsistent.");
  }
  const duplicate = await post(tokens.cashier, saleEnvelope);
  if (!duplicate.duplicate || duplicate.event.version !== sold.event.version) {
    throw new Error("Idempotente Wiederholung erzeugte einen abweichenden Zustand.");
  }
  const staleSale = envelope("cashier-tablet-1", activated.event.version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicTicketCodes: [ticketCode()],
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });
  await post(tokens.cashier, staleSale, 409);

  const rotationId = sold.aggregate.relatedRotationId;
  await post(
    "invalid-synthetic-token",
    envelope("cashier-tablet-1", sold.event.version, "SELL_TICKET_GROUP", {
      productId: "panorama-20",
      publicTicketCodes: [ticketCode()],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    }),
    401,
  );
  await post(
    tokens.cashier,
    envelope("cashier-tablet-1", sold.event.version, "CALL_NEXT", {
      ticketGroupIds: [sold.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    }),
    403,
  );
  const proposedBoard = await board("flight-line-tablet-1", tokens.flightLine);
  const proposedRotation = proposedBoard.rotations.find((rotation) => rotation.id === rotationId);
  if (
    proposedRotation?.suggestedAircraftId !== "aircraft-a" ||
    proposedRotation?.suggestedPilotId !== "550e8400-e29b-41d4-a716-446655440100" ||
    proposedRotation?.estimatedPassengerPayloadKg !== 107 ||
    proposedRotation.tickets.some((ticket) => ticket.status !== "QUEUED")
  ) {
    throw new Error(
      "Vorschlag, neutrale Zuladungsschätzung oder initialer Ticketstatus fehlt im Standardumlauf.",
    );
  }
  await post(
    tokens.cashier,
    envelope("cashier-tablet-1", sold.event.version, "SET_ROTATION_NOTE", {
      rotationId,
      note: "Organisatorischer Testhinweis 42",
      reason: "Synthetischer D-050-Test",
    }),
    403,
  );
  const noted = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", sold.event.version, "SET_ROTATION_NOTE", {
      rotationId,
      note: "Organisatorischer Testhinweis 42",
      reason: "Synthetischer D-050-Test",
    }),
  );
  current = await board("flight-line-tablet-1", tokens.flightLine);
  const notedRotation = current.rotations.find((rotation) => rotation.id === rotationId);
  const noteHistory = await history(rotationId);
  const noteAudit = noteHistory.entries.find((entry) => entry.eventType === "ROTATION_NOTE_SET");
  if (
    notedRotation?.gateId !== "demo-2026-gate-main" ||
    notedRotation.gateLabel !== "Flight Line 1" ||
    notedRotation.operationalNote !== "Organisatorischer Testhinweis 42" ||
    noteAudit?.payload.reason !== "Synthetischer D-050-Test" ||
    noteAudit.payload.note !== "Organisatorischer Testhinweis 42"
  ) {
    throw new Error("Umlauf-Gate, organisatorische Bemerkung oder Auditbezug fehlt.");
  }
  const checkedTicketId = proposedRotation.tickets[0].id;
  flightLineSocket.close();
  const reconnectStartedAt = Date.now();
  flightLineSocket = await connectRealtime();
  const reconnectMilliseconds = Date.now() - reconnectStartedAt;
  const callSignal = nextRealtimeVersion(flightLineSocket);
  const callForecastSignal = nextForecastVersion(flightLineSocket);
  const firstCall = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", noted.event.version, "CALL_NEXT", {
      ticketGroupIds: [sold.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    }),
  );
  const callRealtime = await callSignal;
  const callForecast = await callForecastSignal;
  if (
    callRealtime.version !== firstCall.event.version ||
    callForecast.version !== firstCall.event.version
  ) {
    throw new Error("Wiederverbundenes Gerät erhielt den Aufruf nicht.");
  }
  current = await board("flight-line-tablet-1", tokens.flightLine);
  if (
    current.rotations
      .find((rotation) => rotation.id === rotationId)
      ?.tickets.some((ticket) => ticket.status !== "BOARDING")
  ) {
    throw new Error("NEXT hat den Ticketstatus nicht auf BOARDING gesetzt.");
  }
  const revoked = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", firstCall.event.version, "REVOKE_CALL", { rotationId }),
  );
  current = await board("flight-line-tablet-1", tokens.flightLine);
  const revokedRotation = current.rotations.find((rotation) => rotation.id === rotationId);
  const releasedAircraft = current.aircraft.find((aircraft) => aircraft.id === "aircraft-a");
  if (
    revokedRotation?.status !== "DRAFT" ||
    releasedAircraft?.operationalState !== "AVAILABLE" ||
    revokedRotation.tickets.some((ticket) => ticket.status !== "QUEUED")
  ) {
    throw new Error("Rücknahme hat Umlauf oder Flugzeug nicht in den Vorschlagszustand versetzt.");
  }
  const correctionHistory = await history(rotationId);
  const originalCall = correctionHistory.entries.find(
    (entry) => entry.eventType === "FLIGHT_GROUP_CALLED",
  );
  const correction = correctionHistory.entries.find((entry) => entry.eventType === "CALL_REVOKED");
  if (
    !originalCall?.occurredAt ||
    originalCall.deviceId !== "flight-line-tablet-1" ||
    correction?.payload.corrects !== "FLIGHT_GROUP_CALLED" ||
    correction.payload.calledAt !== originalCall.occurredAt
  ) {
    throw new Error(
      "Rücknahme verweist nicht nachvollziehbar auf das ursprüngliche Aufrufereignis.",
    );
  }
  const checkedIn = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", revoked.event.version, "SET_TICKET_ATTENDANCE", {
      ticketId: checkedTicketId,
      checkedIn: true,
    }),
  );
  current = await board("flight-line-tablet-1", tokens.flightLine);
  const checkedRotation = current.rotations.find((rotation) => rotation.id === rotationId);
  if (
    checkedRotation?.tickets.find((ticket) => ticket.id === checkedTicketId)?.status !==
    "CHECKED_IN"
  ) {
    throw new Error("Check-in hat den Ticketstatus nicht atomar auf CHECKED_IN gesetzt.");
  }
  const called = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", checkedIn.event.version, "CALL_NEXT", {
      ticketGroupIds: [sold.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    }),
  );
  current = await board("flight-line-tablet-1", tokens.flightLine);
  const boardingRotation = current.rotations.find((rotation) => rotation.id === rotationId);
  const boardingStatuses = boardingRotation?.tickets.map((ticket) => ticket.status).sort();
  if (boardingStatuses?.join(",") !== "BOARDING,BOARDING") {
    throw new Error(`NEXT bildet Check-in/Boarding nicht korrekt ab: ${boardingStatuses}`);
  }
  const started = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", called.event.version, "MARK_OFF_BLOCK", { rotationId }),
  );
  const landed = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", started.event.version, "MARK_ON_BLOCK", { rotationId }),
  );
  current = await board("flight-line-tablet-1", tokens.flightLine);
  const landedAircraft = current.aircraft.find((aircraft) => aircraft.id === "aircraft-a");
  const landedRotation = current.rotations.find((rotation) => rotation.id === rotationId);
  if (
    landedAircraft?.operationalState !== "LANDED" ||
    landedRotation?.tickets.some((ticket) => ticket.status !== "LANDED")
  ) {
    throw new Error("GELANDET hat den erwarteten belegten Flugzeugzustand nicht erhalten.");
  }
  const completed = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", landed.event.version, "COMPLETE_TURNAROUND", {
      rotationId,
      nextAircraftState: "AVAILABLE",
    }),
  );
  current = await board("flight-line-tablet-1", tokens.flightLine);
  const finalAircraft = current.aircraft.find((aircraft) => aircraft.id === "aircraft-a");
  const finalRotation = current.rotations.find((rotation) => rotation.id === rotationId);
  if (
    finalAircraft?.operationalState !== "AVAILABLE" ||
    finalRotation?.status !== "COMPLETED" ||
    finalRotation.tickets.some((ticket) => ticket.status !== "COMPLETED")
  ) {
    throw new Error("ABGESCHLOSSEN hat Umlauf oder Flugzeug nicht korrekt freigegeben.");
  }
  const timingComplete = [
    finalRotation.timeline.actual.boardingAt,
    finalRotation.timeline.actual.departureAt,
    finalRotation.timeline.actual.landingAt,
    finalRotation.timeline.actual.completionAt,
  ].every(Boolean);
  if (!timingComplete || finalRotation.ticketCount !== 2) {
    throw new Error("Zeitmesspunkte oder Gruppenbindung des Umlaufs sind unvollständig.");
  }
  let forecastResult;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    forecastResult = await forecastHistory({
      rotationId,
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
      limit: "200",
      offset: "0",
    });
    if (forecastResult.response.ok && forecastResult.body.total > 0) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  if (
    !forecastResult?.response.ok ||
    forecastResult.body.total < 1 ||
    forecastResult.body.entries.some(
      (entry) =>
        entry.dataBasisScope === "LEGACY_UNKNOWN" ||
        entry.triggerEventType === "LEGACY_UNKNOWN" ||
        entry.referenceDurationMinutes <= 0 ||
        entry.activeCapacity <= 0 ||
        entry.actual.completionAt === null ||
        entry.deviationMinutes.boarding === null ||
        entry.deviationMinutes.departure === null ||
        entry.deviationMinutes.completion === null,
    )
  ) {
    throw new Error(
      `Prognoseverlauf oder Ist-Abweichungen sind unvollständig: ${JSON.stringify(forecastResult?.body)}`,
    );
  }
  const cashierForecastHistory = await forecastHistory(
    { rotationId },
    "cashier-tablet-1",
    tokens.cashier,
  );
  if (cashierForecastHistory.response.status !== 403) {
    throw new Error("Kassengerät erhielt unzulässigen Zugriff auf die Prognosehistorie.");
  }
  const invalidForecastRange = await forecastHistory({
    since: "2026-07-11T18:00:00.000Z",
    until: "2026-07-11T08:00:00.000Z",
  });
  if (invalidForecastRange.response.status !== 400) {
    throw new Error("Umgekehrter Prognosezeitraum wurde nicht abgelehnt.");
  }
  const dailyCsvResponse = await fetch(`${base}/api/control/demo-2026/reports/daily.csv`, {
    headers: { "x-device-id": "technical-scaffold", "x-device-token": tokens.admin },
  });
  const dailyCsv = await dailyCsvResponse.text();
  if (
    !dailyCsvResponse.ok ||
    !["KASSEN-ZÄHLBERICHT", "FLÜGE", "PROGNOSEENTWICKLUNG", "BESONDERE EREIGNISSE"].every(
      (section) => dailyCsv.includes(section),
    ) ||
    !dailyCsv.includes(finalRotation.communicationLabel) ||
    !dailyCsv.includes("Mittlere Boardingdauer") ||
    !dailyCsv.includes("Auslastung") ||
    !dailyCsv.includes("CALL_REVOKED")
  ) {
    throw new Error("Der vollständige CSV-Tagesbericht enthält nicht alle V1-Abschnitte.");
  }
  const dailyPdfResponse = await fetch(`${base}/api/control/demo-2026/reports/daily.pdf`, {
    headers: { "x-device-id": "technical-scaffold", "x-device-token": tokens.admin },
  });
  const dailyPdf = new Uint8Array(await dailyPdfResponse.arrayBuffer());
  if (
    !dailyPdfResponse.ok ||
    dailyPdfResponse.headers.get("content-type") !== "application/pdf" ||
    dailyPdf.byteLength < 500
  ) {
    throw new Error("Der archivfähige PDF-Tagesbericht konnte nicht vollständig erzeugt werden.");
  }
  const devicesResponse = await fetch(`${base}/api/control/demo-2026/devices`, {
    headers: { "x-device-id": "technical-scaffold", "x-device-token": tokens.admin },
  });
  const deviceBody = await devicesResponse.json();
  if (
    !devicesResponse.ok ||
    !deviceBody.devices.some(
      (device) =>
        device.id === "cashier-tablet-1" && device.role === "CASHIER" && device.lastSeenAt,
    )
  ) {
    throw new Error("Geräterolle oder letzter Kontakt ist administrativ nicht nachvollziehbar.");
  }
  process.stdout.write(
    JSON.stringify({
      requirements: ["F-BRD-120", "F-SLT-080", "F-HIS-030", "F-HIS-060", "D-050", "D-055"],
      sale: sold.eventType,
      duplicate: duplicate.duplicate,
      staleRejected: true,
      unpairedRejected: true,
      wrongRoleRejected: true,
      twoDevicesRealtimeUnderTwoSeconds: true,
      twoDevicesForecastUnderTwoSeconds: true,
      persistedForecastVersionConsistent: true,
      maximumRealtimeMilliseconds: Math.max(
        cashierRealtime.elapsedMs,
        flightLineRealtime.elapsedMs,
        callRealtime.elapsedMs,
        cashierForecast.elapsedMs,
        flightLineForecast.elapsedMs,
        callForecast.elapsedMs,
      ),
      reconnectMilliseconds,
      deviceAttributionVisible: true,
      assignmentSuggested: true,
      estimatedPassengerPayloadKg: proposedRotation.estimatedPassengerPayloadKg,
      cashierProductForecastComplete: true,
      callCorrectionAudited: true,
      ticketStateSequenceVerified: true,
      rotationGateAndNoteVerified: true,
      transitions: [called.eventType, started.eventType, landed.eventType, completed.eventType],
      landedAircraftState: landedAircraft.operationalState,
      finalAircraftState: finalAircraft.operationalState,
      ticketCount: finalRotation.ticketCount,
      timingComplete,
      forecastBasisAndActualDeviationVerified: true,
      completeDailyCsvAndPdfVerified: true,
      finalVersion: current.event.version,
    }),
  );
} finally {
  cashierSocket?.close();
  flightLineSocket?.close();
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
