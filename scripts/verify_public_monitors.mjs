import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm-Ausführungspfad fehlt.");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const port = Number.parseInt(process.env.PUBLIC_MONITORS_TEST_PORT ?? "8787", 10);
const reset = spawnSync(process.execPath, [npmCli, "run", "db:reset:local"], {
  cwd: root,
  stdio: "ignore",
});
if (reset.status !== 0) throw new Error("Lokale Testdatenbank konnte nicht initialisiert werden.");

// F-MON-010: Alte Abflugzeilen dürfen das FIDS-Limit nicht belegen und dadurch kommende
// Fluggruppen verdrängen. 21 Zeilen reproduzieren die frühere LIMIT-20-Regression.
const staleDepartureCommunicationNumbers = Array.from({ length: 21 }, (_, index) => 8_000 + index);
const staleDepartureTimestamp = "2026-07-11T08:30:00.000Z";
const staleDepartureSql = staleDepartureCommunicationNumbers
  .map((communicationNumber) => {
    const suffix = String(communicationNumber);
    const flightGroupCommunicationNumber = communicationNumber - 1_000;
    return `
      INSERT INTO ticket_groups
        (id, operation_day_id, product_id, queue_sequence, communication_number, standby,
         status, sold_at, version)
      VALUES
        ('fids-history-ticket-group-${suffix}', 'demo-2026', 'panorama-20',
         ${communicationNumber}, ${communicationNumber}, 0, 'COMPLETED',
         '${staleDepartureTimestamp}', 0);
      INSERT INTO tickets
        (id, ticket_group_id, public_code_hash, status, weight_class, individual_weight_kg,
         payment_status, price_cents, created_at)
      VALUES
        ('fids-history-ticket-${suffix}', 'fids-history-ticket-group-${suffix}',
         'fids-history-hash-${suffix}', 'COMPLETED', 'NOT_CAPTURED', NULL, 'PAID', 0,
         '${staleDepartureTimestamp}');
      INSERT INTO flight_groups
        (id, operation_day_id, resource_group_id, communication_number, status, version,
         created_at, updated_at, queue_position)
      VALUES
        ('fids-history-flight-group-${suffix}', 'demo-2026', 'rg-panorama',
         ${flightGroupCommunicationNumber}, 'COMPLETED', 0, '${staleDepartureTimestamp}',
         '${staleDepartureTimestamp}', ${flightGroupCommunicationNumber});
      INSERT INTO rotations
        (id, operation_day_id, flight_group_id, status, departed_at, landed_at, completed_at,
         version, created_at, updated_at, gate_id)
      VALUES
        ('fids-history-rotation-${suffix}', 'demo-2026', 'fids-history-flight-group-${suffix}',
         'COMPLETED', '${staleDepartureTimestamp}', '${staleDepartureTimestamp}',
         '${staleDepartureTimestamp}', 0, '${staleDepartureTimestamp}',
         '${staleDepartureTimestamp}', 'demo-2026-gate-main');
      INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
      VALUES
        ('fids-history-rotation-${suffix}', 'fids-history-ticket-${suffix}',
         '${staleDepartureTimestamp}');`;
  })
  .join("\n");
const historySeedDirectory = mkdtempSync(join(tmpdir(), "rundflug-fids-history-"));
const historySeedFile = join(historySeedDirectory, "history.sql");
const historySeed = (() => {
  try {
    writeFileSync(historySeedFile, staleDepartureSql, "utf8");
    return spawnSync(
      process.execPath,
      [
        wranglerCli,
        "d1",
        "execute",
        "DB",
        "--local",
        "--config",
        "wrangler.jsonc",
        "--file",
        historySeedFile,
      ],
      { cwd: root, encoding: "utf8" },
    );
  } finally {
    rmSync(historySeedDirectory, { recursive: true, force: true });
  }
})();
if (historySeed.status !== 0) {
  const detail =
    historySeed.error?.message ??
    historySeed.stderr?.trim() ??
    historySeed.stdout?.trim() ??
    "unbekannter Fehler";
  throw new Error(`Synthetische FIDS-Abflughistorie konnte nicht angelegt werden: ${detail}`);
}

const pin = String.fromCharCode(48).repeat(4);
const pinHash = createHash("sha256").update(pin).digest("hex");
const server = spawn(
  process.execPath,
  [
    wranglerCli,
    "dev",
    "--config",
    "wrangler.jsonc",
    "--port",
    String(port),
    "--var",
    "APP_ENV:development",
    "--var",
    "DATA_JURISDICTION:eu",
    "--var",
    `ADMIN_PIN_HASH:${pinHash}`,
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}`;
const tokens = {
  admin: ["demo", "admin", "device", "token"].join("-"),
  cashier: ["demo", "cashier", "device", "token"].join("-"),
  flightLine: ["demo", "flight", "line", "device", "token"].join("-"),
};
const devices = {
  admin: "technical-scaffold",
  cashier: "cashier-tablet-1",
  flightLine: "flight-line-tablet-1",
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
  const response = await fetch(`${base}/api/public/events/demo-2026/board`);
  if (!response.ok) throw new Error(`FIDS-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const operationBoard = async (device, token) => {
  const response = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": device, "x-device-token": token },
  });
  if (!response.ok) throw new Error(`Operativer Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const searchTickets = async (query) => {
  const response = await fetch(
    `${base}/api/events/demo-2026/tickets/search?status=ACTIVE&limit=20&q=${encodeURIComponent(query)}`,
    {
      headers: {
        "x-device-id": devices.cashier,
        "x-device-token": tokens.cashier,
      },
    },
  );
  if (!response.ok) throw new Error(`Ticketsuche fehlgeschlagen (${response.status}).`);
  return response.json();
};
const ticketStatus = async (code) => {
  const response = await fetch(`${base}/api/public/tickets/${code}`);
  if (!response.ok)
    throw new Error(`Öffentlicher Ticketstatus fehlgeschlagen (${response.status}).`);
  return response.json();
};
const groupStatus = async (code) => {
  const response = await fetch(`${base}/api/public/groups/${code}`);
  if (!response.ok)
    throw new Error(`Öffentlicher Gruppenstatus fehlgeschlagen (${response.status}).`);
  return response.json();
};
const command = async (device, token, expectedVersion, type, payload, staleRetries = 0) => {
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
  const body = await response.json();
  if (
    response.status === 409 &&
    body.error?.code === "STALE_VERSION" &&
    Number.isInteger(body.error.currentVersion) &&
    staleRetries < 3
  ) {
    return command(device, token, body.error.currentVersion, type, payload, staleRetries + 1);
  }
  if (!response.ok) {
    throw new Error(`${type} fehlgeschlagen (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
};
const connectRealtime = () =>
  new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(`${wsBase}/api/public/events/demo-2026/live`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Realtime-Verbindung wurde nicht rechtzeitig hergestellt."));
    }, 2_000);
    socket.addEventListener(
      "message",
      (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type !== "connected") return;
        clearTimeout(timeout);
        resolvePromise(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => reject(new Error("Realtime-Verbindung fehlgeschlagen.")),
      {
        once: true,
      },
    );
  });
const nextRefresh = (socket) =>
  new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Realtime-Aktualisierung überschritt zwei Sekunden.")),
      2_000,
    );
    socket.addEventListener(
      "message",
      (event) => {
        const message = JSON.parse(String(event.data));
        clearTimeout(timeout);
        if (message.type !== "event-state-changed" || !Number.isInteger(message.eventVersion)) {
          reject(new Error("Realtime-Nachricht ist nicht minimal oder formal ungültig."));
          return;
        }
        resolvePromise(message.eventVersion);
      },
      { once: true },
    );
  });
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");

const assertPublicTimeCommunication = (payload, label) => {
  const containsExactPrediction = (value) => {
    if (Array.isArray(value)) return value.some(containsExactPrediction);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(
      ([key, entry]) =>
        /^(planned|predicted).*(At|Time)$/i.test(key) || containsExactPrediction(entry),
    );
  };
  if (containsExactPrediction(payload)) {
    throw new Error(`${label} veröffentlicht eine exakte Plan- oder Prognosezeit.`);
  }
  const windows = "groups" in payload ? payload.groups : [payload];
  if (
    windows.some(
      (entry) =>
        ("waitLowerMinutes" in entry || "waitUpperMinutes" in entry) &&
        (!Number.isInteger(entry.waitLowerMinutes) ||
          !Number.isInteger(entry.waitUpperMinutes) ||
          entry.waitLowerMinutes < 0 ||
          entry.waitUpperMinutes < entry.waitLowerMinutes),
    )
  ) {
    throw new Error(`${label} veröffentlicht kein konsistentes Wartezeitfenster.`);
  }
  if (!payload.timeZone || typeof payload.timeZone !== "string") {
    throw new Error(`${label} veröffentlicht keine Veranstaltungszeitzone.`);
  }
  for (const entry of windows) {
    const lower = entry.boardingWindowLowerAt;
    const upper = entry.boardingWindowUpperAt;
    const windowExpected =
      entry.predictionQuality !== "UNCERTAIN" && ["WAITING", "PREPARE"].includes(entry.status);
    if (windowExpected) {
      if (
        typeof lower !== "string" ||
        typeof upper !== "string" ||
        !Number.isFinite(Date.parse(lower)) ||
        !Number.isFinite(Date.parse(upper)) ||
        Date.parse(upper) < Date.parse(lower)
      ) {
        throw new Error(`${label} veröffentlicht kein absolutes ISO-Zeitfenster.`);
      }
    } else if (lower !== null || upper !== null) {
      throw new Error(
        `${label} veröffentlicht ein Zeitfenster für einen nicht prognostizierten Zustand.`,
      );
    }
  }
};

let socket;
try {
  await waitForWorker();
  const adminResponse = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": devices.admin, "x-device-token": tokens.admin },
  });
  const current = await adminResponse.json();
  const configured = await command(
    devices.admin,
    tokens.admin,
    current.event.version,
    "CONFIGURE_EVENT_PARAMETERS",
    {
      saleOpensAt: null,
      operationsEndAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      noShowAfterMinutes: 10,
      notificationLeadMinutes: 60,
      // This scenario verifies the separate PREPARE/Web-Push threshold. Automatic GO TO GATE is
      // covered independently and would intentionally supersede PREPARE for the first queue entry.
      automaticPrecallEnabled: false,
      childReferenceWeightKg: 35,
      normalReferenceWeightKg: 80,
      heavyReferenceWeightKg: 110,
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 5,
      plannedBufferMinutes: 5,
      reason: "Synthetischer Monitortest",
      adminPin: pin,
    },
  );
  const activated = await command(
    devices.admin,
    tokens.admin,
    configured.event.version,
    "SET_EVENT_LIFECYCLE",
    { status: "ACTIVE", reason: "Synthetischer Monitortest", adminPin: pin },
  );
  socket = await connectRealtime();
  const privateCodes = [ticketCode(), ticketCode()];
  const publicGroupCode = ticketCode();
  const saleRefresh = nextRefresh(socket);
  const sold = await command(
    devices.cashier,
    tokens.cashier,
    activated.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-20",
      publicGroupCode,
      publicTicketCodes: privateCodes,
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  );
  if ((await saleRefresh) !== sold.event.version) {
    throw new Error("Realtime-Version stimmt nach Verkauf nicht überein.");
  }
  let initialTicketStatus;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    initialTicketStatus = await ticketStatus(privateCodes[0]);
    if (initialTicketStatus.status === "PREPARE") break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  if (
    initialTicketStatus?.status !== "PREPARE" ||
    initialTicketStatus.predictionQuality === "UNCERTAIN" ||
    initialTicketStatus.waitUpperMinutes > 60
  ) {
    throw new Error(
      `Ticketstatus leitet die Vorbereitung nicht aus Prognose und Vorlaufgrenze ab: ${JSON.stringify(initialTicketStatus)}`,
    );
  }
  assertPublicTimeCommunication(initialTicketStatus, "Ticketstatus");
  const initialGroupStatus = await groupStatus(publicGroupCode);
  if (
    initialGroupStatus.groupSize !== 2 ||
    initialGroupStatus.parts.length !== 1 ||
    initialGroupStatus.parts[0]?.passengerCount !== 2 ||
    "communicationLabel" in initialGroupStatus.parts[0]
  ) {
    throw new Error("Der öffentliche Gruppenstatus aggregiert die Buchungsgruppe nicht korrekt.");
  }
  assertPublicTimeCommunication(
    {
      timeZone: initialGroupStatus.timeZone,
      groups: initialGroupStatus.parts,
    },
    "Gruppenstatus",
  );
  const pushEndpoint = `https://fcm.googleapis.com/fcm/send/synthetic-${randomUUID()}`;
  const registerPush = async (consent) => {
    const response = await fetch(
      `${base}/api/public/tickets/${privateCodes[0]}/push-subscriptions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consent,
          endpoint: pushEndpoint,
          keys: { p256dh: "synthetic-p256dh", auth: "synthetic-auth" },
        }),
      },
    );
    return { response, body: await response.json() };
  };
  const rejectedConsent = await registerPush(false);
  if (rejectedConsent.response.status !== 400) {
    throw new Error("Web-Push wurde ohne ausdrückliche Einwilligung akzeptiert.");
  }
  const firstConsent = await registerPush(true);
  const duplicateConsent = await registerPush(true);
  if (
    firstConsent.response.status !== 201 ||
    firstConsent.body.preparationQueued !== true ||
    duplicateConsent.body.preparationQueued !== false ||
    !firstConsent.body.consentedAt ||
    !firstConsent.body.deleteAfter
  ) {
    throw new Error(
      "Push-Einwilligung oder deduplizierter Vorbereitungshinweis ist unvollständig.",
    );
  }
  const groupPushEndpoint = `https://fcm.googleapis.com/fcm/send/synthetic-group-${randomUUID()}`;
  const registerGroupPush = async (consent) => {
    const response = await fetch(
      `${base}/api/public/groups/${publicGroupCode}/push-subscriptions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consent,
          endpoint: groupPushEndpoint,
          keys: { p256dh: "synthetic-group-p256dh", auth: "synthetic-group-auth" },
        }),
      },
    );
    return { response, body: await response.json() };
  };
  const rejectedGroupConsent = await registerGroupPush(false);
  const firstGroupConsent = await registerGroupPush(true);
  const duplicateGroupConsent = await registerGroupPush(true);
  if (
    rejectedGroupConsent.response.status !== 400 ||
    firstGroupConsent.response.status !== 201 ||
    firstGroupConsent.body.preparationQueued !== true ||
    duplicateGroupConsent.body.preparationQueued !== false
  ) {
    throw new Error("Gruppenbezogene Push-Einwilligung oder Deduplizierung ist unvollständig.");
  }
  let publicBoard = await board();
  assertPublicTimeCommunication(publicBoard, "FIDS");
  if (
    publicBoard.groups.some((entry) =>
      staleDepartureCommunicationNumbers.includes(entry.communicationNumber),
    )
  ) {
    throw new Error("Abgelaufene Abflugzeilen verdrängen weiterhin kommende FIDS-Gruppen.");
  }
  const group = publicBoard.groups.find((entry) => entry.ticketLabels.length === 2);
  const soldOperationBoard = await operationBoard(devices.flightLine, tokens.flightLine);
  const soldRotation = soldOperationBoard.rotations.find(
    (rotation) => rotation.id === sold.aggregate.relatedRotationId,
  );
  const stableBookingNumber = soldRotation?.bookingGroups.find(
    (bookingGroup) => bookingGroup.id === sold.aggregate.id,
  )?.communicationNumber;
  const bookingGroupLabel = stableBookingNumber
    ? `G-${soldRotation.productCode}-${String(stableBookingNumber).padStart(4, "0")}`
    : "";
  const flightGroupLabel = soldRotation?.communicationLabel ?? "";
  const [bookingSearch, flightSearch] = await Promise.all([
    searchTickets(bookingGroupLabel),
    searchTickets(flightGroupLabel),
  ]);
  const serializedBoard = JSON.stringify(publicBoard);
  if (
    !stableBookingNumber ||
    soldRotation.communicationNumber === stableBookingNumber ||
    !flightGroupLabel.startsWith("F-PA-") ||
    bookingSearch.results[0]?.bookingGroupLabel !== bookingGroupLabel ||
    flightSearch.results[0]?.bookingGroupLabel !== bookingGroupLabel ||
    group?.communicationNumber !== stableBookingNumber ||
    initialTicketStatus.communicationNumber !== stableBookingNumber ||
    group?.ticketLabels.length !== 2 ||
    group.ticketLabels.some((label) => !label.startsWith("G-PAN20-")) ||
    group.gateLabel !== "Flight Line 1" ||
    initialTicketStatus.gateLabel !== "Flight Line 1" ||
    [...privateCodes, publicGroupCode].some((code) => serializedBoard.includes(code)) ||
    /pilot/i.test(serializedBoard)
  ) {
    throw new Error(
      `FIDS-Ticketlabels sind unvollständig oder inkonsistent: ${JSON.stringify({
        stableBookingNumber,
        bookingGroupLabel,
        flightGroupLabel,
        bookingSearchMatched: bookingSearch.results[0]?.bookingGroupLabel === bookingGroupLabel,
        flightSearchMatched: flightSearch.results[0]?.bookingGroupLabel === bookingGroupLabel,
        rotationCommunicationNumber: soldRotation?.communicationNumber,
        boardCommunicationNumber: group?.communicationNumber,
        ticketStatusCommunicationNumber: initialTicketStatus.communicationNumber,
        ticketLabelCount: group?.ticketLabels.length,
        ticketLabelsUseProductPrefix: group?.ticketLabels.every((label) =>
          label.startsWith("G-PAN20-"),
        ),
        gateLabel: group?.gateLabel,
        ticketGateLabel: initialTicketStatus.gateLabel,
        privateCodeExposed: [...privateCodes, publicGroupCode].some((code) =>
          serializedBoard.includes(code),
        ),
        pilotDataExposed: /pilot/i.test(serializedBoard),
      })}`,
    );
  }
  const splitPrivateCodes = Array.from({ length: 5 }, ticketCode);
  const splitGroupCode = ticketCode();
  const splitSaleRefresh = nextRefresh(socket);
  const splitSale = await command(
    devices.cashier,
    tokens.cashier,
    sold.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-20",
      publicGroupCode: splitGroupCode,
      publicTicketCodes: splitPrivateCodes,
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      oversizeSplitAcknowledged: true,
    },
  );
  await splitSaleRefresh;
  const splitStatus = await groupStatus(splitGroupCode);
  if (
    splitStatus.groupSize !== 5 ||
    splitStatus.parts.length !== 2 ||
    splitStatus.parts.some((part) => part.partCount !== 2) ||
    splitStatus.parts.reduce((sum, part) => sum + part.passengerCount, 0) !== 5 ||
    splitStatus.parts.some((part) => "communicationLabel" in part || "flightGroup" in part)
  ) {
    throw new Error(
      "Der öffentliche Gruppenstatus bildet eine bewusste Aufteilung nicht korrekt ab.",
    );
  }
  const alternateGate = await command(
    devices.admin,
    tokens.admin,
    splitSale.event.version,
    "UPSERT_GATE",
    {
      gateId: "demo-2026-gate-alternate",
      label: "Flight Line 2",
      gateType: "FLIGHT_LINE",
      active: true,
      sortOrder: 20,
      reason: "Synthetischer Monitortest",
      adminPin: pin,
    },
  );
  const retargetedProduct = await command(
    devices.admin,
    tokens.admin,
    alternateGate.event.version,
    "UPSERT_PRODUCT",
    {
      productId: "panorama-20",
      resourceGroupId: "rg-panorama",
      gateId: "demo-2026-gate-alternate",
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
      reason: "Synthetischer Monitortest",
      adminPin: pin,
    },
  );
  const historicalTicketStatus = await ticketStatus(privateCodes[0]);
  publicBoard = await board();
  const historicalGroup = publicBoard.groups.find(
    (entry) => entry.communicationNumber === group.communicationNumber,
  );
  if (
    historicalTicketStatus.gateLabel !== "Flight Line 1" ||
    historicalGroup?.gateLabel !== "Flight Line 1"
  ) {
    throw new Error("Eine Produktänderung hat das historische Umlauf-Gate überschrieben.");
  }
  const secondSaleRefresh = nextRefresh(socket);
  const secondSale = await command(
    devices.cashier,
    tokens.cashier,
    retargetedProduct.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-30",
      publicTicketCodes: [ticketCode()],
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  );
  await secondSaleRefresh;
  publicBoard = await board();
  assertPublicTimeCommunication(publicBoard, "FIDS nach weiterem Verkauf");
  if (
    publicBoard.groups.length < 2 ||
    !publicBoard.groups.some((entry) => entry.productCode === "PAN30")
  ) {
    throw new Error("Mehrere kommende Fluggruppen werden im FIDS nicht gemeinsam angezeigt.");
  }

  const callRefresh = nextRefresh(socket);
  const called = await command(
    devices.flightLine,
    tokens.flightLine,
    secondSale.event.version,
    "CALL_NEXT",
    {
      ticketGroupIds: [sold.aggregate.id],
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  await callRefresh;
  publicBoard = await board();
  const calledGroup = publicBoard.groups.find(
    (entry) => entry.communicationNumber === group.communicationNumber,
  );
  if (
    calledGroup?.status !== "BOARDING" ||
    calledGroup.aircraftRegistration !== "D-EDEM" ||
    publicBoard.fleet.find((aircraft) => aircraft.registration === "D-EDEM")?.status !== "BOARDING"
  ) {
    throw new Error("Boardingaufruf, Flugzeug oder Flottenstatus fehlt im FIDS.");
  }
  const calledTicketStatus = await ticketStatus(privateCodes[0]);
  assertPublicTimeCommunication(calledTicketStatus, "aufgerufener Ticketstatus");
  if (
    calledTicketStatus.status !== "COME_TO_FLIGHT_LINE" ||
    calledTicketStatus.message !== "Bitte jetzt zur Flight Line kommen."
  ) {
    throw new Error(
      `Verbindlicher Aufruf fehlt im öffentlichen Ticketstatus: ${JSON.stringify(calledTicketStatus)}`,
    );
  }
  const calledOperationBoard = await operationBoard(devices.flightLine, tokens.flightLine);
  const calledRotation = calledOperationBoard.rotations.find(
    (rotation) => rotation.id === sold.aggregate.relatedRotationId,
  );
  const attendanceRefresh = nextRefresh(socket);
  const attendance = await command(
    devices.flightLine,
    tokens.flightLine,
    called.event.version,
    "SET_TICKET_ATTENDANCE",
    { ticketId: calledRotation.tickets[0].id, checkedIn: true },
  );
  await attendanceRefresh;
  const boardingTicketStatuses = await Promise.all(privateCodes.map((code) => ticketStatus(code)));
  if (
    boardingTicketStatuses.filter((status) => status.status === "BOARDING").length !== 1 ||
    boardingTicketStatuses.filter((status) => status.status === "COME_TO_FLIGHT_LINE").length !== 1
  ) {
    throw new Error(
      `Der Check-in wird nicht ticketgenau öffentlich projiziert: ${JSON.stringify(
        boardingTicketStatuses.map((status) => status.status),
      )}`,
    );
  }

  socket.close();
  const reconnectStartedAt = Date.now();
  socket = await connectRealtime();
  const reconnectMilliseconds = Date.now() - reconnectStartedAt;
  const flightRefresh = nextRefresh(socket);
  const started = await command(
    devices.flightLine,
    tokens.flightLine,
    attendance.event.version,
    "MARK_OFF_BLOCK",
    { rotationId: sold.aggregate.relatedRotationId },
  );
  await flightRefresh;
  publicBoard = await board();
  if (
    publicBoard.groups.find((entry) => entry.communicationNumber === group.communicationNumber)
      ?.status !== "IN_FLIGHT"
  ) {
    throw new Error("FIDS wurde nach Reconnect nicht auf IM FLUG aktualisiert.");
  }
  const revokePush = await fetch(
    `${base}/api/public/tickets/${privateCodes[0]}/push-subscriptions`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: pushEndpoint }),
    },
  );
  if (revokePush.status !== 204) throw new Error("Push-Widerruf wurde nicht unmittelbar gelöscht.");
  const revokeGroupPush = await fetch(
    `${base}/api/public/groups/${publicGroupCode}/push-subscriptions`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: groupPushEndpoint }),
    },
  );
  if (revokeGroupPush.status !== 204) {
    throw new Error("Gruppen-Push-Widerruf wurde nicht unmittelbar gelöscht.");
  }
  process.stdout.write(
    JSON.stringify({
      ticketLabels: group.ticketLabels,
      bookingGroupLabel,
      flightGroupLabel,
      bookingAndFlightLabelsSearchable: true,
      privateCodesHidden: true,
      publicTicketStatusWithoutLogin: true,
      publicGroupStatusWithoutLogin: true,
      splitGroupStatusAggregated: true,
      preparationFromForecast: true,
      explicitPushConsentRequired: true,
      preparationPushDeduplicated: true,
      groupPushCoversBookingGroup: true,
      consentTimestampAndDeletionRecorded: true,
      pushRevocationDeleted: true,
      bindingCallVisible: true,
      boardingStatusVisible: true,
      boardingCallVisible: true,
      aircraftVisibleAfterAssignment: true,
      fleetStatusVisible: true,
      multipleUpcomingGroupsVisible: true,
      staleDeparturesDoNotDisplaceUpcomingGroups: true,
      absolutePublicTimeWindows: true,
      compatiblePublicWaitWindowsConsistent: true,
      historicalRotationGatePreserved: true,
      realtimeUnderTwoSeconds: true,
      reconnectMilliseconds,
      pollingFallbackSeconds: 15,
      finalVersion: started.event.version,
    }),
  );
} finally {
  socket?.close();
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
