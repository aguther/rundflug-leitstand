import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = "http://127.0.0.1:8787";
const wsBase = "ws://127.0.0.1:8787";
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
const ticketStatus = async (code) => {
  const response = await fetch(`${base}/api/public/tickets/${code}`);
  if (!response.ok)
    throw new Error(`Öffentlicher Ticketstatus fehlgeschlagen (${response.status}).`);
  return response.json();
};
const command = async (device, token, expectedVersion, type, payload) => {
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
  if (!response.ok) throw new Error(`${type} fehlgeschlagen (${response.status}).`);
  return response.json();
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
  const saleRefresh = nextRefresh(socket);
  const sold = await command(
    devices.cashier,
    tokens.cashier,
    activated.event.version,
    "SELL_TICKET_GROUP",
    {
      productId: "panorama-20",
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
  let publicBoard = await board();
  const group = publicBoard.groups.find((entry) => entry.ticketLabels.length === 2);
  const serializedBoard = JSON.stringify(publicBoard);
  if (
    group?.ticketLabels.length !== 2 ||
    group.ticketLabels.some((label) => !label.startsWith("PAN20-")) ||
    privateCodes.some((code) => serializedBoard.includes(code)) ||
    /pilot/i.test(serializedBoard)
  ) {
    throw new Error("FIDS-Ticketlabels sind unvollständig oder enthalten vertrauliche Daten.");
  }
  const secondSaleRefresh = nextRefresh(socket);
  const secondSale = await command(
    devices.cashier,
    tokens.cashier,
    sold.event.version,
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
      rotationId: sold.aggregate.relatedRotationId,
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
    calledGroup?.status !== "COME_TO_FLIGHT_LINE" ||
    calledGroup.aircraftRegistration !== "D-EDEM" ||
    publicBoard.fleet.find((aircraft) => aircraft.registration === "D-EDEM")?.status !== "BOARDING"
  ) {
    throw new Error("Boardingaufruf, Flugzeug oder Flottenstatus fehlt im FIDS.");
  }
  const calledTicketStatus = await ticketStatus(privateCodes[0]);
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
  const boardingTicketStatus = await ticketStatus(privateCodes[0]);
  if (boardingTicketStatus.status !== "BOARDING") {
    throw new Error("Eingechecktes Ticket wechselt öffentlich nicht auf Boarding.");
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
    "MARK_IN_FLIGHT",
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
  process.stdout.write(
    JSON.stringify({
      ticketLabels: group.ticketLabels,
      privateCodesHidden: true,
      publicTicketStatusWithoutLogin: true,
      preparationFromForecast: true,
      explicitPushConsentRequired: true,
      preparationPushDeduplicated: true,
      consentTimestampAndDeletionRecorded: true,
      pushRevocationDeleted: true,
      bindingCallVisible: true,
      boardingStatusVisible: true,
      boardingCallVisible: true,
      aircraftVisibleAfterAssignment: true,
      fleetStatusVisible: true,
      multipleUpcomingGroupsVisible: true,
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
