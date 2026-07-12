import { APP_NAME, REQUIREMENTS_VERSION } from "@rundflug/config";
import { cloneEventRequestSchema } from "@rundflug/contracts";
import { assessRemainingCapacity, estimateDuration, forecastQueueWindows } from "@rundflug/domain";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createPortableBackup } from "./backup";
import { sha256Hex, verifyCredential } from "./crypto";
import { EventCoordinator } from "./event-coordinator";
import { allowUnknownTicketAttempt } from "./public-access";
import { createCsv, createTextPdf } from "./report";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";
import { isAllowedPushEndpoint, purgeExpiredPushSubscriptions } from "./web-push";

const app = new Hono<{ Bindings: Env }>();

async function unknownTicketResponse(env: Env, request: Request): Promise<Response> {
  if (!(await allowUnknownTicketAttempt(env.PUBLIC_TICKET_RATE_LIMITER, request))) {
    return Response.json(
      { error: { code: "TOO_MANY_TICKET_ATTEMPTS", message: "Bitte später erneut versuchen." } },
      { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } },
    );
  }
  return Response.json(
    { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

async function authorizeDevice(
  env: Env,
  eventId: string,
  deviceId: string | undefined,
  token: string | undefined,
): Promise<{ role: string } | null> {
  if (!deviceId) return null;
  const device = await env.DB.prepare(
    "SELECT role, credential_hash FROM paired_devices WHERE id = ?1 AND operation_day_id = ?2 AND active = 1",
  )
    .bind(deviceId, eventId)
    .first<{ role: string; credential_hash: string | null }>();
  if (!device || !(await verifyCredential(token ?? null, device.credential_hash))) return null;
  await env.DB.prepare("UPDATE paired_devices SET last_seen_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), deviceId)
    .run();
  return { role: device.role };
}

function eventCoordinatorNamespace(env: Env): DurableObjectNamespace {
  // workerd/miniflare does not implement jurisdiction restrictions locally.
  // Acceptance and production always request the EU jurisdiction explicitly.
  return env.APP_ENV === "development"
    ? env.EVENT_COORDINATOR
    : env.EVENT_COORDINATOR.jurisdiction("eu");
}

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: "no-referrer",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
  }),
);

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    service: APP_NAME,
    environment: context.env.APP_ENV,
    requirementsVersion: REQUIREMENTS_VERSION,
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/meta", (context) =>
  context.json({
    architecture: "Cloudflare Worker + Static Assets + D1 + Durable Object + R2",
    dataJurisdiction: context.env.DATA_JURISDICTION,
    productionReady: false,
  }),
);

app.get("/api/admin/events", async (context) => {
  const sourceEventId = context.req.header("x-event-id");
  const device = sourceEventId
    ? await authorizeDevice(
        context.env,
        sourceEventId,
        context.req.header("x-device-id"),
        context.req.header("x-device-token"),
      )
    : null;
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const rows = await context.env.DB.prepare(
    `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at,
            template_source_id, version
       FROM operation_days ORDER BY event_date DESC, name`,
  ).all<{
    id: string;
    name: string;
    event_date: string;
    aerodrome: string;
    time_zone: string;
    status: string;
    archived_at: string | null;
    template_source_id: string | null;
    version: number;
  }>();
  return context.json({
    events: rows.results.map((row) => ({
      eventId: row.id,
      name: row.name,
      eventDate: row.event_date,
      aerodrome: row.aerodrome,
      timeZone: row.time_zone,
      status: row.status,
      archivedAt: row.archived_at,
      templateSourceId: row.template_source_id,
      version: row.version,
    })),
  });
});

app.post("/api/admin/events/:sourceEventId/clone", async (context) => {
  const sourceEventId = context.req.param("sourceEventId");
  const sourceAdmin = await context.env.DB.prepare(
    `SELECT role, credential_hash FROM paired_devices
      WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
  )
    .bind(context.req.header("x-device-id"), sourceEventId)
    .first<{ role: string; credential_hash: string | null }>();
  if (
    sourceAdmin?.role !== "ADMIN" ||
    !(await verifyCredential(
      context.req.header("x-device-token") ?? null,
      sourceAdmin.credential_hash,
    ))
  ) {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  const parsed = cloneEventRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json(
      { error: { code: "INVALID_EVENT", message: "Veranstaltungsdaten sind unvollständig." } },
      400,
    );
  }
  const input = parsed.data;
  const receipt = await context.env.DB.prepare(
    `SELECT operation_day_id, device_id, response_json FROM idempotency_receipts
      WHERE command_id = ?1`,
  )
    .bind(input.commandId)
    .first<{ operation_day_id: string; device_id: string; response_json: string }>();
  if (receipt) {
    if (
      receipt.operation_day_id !== sourceEventId ||
      receipt.device_id !== context.req.header("x-device-id")
    ) {
      return context.json(
        { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
        409,
      );
    }
    return context.json(JSON.parse(receipt.response_json));
  }
  const existing = await context.env.DB.prepare("SELECT id FROM operation_days WHERE id = ?1")
    .bind(input.eventId)
    .first();
  if (existing) {
    return context.json(
      {
        error: {
          code: "EVENT_ID_EXISTS",
          message: "Diese Veranstaltungs-ID ist bereits vergeben.",
        },
      },
      409,
    );
  }
  const source = await context.env.DB.prepare("SELECT * FROM operation_days WHERE id = ?1")
    .bind(sourceEventId)
    .first<Record<string, unknown>>();
  if (!source) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Vorveranstaltung nicht gefunden." } },
      404,
    );
  }
  if (Number(source.version) !== input.expectedSourceVersion) {
    return context.json(
      {
        error: {
          code: "STALE_VERSION",
          message: "Die Vorveranstaltung wurde zwischenzeitlich geändert. Bitte neu laden.",
        },
      },
      409,
    );
  }
  const [gates, groups, products, pilots, memberships] = await Promise.all([
    context.env.DB.prepare("SELECT * FROM gates WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    context.env.DB.prepare("SELECT * FROM resource_groups WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    context.env.DB.prepare("SELECT * FROM products WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    context.env.DB.prepare("SELECT * FROM pilots WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    context.env.DB.prepare(
      "SELECT * FROM resource_group_memberships WHERE operation_day_id = ?1 AND active_until IS NULL",
    )
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
  ]);
  const now = new Date().toISOString();
  const gateIds = new Map(gates.results.map((row) => [String(row.id), crypto.randomUUID()]));
  const groupIds = new Map(groups.results.map((row) => [String(row.id), crypto.randomUUID()]));
  const adminDeviceId = crypto.randomUUID();
  const responseBody = {
    eventId: input.eventId,
    adminDeviceId,
    templateSourceId: sourceEventId,
  };
  const statements = [
    context.env.DB.prepare(
      `INSERT INTO operation_days
        (id, name, event_date, time_zone, status, emergency_mode, operational_note, version,
         created_at, updated_at, operations_end_at, operational_interrupted, sale_opens_at,
         no_show_after_minutes, notification_lead_minutes, child_reference_weight_kg,
         normal_reference_weight_kg, heavy_reference_weight_kg, planned_boarding_minutes,
         planned_deboarding_minutes, planned_buffer_minutes, aerodrome, template_source_id)
       VALUES (?1, ?2, ?3, ?4, 'PREPARATION', 0, '', 0, ?5, ?5, NULL, 0, NULL,
         ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    ).bind(
      input.eventId,
      input.name,
      input.eventDate,
      input.timeZone,
      now,
      source.no_show_after_minutes,
      source.notification_lead_minutes,
      source.child_reference_weight_kg,
      source.normal_reference_weight_kg,
      source.heavy_reference_weight_kg,
      source.planned_boarding_minutes,
      source.planned_deboarding_minutes,
      source.planned_buffer_minutes,
      input.aerodrome,
      sourceEventId,
    ),
    ...gates.results.map((row) =>
      context.env.DB.prepare(
        `INSERT INTO gates (id, operation_day_id, label, gate_type, active, sort_order, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      ).bind(
        gateIds.get(String(row.id)),
        input.eventId,
        row.label,
        row.gate_type,
        row.active,
        row.sort_order,
        now,
      ),
    ),
    ...groups.results.map((row) =>
      context.env.DB.prepare(
        `INSERT INTO resource_groups
        (id, operation_day_id, name, status, version, created_at, updated_at, gate_id,
         reference_capacity, planned_rotation_minutes, compatible_aircraft_types_json)
       VALUES (?1, ?2, ?3, 'ACTIVE', 0, ?4, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        groupIds.get(String(row.id)),
        input.eventId,
        row.name,
        now,
        row.gate_id ? gateIds.get(String(row.gate_id)) : null,
        row.reference_capacity,
        row.planned_rotation_minutes,
        row.compatible_aircraft_types_json,
      ),
    ),
    ...products.results.map((row) =>
      context.env.DB.prepare(
        `INSERT INTO products
        (id, operation_day_id, resource_group_id, name, price_cents, sale_enabled, created_at,
         updated_at, sale_closes_at, capacity_warning_threshold, capacity_critical_threshold,
         code, public_description, child_companion_required, sort_order, weight_classes_json, gate_id)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6, NULL, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      ).bind(
        crypto.randomUUID(),
        input.eventId,
        groupIds.get(String(row.resource_group_id)),
        row.name,
        row.price_cents,
        now,
        row.capacity_warning_threshold,
        row.capacity_critical_threshold,
        row.code,
        row.public_description,
        row.child_companion_required,
        row.sort_order,
        row.weight_classes_json,
        row.gate_id ? gateIds.get(String(row.gate_id)) : null,
      ),
    ),
    ...pilots.results.map((row) =>
      context.env.DB.prepare(
        `INSERT INTO pilots (id, operation_day_id, operational_code, active, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
      ).bind(crypto.randomUUID(), input.eventId, row.operational_code, row.active, now),
    ),
    ...memberships.results.map((row) =>
      context.env.DB.prepare(
        `INSERT INTO resource_group_memberships
        (id, operation_day_id, resource_group_id, aircraft_id, active_from, created_at,
         change_reason, changed_by_device_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'Aus Vorveranstaltung übernommen', ?6)`,
      ).bind(
        crypto.randomUUID(),
        input.eventId,
        groupIds.get(String(row.resource_group_id)),
        row.aircraft_id,
        now,
        adminDeviceId,
      ),
    ),
    context.env.DB.prepare(
      `INSERT INTO paired_devices
        (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
       VALUES (?1, ?2, 'Übernommenes Administrationsgerät', 'ADMIN', 1, ?3, ?3, ?4)`,
    ).bind(adminDeviceId, input.eventId, now, sourceAdmin.credential_hash),
    context.env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json)
       VALUES (?1, ?2, 'EVENT_CREATED_FROM_TEMPLATE', ?3, ?4, 'OPERATION_DAY', ?2, 0, ?5)`,
    ).bind(
      crypto.randomUUID(),
      input.eventId,
      now,
      adminDeviceId,
      JSON.stringify({ templateSourceId: sourceEventId }),
    ),
    context.env.DB.prepare(
      `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
       VALUES (?1, ?2, 'EVENT_CREATED_FROM_TEMPLATE', ?3, ?4)`,
    ).bind(crypto.randomUUID(), input.eventId, JSON.stringify(responseBody), now),
    context.env.DB.prepare(
      `INSERT INTO idempotency_receipts
        (command_id, operation_day_id, device_id, command_type, received_at, response_json)
       VALUES (?1, ?2, ?3, 'CREATE_EVENT_FROM_TEMPLATE', ?4, ?5)`,
    ).bind(
      input.commandId,
      sourceEventId,
      context.req.header("x-device-id"),
      now,
      JSON.stringify(responseBody),
    ),
  ];
  await context.env.DB.batch(statements);
  return context.json(responseBody, 201);
});

app.get("/api/events/:eventId/snapshot", async (context) => {
  const row = await context.env.DB.prepare(
    `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
            emergency_mode, operational_interrupted, version,
            operational_note, operations_end_at, sale_opens_at, no_show_after_minutes,
            notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
            heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
            planned_buffer_minutes, updated_at
       FROM operation_days
      WHERE id = ?1`,
  )
    .bind(context.req.param("eventId"))
    .first<StoredEventRow>();
  if (!row) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  return context.json(rowToSnapshot(row));
});

app.get("/api/events/:eventId/operations", async (context) => {
  const eventId = context.req.param("eventId");
  const deviceId = context.req.header("x-device-id");
  if (!deviceId) {
    return context.json(
      { error: { code: "DEVICE_REQUIRED", message: "Gekoppeltes Gerät erforderlich." } },
      401,
    );
  }
  const device = await context.env.DB.prepare(
    "SELECT role, credential_hash FROM paired_devices WHERE id = ?1 AND operation_day_id = ?2 AND active = 1",
  )
    .bind(deviceId, eventId)
    .first<{ role: string; credential_hash: string | null }>();
  const credentialValid = await verifyCredential(
    context.req.header("x-device-token") ?? null,
    device?.credential_hash ?? null,
  );
  if (!device || !credentialValid || device.role === "DISPLAY") {
    return context.json(
      { error: { code: "DEVICE_NOT_AUTHORIZED", message: "Gerät nicht berechtigt." } },
      403,
    );
  }
  await context.env.DB.prepare("UPDATE paired_devices SET last_seen_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), deviceId)
    .run();

  const eventRow = await context.env.DB.prepare(
    `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
            emergency_mode, operational_interrupted, version,
            operational_note, operations_end_at, sale_opens_at, no_show_after_minutes,
            notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
            heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
            planned_buffer_minutes, updated_at FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<StoredEventRow>();
  if (!eventRow) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }

  const [
    products,
    rotations,
    durationRows,
    aircraftRows,
    fleetRows,
    pilotRows,
    gatesRows,
    resourceGroupRows,
    metricsRow,
  ] = await Promise.all([
    context.env.DB.prepare(
      `SELECT p.id, p.code, p.name, p.public_description, p.resource_group_id, rg.name AS resource_group_name,
              rg.status AS resource_group_status, rg.operational_note AS resource_group_operational_note,
              p.price_cents, p.sale_enabled, p.reference_capacity, p.reference_duration_minutes,
              p.sale_closes_at, p.capacity_warning_threshold, p.capacity_critical_threshold,
              p.child_companion_required, p.weight_classes_json, p.sort_order, p.gate_id,
              g.label AS gate_label,
              COUNT(CASE WHEN t.status = 'QUEUED' THEN 1 END) AS queued_tickets,
              (SELECT COUNT(*) FROM tickets shared_t
                JOIN ticket_groups shared_tg ON shared_tg.id = shared_t.ticket_group_id
                JOIN products shared_p ON shared_p.id = shared_tg.product_id
               WHERE shared_p.resource_group_id = p.resource_group_id
                 AND shared_t.status = 'QUEUED') AS resource_group_open_tickets
         FROM products p
         JOIN resource_groups rg ON rg.id = p.resource_group_id
         JOIN gates g ON g.id = p.gate_id
         LEFT JOIN ticket_groups tg ON tg.product_id = p.id
         LEFT JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE p.operation_day_id = ?1
        GROUP BY p.id
        ORDER BY p.sort_order, p.name`,
    )
      .bind(eventId)
      .all<{
        id: string;
        code: string;
        name: string;
        public_description: string;
        resource_group_id: string;
        resource_group_name: string;
        resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
        resource_group_operational_note: string;
        price_cents: number;
        gate_id: string;
        gate_label: string;
        child_companion_required: number;
        weight_classes_json: string;
        sort_order: number;
        sale_enabled: number;
        reference_capacity: number;
        reference_duration_minutes: number;
        queued_tickets: number;
        resource_group_open_tickets: number;
        sale_closes_at: string | null;
        capacity_warning_threshold: number;
        capacity_critical_threshold: number;
      }>(),
    context.env.DB.prepare(
      `SELECT r.id, r.flight_group_id, fg.resource_group_id, fg.communication_number, r.status, r.aircraft_id,
              r.called_at, r.departed_at, r.landed_at, r.completed_at,
              r.planned_boarding_at, r.planned_departure_at, r.planned_landing_at,
              r.planned_completion_at, r.predicted_boarding_at, r.predicted_departure_at,
              r.predicted_landing_at, r.predicted_completion_at, r.prediction_quality,
              r.prediction_lower_minutes, r.prediction_upper_minutes, r.prediction_updated_at,
              a.registration AS aircraft_registration,
              r.pilot_id, assigned_pilot.operational_code AS pilot_operational_code,
              (SELECT available_pilot.id FROM pilots available_pilot
                WHERE available_pilot.operation_day_id = r.operation_day_id
                  AND available_pilot.active = 1 AND available_pilot.paused = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM rotations pilot_rotation
                     WHERE pilot_rotation.operation_day_id = r.operation_day_id
                       AND pilot_rotation.pilot_id = available_pilot.id
                       AND pilot_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                  )
                ORDER BY available_pilot.operational_code LIMIT 1) AS suggested_pilot_id,
              (SELECT available_pilot.operational_code FROM pilots available_pilot
                WHERE available_pilot.operation_day_id = r.operation_day_id
                  AND available_pilot.active = 1 AND available_pilot.paused = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM rotations pilot_rotation
                     WHERE pilot_rotation.operation_day_id = r.operation_day_id
                       AND pilot_rotation.pilot_id = available_pilot.id
                       AND pilot_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                  )
                ORDER BY available_pilot.operational_code LIMIT 1) AS suggested_pilot_operational_code,
              (SELECT candidate.id FROM resource_group_memberships membership
                JOIN aircraft candidate ON candidate.id = membership.aircraft_id
               WHERE membership.operation_day_id = r.operation_day_id
                 AND membership.resource_group_id = fg.resource_group_id
                 AND membership.active_until IS NULL
                 AND candidate.operational_state = 'AVAILABLE'
               ORDER BY candidate.registration LIMIT 1) AS suggested_aircraft_id,
              (SELECT candidate.registration FROM resource_group_memberships membership
                JOIN aircraft candidate ON candidate.id = membership.aircraft_id
               WHERE membership.operation_day_id = r.operation_day_id
                 AND membership.resource_group_id = fg.resource_group_id
                 AND membership.active_until IS NULL
                 AND candidate.operational_state = 'AVAILABLE'
               ORDER BY candidate.registration LIMIT 1) AS suggested_aircraft_registration,
              MIN(tg.id) AS ticket_group_id, COUNT(rt.ticket_id) AS ticket_count,
              COALESCE(MIN(p.name), 'Rundflug') AS product_name,
              COALESCE(MIN(p.reference_duration_minutes), 20) AS reference_duration_minutes,
              (SELECT json_group_array(json_object(
                'id', attendance_ticket.id,
                'attendanceStatus', attendance_ticket.attendance_status
              ))
                FROM rotation_tickets attendance_rt
                JOIN tickets attendance_ticket ON attendance_ticket.id = attendance_rt.ticket_id
               WHERE attendance_rt.rotation_id = r.id AND attendance_rt.released_at IS NULL) AS tickets_json
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN pilots assigned_pilot ON assigned_pilot.id = r.pilot_id
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         LEFT JOIN tickets t ON t.id = rt.ticket_id
         LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         LEFT JOIN products p ON p.id = tg.product_id
        WHERE r.operation_day_id = ?1 AND r.status <> 'CANCELED'
        GROUP BY r.id
        ORDER BY fg.communication_number`,
    )
      .bind(eventId)
      .all<{
        id: string;
        flight_group_id: string;
        resource_group_id: string;
        communication_number: number;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        aircraft_id: string | null;
        aircraft_registration: string | null;
        pilot_id: string | null;
        pilot_operational_code: string | null;
        suggested_pilot_id: string | null;
        suggested_pilot_operational_code: string | null;
        suggested_aircraft_id: string | null;
        suggested_aircraft_registration: string | null;
        ticket_group_id: string;
        ticket_count: number;
        product_name: string;
        reference_duration_minutes: number;
        called_at: string | null;
        departed_at: string | null;
        landed_at: string | null;
        completed_at: string | null;
        planned_boarding_at: string | null;
        planned_departure_at: string | null;
        planned_landing_at: string | null;
        planned_completion_at: string | null;
        predicted_boarding_at: string | null;
        predicted_departure_at: string | null;
        predicted_landing_at: string | null;
        predicted_completion_at: string | null;
        prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
        prediction_lower_minutes: number | null;
        prediction_upper_minutes: number | null;
        prediction_updated_at: string | null;
        tickets_json: string;
      }>(),
    context.env.DB.prepare(
      `SELECT (julianday(landed_at) - julianday(departed_at)) * 1440.0 AS duration_minutes
         FROM rotations
        WHERE operation_day_id = ?1 AND departed_at IS NOT NULL AND landed_at IS NOT NULL
        ORDER BY landed_at DESC LIMIT 12`,
    )
      .bind(eventId)
      .all<{ duration_minutes: number }>(),
    context.env.DB.prepare(
      `SELECT m.resource_group_id, a.passenger_seats, a.refuel_planned FROM aircraft a
         JOIN resource_group_memberships m ON m.aircraft_id = a.id
        WHERE m.operation_day_id = ?1 AND m.active_until IS NULL
          AND a.operational_state NOT IN ('INACTIVE', 'PAUSED', 'REFUELING')`,
    )
      .bind(eventId)
      .all<{ resource_group_id: string; passenger_seats: number; refuel_planned: number }>(),
    context.env.DB.prepare(
      `SELECT a.id, a.registration, a.aircraft_type, a.passenger_seats,
              a.maximum_passenger_payload_kg, a.operational_state,
              a.refuel_planned, a.rotations_since_refuel, a.refuel_reminder_threshold,
              a.operational_interrupted,
              m.resource_group_id, rg.name AS resource_group_name,
              (SELECT b.expected_review_at FROM operational_blocks b
                WHERE b.operation_day_id = m.operation_day_id AND b.scope_type = 'AIRCRAFT'
                  AND b.scope_id = a.id AND b.status = 'ACTIVE'
                ORDER BY b.started_at DESC LIMIT 1) AS expected_review_at
         FROM aircraft a
         LEFT JOIN resource_group_memberships m ON m.aircraft_id = a.id
          AND m.operation_day_id = ?1 AND m.active_until IS NULL
         LEFT JOIN resource_groups rg ON rg.id = m.resource_group_id
        ORDER BY a.registration`,
    )
      .bind(eventId)
      .all<{
        id: string;
        registration: string;
        aircraft_type: string;
        passenger_seats: number;
        maximum_passenger_payload_kg: number | null;
        operational_state: string;
        refuel_planned: number;
        rotations_since_refuel: number;
        refuel_reminder_threshold: number;
        operational_interrupted: number;
        resource_group_id: string | null;
        resource_group_name: string | null;
        expected_review_at: string | null;
      }>(),
    context.env.DB.prepare(
      `SELECT id, operational_code, active, paused, pause_expected_review_at
         FROM pilots WHERE operation_day_id = ?1 ORDER BY operational_code`,
    )
      .bind(eventId)
      .all<{
        id: string;
        operational_code: string;
        active: number;
        paused: number;
        pause_expected_review_at: string | null;
      }>(),
    context.env.DB.prepare(
      `SELECT id, label, gate_type, active, sort_order
           FROM gates WHERE operation_day_id = ?1 ORDER BY sort_order, label`,
    )
      .bind(eventId)
      .all<{
        id: string;
        label: string;
        gate_type: "FLIGHT_LINE" | "BOARDING" | "DISPLAY_ONLY";
        active: number;
        sort_order: number;
      }>(),
    context.env.DB.prepare(
      `SELECT rg.id, rg.name, rg.status, rg.gate_id, g.label AS gate_label,
              rg.reference_capacity, rg.planned_rotation_minutes,
              rg.compatible_aircraft_types_json,
              COALESCE((SELECT json_group_array(m.aircraft_id)
                FROM resource_group_memberships m
               WHERE m.operation_day_id = rg.operation_day_id
                 AND m.resource_group_id = rg.id AND m.active_until IS NULL), '[]') AS aircraft_ids_json
         FROM resource_groups rg JOIN gates g ON g.id = rg.gate_id
        WHERE rg.operation_day_id = ?1 ORDER BY rg.name`,
    )
      .bind(eventId)
      .all<{
        id: string;
        name: string;
        status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
        gate_id: string;
        gate_label: string;
        reference_capacity: number;
        planned_rotation_minutes: number;
        compatible_aircraft_types_json: string;
        aircraft_ids_json: string;
      }>(),
    context.env.DB.prepare(
      `SELECT
          (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1 AND t.status = 'QUEUED') AS open_tickets,
          (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1) AS sold_tickets,
          (SELECT COUNT(*) FROM rotations WHERE operation_day_id = ?1 AND status = 'COMPLETED') AS completed_rotations,
          (SELECT COUNT(*) FROM rotations WHERE operation_day_id = ?1
            AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')) AS active_rotations,
          (SELECT ROUND(AVG((julianday(departed_at) - julianday(called_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND called_at IS NOT NULL AND departed_at IS NOT NULL)
            AS average_boarding_minutes,
          (SELECT ROUND(AVG((julianday(landed_at) - julianday(departed_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND departed_at IS NOT NULL AND landed_at IS NOT NULL)
            AS average_flight_minutes,
          (SELECT ROUND(AVG((julianday(completed_at) - julianday(landed_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND landed_at IS NOT NULL AND completed_at IS NOT NULL)
            AS average_turnaround_minutes,
          (SELECT ROUND(AVG((julianday(completed_at) - julianday(called_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND called_at IS NOT NULL AND completed_at IS NOT NULL)
            AS average_rotation_minutes,
          (SELECT ROUND(AVG((julianday(r.called_at) - julianday(tg.sold_at)) * 1440.0), 1)
            FROM ticket_groups tg
            JOIN tickets t ON t.ticket_group_id = tg.id
            JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
            JOIN rotations r ON r.id = rt.rotation_id
            WHERE tg.operation_day_id = ?1 AND r.called_at IS NOT NULL) AS average_wait_minutes,
          (SELECT COALESCE(SUM(CASE WHEN t.status <> 'CANCELED' THEN t.price_cents ELSE 0 END), 0)
            FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1) AS informational_revenue_cents,
          (SELECT COUNT(*) FROM paired_devices WHERE operation_day_id = ?1 AND active = 1
            AND last_seen_at >= ?2) AS active_devices,
          (SELECT COUNT(*) FROM web_push_subscriptions WHERE operation_day_id = ?1
            AND status = 'ACTIVE' AND delete_after > ?3) AS active_push_subscriptions`,
    )
      .bind(eventId, new Date(Date.now() - 120_000).toISOString(), new Date().toISOString())
      .first<{
        open_tickets: number;
        sold_tickets: number;
        completed_rotations: number;
        active_rotations: number;
        average_boarding_minutes: number | null;
        average_flight_minutes: number | null;
        average_turnaround_minutes: number | null;
        average_rotation_minutes: number | null;
        average_wait_minutes: number | null;
        informational_revenue_cents: number;
        active_devices: number;
        active_push_subscriptions: number;
      }>(),
  ]);

  const actualDurations = [...durationRows.results].reverse().map((row) => row.duration_minutes);
  const activePilotCount = pilotRows.results.filter(
    (pilot) => pilot.active === 1 && pilot.paused === 0,
  ).length;
  const dataAgeMinutes = Math.max(0, (Date.now() - Date.parse(eventRow.updated_at)) / 60_000);
  const operationsEnd = eventRow.operations_end_at ? Date.parse(eventRow.operations_end_at) : 0;
  const remainingOperatingMinutes = Math.max(0, (operationsEnd - Date.now()) / 60_000);

  return context.json({
    currentDeviceRole: device.role,
    event: rowToSnapshot(eventRow),
    products: products.results.map((product) => {
      const groupAircraftSeats = aircraftRows.results
        .filter((aircraft) => aircraft.resource_group_id === product.resource_group_id)
        .map((aircraft) => aircraft.passenger_seats)
        .slice(0, activePilotCount);
      const reservedRefuelSeats = aircraftRows.results
        .filter(
          (aircraft) =>
            aircraft.resource_group_id === product.resource_group_id &&
            aircraft.refuel_planned === 1,
        )
        .reduce((sum, aircraft) => sum + aircraft.passenger_seats, 0);
      const activeAircraft = groupAircraftSeats.length;
      const queueSequence = Math.max(
        1,
        Math.ceil(product.queued_tickets / product.reference_capacity),
      );
      const duration = estimateDuration({
        referenceMinutes:
          product.reference_duration_minutes +
          (eventRow.planned_boarding_minutes ?? 8) +
          (eventRow.planned_deboarding_minutes ?? 5) +
          (eventRow.planned_buffer_minutes ?? 3),
        actualDurationsMinutes: actualDurations,
        dataAgeMinutes,
        interrupted:
          product.resource_group_status !== "ACTIVE" ||
          eventRow.emergency_mode === 1 ||
          eventRow.operational_interrupted === 1,
        activeCapacity: activeAircraft,
      });
      const forecast = forecastQueueWindows({ queueSequence, activeAircraft, duration });
      const capacity = assessRemainingCapacity({
        remainingOperatingMinutes,
        expectedRotationMinutes: duration.expectedMinutes,
        activeAircraftSeats: eventRow.operational_interrupted === 1 ? [] : groupAircraftSeats,
        openTickets: product.resource_group_open_tickets,
        reservedSeats: reservedRefuelSeats,
        predictionQuality: forecast.quality,
        warningThreshold: product.capacity_warning_threshold,
        criticalThreshold: product.capacity_critical_threshold,
      });
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        publicDescription: product.public_description,
        resourceGroupId: product.resource_group_id,
        resourceGroupName: product.resource_group_name,
        resourceGroupStatus: product.resource_group_status,
        resourceGroupOperationalNote: product.resource_group_operational_note,
        priceCents: product.price_cents,
        gateId: product.gate_id,
        gateLabel: product.gate_label,
        childCompanionRequired: product.child_companion_required === 1,
        weightClasses: JSON.parse(product.weight_classes_json) as Array<
          "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
        >,
        sortOrder: product.sort_order,
        saleEnabled: product.sale_enabled === 1,
        referenceCapacity: product.reference_capacity,
        referenceDurationMinutes: product.reference_duration_minutes,
        queuedTickets: product.queued_tickets,
        estimatedWaitLowerMinutes: forecast.lowerMinutes,
        estimatedWaitUpperMinutes: forecast.upperMinutes,
        remainingSellableSeats: capacity.remainingSellableSeats,
        projectedSeats: capacity.projectedSeats,
        capacityStatus: capacity.status,
        saleRecommended:
          capacity.saleRecommended &&
          eventRow.status === "ACTIVE" &&
          product.sale_enabled === 1 &&
          product.resource_group_status === "ACTIVE" &&
          eventRow.emergency_mode === 0 &&
          eventRow.operational_interrupted !== 1 &&
          (product.sale_closes_at === null || Date.parse(product.sale_closes_at) > Date.now()) &&
          (!eventRow.sale_opens_at || Date.parse(eventRow.sale_opens_at) <= Date.now()),
        saleClosesAt: product.sale_closes_at,
        capacityWarningThreshold: product.capacity_warning_threshold,
        capacityCriticalThreshold: product.capacity_critical_threshold,
        predictionQuality: forecast.quality,
      };
    }),
    rotations: rotations.results.map((rotation, index) => {
      const activeAircraft = aircraftRows.results.filter(
        (aircraft) => aircraft.resource_group_id === rotation.resource_group_id,
      ).length;
      const effectiveActiveCapacity = Math.min(activeAircraft, activePilotCount);
      return {
        id: rotation.id,
        flightGroupId: rotation.flight_group_id,
        communicationNumber: rotation.communication_number,
        productName: rotation.product_name,
        status: rotation.status,
        ticketGroupId: rotation.ticket_group_id,
        aircraftId: rotation.aircraft_id,
        aircraftRegistration: rotation.aircraft_registration,
        pilotId: rotation.pilot_id,
        pilotOperationalCode: rotation.pilot_operational_code,
        suggestedPilotId: rotation.suggested_pilot_id,
        suggestedPilotOperationalCode: rotation.suggested_pilot_operational_code,
        suggestedAircraftId: rotation.suggested_aircraft_id,
        suggestedAircraftRegistration: rotation.suggested_aircraft_registration,
        ticketCount: rotation.ticket_count,
        predictedLowerMinutes:
          rotation.prediction_lower_minutes ??
          forecastQueueWindows({
            queueSequence: index + 1,
            activeAircraft: effectiveActiveCapacity,
            duration: estimateDuration({
              referenceMinutes:
                rotation.reference_duration_minutes +
                (eventRow.planned_boarding_minutes ?? 8) +
                (eventRow.planned_deboarding_minutes ?? 5) +
                (eventRow.planned_buffer_minutes ?? 3),
              actualDurationsMinutes: actualDurations,
              dataAgeMinutes,
              interrupted: eventRow.emergency_mode === 1 || eventRow.operational_interrupted === 1,
              activeCapacity: effectiveActiveCapacity,
            }),
          }).lowerMinutes,
        predictedUpperMinutes:
          rotation.prediction_upper_minutes ??
          forecastQueueWindows({
            queueSequence: index + 1,
            activeAircraft: effectiveActiveCapacity,
            duration: estimateDuration({
              referenceMinutes:
                rotation.reference_duration_minutes +
                (eventRow.planned_boarding_minutes ?? 8) +
                (eventRow.planned_deboarding_minutes ?? 5) +
                (eventRow.planned_buffer_minutes ?? 3),
              actualDurationsMinutes: actualDurations,
              dataAgeMinutes,
              interrupted: eventRow.emergency_mode === 1 || eventRow.operational_interrupted === 1,
              activeCapacity: effectiveActiveCapacity,
            }),
          }).upperMinutes,
        calledAt: rotation.called_at,
        timeline: {
          planned: {
            boardingAt: rotation.planned_boarding_at,
            departureAt: rotation.planned_departure_at,
            landingAt: rotation.planned_landing_at,
            completionAt: rotation.planned_completion_at,
          },
          predicted: {
            boardingAt: rotation.predicted_boarding_at,
            departureAt: rotation.predicted_departure_at,
            landingAt: rotation.predicted_landing_at,
            completionAt: rotation.predicted_completion_at,
          },
          actual: {
            boardingAt: rotation.called_at,
            departureAt: rotation.departed_at,
            landingAt: rotation.landed_at,
            completionAt: rotation.completed_at,
          },
          predictionQuality: rotation.prediction_quality,
          predictionUpdatedAt: rotation.prediction_updated_at,
        },
        tickets: JSON.parse(rotation.tickets_json) as Array<{
          id: string;
          attendanceStatus: "NOT_CHECKED_IN" | "CHECKED_IN";
        }>,
      };
    }),
    aircraft: fleetRows.results.map((aircraft) => ({
      id: aircraft.id,
      registration: aircraft.registration,
      aircraftType: aircraft.aircraft_type,
      passengerSeats: aircraft.passenger_seats,
      maximumPassengerPayloadKg: aircraft.maximum_passenger_payload_kg,
      operationalState:
        aircraft.operational_interrupted === 1 ? "INTERRUPTED" : aircraft.operational_state,
      resourceGroupId: aircraft.resource_group_id ?? "",
      resourceGroupName: aircraft.resource_group_name ?? "Nicht zugeordnet",
      refuelPlanned: aircraft.refuel_planned === 1,
      rotationsSinceRefuel: aircraft.rotations_since_refuel,
      refuelReminderThreshold: aircraft.refuel_reminder_threshold,
      expectedReviewAt: aircraft.expected_review_at,
    })),
    pilots: pilotRows.results.map((pilot) => ({
      id: pilot.id,
      operationalCode: pilot.operational_code,
      active: pilot.active === 1,
      paused: pilot.paused === 1,
      pauseExpectedReviewAt: pilot.pause_expected_review_at,
    })),
    gates: gatesRows.results.map((gate) => ({
      id: gate.id,
      label: gate.label,
      gateType: gate.gate_type,
      active: gate.active === 1,
      sortOrder: gate.sort_order,
    })),
    resourceGroups: resourceGroupRows.results.map((group) => ({
      id: group.id,
      name: group.name,
      status: group.status,
      gateId: group.gate_id,
      gateLabel: group.gate_label,
      referenceCapacity: group.reference_capacity,
      plannedRotationMinutes: group.planned_rotation_minutes,
      compatibleAircraftTypes: JSON.parse(group.compatible_aircraft_types_json) as string[],
      activeAircraftIds: JSON.parse(group.aircraft_ids_json) as string[],
    })),
    metrics: {
      openTickets: metricsRow?.open_tickets ?? 0,
      soldTickets: metricsRow?.sold_tickets ?? 0,
      completedRotations: metricsRow?.completed_rotations ?? 0,
      activeRotations: metricsRow?.active_rotations ?? 0,
      averageBoardingMinutes: metricsRow?.average_boarding_minutes ?? null,
      averageFlightMinutes: metricsRow?.average_flight_minutes ?? null,
      averageTurnaroundMinutes: metricsRow?.average_turnaround_minutes ?? null,
      averageRotationMinutes: metricsRow?.average_rotation_minutes ?? null,
      averageWaitMinutes: metricsRow?.average_wait_minutes ?? null,
      informationalRevenueCents: metricsRow?.informational_revenue_cents ?? 0,
      activeDevices: metricsRow?.active_devices ?? 0,
      activePushSubscriptions: metricsRow?.active_push_subscriptions ?? 0,
    },
  });
});

app.get("/api/events/:eventId/tickets/search", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(
    context.env,
    eventId,
    context.req.header("x-device-id"),
    context.req.header("x-device-token"),
  );
  if (!device || !["CASHIER", "FLIGHT_LINE", "FLIGHT_LINE_LEAD", "ADMIN"].includes(device.role)) {
    return context.json(
      { error: { code: "DEVICE_NOT_AUTHORIZED", message: "Gerät nicht berechtigt." } },
      403,
    );
  }
  const rawQuery = context.req.query("q")?.trim() ?? "";
  if (rawQuery.length < 2 || rawQuery.length > 200) {
    return context.json({ results: [] });
  }
  let query = rawQuery;
  try {
    const url = new URL(rawQuery);
    query = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? rawQuery);
  } catch {
    // Plain ticket, group or communication identifier.
  }
  const normalized = query.trim().toUpperCase();
  const ticketHash = await sha256Hex(normalized);
  const likeQuery = `%${query.trim()}%`;
  const numericQuery = /^\d+$/.test(normalized) ? String(Number(normalized)) : "";
  const rows = await context.env.DB.prepare(
    `SELECT tg.id AS ticket_group_id, tg.status AS group_status, tg.queue_sequence, tg.standby,
            tg.sold_at, p.id AS product_id, p.code AS product_code, p.name AS product_name,
            COUNT(DISTINCT t.id) AS group_size, fg.communication_number,
            r.status AS rotation_status
       FROM ticket_groups tg
       JOIN products p ON p.id = tg.product_id
       JOIN tickets t ON t.ticket_group_id = tg.id
       LEFT JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
       LEFT JOIN rotations r ON r.id = rt.rotation_id
       LEFT JOIN flight_groups fg ON fg.id = r.flight_group_id
      WHERE tg.operation_day_id = ?1
        AND (t.public_code_hash = ?2 OR tg.id LIKE ?3 OR CAST(fg.communication_number AS TEXT) = ?4
             OR UPPER(p.code || '-' || printf('%03d', fg.communication_number)) = ?5)
      GROUP BY tg.id, tg.status, tg.queue_sequence, tg.standby, tg.sold_at, p.id, p.code, p.name,
               fg.communication_number, r.status
      ORDER BY tg.sold_at DESC LIMIT 20`,
  )
    .bind(eventId, ticketHash, likeQuery, numericQuery, normalized)
    .all<{
      ticket_group_id: string;
      group_status: string;
      queue_sequence: number;
      standby: number;
      sold_at: string;
      product_id: string;
      product_code: string;
      product_name: string;
      group_size: number;
      communication_number: number | null;
      rotation_status: string | null;
    }>();
  return context.json({
    results: rows.results.map((row) => ({
      ticketGroupId: row.ticket_group_id,
      productId: row.product_id,
      productCode: row.product_code,
      productName: row.product_name,
      groupStatus: row.group_status,
      groupSize: row.group_size,
      queueSequence: row.queue_sequence,
      standby: row.standby === 1,
      soldAt: row.sold_at,
      communicationNumber: row.communication_number,
      communicationLabel:
        row.communication_number === null
          ? null
          : `${row.product_code}-${String(row.communication_number).padStart(3, "0")}`,
      rotationStatus: row.rotation_status,
    })),
  });
});

app.get("/api/events/:eventId/history", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(
    context.env,
    eventId,
    context.req.header("x-device-id"),
    context.req.header("x-device-token"),
  );
  if (!device || !["ADMIN", "FLIGHT_LINE_LEAD", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      { error: { code: "DEVICE_NOT_AUTHORIZED", message: "Gerät nicht berechtigt." } },
      403,
    );
  }
  const conditions = ["operation_day_id = ?1"];
  const bindings: Array<string | number> = [eventId];
  const addFilter = (column: string, value: string | undefined) => {
    if (!value?.trim()) return;
    bindings.push(value.trim());
    conditions.push(`${column} = ?${bindings.length}`);
  };
  addFilter("event_type", context.req.query("eventType"));
  addFilter("aggregate_type", context.req.query("aggregateType"));
  addFilter("aggregate_id", context.req.query("aggregateId"));
  addFilter("device_id", context.req.query("deviceId"));
  const since = context.req.query("since");
  if (since && !Number.isNaN(Date.parse(since))) {
    bindings.push(new Date(since).toISOString());
    conditions.push(`occurred_at >= ?${bindings.length}`);
  }
  const until = context.req.query("until");
  if (until && !Number.isNaN(Date.parse(until))) {
    bindings.push(new Date(until).toISOString());
    conditions.push(`occurred_at <= ?${bindings.length}`);
  }
  const requestedLimit = Number.parseInt(context.req.query("limit") ?? "200", 10);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 200, 1), 1000);
  bindings.push(limit);
  const rows = await context.env.DB.prepare(
    `SELECT sequence, event_type, occurred_at, device_id, aggregate_type, aggregate_id,
            aggregate_version, payload_json
       FROM operational_events WHERE ${conditions.join(" AND ")}
      ORDER BY sequence DESC LIMIT ?${bindings.length}`,
  )
    .bind(...bindings)
    .all<{
      sequence: number;
      event_type: string;
      occurred_at: string;
      device_id: string;
      aggregate_type: string;
      aggregate_id: string;
      aggregate_version: number;
      payload_json: string;
    }>();
  return context.json({
    entries: rows.results.map((row) => ({
      sequence: row.sequence,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      deviceId: row.device_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      aggregateVersion: row.aggregate_version,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    })),
  });
});

app.get("/api/events/:eventId/devices", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(
    context.env,
    eventId,
    context.req.header("x-device-id"),
    context.req.header("x-device-token"),
  );
  if (device?.role !== "ADMIN") {
    return context.json(
      { error: { code: "DEVICE_NOT_AUTHORIZED", message: "Gerät nicht berechtigt." } },
      403,
    );
  }
  const devices = await context.env.DB.prepare(
    `SELECT id, label, role, active, paired_at, last_seen_at, revoked_at
       FROM paired_devices WHERE operation_day_id = ?1 ORDER BY active DESC, paired_at DESC`,
  )
    .bind(eventId)
    .all<{
      id: string;
      label: string;
      role: string;
      active: number;
      paired_at: string;
      last_seen_at: string;
      revoked_at: string | null;
    }>();
  const now = Date.now();
  return context.json({
    devices: devices.results.map((entry) => ({
      id: entry.id,
      label: entry.label,
      role: entry.role,
      active: entry.active === 1,
      online: entry.active === 1 && now - Date.parse(entry.last_seen_at) <= 120_000,
      pairedAt: entry.paired_at,
      lastSeenAt: entry.last_seen_at,
      revokedAt: entry.revoked_at,
    })),
  });
});

app.get("/api/events/:eventId/reports/daily.csv", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(
    context.env,
    eventId,
    context.req.header("x-device-id"),
    context.req.header("x-device-token"),
  );
  if (!device || !["ADMIN", "CASHIER"].includes(device.role)) {
    return context.json(
      { error: { code: "DEVICE_NOT_AUTHORIZED", message: "Gerät nicht berechtigt." } },
      403,
    );
  }
  const rows = await context.env.DB.prepare(
    `SELECT p.name AS product_name, t.payment_method, t.payment_status,
            COUNT(*) AS ticket_count,
            SUM(CASE WHEN t.status = 'CANCELED' THEN 1 ELSE 0 END) AS canceled_count,
            SUM(CASE WHEN t.status <> 'CANCELED' THEN t.price_cents ELSE 0 END) AS amount_cents
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
      WHERE tg.operation_day_id = ?1
      GROUP BY p.id, t.payment_method, t.payment_status
      ORDER BY p.name, t.payment_method`,
  )
    .bind(eventId)
    .all<{
      product_name: string;
      payment_method: string | null;
      payment_status: string;
      ticket_count: number;
      canceled_count: number;
      amount_cents: number;
    }>();
  const lines = [
    ["Produkt", "Zahlart", "Zahlstatus", "Tickets", "Stornos", "Betrag_Cent"],
    ...rows.results.map((row) => [
      row.product_name,
      row.payment_method ?? "NICHT_ERFASST",
      row.payment_status,
      row.ticket_count,
      row.canceled_count,
      row.amount_cents,
    ]),
  ];
  const csv = createCsv(lines);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tagesbericht-${eventId}.csv"`,
      "cache-control": "no-store",
    },
  });
});

app.get("/api/events/:eventId/exports/tickets.csv", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(
    context.env,
    eventId,
    context.req.header("x-device-id"),
    context.req.header("x-device-token"),
  );
  if (!device || !["ADMIN", "CASHIER", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      { error: { code: "DEVICE_NOT_AUTHORIZED", message: "Gerät nicht berechtigt." } },
      403,
    );
  }
  const rows = await context.env.DB.prepare(
    `SELECT t.id AS ticket_id, t.status AS ticket_status, t.weight_class,
            t.payment_method, t.payment_status, t.price_cents, t.created_at,
            tg.id AS ticket_group_id, tg.queue_sequence, tg.standby,
            p.id AS product_id, p.name AS product_name,
            rg.id AS resource_group_id, rg.name AS resource_group_name,
            fg.communication_number, r.id AS rotation_id, r.status AS rotation_status,
            a.registration, pl.operational_code AS pilot_code,
            r.called_at, r.departed_at, r.landed_at, r.completed_at
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
       JOIN resource_groups rg ON rg.id = p.resource_group_id
       LEFT JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
       LEFT JOIN rotations r ON r.id = rt.rotation_id
       LEFT JOIN flight_groups fg ON fg.id = r.flight_group_id
       LEFT JOIN aircraft a ON a.id = r.aircraft_id
       LEFT JOIN pilots pl ON pl.id = r.pilot_id
      WHERE tg.operation_day_id = ?1
      ORDER BY t.created_at, t.id`,
  )
    .bind(eventId)
    .all<Record<string, string | number | null>>();
  const columns = [
    "ticket_id",
    "ticket_status",
    "weight_class",
    "payment_method",
    "payment_status",
    "price_cents",
    "created_at",
    "ticket_group_id",
    "queue_sequence",
    "standby",
    "product_id",
    "product_name",
    "resource_group_id",
    "resource_group_name",
    "communication_number",
    "rotation_id",
    "rotation_status",
    "registration",
    "pilot_code",
    "called_at",
    "departed_at",
    "landed_at",
    "completed_at",
  ];
  return new Response(
    createCsv([
      columns,
      ...rows.results.map((row) => columns.map((column) => row[column] ?? null)),
    ]),
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rohdaten-tickets-${eventId}.csv"`,
        "cache-control": "no-store",
      },
    },
  );
});

app.get("/api/events/:eventId/reports/daily.pdf", async (context) => {
  const eventId = context.req.param("eventId");
  const device = await authorizeDevice(
    context.env,
    eventId,
    context.req.header("x-device-id"),
    context.req.header("x-device-token"),
  );
  if (!device || !["ADMIN", "CASHIER", "FLIGHT_DIRECTOR"].includes(device.role)) {
    return context.json(
      { error: { code: "DEVICE_NOT_AUTHORIZED", message: "Gerät nicht berechtigt." } },
      403,
    );
  }
  const summary = await context.env.DB.prepare(
    `SELECT od.name, od.event_date,
            (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id WHERE tg.operation_day_id = od.id) AS tickets,
            (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id WHERE tg.operation_day_id = od.id AND t.status = 'CANCELED') AS cancellations,
            (SELECT COALESCE(SUM(t.price_cents), 0) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id WHERE tg.operation_day_id = od.id AND t.status <> 'CANCELED') AS revenue,
            (SELECT COUNT(*) FROM rotations r WHERE r.operation_day_id = od.id AND r.status = 'COMPLETED') AS completed_rotations,
            (SELECT ROUND(AVG((julianday(r.completed_at) - julianday(r.called_at)) * 1440), 1) FROM rotations r WHERE r.operation_day_id = od.id AND r.completed_at IS NOT NULL) AS average_rotation
       FROM operation_days od
      WHERE od.id = ?1`,
  )
    .bind(eventId)
    .first<Record<string, string | number | null>>();
  if (!summary)
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  const pdf = createTextPdf(`Tagesbericht ${String(summary.name)}`, [
    `Datum: ${String(summary.event_date)}`,
    `Tickets: ${String(summary.tickets ?? 0)}`,
    `Stornos: ${String(summary.cancellations ?? 0)}`,
    `Abgeschlossene Umlaeufe: ${String(summary.completed_rotations ?? 0)}`,
    `Mittlere Umlaufzeit: ${String(summary.average_rotation ?? "-")} Minuten`,
    `Informatorischer Umsatz: ${(Number(summary.revenue ?? 0) / 100).toFixed(2)} EUR`,
    "Zeitangaben basieren auf bestaetigten operativen Ist-Ereignissen.",
  ]);
  return new Response(
    pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer,
    {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="tagesbericht-${eventId}.pdf"`,
        "cache-control": "no-store",
      },
    },
  );
});

app.get("/api/public/tickets/:ticketCode", async (context) => {
  const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
  if (!/^[A-Z2-9]{12,32}$/.test(ticketCode)) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const ticketHash = await sha256Hex(ticketCode);
  const row = await context.env.DB.prepare(
    `SELECT p.name AS product_name, p.code AS product_code, p.public_description,
            g.label AS gate_label,
            fg.communication_number, r.status, tg.queue_sequence,
            od.operational_note AS event_operational_note, od.operational_interrupted,
            rg.operational_note AS resource_group_operational_note, od.updated_at
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
       JOIN gates g ON g.id = p.gate_id
       JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
       JOIN rotations r ON r.id = rt.rotation_id
       JOIN flight_groups fg ON fg.id = r.flight_group_id
       JOIN resource_groups rg ON rg.id = fg.resource_group_id
       JOIN operation_days od ON od.id = tg.operation_day_id
      WHERE t.public_code_hash = ?1`,
  )
    .bind(ticketHash)
    .first<{
      product_name: string;
      product_code: string;
      public_description: string;
      gate_label: string;
      communication_number: number;
      status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      queue_sequence: number;
      updated_at: string;
      event_operational_note: string;
      resource_group_operational_note: string;
      operational_interrupted: number;
    }>();
  if (!row) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const publicState = {
    DRAFT: "WAITING",
    CALLED: "COME_TO_FLIGHT_LINE",
    IN_FLIGHT: "IN_FLIGHT",
    LANDED: "LANDED",
    COMPLETED: "COMPLETED",
  } as const;
  const message = {
    DRAFT: "Bitte Status regelmäßig prüfen.",
    CALLED: "Bitte jetzt zur Flight Line kommen.",
    IN_FLIGHT: "Der Flug läuft.",
    LANDED: "Der Flug ist gelandet.",
    COMPLETED: "Der Rundflug ist abgeschlossen.",
  } as const;
  return context.json({
    productName: row.product_name,
    productCode: row.product_code,
    publicDescription: row.public_description,
    gateLabel: row.gate_label,
    communicationNumber: row.communication_number,
    status: publicState[row.status],
    queuePosition: row.status === "DRAFT" ? row.queue_sequence : null,
    waitLowerMinutes:
      row.status === "DRAFT" && row.operational_interrupted === 0
        ? Math.max(0, (row.queue_sequence - 1) * 20)
        : 0,
    waitUpperMinutes:
      row.status === "DRAFT" && row.operational_interrupted === 0 ? row.queue_sequence * 30 : 0,
    predictionQuality: row.operational_interrupted === 1 ? "UNCERTAIN" : "CHANGING",
    message:
      row.operational_interrupted === 1
        ? "Flugbetrieb unterbrochen – bitte Status erneut prüfen."
        : message[row.status],
    operationalNotice: row.resource_group_operational_note || row.event_operational_note,
    updatedAt: row.updated_at,
  });
});

app.get("/api/public/push/config", (context) => {
  if (!context.env.VAPID_PUBLIC_KEY) {
    return context.json(
      { error: { code: "PUSH_NOT_CONFIGURED", message: "Web-Push ist noch nicht eingerichtet." } },
      503,
    );
  }
  return context.json({ publicKey: context.env.VAPID_PUBLIC_KEY, retentionDays: 7 });
});

app.post("/api/public/tickets/:ticketCode/push-subscriptions", async (context) => {
  const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
  if (!/^[A-Z2-9]{12,32}$/.test(ticketCode)) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const body = await context.req.json<{
    consent?: boolean;
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  }>();
  if (
    body.consent !== true ||
    typeof body.endpoint !== "string" ||
    !isAllowedPushEndpoint(body.endpoint) ||
    typeof body.keys?.p256dh !== "string" ||
    typeof body.keys.auth !== "string"
  ) {
    return context.json(
      { error: { code: "INVALID_PUSH_SUBSCRIPTION", message: "Push-Einwilligung ist ungültig." } },
      400,
    );
  }
  const ticket = await context.env.DB.prepare(
    `SELECT t.id, tg.operation_day_id FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
      WHERE t.public_code_hash = ?1 AND t.status <> 'CANCELED'`,
  )
    .bind(await sha256Hex(ticketCode))
    .first<{ id: string; operation_day_id: string }>();
  if (!ticket) {
    return unknownTicketResponse(context.env, context.req.raw);
  }
  const now = new Date();
  const deleteAfter = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await context.env.DB.prepare(
    `INSERT INTO web_push_subscriptions
       (id, operation_day_id, ticket_id, endpoint, p256dh, auth, consented_at, delete_after, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ACTIVE', ?7)
     ON CONFLICT(endpoint) DO UPDATE SET ticket_id = excluded.ticket_id,
       operation_day_id = excluded.operation_day_id, p256dh = excluded.p256dh, auth = excluded.auth,
       consented_at = excluded.consented_at, delete_after = excluded.delete_after,
       status = 'ACTIVE', updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(),
      ticket.operation_day_id,
      ticket.id,
      body.endpoint,
      body.keys.p256dh,
      body.keys.auth,
      now.toISOString(),
      deleteAfter,
    )
    .run();
  return context.json({ active: true, consentedAt: now.toISOString(), deleteAfter }, 201);
});

app.delete("/api/public/tickets/:ticketCode/push-subscriptions", async (context) => {
  const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
  const body = await context.req.json<{ endpoint?: string }>();
  if (!/^[A-Z2-9]{12,32}$/.test(ticketCode) || typeof body.endpoint !== "string") {
    return context.json(
      { error: { code: "INVALID_REQUEST", message: "Abmeldung ist ungültig." } },
      400,
    );
  }
  await context.env.DB.prepare(
    `DELETE FROM web_push_subscriptions
      WHERE endpoint = ?1 AND ticket_id IN (SELECT id FROM tickets WHERE public_code_hash = ?2)`,
  )
    .bind(body.endpoint, await sha256Hex(ticketCode))
    .run();
  return context.body(null, 204);
});

app.get("/api/public/events/:eventId/board", async (context) => {
  const eventId = context.req.param("eventId");
  const event = await context.env.DB.prepare(
    "SELECT name, emergency_mode, operational_interrupted, operational_note, updated_at FROM operation_days WHERE id = ?1",
  )
    .bind(eventId)
    .first<{
      name: string;
      emergency_mode: number;
      operational_interrupted: number;
      operational_note: string;
      updated_at: string;
    }>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const rows = await context.env.DB.prepare(
    `SELECT COALESCE(MIN(p.name), 'Rundflug') AS product_name,
            COALESCE(MIN(p.code), 'RF') AS product_code,
            COALESCE(MIN(g.label), 'Flight Line') AS gate_label,
            fg.communication_number, r.status,
            rg.operational_note AS resource_group_operational_note
       FROM rotations r
       JOIN flight_groups fg ON fg.id = r.flight_group_id
       JOIN resource_groups rg ON rg.id = fg.resource_group_id
       LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
       LEFT JOIN tickets t ON t.id = rt.ticket_id
       LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       LEFT JOIN products p ON p.id = tg.product_id
       LEFT JOIN gates g ON g.id = p.gate_id
      WHERE r.operation_day_id = ?1 AND r.status <> 'CANCELED'
      GROUP BY r.id
      ORDER BY fg.communication_number
      LIMIT 20`,
  )
    .bind(eventId)
    .all<{
      product_name: string;
      product_code: string;
      gate_label: string;
      communication_number: number;
      status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      resource_group_operational_note: string;
    }>();
  const publicState = {
    DRAFT: "WAITING",
    CALLED: "COME_TO_FLIGHT_LINE",
    IN_FLIGHT: "IN_FLIGHT",
    LANDED: "LANDED",
    COMPLETED: "COMPLETED",
  } as const;
  return context.json({
    eventName: event.name,
    emergencyMode: event.emergency_mode === 1,
    operationalInterrupted: event.operational_interrupted === 1,
    operationalNotice: event.operational_note,
    updatedAt: event.updated_at,
    groups: event.emergency_mode
      ? []
      : rows.results.map((row, index) => ({
          productName: row.product_name,
          productCode: row.product_code,
          gateLabel: row.gate_label,
          communicationNumber: row.communication_number,
          status: publicState[row.status],
          waitLowerMinutes: event.operational_interrupted === 1 ? 0 : index * 20,
          waitUpperMinutes: event.operational_interrupted === 1 ? 0 : (index + 1) * 30,
          operationalNotice: row.resource_group_operational_note,
        })),
  });
});

app.all("/api/events/:eventId/live", async (context) => {
  const eventId = context.req.param("eventId");
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const response = await stub.fetch(context.req.raw);
  return new Response(response.body, response);
});

app.post("/api/events/:eventId/commands", async (context) => {
  const eventId = context.req.param("eventId");
  const namespace = eventCoordinatorNamespace(context.env);
  const stub = namespace.get(namespace.idFromName(eventId));
  const target = new URL(context.req.url);
  target.pathname = `/internal/events/${encodeURIComponent(eventId)}/command`;
  const response = await stub.fetch(new Request(target, context.req.raw));
  return new Response(response.body, response);
});

app.notFound((context) =>
  context.json({ error: { code: "NOT_FOUND", message: "API-Route nicht gefunden." } }, 404),
);

app.onError((error, context) => {
  console.error(
    JSON.stringify({ level: "error", code: "UNHANDLED_API_ERROR", message: error.message }),
  );
  return context.json({ error: { code: "INTERNAL_ERROR", message: "Interner Fehler." } }, 500);
});

export { EventCoordinator };

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const purgedPushSubscriptions = await purgeExpiredPushSubscriptions(env);
    const result = await createPortableBackup(env);
    console.log(
      JSON.stringify({
        level: "info",
        code: "PORTABLE_BACKUP_CREATED",
        key: result.key,
        checksum: result.checksum,
        purgedPushSubscriptions,
        timestamp: new Date().toISOString(),
      }),
    );
  },
};
