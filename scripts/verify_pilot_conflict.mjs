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
const history = async (rotationId) => {
  const query = new URLSearchParams({ aggregateType: "ROTATION", aggregateId: rotationId });
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
  const firstSale = await sell(result.event.version);
  current = await board();
  const capacitySafeProposal = current.rotations.find(
    (rotation) => rotation.id === firstSale.aggregate.relatedRotationId,
  );
  if (capacitySafeProposal?.suggestedAircraftId !== "aircraft-a") {
    throw new Error("Zu kleines Flugzeug wurde für eine Vierergruppe vorgeschlagen.");
  }
  const secondSale = await sell(firstSale.event.version);
  const firstCall = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    secondSale.event.version,
    "CALL_NEXT",
    {
      rotationId: secondSale.aggregate.relatedRotationId,
      aircraftId: "aircraft-b",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  const conflict = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    firstCall.event.version,
    "CALL_NEXT",
    {
      rotationId: firstSale.aggregate.relatedRotationId,
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
    409,
  );
  if (conflict.error?.code !== "PILOT_NOT_AVAILABLE") {
    throw new Error(
      "Parallele Pilotenzuordnung wurde nicht mit dem erwarteten Konflikt abgewiesen.",
    );
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  const secondCall = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    firstCall.event.version,
    "CALL_NEXT",
    {
      rotationId: firstSale.aggregate.relatedRotationId,
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
    for (const type of ["MARK_IN_FLIGHT", "MARK_LANDED", "MARK_COMPLETED"]) {
      transition = await command(
        "flight-line-tablet-1",
        tokens.flightLine,
        transition.event.version,
        type,
        { rotationId },
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
  const changedPilot = await command(
    "flight-line-tablet-1",
    tokens.flightLine,
    thirdSale.event.version,
    "CALL_NEXT",
    {
      rotationId: thirdSale.aggregate.relatedRotationId,
      aircraftId: "aircraft-a",
      pilotId: "550e8400-e29b-41d4-a716-446655440100",
    },
  );
  current = await board();
  const changedAircraft = current.aircraft.find((aircraft) => aircraft.id === "aircraft-a");
  const changeHistory = await history(thirdSale.aggregate.relatedRotationId);
  const callAudit = changeHistory.entries.find(
    (entry) => entry.eventType === "FLIGHT_GROUP_CALLED",
  );
  if (
    changedPilot.event.version !== current.event.version ||
    changedAircraft?.currentPilotId !== "550e8400-e29b-41d4-a716-446655440100" ||
    callAudit?.payload?.previousAircraftPilotId !== "550e8400-e29b-41d4-a716-446655440200" ||
    callAudit.payload.pilotChanged !== true
  ) {
    throw new Error("Bewusster Pilotwechsel wurde nicht fortgeführt und vollständig auditiert.");
  }
  transition = changedPilot;
  for (const type of ["MARK_IN_FLIGHT", "MARK_LANDED", "MARK_COMPLETED"]) {
    transition = await command(
      "flight-line-tablet-1",
      tokens.flightLine,
      transition.event.version,
      type,
      { rotationId: thirdSale.aggregate.relatedRotationId },
    );
  }
  const fourthSale = await sell(transition.event.version);
  current = await board();
  const fourthProposal = current.rotations.find(
    (rotation) => rotation.id === fourthSale.aggregate.relatedRotationId,
  );
  if (
    fourthProposal?.suggestedAircraftId !== "aircraft-a" ||
    fourthProposal.suggestedPilotId !== "550e8400-e29b-41d4-a716-446655440100"
  ) {
    throw new Error(
      "Geänderter Pilotencode wird beim Folgeumlauf nicht fortgeführt vorgeschlagen.",
    );
  }
  console.log(
    JSON.stringify({
      ok: true,
      requirements: ["F-BRD-030", "F-BRD-040", "F-SLT-120"],
      samePilotConflictRejected: true,
      undersizedAircraftNotSuggested: true,
      differentPilotsAccepted: true,
      activeRotations: active.length,
      earliestBusyAircraftSuggested: true,
      rememberedPilotSuggested: true,
      pilotChangeAudited: true,
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
