import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const persistPath = resolve(root, ".wrangler/acceptance-state");
const port = 8_796;
await rm(persistPath, { recursive: true, force: true });
const wranglerBaseArguments = [
  "--local",
  "--persist-to",
  persistPath,
  "--config",
  "wrangler.jsonc",
];
const migrate = spawnSync(
  process.execPath,
  [wranglerCli, "d1", "migrations", "apply", "DB", ...wranglerBaseArguments],
  { cwd: root, stdio: "ignore" },
);
if (migrate.status !== 0)
  throw new Error("Isolierte Abnahmedatenbank konnte nicht migriert werden.");

const eventId = "acceptance-v1";
const token = "synthetic-v1-acceptance-device-token";
const tokenHash = createHash("sha256").update(token).digest("hex");
const now = "2026-07-14T06:00:00.000Z";
const seedSql = `
INSERT INTO operation_days
  (id, name, event_date, time_zone, status, version, operations_end_at, created_at, updated_at)
VALUES
  ('${eventId}', 'Synthetischer V1-Abnahmetag', '2026-07-14', 'Europe/Berlin', 'ACTIVE', 0,
   '2099-07-14T20:00:00.000Z', '${now}', '${now}');

INSERT INTO gates
  (id, operation_day_id, label, gate_type, active, sort_order, created_at, updated_at)
VALUES
  ('acceptance-gate-a', '${eventId}', 'Flight Line A', 'FLIGHT_LINE', 1, 10, '${now}', '${now}'),
  ('acceptance-gate-b', '${eventId}', 'Flight Line B', 'FLIGHT_LINE', 1, 20, '${now}', '${now}');

INSERT INTO resource_groups
  (id, operation_day_id, name, status, gate_id, reference_capacity, planned_rotation_minutes,
   compatible_aircraft_types_json, version, created_at, updated_at)
VALUES
  ('acceptance-rg-a', '${eventId}', 'Ressource A', 'ACTIVE', 'acceptance-gate-a', 4, 30,
   '["SYN-A"]', 0, '${now}', '${now}'),
  ('acceptance-rg-b', '${eventId}', 'Ressource B', 'ACTIVE', 'acceptance-gate-b', 4, 35,
   '["SYN-B"]', 0, '${now}', '${now}');

INSERT INTO products
  (id, operation_day_id, resource_group_id, gate_id, name, code, price_cents, sale_enabled,
   reference_capacity, reference_duration_minutes, sort_order, created_at, updated_at)
VALUES
  ('acceptance-product-a1', '${eventId}', 'acceptance-rg-a', 'acceptance-gate-a',
   'Synthetisches Produkt A1', 'A1', 2500, 1, 4, 15, 10, '${now}', '${now}'),
  ('acceptance-product-a2', '${eventId}', 'acceptance-rg-a', 'acceptance-gate-a',
   'Synthetisches Produkt A2', 'A2', 3500, 1, 4, 25, 20, '${now}', '${now}'),
  ('acceptance-product-b1', '${eventId}', 'acceptance-rg-b', 'acceptance-gate-b',
   'Synthetisches Produkt B1', 'B1', 4500, 1, 4, 30, 30, '${now}', '${now}');

INSERT INTO aircraft
  (id, registration, aircraft_type, passenger_seats, operational_state, created_at, updated_at)
VALUES
  ('acceptance-aircraft-a1', 'D-SA01', 'SYN-A', 4, 'AVAILABLE', '${now}', '${now}'),
  ('acceptance-aircraft-a2', 'D-SA02', 'SYN-A', 4, 'AVAILABLE', '${now}', '${now}'),
  ('acceptance-aircraft-b1', 'D-SB01', 'SYN-B', 4, 'AVAILABLE', '${now}', '${now}');

INSERT INTO resource_group_memberships
  (id, operation_day_id, resource_group_id, aircraft_id, active_from, created_at)
VALUES
  ('acceptance-membership-a1', '${eventId}', 'acceptance-rg-a', 'acceptance-aircraft-a1', '${now}', '${now}'),
  ('acceptance-membership-a2', '${eventId}', 'acceptance-rg-a', 'acceptance-aircraft-a2', '${now}', '${now}'),
  ('acceptance-membership-b1', '${eventId}', 'acceptance-rg-b', 'acceptance-aircraft-b1', '${now}', '${now}');

INSERT INTO pilots
  (id, operation_day_id, operational_code, active, created_at, updated_at)
VALUES
  ('acceptance-pilot-01', '${eventId}', 'P-01', 1, '${now}', '${now}'),
  ('acceptance-pilot-02', '${eventId}', 'P-02', 1, '${now}', '${now}'),
  ('acceptance-pilot-03', '${eventId}', 'P-03', 1, '${now}', '${now}');

INSERT INTO paired_devices
  (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
VALUES
  ('acceptance-admin', '${eventId}', 'Synthetisches Administrationsgerät', 'ADMIN', 1, '${now}', '${now}', '${tokenHash}'),
  ('acceptance-cashier', '${eventId}', 'Synthetische Kasse', 'CASHIER', 1, '${now}', '${now}', '${tokenHash}'),
  ('acceptance-flight-line', '${eventId}', 'Synthetische Flight Line', 'FLIGHT_LINE', 1, '${now}', '${now}', '${tokenHash}');
`;

const seed = spawnSync(
  process.execPath,
  [wranglerCli, "d1", "execute", "DB", ...wranglerBaseArguments, "--command", seedSql],
  { cwd: root, encoding: "utf8" },
);
if (seed.status !== 0) {
  throw new Error(`Synthetischer Abnahmedatensatz fehlgeschlagen: ${seed.stderr || seed.stdout}`);
}

const server = spawn(
  process.execPath,
  [
    wranglerCli,
    "dev",
    "--config",
    "wrangler.jsonc",
    "--port",
    String(port),
    "--inspector-port",
    String(port + 1_000),
    "--persist-to",
    persistPath,
    "--var",
    "APP_ENV:development",
    "--var",
    "DATA_JURISDICTION:eu",
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = `http://127.0.0.1:${port}`;
const waitForWorker = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig bereit.");
};
const ticketCode = () =>
  randomBytes(12)
    .toString("base64url")
    .toUpperCase()
    .replaceAll(/[01OI_-]/g, "A");
const envelope = (deviceId, expectedVersion, type, payload) => ({
  commandId: randomUUID(),
  eventId,
  deviceId,
  expectedVersion,
  issuedAt: new Date().toISOString(),
  type,
  payload,
});
const post = async (body) => {
  const response = await fetch(`${base}/api/events/${eventId}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": token },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      `Abnahmekommando ${body.type} schlug fehl (${response.status}): ${JSON.stringify(result)}`,
    );
  }
  return result;
};
const loadOperations = async () => {
  const response = await fetch(`${base}/api/events/${eventId}/operations`, {
    headers: { "x-device-id": "acceptance-admin", "x-device-token": token },
  });
  if (!response.ok)
    throw new Error(`Abnahmestand konnte nicht geladen werden (${response.status}).`);
  return response.json();
};

try {
  await waitForWorker();
  let version = 0;
  const soldRotations = [];
  const products = ["acceptance-product-a1", "acceptance-product-a2", "acceptance-product-b1"];
  for (let index = 0; index < 20; index += 1) {
    const productId = products[index % products.length];
    const sold = await post(
      envelope("acceptance-cashier", version, "SELL_TICKET_GROUP", {
        productId,
        publicTicketCodes: [ticketCode(), ticketCode(), ticketCode()],
        standby: false,
        paymentStatus: "PAID",
        paymentMethod: "CASH",
      }),
    );
    version = sold.event.version;
    soldRotations.push({
      id: sold.aggregate.relatedRotationId,
      ticketGroupId: sold.aggregate.id,
      resourceGroupId:
        productId === "acceptance-product-b1" ? "acceptance-rg-b" : "acceptance-rg-a",
    });
  }

  for (let index = 0; index < soldRotations.length; index += 1) {
    const rotation = soldRotations[index];
    const aircraftId =
      rotation.resourceGroupId === "acceptance-rg-b"
        ? "acceptance-aircraft-b1"
        : index % 2 === 0
          ? "acceptance-aircraft-a1"
          : "acceptance-aircraft-a2";
    const pilotId = `acceptance-pilot-0${(index % 3) + 1}`;
    const pilotAssigned = await post(
      envelope("acceptance-admin", version, "ASSIGN_AIRCRAFT_PILOT", {
        aircraftId,
        pilotId,
        reassign: true,
      }),
    );
    version = pilotAssigned.event.version;
    const called = await post(
      envelope("acceptance-flight-line", version, "CALL_NEXT", {
        ticketGroupIds: [rotation.ticketGroupId],
        aircraftId,
        pilotId,
      }),
    );
    version = called.event.version;
    const started = await post(
      envelope("acceptance-flight-line", version, "MARK_OFF_BLOCK", { rotationId: rotation.id }),
    );
    version = started.event.version;
    const landed = await post(
      envelope("acceptance-flight-line", version, "MARK_ON_BLOCK", { rotationId: rotation.id }),
    );
    version = landed.event.version;
    const completed = await post(
      envelope("acceptance-flight-line", version, "COMPLETE_TURNAROUND", {
        rotationId: rotation.id,
        nextAircraftState: "AVAILABLE",
      }),
    );
    version = completed.event.version;
  }

  const operations = await loadOperations();
  const eventHistoryResponse = await fetch(`${base}/api/events/${eventId}/history?limit=1000`, {
    headers: { "x-device-id": "acceptance-admin", "x-device-token": token },
  });
  const eventHistory = await eventHistoryResponse.json();
  const counts = eventHistory.entries.reduce((result, entry) => {
    result[entry.eventType] = (result[entry.eventType] ?? 0) + 1;
    return result;
  }, {});
  const expectedAircraftIds = new Set([
    "acceptance-aircraft-a1",
    "acceptance-aircraft-a2",
    "acceptance-aircraft-b1",
  ]);
  const acceptanceAircraft = operations.aircraft.filter((aircraft) =>
    expectedAircraftIds.has(aircraft.id),
  );
  const invariants = {
    aircraft:
      acceptanceAircraft.length === 3 &&
      acceptanceAircraft.every((aircraft) => aircraft.operationalState === "AVAILABLE"),
    resourceGroups: operations.resourceGroups.length === 2,
    products: operations.products.length === 3,
    soldTickets: operations.metrics.soldTickets === 60,
    completedRotations: operations.metrics.completedRotations === 20,
    noActiveRotations: operations.metrics.activeRotations === 0,
    allRotationsCompleted:
      operations.rotations.length === 20 &&
      operations.rotations.every(
        (rotation) =>
          rotation.status === "COMPLETED" &&
          rotation.ticketCount === 3 &&
          rotation.tickets.every((ticket) => ticket.status === "COMPLETED"),
      ),
    auditComplete:
      eventHistoryResponse.ok &&
      counts.TICKET_GROUP_SOLD === 20 &&
      counts.AIRCRAFT_PILOT_CHANGED === 20 &&
      counts.FLIGHT_GROUP_CALLED === 20 &&
      counts.MARK_OFF_BLOCK === 20 &&
      counts.MARK_ON_BLOCK === 20 &&
      counts.TURNAROUND_COMPLETED === 20,
  };
  if (Object.values(invariants).some((passed) => !passed)) {
    throw new Error(`V1-Abnahmetag unvollständig: ${JSON.stringify({ invariants, counts })}`);
  }
  process.stdout.write(
    JSON.stringify({
      ok: true,
      requirements: ["BP-12", "V1-Abnahmeszenario Kapitel 13.2"],
      dataset: { aircraft: 3, resourceGroups: 2, products: 3, tickets: 60, rotations: 20 },
      eventVersion: version,
      auditCounts: counts,
      invariants,
    }),
  );
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}
