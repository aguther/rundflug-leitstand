import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WINDOWS_TASKKILL_EXECUTABLE } from "./lib/tool-executables.mjs";
import {
  LOCAL_CI_GUARDRAIL_MILLISECONDS,
  localScaleGuardrails,
  percentile95,
} from "./scale-performance-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.SCALE_PERFORMANCE_TEST_PORT ?? "18795");
const ciGuardrailMilliseconds = Number(
  process.env.SCALE_CI_GUARDRAIL_MILLISECONDS ?? LOCAL_CI_GUARDRAIL_MILLISECONDS,
);
if (
  !Number.isFinite(ciGuardrailMilliseconds) ||
  ciGuardrailMilliseconds < 2_000 ||
  ciGuardrailMilliseconds > 60_000
) {
  throw new Error("SCALE_CI_GUARDRAIL_MILLISECONDS must be between 2000 and 60000.");
}
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("The npm execution path is missing.");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const reset = spawnSync(process.execPath, [npmCli, "run", "db:reset:local"], {
  cwd: root,
  stdio: "ignore",
});
if (reset.status !== 0) throw new Error("Lokale Testdatenbank konnte nicht initialisiert werden.");

const token = "synthetic-performance-device-token";
const tokenHash = createHash("sha256").update(token).digest("hex");
const sql = `
INSERT INTO operation_days
  (id, name, event_date, time_zone, status, version, operations_end_at, created_at, updated_at)
VALUES
  ('perf-current', 'Synthetischer Lasttest', '2026-07-14', 'Europe/Berlin', 'ACTIVE', 0,
   '2099-07-14T20:00:00.000Z', '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z');

INSERT INTO gates
  (id, operation_day_id, label, gate_type, active, sort_order, created_at, updated_at)
VALUES
  ('perf-gate', 'perf-current', 'Synthetische Flight Line', 'FLIGHT_LINE', 1, 10,
   '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z');

INSERT INTO resource_groups
  (id, operation_day_id, name, short_code, status, gate_id, reference_capacity,
   compatible_aircraft_types_json, version, created_at, updated_at)
VALUES
  ('perf-rg', 'perf-current', 'Synthetische Ressource', 'SR', 'ACTIVE', 'perf-gate', 4,
   '["SYNTHETIC-PERF"]', 0, '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z');

INSERT INTO products
  (id, operation_day_id, resource_group_id, gate_id, name, code, price_cents, sale_enabled,
   reference_capacity, reference_duration_minutes, created_at, updated_at)
VALUES
  ('perf-product', 'perf-current', 'perf-rg', 'perf-gate', 'Synthetischer Rundflug', 'PERF', 1000, 1,
   4, 20, '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z');
`;

const generatedSql = `${sql}
WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 20)
INSERT INTO paired_devices
  (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
SELECT printf('perf-device-%02d', value), 'perf-current', printf('Synthetisches Gerät %02d', value),
       CASE WHEN value = 1 THEN 'ADMIN' WHEN value = 2 THEN 'CASHIER' ELSE 'FLIGHT_LINE' END,
       1, '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z', '${tokenHash}' FROM n;

WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 3)
INSERT INTO aircraft
  (id, registration, aircraft_type, passenger_seats, operational_state, created_at, updated_at)
SELECT printf('perf-aircraft-%02d', value), printf('D-P%03d', value), 'SYNTHETIC-PERF', 4,
       'AVAILABLE', '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z' FROM n;

WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 3)
INSERT INTO resource_group_memberships
  (id, operation_day_id, resource_group_id, aircraft_id, active_from, created_at)
SELECT printf('perf-membership-%02d', value), 'perf-current', 'perf-rg',
       printf('perf-aircraft-%02d', value), '2026-07-14T06:00:00.000Z',
       '2026-07-14T06:00:00.000Z' FROM n;

WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 3)
INSERT INTO pilots
  (id, operation_day_id, operational_code, active, created_at, updated_at)
SELECT printf('perf-pilot-%02d', value), 'perf-current', printf('P-%02d', value), 1,
       '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z' FROM n;

WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 300)
INSERT INTO flight_groups
  (id, operation_day_id, resource_group_id, product_id, communication_number, queue_position, status,
   version, created_at, updated_at)
SELECT printf('perf-flight-group-%03d', value), 'perf-current', 'perf-rg', 'perf-product',
       value, value, 'QUEUED',
       0, '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z' FROM n;

WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 300)
INSERT INTO rotations
  (id, operation_day_id, flight_group_id, gate_id, status, usable_capacity, version, created_at, updated_at)
SELECT printf('perf-rotation-%03d', value), 'perf-current', printf('perf-flight-group-%03d', value),
       'perf-gate', 'DRAFT', 4, 0, '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z' FROM n;

WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 1000)
INSERT INTO ticket_groups
  (id, operation_day_id, product_id, queue_sequence, communication_number, standby, status, sold_at, version)
SELECT printf('perf-ticket-group-%04d', value), 'perf-current', 'perf-product', value, value, 0, 'QUEUED',
       datetime('2026-07-14T06:00:00.000Z', printf('+%d seconds', value)), 0 FROM n;

WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 1000)
INSERT INTO tickets
  (id, ticket_group_id, public_code_hash, status, weight_class, payment_status, payment_method,
   price_cents, created_at)
SELECT printf('perf-ticket-%04d', value), printf('perf-ticket-group-%04d', value),
       printf('%064x', value), 'QUEUED', 'NOT_CAPTURED', 'PAID', 'CASH', 1000,
       datetime('2026-07-14T06:00:00.000Z', printf('+%d seconds', value)) FROM n;

WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 1000)
INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
SELECT printf('perf-rotation-%03d', ((value - 1) % 300) + 1), printf('perf-ticket-%04d', value),
       datetime('2026-07-14T06:00:00.000Z', printf('+%d seconds', value)) FROM n;

WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 60)
INSERT INTO operation_days
  (id, name, event_date, time_zone, status, archived_at, version, created_at, updated_at)
SELECT printf('perf-history-%03d', value), printf('Synthetische Historie %03d', value),
       date('2026-07-01', printf('-%d months', value)), 'Europe/Berlin', 'ARCHIVED',
       datetime('2026-07-01T20:00:00.000Z', printf('-%d months', value)), 100,
       datetime('2026-07-01T06:00:00.000Z', printf('-%d months', value)),
       datetime('2026-07-01T20:00:00.000Z', printf('-%d months', value)) FROM n;

WITH RECURSIVE months(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM months WHERE value < 60),
events(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM events WHERE value < 100)
INSERT INTO operational_events
  (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type, aggregate_id,
   aggregate_version, payload_json)
SELECT printf('perf-event-%03d-%03d', months.value, events.value),
       printf('perf-history-%03d', months.value), 'SYNTHETIC_HISTORY_EVENT',
       datetime('2026-07-01T06:00:00.000Z', printf('-%d months', months.value),
                printf('+%d minutes', events.value)),
       'synthetic-history-device', 'OPERATION_DAY', printf('perf-history-%03d', months.value),
       events.value, '{}' FROM months CROSS JOIN events;
`;

const seed = spawnSync(
  process.execPath,
  [
    wranglerCli,
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--command",
    generatedSql,
  ],
  { cwd: root, encoding: "utf8" },
);
if (seed.status !== 0) {
  throw new Error(
    `Synthetischer Skalierungsdatensatz fehlgeschlagen: ${seed.stderr || seed.stdout}`,
  );
}

const pin = "0000";
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
    `ADMIN_PIN_HASH:${createHash("sha256").update(pin).digest("hex")}`,
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const base = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}`;
const waitForWorker = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Lokaler Worker wurde nicht rechtzeitig bereit.");
};
const headers = (deviceNumber) => ({
  "x-device-id": `perf-device-${String(deviceNumber).padStart(2, "0")}`,
  "x-device-token": token,
});
const timedJson = async (url, init) => {
  const startedAt = performance.now();
  const response = await fetch(url, init);
  const body = await response.json();
  return { response, body, elapsedMs: performance.now() - startedAt };
};
const connect = () =>
  new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(`${wsBase}/api/public/events/perf-current/live`);
    const timeout = setTimeout(
      () => reject(new Error("The WebSocket connection exceeded the local CI guardrail.")),
      ciGuardrailMilliseconds,
    );
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type !== "connected") return;
      clearTimeout(timeout);
      resolvePromise(socket);
    });
    socket.addEventListener(
      "error",
      () => reject(new Error("WebSocket-Verbindung fehlgeschlagen.")),
      { once: true },
    );
  });
const waitForForecast = (socket) =>
  new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("The forecast update exceeded the local CI guardrail.")),
      ciGuardrailMilliseconds,
    );
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type !== "forecast-updated") return;
      clearTimeout(timeout);
      resolvePromise(message);
    });
  });
const sockets = [];
try {
  await waitForWorker();
  const initial = await timedJson(`${base}/api/control/perf-current/operations`, {
    headers: headers(1),
  });
  if (
    !initial.response.ok ||
    initial.body.metrics.soldTickets !== 1000 ||
    initial.body.rotations.length !== 300
  ) {
    throw new Error(
      `Skalierungsdatensatz ist in der Operationssicht unvollständig: HTTP ${initial.response.status}, ${initial.body.metrics?.soldTickets ?? "?"} Tickets, ${initial.body.rotations?.length ?? "?"} Umläufe.`,
    );
  }
  if (!initial.response.headers.get("server-timing")?.includes("operations;dur=")) {
    throw new Error("Server-Timing für den Betriebsstand fehlt.");
  }

  sockets.push(...(await Promise.all(Array.from({ length: 20 }, () => connect()))));
  const parallel = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      timedJson(`${base}/api/control/perf-current/operations`, { headers: headers(index + 1) }),
    ),
  );
  if (parallel.some((entry) => !entry.response.ok)) {
    throw new Error(
      "Mindestens eines der 20 gleichzeitig verbundenen Geräte erhielt keinen Stand.",
    );
  }
  const parallelTimes = parallel.map((entry) => entry.elapsedMs);

  const history = await timedJson(
    `${base}/api/control/perf-current/history/operations?limit=200&offset=800`,
    { headers: headers(1) },
  );
  if (!history.response.ok || history.body.total !== 1000 || history.body.entries.length !== 200) {
    throw new Error("Paginierte Historie verarbeitet 1.000 Tickets nicht vollständig.");
  }

  const cashierPageOne = await timedJson(
    `${base}/api/control/perf-current/tickets/search?status=ACTIVE&limit=50&q=`,
    { headers: headers(2) },
  );
  if (
    !cashierPageOne.response.ok ||
    cashierPageOne.body.results.length !== 50 ||
    !cashierPageOne.body.nextCursor ||
    cashierPageOne.body.results[0]?.bookingGroupLabel !== "G-PERF-1000"
  ) {
    throw new Error("Erste cursorbasierte Kassenseite ist im Mengengerüst unvollständig.");
  }
  const cashierPageTwo = await timedJson(
    `${base}/api/control/perf-current/tickets/search?status=ACTIVE&limit=50&q=&cursor=${encodeURIComponent(cashierPageOne.body.nextCursor)}`,
    { headers: headers(2) },
  );
  const firstPageIds = new Set(cashierPageOne.body.results.map((entry) => entry.ticketGroupId));
  if (
    !cashierPageTwo.response.ok ||
    cashierPageTwo.body.results.length !== 50 ||
    cashierPageTwo.body.results.some((entry) => firstPageIds.has(entry.ticketGroupId))
  ) {
    throw new Error("Zweite cursorbasierte Kassenseite enthält Lücken oder Duplikate.");
  }
  const revalidation = await timedJson(
    `${base}/api/control/perf-current/tickets/search?status=ACTIVE&limit=20&q=&id=perf-ticket-group-1000&id=perf-ticket-group-0951`,
    { headers: headers(2) },
  );
  if (!revalidation.response.ok || revalidation.body.results.length !== 2) {
    throw new Error("Gezielte Revalidierung sichtbarer Kassenzeilen ist unvollständig.");
  }

  const forecastSignal = waitForForecast(sockets[0]);
  const command = {
    commandId: randomUUID(),
    eventId: "perf-current",
    deviceId: "perf-device-02",
    expectedVersion: 0,
    issuedAt: new Date().toISOString(),
    type: "SELL_TICKET_GROUP",
    payload: {
      productId: "perf-product",
      ticketCount: 1,
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  };
  const saleStartedAt = performance.now();
  const sale = await timedJson(`${base}/api/control/perf-current/commands`, {
    method: "POST",
    headers: { ...headers(2), "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!sale.response.ok || sale.body.eventType !== "TICKET_GROUP_SOLD") {
    throw new Error(`Standardverkauf schlug im Mengengerüst fehl: ${JSON.stringify(sale.body)}`);
  }
  const commandServerTiming = sale.response.headers.get("server-timing") ?? "";
  if (
    !commandServerTiming.includes("command-queue;dur=") ||
    !commandServerTiming.includes("command;dur=") ||
    !commandServerTiming.includes("sale-preflight;dur=") ||
    !commandServerTiming.includes("sale-persist;dur=")
  ) {
    throw new Error("Server-Timing für Verkaufsprüfung oder Persistenz fehlt.");
  }
  await forecastSignal;
  const forecastElapsedMs = performance.now() - saleStartedAt;

  const measurements = {
    initialOperations: initial.elapsedMs,
    parallelDeviceP95: percentile95(parallelTimes),
    history: history.elapsedMs,
    cashierPageOne: cashierPageOne.elapsedMs,
    cashierPageTwo: cashierPageTwo.elapsedMs,
    cashierRevalidation: revalidation.elapsedMs,
    sale: sale.elapsedMs,
    forecast: forecastElapsedMs,
  };
  const guardrails = localScaleGuardrails(measurements, ciGuardrailMilliseconds);
  if (Object.values(guardrails).some((passed) => !passed)) {
    throw new Error(
      `Local CI scale guardrail exceeded: ${JSON.stringify({ ciGuardrailMilliseconds, guardrails, measurements, parallelTimes })}`,
    );
  }

  console.log(
    JSON.stringify({
      ok: true,
      executionProfile: "local-wrangler-ci",
      requirements: ["Q-PER-010-server", "Q-PER-020", "Q-PER-030", "V16-KAS-030"],
      dataset: {
        connectedDevices: 20,
        tickets: 1000,
        rotations: 300,
        historyMonths: 60,
        historyEvents: 6000,
      },
      measurementsMs: {
        operations: Math.round(measurements.initialOperations),
        parallelDeviceP95: Math.round(measurements.parallelDeviceP95),
        operationalHistory: Math.round(measurements.history),
        cashierPageOne: Math.round(measurements.cashierPageOne),
        cashierPageTwo: Math.round(measurements.cashierPageTwo),
        cashierRevalidation: Math.round(measurements.cashierRevalidation),
        standardSale: Math.round(measurements.sale),
        forecastFor300Rotations: Math.round(measurements.forecast),
      },
      ciGuardrailMilliseconds,
      guardrails,
      productionSloEvaluated: false,
      serverTimingExposed: true,
    }),
  );
} finally {
  for (const socket of sockets) socket.close();
  if (process.platform === "win32") {
    spawnSync(WINDOWS_TASKKILL_EXECUTABLE, ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    server.kill();
  }
}
