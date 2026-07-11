import { APP_NAME, REQUIREMENTS_VERSION } from "@rundflug/config";
import { assessRemainingCapacity, estimateDuration, forecastQueueWindows } from "@rundflug/domain";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createPortableBackup } from "./backup";
import { sha256Hex, verifyCredential } from "./crypto";
import { EventCoordinator } from "./event-coordinator";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";
import { isAllowedPushEndpoint, purgeExpiredPushSubscriptions } from "./web-push";

const app = new Hono<{ Bindings: Env }>();

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

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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

app.get("/api/events/:eventId/snapshot", async (context) => {
  const row = await context.env.DB.prepare(
    `SELECT id, name, event_date, time_zone, status, emergency_mode, operational_interrupted, version,
            operational_note, operations_end_at, updated_at
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
    `SELECT id, name, event_date, time_zone, status, emergency_mode, operational_interrupted, version,
            operational_note, operations_end_at, updated_at FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<StoredEventRow>();
  if (!eventRow) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }

  const [products, rotations, durationRows, aircraftRows, fleetRows, pilotRows] = await Promise.all(
    [
      context.env.DB.prepare(
        `SELECT p.id, p.name, p.resource_group_id, rg.name AS resource_group_name,
              rg.status AS resource_group_status, rg.operational_note AS resource_group_operational_note,
              p.price_cents, p.sale_enabled, p.reference_capacity, p.reference_duration_minutes,
              p.sale_closes_at, p.capacity_warning_threshold, p.capacity_critical_threshold,
              COUNT(CASE WHEN t.status = 'QUEUED' THEN 1 END) AS queued_tickets,
              (SELECT COUNT(*) FROM tickets shared_t
                JOIN ticket_groups shared_tg ON shared_tg.id = shared_t.ticket_group_id
                JOIN products shared_p ON shared_p.id = shared_tg.product_id
               WHERE shared_p.resource_group_id = p.resource_group_id
                 AND shared_t.status = 'QUEUED') AS resource_group_open_tickets
         FROM products p
         JOIN resource_groups rg ON rg.id = p.resource_group_id
         LEFT JOIN ticket_groups tg ON tg.product_id = p.id
         LEFT JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE p.operation_day_id = ?1
        GROUP BY p.id
        ORDER BY p.name`,
      )
        .bind(eventId)
        .all<{
          id: string;
          name: string;
          resource_group_id: string;
          resource_group_name: string;
          resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
          resource_group_operational_note: string;
          price_cents: number;
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
        `SELECT r.id, r.flight_group_id, fg.resource_group_id, fg.communication_number, r.status, r.aircraft_id, r.called_at,
              a.registration AS aircraft_registration,
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
              COALESCE(MIN(p.name), 'Rundflug') AS product_name
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
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
          suggested_aircraft_id: string | null;
          suggested_aircraft_registration: string | null;
          ticket_group_id: string;
          ticket_count: number;
          product_name: string;
          called_at: string | null;
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
        `SELECT a.id, a.registration, a.aircraft_type, a.passenger_seats, a.operational_state,
              a.refuel_planned, a.rotations_since_refuel, a.refuel_reminder_threshold,
              a.operational_interrupted,
              m.resource_group_id, rg.name AS resource_group_name,
              (SELECT b.expected_review_at FROM operational_blocks b
                WHERE b.operation_day_id = m.operation_day_id AND b.scope_type = 'AIRCRAFT'
                  AND b.scope_id = a.id AND b.status = 'ACTIVE'
                ORDER BY b.started_at DESC LIMIT 1) AS expected_review_at
         FROM aircraft a
         JOIN resource_group_memberships m ON m.aircraft_id = a.id AND m.active_until IS NULL
         JOIN resource_groups rg ON rg.id = m.resource_group_id
        WHERE m.operation_day_id = ?1 ORDER BY a.registration`,
      )
        .bind(eventId)
        .all<{
          id: string;
          registration: string;
          aircraft_type: string;
          passenger_seats: number;
          operational_state: string;
          refuel_planned: number;
          rotations_since_refuel: number;
          refuel_reminder_threshold: number;
          operational_interrupted: number;
          resource_group_id: string;
          resource_group_name: string;
          expected_review_at: string | null;
        }>(),
      context.env.DB.prepare(
        "SELECT id, operational_code, active FROM pilots WHERE operation_day_id = ?1 ORDER BY operational_code",
      )
        .bind(eventId)
        .all<{ id: string; operational_code: string; active: number }>(),
    ],
  );

  const actualDurations = durationRows.results.map((row) => row.duration_minutes);
  const dataAgeMinutes = Math.max(0, (Date.now() - Date.parse(eventRow.updated_at)) / 60_000);
  const operationsEnd = eventRow.operations_end_at ? Date.parse(eventRow.operations_end_at) : 0;
  const remainingOperatingMinutes = Math.max(0, (operationsEnd - Date.now()) / 60_000);

  return context.json({
    event: rowToSnapshot(eventRow),
    products: products.results.map((product) => {
      const groupAircraftSeats = aircraftRows.results
        .filter((aircraft) => aircraft.resource_group_id === product.resource_group_id)
        .map((aircraft) => aircraft.passenger_seats);
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
        referenceMinutes: product.reference_duration_minutes,
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
        name: product.name,
        resourceGroupId: product.resource_group_id,
        resourceGroupName: product.resource_group_name,
        resourceGroupStatus: product.resource_group_status,
        resourceGroupOperationalNote: product.resource_group_operational_note,
        priceCents: product.price_cents,
        saleEnabled: product.sale_enabled === 1,
        referenceCapacity: product.reference_capacity,
        queuedTickets: product.queued_tickets,
        estimatedWaitLowerMinutes: forecast.lowerMinutes,
        estimatedWaitUpperMinutes: forecast.upperMinutes,
        remainingSellableSeats: capacity.remainingSellableSeats,
        projectedSeats: capacity.projectedSeats,
        capacityStatus: capacity.status,
        saleRecommended:
          capacity.saleRecommended &&
          product.sale_enabled === 1 &&
          product.resource_group_status === "ACTIVE" &&
          eventRow.emergency_mode === 0 &&
          eventRow.operational_interrupted !== 1 &&
          (product.sale_closes_at === null || Date.parse(product.sale_closes_at) > Date.now()),
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
      return {
        id: rotation.id,
        flightGroupId: rotation.flight_group_id,
        communicationNumber: rotation.communication_number,
        productName: rotation.product_name,
        status: rotation.status,
        ticketGroupId: rotation.ticket_group_id,
        aircraftId: rotation.aircraft_id,
        aircraftRegistration: rotation.aircraft_registration,
        suggestedAircraftId: rotation.suggested_aircraft_id,
        suggestedAircraftRegistration: rotation.suggested_aircraft_registration,
        ticketCount: rotation.ticket_count,
        predictedLowerMinutes: forecastQueueWindows({
          queueSequence: index + 1,
          activeAircraft,
          duration: estimateDuration({
            referenceMinutes: 20,
            actualDurationsMinutes: actualDurations,
            dataAgeMinutes,
            interrupted: eventRow.emergency_mode === 1 || eventRow.operational_interrupted === 1,
            activeCapacity: activeAircraft,
          }),
        }).lowerMinutes,
        predictedUpperMinutes: forecastQueueWindows({
          queueSequence: index + 1,
          activeAircraft,
          duration: estimateDuration({
            referenceMinutes: 20,
            actualDurationsMinutes: actualDurations,
            dataAgeMinutes,
            interrupted: eventRow.emergency_mode === 1 || eventRow.operational_interrupted === 1,
            activeCapacity: activeAircraft,
          }),
        }).upperMinutes,
        calledAt: rotation.called_at,
      };
    }),
    aircraft: fleetRows.results.map((aircraft) => ({
      id: aircraft.id,
      registration: aircraft.registration,
      aircraftType: aircraft.aircraft_type,
      passengerSeats: aircraft.passenger_seats,
      operationalState:
        aircraft.operational_interrupted === 1 ? "INTERRUPTED" : aircraft.operational_state,
      resourceGroupId: aircraft.resource_group_id,
      resourceGroupName: aircraft.resource_group_name,
      refuelPlanned: aircraft.refuel_planned === 1,
      rotationsSinceRefuel: aircraft.rotations_since_refuel,
      refuelReminderThreshold: aircraft.refuel_reminder_threshold,
      expectedReviewAt: aircraft.expected_review_at,
    })),
    pilots: pilotRows.results.map((pilot) => ({
      id: pilot.id,
      operationalCode: pilot.operational_code,
      active: pilot.active === 1,
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
  const rows = await context.env.DB.prepare(
    `SELECT sequence, event_type, occurred_at, device_id, aggregate_type, aggregate_id,
            aggregate_version, payload_json
       FROM operational_events WHERE operation_day_id = ?1
      ORDER BY sequence DESC LIMIT 200`,
  )
    .bind(eventId)
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
  const csv = `\uFEFF${lines.map((line) => line.map(csvCell).join(";")).join("\r\n")}\r\n`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tagesbericht-${eventId}.csv"`,
      "cache-control": "no-store",
    },
  });
});

app.get("/api/public/tickets/:ticketCode", async (context) => {
  const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
  if (!/^[A-Z2-9]{12,32}$/.test(ticketCode)) {
    return context.json(
      { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
      404,
    );
  }
  const ticketHash = await sha256Hex(ticketCode);
  const row = await context.env.DB.prepare(
    `SELECT p.name AS product_name, fg.communication_number, r.status, tg.queue_sequence,
            od.operational_note AS event_operational_note, od.operational_interrupted,
            rg.operational_note AS resource_group_operational_note, od.updated_at
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
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
      communication_number: number;
      status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      queue_sequence: number;
      updated_at: string;
      event_operational_note: string;
      resource_group_operational_note: string;
      operational_interrupted: number;
    }>();
  if (!row) {
    return context.json(
      { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
      404,
    );
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
    return context.json(
      { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
      404,
    );
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
    return context.json(
      { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
      404,
    );
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
    `SELECT COALESCE(MIN(p.name), 'Rundflug') AS product_name, fg.communication_number, r.status,
            rg.operational_note AS resource_group_operational_note
       FROM rotations r
       JOIN flight_groups fg ON fg.id = r.flight_group_id
       JOIN resource_groups rg ON rg.id = fg.resource_group_id
       LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
       LEFT JOIN tickets t ON t.id = rt.ticket_id
       LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       LEFT JOIN products p ON p.id = tg.product_id
      WHERE r.operation_day_id = ?1 AND r.status <> 'CANCELED'
      GROUP BY r.id
      ORDER BY fg.communication_number
      LIMIT 20`,
  )
    .bind(eventId)
    .all<{
      product_name: string;
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
