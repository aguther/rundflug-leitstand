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
  const response = await fetch(`${base}/api/events/demo-2026/operations`, {
    headers: { "x-device-id": deviceId, "x-device-token": token },
  });
  if (!response.ok) throw new Error(`Board-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
};
const history = async (aggregateId) => {
  const query = new URLSearchParams({ aggregateType: "ROTATION", aggregateId });
  const response = await fetch(`${base}/api/events/demo-2026/history?${query}`, {
    headers: { "x-device-id": "technical-scaffold", "x-device-token": tokens.admin },
  });
  if (!response.ok) throw new Error(`Historien-Abruf fehlgeschlagen (${response.status}).`);
  return response.json();
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
  const response = await fetch(`${base}/api/events/demo-2026/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": token },
    body: JSON.stringify(body),
  });
  if (response.status !== expectedStatus) {
    throw new Error(`Kommando lieferte ${response.status} statt ${expectedStatus}.`);
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
  const activated = await post(
    tokens.admin,
    envelope("technical-scaffold", configured.event.version, "SET_EVENT_LIFECYCLE", {
      status: "ACTIVE",
      reason: "Synthetischer Vertical-Slice-Test",
      adminPin: pin,
    }),
  );
  cashierSocket = await connectRealtime();
  flightLineSocket = await connectRealtime();
  const cashierSaleSignal = nextRealtimeVersion(cashierSocket);
  const flightLineSaleSignal = nextRealtimeVersion(flightLineSocket);
  const saleEnvelope = envelope("cashier-tablet-1", activated.event.version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicTicketCodes: [ticketCode(), ticketCode()],
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });
  const sold = await post(tokens.cashier, saleEnvelope);
  const [cashierRealtime, flightLineRealtime] = await Promise.all([
    cashierSaleSignal,
    flightLineSaleSignal,
  ]);
  if (
    cashierRealtime.version !== sold.event.version ||
    flightLineRealtime.version !== sold.event.version
  ) {
    throw new Error("Parallele Geräte erhielten eine abweichende Veranstaltungsversion.");
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
      rotationId,
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    }),
    403,
  );
  const proposedBoard = await board("flight-line-tablet-1", tokens.flightLine);
  const proposedRotation = proposedBoard.rotations.find((rotation) => rotation.id === rotationId);
  if (
    proposedRotation?.suggestedAircraftId !== "aircraft-a" ||
    proposedRotation?.suggestedPilotId !== "550e8400-e29b-41d4-a716-446655440100"
  ) {
    throw new Error("Flugzeug- oder Pilotenvorschlag fehlt im Standardumlauf.");
  }
  flightLineSocket.close();
  const reconnectStartedAt = Date.now();
  flightLineSocket = await connectRealtime();
  const reconnectMilliseconds = Date.now() - reconnectStartedAt;
  const callSignal = nextRealtimeVersion(flightLineSocket);
  const firstCall = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", sold.event.version, "CALL_NEXT", {
      rotationId,
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    }),
  );
  const callRealtime = await callSignal;
  if (callRealtime.version !== firstCall.event.version) {
    throw new Error("Wiederverbundenes Gerät erhielt den Aufruf nicht.");
  }
  const revoked = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", firstCall.event.version, "REVOKE_CALL", { rotationId }),
  );
  current = await board("flight-line-tablet-1", tokens.flightLine);
  const revokedRotation = current.rotations.find((rotation) => rotation.id === rotationId);
  const releasedAircraft = current.aircraft.find((aircraft) => aircraft.id === "aircraft-a");
  if (revokedRotation?.status !== "DRAFT" || releasedAircraft?.operationalState !== "AVAILABLE") {
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
  const called = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", revoked.event.version, "CALL_NEXT", {
      rotationId,
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    }),
  );
  const started = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", called.event.version, "MARK_IN_FLIGHT", { rotationId }),
  );
  const landed = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", started.event.version, "MARK_LANDED", { rotationId }),
  );
  current = await board("flight-line-tablet-1", tokens.flightLine);
  const landedAircraft = current.aircraft.find((aircraft) => aircraft.id === "aircraft-a");
  if (landedAircraft?.operationalState !== "LANDED") {
    throw new Error("GELANDET hat den erwarteten belegten Flugzeugzustand nicht erhalten.");
  }
  const completed = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", landed.event.version, "MARK_COMPLETED", { rotationId }),
  );
  current = await board("flight-line-tablet-1", tokens.flightLine);
  const finalAircraft = current.aircraft.find((aircraft) => aircraft.id === "aircraft-a");
  const finalRotation = current.rotations.find((rotation) => rotation.id === rotationId);
  if (finalAircraft?.operationalState !== "AVAILABLE" || finalRotation?.status !== "COMPLETED") {
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
  const devicesResponse = await fetch(`${base}/api/events/demo-2026/devices`, {
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
      sale: sold.eventType,
      duplicate: duplicate.duplicate,
      staleRejected: true,
      unpairedRejected: true,
      wrongRoleRejected: true,
      twoDevicesRealtimeUnderTwoSeconds: true,
      maximumRealtimeMilliseconds: Math.max(
        cashierRealtime.elapsedMs,
        flightLineRealtime.elapsedMs,
        callRealtime.elapsedMs,
      ),
      reconnectMilliseconds,
      deviceAttributionVisible: true,
      assignmentSuggested: true,
      callCorrectionAudited: true,
      transitions: [called.eventType, started.eventType, landed.eventType, completed.eventType],
      landedAircraftState: landedAircraft.operationalState,
      finalAircraftState: finalAircraft.operationalState,
      ticketCount: finalRotation.ticketCount,
      timingComplete,
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
