import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const persistPath = resolve(root, ".wrangler/automatic-precall-state");
const persistArgument = ".wrangler/automatic-precall-state";
const port = 8_797;
const eventId = "demo-2026";
const gateId = "demo-2026-gate-main";
const resourceGroupId = "rg-panorama";
const productId = "panorama-20";
const deviceId = "technical-scaffold";
const token = "demo-admin-device-token";
const createdAt = new Date(Date.now() - 60_000).toISOString();
const wranglerBaseArguments = [
  "--local",
  "--persist-to",
  persistArgument,
  "--config",
  "wrangler.jsonc",
];

await rm(persistPath, { recursive: true, force: true });
const migrate = spawnSync(
  process.execPath,
  [wranglerCli, "d1", "migrations", "apply", "DB", ...wranglerBaseArguments],
  { cwd: root, stdio: "ignore" },
);
if (migrate.status !== 0) {
  throw new Error("Isolierte GO-TO-GATE-Testdatenbank konnte nicht migriert werden.");
}

const groupSql = Array.from({ length: 4 }, (_, groupIndex) => {
  const groupNumber = groupIndex + 1;
  const ticketGroupId = `automatic-precall-ticket-group-${groupNumber}`;
  const flightGroupId = `automatic-precall-flight-group-${groupNumber}`;
  const rotationId = `automatic-precall-rotation-${groupNumber}`;
  const tickets = Array.from({ length: 3 }, (_, ticketIndex) => {
    const ticketNumber = ticketIndex + 1;
    const ticketId = `automatic-precall-ticket-${groupNumber}-${ticketNumber}`;
    const publicCode = `SYN-AUTO-${groupNumber}-${ticketNumber}`;
    const publicCodeHash = createHash("sha256").update(publicCode).digest("hex");
    return `
INSERT INTO tickets
  (id, ticket_group_id, public_code_hash, public_code, status, weight_class,
   payment_status, payment_method, price_cents, created_at)
VALUES
  ('${ticketId}', '${ticketGroupId}', '${publicCodeHash}', '${publicCode}', 'QUEUED',
   'NOT_CAPTURED', 'PAID', 'CASH', 2500, '${createdAt}');
INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
VALUES ('${rotationId}', '${ticketId}', '${createdAt}');`;
  }).join("\n");
  return `
INSERT INTO ticket_groups
  (id, operation_day_id, product_id, queue_sequence, communication_number, standby,
   status, sold_at, version)
VALUES
  ('${ticketGroupId}', '${eventId}', '${productId}', ${groupNumber}, ${100 + groupNumber}, 0,
   'QUEUED', '${createdAt}', 0);
INSERT INTO flight_groups
  (id, operation_day_id, resource_group_id, communication_number, queue_position, status,
   version, created_at, updated_at)
VALUES
  ('${flightGroupId}', '${eventId}', '${resourceGroupId}', ${groupNumber}, ${groupNumber},
   'DRAFT', 0, '${createdAt}', '${createdAt}');
INSERT INTO rotations
  (id, operation_day_id, flight_group_id, gate_id, status, version, created_at, updated_at)
VALUES
  ('${rotationId}', '${eventId}', '${flightGroupId}', '${gateId}', 'DRAFT', 0,
   '${createdAt}', '${createdAt}');
${tickets}`;
}).join("\n");

const setupSql = `
UPDATE operation_days
   SET status = 'ACTIVE', version = 0, automatic_precall_enabled = 1,
       operations_end_at = '2099-07-23T20:00:00.000Z', updated_at = '${createdAt}'
 WHERE id = '${eventId}';
UPDATE resource_groups
   SET status = 'ACTIVE', automatic_precall_enabled = 1, reference_capacity = 4,
       planned_rotation_minutes = 36, compatible_aircraft_types_json = '["SYN-4"]'
 WHERE id = '${resourceGroupId}';
UPDATE aircraft
   SET aircraft_type = 'SYN-4', passenger_seats = 4, operational_state = 'AVAILABLE'
 WHERE id = 'aircraft-a';
INSERT INTO aircraft
  (id, registration, aircraft_type, passenger_seats, operational_state, created_at, updated_at)
VALUES
  ('automatic-precall-aircraft-2', 'D-SY02', 'SYN-4', 4, 'AVAILABLE', '${createdAt}', '${createdAt}'),
  ('automatic-precall-aircraft-3', 'D-SY03', 'SYN-4', 4, 'AVAILABLE', '${createdAt}', '${createdAt}');

INSERT INTO resource_group_memberships
  (id, operation_day_id, resource_group_id, aircraft_id, active_from, created_at)
VALUES
  ('automatic-precall-membership-2', '${eventId}', '${resourceGroupId}',
   'automatic-precall-aircraft-2', '${createdAt}', '${createdAt}'),
  ('automatic-precall-membership-3', '${eventId}', '${resourceGroupId}',
   'automatic-precall-aircraft-3', '${createdAt}', '${createdAt}');

INSERT INTO pilots
  (id, operation_day_id, operational_code, active, created_at, updated_at)
VALUES
  ('automatic-precall-pilot-2', '${eventId}', 'SYN-02', 1, '${createdAt}', '${createdAt}'),
  ('automatic-precall-pilot-3', '${eventId}', 'SYN-03', 1, '${createdAt}', '${createdAt}');

${groupSql}
`;

const seed = spawnSync(
  process.execPath,
  [
    wranglerCli,
    "d1",
    "execute",
    "DB",
    "--file",
    "apps/worker/seed/demo.sql",
    ...wranglerBaseArguments,
  ],
  { cwd: root, encoding: "utf8" },
);
if (seed.status !== 0) {
  throw new Error(
    `Synthetischer GO-TO-GATE-Datensatz fehlgeschlagen: ${seed.stderr || seed.stdout}`,
  );
}
const setup = spawnSync(
  process.execPath,
  [wranglerCli, "d1", "execute", "DB", ...wranglerBaseArguments, "--command", setupSql],
  { cwd: root, encoding: "utf8" },
);
if (setup.status !== 0) {
  throw new Error(`GO-TO-GATE-Testaufbau fehlgeschlagen: ${setup.stderr || setup.stdout}`);
}

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
    "--persist-to",
    persistArgument,
    "--port",
    String(port),
    "--inspector-port",
    String(port + 1_000),
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = `http://127.0.0.1:${port}`;
const wait = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const waitForWorker = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig bereit.");
};
const command = async (expectedVersion, note) => {
  const response = await fetch(`${base}/api/events/${eventId}/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-token": token,
    },
    body: JSON.stringify({
      commandId: randomUUID(),
      eventId,
      deviceId,
      expectedVersion,
      issuedAt: new Date().toISOString(),
      type: "SET_OPERATIONAL_NOTE",
      payload: { note },
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      `GO-TO-GATE-Auslöser schlug fehl (${response.status}): ${JSON.stringify(result)}`,
    );
  }
  return result;
};
const loadOperations = async () => {
  const response = await fetch(`${base}/api/events/${eventId}/operations`, {
    headers: { "x-device-id": deviceId, "x-device-token": token },
  });
  if (!response.ok) throw new Error(`Operativer Stand nicht lesbar (${response.status}).`);
  return response.json();
};
const loadHistory = async () => {
  const response = await fetch(`${base}/api/events/${eventId}/history?limit=100`, {
    headers: { "x-device-id": deviceId, "x-device-token": token },
  });
  if (!response.ok) throw new Error(`GO-TO-GATE-Audit nicht lesbar (${response.status}).`);
  return response.json();
};
const loadPublicBoard = async () => {
  const response = await fetch(
    `${base}/api/public/events/${eventId}/board?gateId=${encodeURIComponent(gateId)}`,
  );
  if (!response.ok)
    throw new Error(`Öffentlicher GO-TO-GATE-Stand nicht lesbar (${response.status}).`);
  return response.json();
};
const waitForPrecallCount = async (expectedCount, afterPredictionUpdate = null) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const operations = await loadOperations();
    const rotations = operations.rotations
      .filter((rotation) => rotation.id.startsWith("automatic-precall-rotation-"))
      .sort((left, right) => left.communicationNumber - right.communicationNumber);
    const precallCount = rotations.filter((rotation) => rotation.precalledAt !== null).length;
    const forecastAdvanced =
      afterPredictionUpdate === null ||
      rotations.some(
        (rotation) =>
          rotation.timeline.predictionUpdatedAt &&
          Date.parse(rotation.timeline.predictionUpdatedAt) > Date.parse(afterPredictionUpdate),
      );
    if (rotations.length === 4 && precallCount === expectedCount && forecastAdvanced) {
      return { operations, rotations };
    }
    await wait(100);
  }
  throw new Error(`Erwartete Anzahl von ${expectedCount} GO-TO-GATE-Aufrufen nicht erreicht.`);
};

let firstRun;
let secondRun;
let publicBoard;
let history;
try {
  await waitForWorker();
  const seededBoard = await loadPublicBoard();
  if (seededBoard.eventName !== "Synthetischer Flugtag 2026") {
    throw new Error(
      `Der lokale Worker verwendet nicht den isolierten GO-TO-GATE-Datensatz: ${JSON.stringify({
        eventName: seededBoard.eventName,
      })}`,
    );
  }
  await command(0, "Synthetischer paralleler Voraufruf");
  firstRun = await waitForPrecallCount(3);
  const firstPredictionUpdate = firstRun.rotations[0]?.timeline.predictionUpdatedAt;
  if (!firstPredictionUpdate) throw new Error("Erster Prognosezeitpunkt fehlt.");

  await wait(50);
  await command(1, "Synthetischer Wiederholungslauf");
  secondRun = await waitForPrecallCount(3, firstPredictionUpdate);
  [publicBoard, history] = await Promise.all([loadPublicBoard(), loadHistory()]);
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}

const firstThree = secondRun.rotations.slice(0, 3);
const fourth = secondRun.rotations[3];
const precallAudit = history.entries
  .filter((entry) => entry.eventType === "FLIGHT_GROUP_PRECALLED")
  .sort((left, right) => left.sequence - right.sequence);
const publicGroups = publicBoard.groups
  .filter((group) => group.productCode === "PAN20")
  .sort((left, right) => left.communicationNumber - right.communicationNumber);
const invariants = {
  exactlyThreePrecalled:
    firstThree.every((rotation) => rotation.precalledAt !== null) && fourth?.precalledAt === null,
  stableQueueOrder:
    firstThree.map((rotation) => rotation.communicationNumber).join(",") === "1,2,3" &&
    precallAudit.map((entry) => entry.aggregateId).join(",") ===
      "automatic-precall-flight-group-1,automatic-precall-flight-group-2,automatic-precall-flight-group-3",
  draftWithoutBinding:
    firstThree.every((rotation) => rotation.status === "DRAFT" && rotation.aircraftId === null) &&
    fourth?.status === "DRAFT" &&
    fourth.aircraftId === null,
  publicStatus:
    publicGroups.length === 4 &&
    publicGroups.slice(0, 3).every((group) => group.status === "COME_TO_FLIGHT_LINE") &&
    publicGroups[3]?.status === "WAITING",
  auditExactlyOnce:
    precallAudit.length === 3 &&
    precallAudit.every(
      (entry) =>
        entry.deviceId === "SYSTEM" &&
        entry.aggregateType === "FLIGHT_GROUP" &&
        entry.aggregateVersion === 1 &&
        entry.payload.trigger === "AUTOMATIC_PRECALL",
    ),
};
if (Object.values(invariants).some((passed) => !passed)) {
  throw new Error(
    `Paralleler GO-TO-GATE-Lauf inkonsistent: ${JSON.stringify({
      invariants,
      rotations: secondRun.rotations,
      publicGroups,
      precallAudit,
    })}`,
  );
}

const outboxQuery = spawnSync(
  process.execPath,
  [
    wranglerCli,
    "d1",
    "execute",
    "DB",
    ...wranglerBaseArguments,
    "--command",
    `SELECT COUNT(*) AS count FROM outbox
      WHERE operation_day_id = '${eventId}'
        AND json_extract(payload_json, '$.trigger') = 'AUTOMATIC_PRECALL'`,
    "--json",
  ],
  { cwd: root, encoding: "utf8" },
);
if (outboxQuery.status !== 0) {
  throw new Error(`GO-TO-GATE-Outbox nicht lesbar: ${outboxQuery.stderr || outboxQuery.stdout}`);
}
const outboxResult = JSON.parse(outboxQuery.stdout);
const outboxCount = outboxResult.flatMap((entry) => entry.results ?? [])[0]?.count;
if (outboxCount !== 3) {
  throw new Error(
    `Erwartet wurden exakt drei GO-TO-GATE-Outbox-Einträge, erhalten: ${outboxCount}`,
  );
}

console.log(
  JSON.stringify({
    ok: true,
    selectedCommunicationNumbers: firstThree.map((rotation) => rotation.communicationNumber),
    waitingCommunicationNumber: fourth.communicationNumber,
    publicStatuses: publicGroups.map((group) => group.status),
    auditEntries: precallAudit.length,
    outboxEntries: outboxCount,
    duplicatePrecallsAfterSecondRun: 0,
  }),
);
