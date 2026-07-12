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
  const saleEnvelope = envelope("cashier-tablet-1", activated.event.version, "SELL_TICKET_GROUP", {
    productId: "panorama-20",
    publicTicketCodes: [ticketCode(), ticketCode()],
    standby: false,
    paymentStatus: "PAID",
    paymentMethod: "CASH",
  });
  const sold = await post(tokens.cashier, saleEnvelope);
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
  const proposedBoard = await board("flight-line-tablet-1", tokens.flightLine);
  const proposedRotation = proposedBoard.rotations.find((rotation) => rotation.id === rotationId);
  if (
    proposedRotation?.suggestedAircraftId !== "aircraft-a" ||
    proposedRotation?.suggestedPilotId !== "550e8400-e29b-41d4-a716-446655440100"
  ) {
    throw new Error("Flugzeug- oder Pilotenvorschlag fehlt im Standardumlauf.");
  }
  const called = await post(
    tokens.flightLine,
    envelope("flight-line-tablet-1", sold.event.version, "CALL_NEXT", {
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
  process.stdout.write(
    JSON.stringify({
      sale: sold.eventType,
      duplicate: duplicate.duplicate,
      staleRejected: true,
      assignmentSuggested: true,
      transitions: [called.eventType, started.eventType, landed.eventType, completed.eventType],
      landedAircraftState: landedAircraft.operationalState,
      finalAircraftState: finalAircraft.operationalState,
      ticketCount: finalRotation.ticketCount,
      timingComplete,
      finalVersion: current.event.version,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
