import { APP_NAME, REQUIREMENTS_VERSION } from "@rundflug/config";
import { estimateDuration, forecastQueueWindows } from "@rundflug/domain";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { sha256Hex, verifyCredential } from "./crypto";
import { EventCoordinator } from "./event-coordinator";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const app = new Hono<{ Bindings: Env }>();

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
    `SELECT id, name, event_date, time_zone, status, emergency_mode, version,
            operational_note, updated_at
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

  const eventRow = await context.env.DB.prepare(
    `SELECT id, name, event_date, time_zone, status, emergency_mode, version,
            operational_note, updated_at FROM operation_days WHERE id = ?1`,
  )
    .bind(eventId)
    .first<StoredEventRow>();
  if (!eventRow) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }

  const [products, rotations, durationRows, aircraftCountRow] = await Promise.all([
    context.env.DB.prepare(
      `SELECT p.id, p.name, p.resource_group_id, rg.status AS resource_group_status,
              p.price_cents, p.sale_enabled, p.reference_capacity, p.reference_duration_minutes,
              COUNT(CASE WHEN t.status = 'QUEUED' THEN 1 END) AS queued_tickets
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
        resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
        price_cents: number;
        sale_enabled: number;
        reference_capacity: number;
        reference_duration_minutes: number;
        queued_tickets: number;
      }>(),
    context.env.DB.prepare(
      `SELECT r.id, r.flight_group_id, fg.communication_number, r.status, r.aircraft_id, r.called_at,
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
      `SELECT COUNT(*) AS active_count FROM aircraft a
        WHERE a.operational_state NOT IN ('INACTIVE', 'PAUSED')
          AND EXISTS (SELECT 1 FROM resource_group_memberships m
                       WHERE m.aircraft_id = a.id AND m.operation_day_id = ?1 AND m.active_until IS NULL)`,
    )
      .bind(eventId)
      .first<{ active_count: number }>(),
  ]);

  const actualDurations = durationRows.results.map((row) => row.duration_minutes);
  const dataAgeMinutes = Math.max(0, (Date.now() - Date.parse(eventRow.updated_at)) / 60_000);
  const activeAircraft = aircraftCountRow?.active_count ?? 0;

  return context.json({
    event: rowToSnapshot(eventRow),
    products: products.results.map((product) => {
      const queueSequence = Math.max(
        1,
        Math.ceil(product.queued_tickets / product.reference_capacity),
      );
      const duration = estimateDuration({
        referenceMinutes: product.reference_duration_minutes,
        actualDurationsMinutes: actualDurations,
        dataAgeMinutes,
        interrupted: product.resource_group_status !== "ACTIVE" || eventRow.emergency_mode === 1,
        activeCapacity: activeAircraft,
      });
      const forecast = forecastQueueWindows({ queueSequence, activeAircraft, duration });
      return {
        id: product.id,
        name: product.name,
        resourceGroupId: product.resource_group_id,
        resourceGroupStatus: product.resource_group_status,
        priceCents: product.price_cents,
        saleEnabled: product.sale_enabled === 1,
        referenceCapacity: product.reference_capacity,
        queuedTickets: product.queued_tickets,
        estimatedWaitLowerMinutes: forecast.lowerMinutes,
        estimatedWaitUpperMinutes: forecast.upperMinutes,
        remainingSellableSeats: Math.max(0, 1000 - product.queued_tickets),
        predictionQuality: forecast.quality,
      };
    }),
    rotations: rotations.results.map((rotation, index) => ({
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
          interrupted: eventRow.emergency_mode === 1,
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
          interrupted: eventRow.emergency_mode === 1,
          activeCapacity: activeAircraft,
        }),
      }).upperMinutes,
      calledAt: rotation.called_at,
    })),
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
            od.updated_at
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
       JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
       JOIN rotations r ON r.id = rt.rotation_id
       JOIN flight_groups fg ON fg.id = r.flight_group_id
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
    waitLowerMinutes: row.status === "DRAFT" ? Math.max(0, (row.queue_sequence - 1) * 20) : 0,
    waitUpperMinutes: row.status === "DRAFT" ? row.queue_sequence * 30 : 0,
    predictionQuality: "CHANGING",
    message: message[row.status],
    updatedAt: row.updated_at,
  });
});

app.get("/api/public/events/:eventId/board", async (context) => {
  const eventId = context.req.param("eventId");
  const event = await context.env.DB.prepare(
    "SELECT name, emergency_mode, updated_at FROM operation_days WHERE id = ?1",
  )
    .bind(eventId)
    .first<{ name: string; emergency_mode: number; updated_at: string }>();
  if (!event) {
    return context.json(
      { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
      404,
    );
  }
  const rows = await context.env.DB.prepare(
    `SELECT COALESCE(MIN(p.name), 'Rundflug') AS product_name, fg.communication_number, r.status
       FROM rotations r
       JOIN flight_groups fg ON fg.id = r.flight_group_id
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
    updatedAt: event.updated_at,
    groups: event.emergency_mode
      ? []
      : rows.results.map((row, index) => ({
          productName: row.product_name,
          communicationNumber: row.communication_number,
          status: publicState[row.status],
          waitLowerMinutes: index * 20,
          waitUpperMinutes: (index + 1) * 30,
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
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Deliberately no fake backup implementation. See docs/operations/backup-restore.md.
    console.log(
      JSON.stringify({
        level: "info",
        code: "MAINTENANCE_TRIGGER",
        timestamp: new Date().toISOString(),
      }),
    );
  },
};
