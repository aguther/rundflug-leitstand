import { adminEventFlowSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import { buildAdminEventFlow } from "./admin-event-flow";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeDevice,
  buildAdminEventFlow,
  now: () => new Date(),
};

type AdminEventRouteDependencies = typeof defaultDependencies;

export function registerAdminEventRoutes(
  app: WorkerApp,
  dependencies: AdminEventRouteDependencies = defaultDependencies,
) {
  app.get("/api/admin/events", async (context) => {
    const device = await dependencies.authorizeDevice(
      context.env,
      context.req.header("x-event-id") ?? "",
      context.req.raw,
    );
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

  app.get("/api/admin/events/:eventId/flow", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (device?.role !== "ADMIN") {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    const event = await context.env.DB.prepare(
      `SELECT id, event_date, time_zone, sale_opens_at, operations_start_at, operations_end_at
         FROM operation_days WHERE id = ?1`,
    )
      .bind(eventId)
      .first<{
        id: string;
        event_date: string;
        time_zone: string;
        sale_opens_at: string | null;
        operations_start_at: string | null;
        operations_end_at: string | null;
      }>();
    if (!event) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    const tickets = await context.env.DB.prepare(
      `SELECT tg.sold_at,
              CASE WHEN r.status = 'COMPLETED' THEN r.completed_at ELSE NULL END AS completed_at
         FROM tickets t
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         LEFT JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         LEFT JOIN rotations r ON r.id = rt.rotation_id
        WHERE tg.operation_day_id = ?1 AND t.status <> 'CANCELED'
        ORDER BY tg.sold_at, t.id`,
    )
      .bind(eventId)
      .all<{ sold_at: string; completed_at: string | null }>();
    const requestedBucketMinutes = Number(context.req.query("bucketMinutes") ?? "15");
    const flow = dependencies.buildAdminEventFlow({
      eventId,
      eventDate: event.event_date,
      timeZone: event.time_zone,
      saleOpensAt: event.sale_opens_at,
      operationsStartAt: event.operations_start_at,
      operationsEndAt: event.operations_end_at,
      observedAt: dependencies.now().toISOString(),
      requestedBucketMinutes: Number.isFinite(requestedBucketMinutes) ? requestedBucketMinutes : 15,
      tickets: tickets.results.map((ticket) => ({
        soldAt: ticket.sold_at,
        completedAt: ticket.completed_at,
      })),
    });
    return context.json(adminEventFlowSchema.parse(flow));
  });
}
