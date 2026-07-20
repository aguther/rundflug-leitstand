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
const board = async () => {
  const response = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": devices.admin, "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const envelope = (deviceId, expectedVersion, type, payload, commandId = randomUUID()) => ({
  commandId,
  eventId: "demo-2026",
  deviceId,
  expectedVersion,
  issuedAt: new Date().toISOString(),
  type,
  payload,
});
const post = async (token, body, expectedStatus = 200) => {
  const response = await fetch(`${base}/api/events/demo-2026/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": token },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${body.type} lieferte ${response.status} statt ${expectedStatus}: ${JSON.stringify(result)}`,
    );
  }
  return result;
};
const history = async (ticketGroupId) => {
  const query = new URLSearchParams({
    aggregateType: "TICKET_GROUP",
    aggregateId: ticketGroupId,
    limit: "100",
  });
  const response = await fetch(`${base}/api/events/demo-2026/history?${query}`, {
    headers: { "x-device-id": devices.admin, "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Historien-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const ticketSearch = async (status, query) => {
  const params = new URLSearchParams({ status, q: query, limit: "20" });
  const response = await fetch(`${base}/api/events/demo-2026/tickets/search?${params}`, {
    headers: { "x-device-id": devices.cashier, "x-device-token": tokens.cashier },
  });
  if (!response.ok) throw new Error(`Ticketsuche fehlgeschlagen (${response.status}).`);
  return response.json();
};
const operationalHistory = async (filters, device = "admin", expectedStatus = 200) => {
  const query = new URLSearchParams(filters);
  const response = await fetch(`${base}/api/events/demo-2026/history/operations?${query}`, {
    headers: { "x-device-id": devices[device], "x-device-token": tokens[device] },
  });
  const result = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(
      `Fachhistorie lieferte ${response.status} statt ${expectedStatus}: ${JSON.stringify(result)}`,
    );
  }
  return result;
};
const dailyReport = async () => {
  const response = await fetch(`${base}/api/events/demo-2026/reports/daily.csv`, {
    headers: { "x-device-id": devices.admin, "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Tagesbericht-Abruf fehlgeschlagen (${response.status}).`);
  return response.text();
};
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const sale = (version, count = 2, oversizeSplitAcknowledged = false) =>
  post(
    tokens.cashier,
    envelope(devices.cashier, version, "SELL_TICKET_GROUP", {
      productId: "panorama-20",
      publicTicketCodes: Array.from({ length: count }, ticketCode),
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      oversizeSplitAcknowledged,
    }),
  );

try {
  await waitForWorker();
  let current = await board();
  let result = await post(
    tokens.admin,
    envelope(devices.admin, current.event.version, "CONFIGURE_EVENT_PARAMETERS", {
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
      reason: "Synthetischer Korrekturtest",
      adminPin: pin,
    }),
  );
  result = await post(
    tokens.admin,
    envelope(devices.admin, result.event.version, "SET_EVENT_LIFECYCLE", {
      status: "ACTIVE",
      reason: "Synthetischer Korrekturtest",
      adminPin: pin,
    }),
  );

  const cancelSale = await sale(result.event.version);
  const cancelGroupId = cancelSale.aggregate.id;
  const boardWithSale = await board();
  const capacityWithSale = boardWithSale.products.find(
    (entry) => entry.id === "panorama-20",
  )?.remainingSellableSeats;
  const cancelPayload = {
    ticketGroupId: cancelGroupId,
    reason: "Synthetisches Storno",
    adminPin: pin,
  };
  await post(
    tokens.flightLine,
    envelope(devices.flightLine, cancelSale.event.version, "CANCEL_TICKET_GROUP", cancelPayload),
    403,
  );
  await post(
    "invalid-device-token",
    envelope(devices.cashier, cancelSale.event.version, "CANCEL_TICKET_GROUP", {
      ...cancelPayload,
      adminPin: pin,
    }),
    401,
  );
  const cancelCommand = envelope(
    devices.cashier,
    cancelSale.event.version,
    "CANCEL_TICKET_GROUP",
    cancelPayload,
  );
  const canceled = await post(tokens.cashier, cancelCommand);
  const duplicate = await post(tokens.cashier, cancelCommand);
  if (!duplicate.duplicate || duplicate.event.version !== canceled.event.version) {
    throw new Error("Idempotentes Storno veränderte den bestätigten Zustand.");
  }
  const reportAfterCancel = await dailyReport();
  if (!reportAfterCancel.split("\n").some((line) => /[;,]2[;,]2[;,]0\s*$/.test(line))) {
    throw new Error(
      `Stornierte Tickets fehlen im autorisierten Tagesbericht: ${JSON.stringify(reportAfterCancel)}`,
    );
  }
  const cancelAudit = await history(cancelGroupId);
  const cancelEvent = cancelAudit.entries.find(
    (entry) => entry.eventType === "TICKET_GROUP_CANCELED",
  );
  if (cancelEvent?.payload?.reason !== cancelPayload.reason) {
    throw new Error("Stornogrund fehlt im unveränderlichen Audit-Eintrag.");
  }
  const canceledHistory = await operationalHistory({
    ticketGroupId: cancelGroupId,
    ticketStatus: "CANCELED",
  });
  if (
    canceledHistory.total !== 2 ||
    canceledHistory.entries.some(
      (entry) => entry.assignmentActive || !entry.releasedAt || !entry.rotationId,
    )
  ) {
    throw new Error(
      "Stornierte Tickets oder freigegebene Umlaufzuordnungen fehlen in der Fachhistorie.",
    );
  }
  const boardAfterCancel = await board();
  const capacityAfterCancel = boardAfterCancel.products.find(
    (entry) => entry.id === "panorama-20",
  )?.remainingSellableSeats;
  if (
    capacityWithSale === undefined ||
    capacityAfterCancel === undefined ||
    capacityAfterCancel < capacityWithSale + 2
  ) {
    throw new Error("Storno hat die verkaufte Kapazität nicht unmittelbar freigegeben.");
  }
  const canceledSearch = await ticketSearch("CANCELED", cancelGroupId);
  const canceledListEntry = canceledSearch.results.find(
    (entry) => entry.ticketGroupId === cancelGroupId,
  );
  if (canceledListEntry?.groupStatus !== "CANCELED" || !canceledListEntry.bookingGroupLabel) {
    throw new Error("Stornierte Buchungsgruppe fehlt in der aktuellen Kassenliste.");
  }

  await post(
    tokens.cashier,
    envelope(devices.cashier, canceled.event.version, "REBOOK_TICKET_GROUP", {
      ticketGroupId: cancelGroupId,
      newProductId: "panorama-30",
      reason: "Nicht mehr unterstützte Umbuchung",
      adminPin: pin,
    }),
    400,
  );

  const resale = await sale(canceled.event.version);
  const resaleGroupId = resale.aggregate.id;
  if (resaleGroupId === cancelGroupId) {
    throw new Error("Neuverkauf hat die stornierte Buchungsgruppe wiederverwendet.");
  }
  current = await board();
  const newRotation = current.rotations.find(
    (entry) => entry.ticketGroupId === resaleGroupId && entry.status === "DRAFT",
  );
  const resaleProduct = current.products.find((entry) => entry.id === "panorama-20");
  if (newRotation?.productName !== "20 Min. Panorama") {
    throw new Error("Neuverkauf wurde nicht als neue aktive Buchungsgruppe eingereiht.");
  }
  if (!resaleProduct)
    throw new Error("Synthetisches Verkaufsprodukt fehlt in der Operationssicht.");
  const activeSearch = await ticketSearch("ACTIVE", resaleGroupId);
  const activeListEntry = activeSearch.results.find(
    (entry) => entry.ticketGroupId === resaleGroupId,
  );
  if (
    !activeListEntry ||
    activeListEntry.queueSequence <= canceledListEntry.queueSequence ||
    activeListEntry.groupStatus !== "QUEUED"
  ) {
    throw new Error("Neuverkauf steht nicht mit neuer aktueller Queue-Position am Queue-Ende.");
  }
  const resaleHistory = await operationalHistory({
    productId: "panorama-20",
    resourceGroupId: resaleProduct.resourceGroupId,
    ticketGroupId: resaleGroupId,
    communicationNumber: String(newRotation.communicationNumber),
    ticketStatus: "QUEUED",
    rotationStatus: "DRAFT",
    limit: "1",
    offset: "0",
  });
  if (
    resaleHistory.total !== 2 ||
    resaleHistory.entries.length !== 1 ||
    resaleHistory.entries[0]?.communicationLabel !== newRotation.communicationLabel ||
    resaleHistory.entries[0]?.productId !== "panorama-20"
  ) {
    throw new Error(
      "Produkt-, Ressourcen-, Slot- oder Statusfilter der Fachhistorie sind inkonsistent.",
    );
  }
  await post(
    tokens.cashier,
    envelope(devices.cashier, resale.event.version, "SELL_TICKET_GROUP", {
      productId: "panorama-20",
      publicTicketCodes: Array.from({ length: 5 }, ticketCode),
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      oversizeSplitAcknowledged: false,
    }),
    409,
  );
  const splitSale = await sale(resale.event.version, 5, true);
  current = await board();
  const splitRotations = current.rotations.filter(
    (entry) => entry.ticketGroupId === splitSale.aggregate.id && entry.status === "DRAFT",
  );
  if (splitRotations.length !== 2) {
    throw new Error("Informierter Verkauf über Referenzkapazität erzeugte nicht zwei Fluggruppen.");
  }
  const splitHistory = await history(splitSale.aggregate.id);
  const splitEvent = splitHistory.entries.find((entry) => entry.eventType === "TICKET_GROUP_SOLD");
  if (
    splitEvent?.payload?.oversizeSplitAcknowledged !== true ||
    JSON.stringify(splitEvent.payload.slotSizes) !== JSON.stringify([4, 1])
  ) {
    throw new Error("Aufteilung und Auswirkungen fehlen im Audit des Verkaufs.");
  }
  await operationalHistory(
    {
      since: "2026-07-11T18:00:00.000Z",
      until: "2026-07-11T08:00:00.000Z",
    },
    "admin",
    400,
  );
  await operationalHistory({ ticketGroupId: resaleGroupId }, "cashier", 403);
  console.log(
    JSON.stringify({
      ok: true,
      requirements: [
        "F-KAS-070",
        "V16-KAS-010",
        "V16-KAS-020",
        "V16-KAS-040",
        "V16-KAS-050",
        "F-HIS-020",
      ],
      verified: [
        "role-and-session-authorization",
        "reason-audit",
        "idempotency",
        "stale-write-rejection",
        "rotation-release",
        "capacity-release",
        "rebooking-rejected",
        "cancel-and-resale-new-queue-entry",
        "informed-capacity-split-without-extra-confirmation",
        "authorized-paginated-operational-history",
        "entity-status-and-time-filter-validation",
      ],
    }),
  );
} finally {
  server.kill();
}
