import type { Hono } from "hono";
import { authorizeSession, type SessionActor } from "./auth";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

type EventCoordinatorNamespaceResolver = (env: Env) => Env["EVENT_COORDINATOR"];

const defaultDependencies = { authorizeSession, rowToSnapshot };

type ControlCoordinationRouteDependencies = typeof defaultDependencies;

function isOperationalActor(actor: SessionActor | null): actor is SessionActor {
  return Boolean(actor && ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"].includes(actor.role));
}

function unauthorizedResponse() {
  return {
    error: {
      code: "SESSION_NOT_AUTHORIZED",
      message: "Sitzung für diese Ansicht nicht berechtigt.",
    },
  };
}

function operatorHeaders(actor: SessionActor, contentType?: string): Headers {
  const headers = new Headers(contentType ? { "content-type": contentType } : undefined);
  headers.set("x-operator-account-id", actor.accountId);
  headers.set("x-operator-login-code", actor.loginCode);
  headers.set("x-operator-session-id", actor.sessionId);
  headers.set("x-operator-role", actor.role);
  headers.set("x-operator-device-id", actor.deviceId);
  return headers;
}

function coordinatorStub(
  env: Env,
  eventId: string,
  eventCoordinatorNamespace: EventCoordinatorNamespaceResolver,
) {
  const namespace = eventCoordinatorNamespace(env);
  return namespace.get(namespace.idFromName(eventId));
}

export function registerControlCoordinationRoutes(
  app: WorkerApp,
  eventCoordinatorNamespace: EventCoordinatorNamespaceResolver,
  dependencies: ControlCoordinationRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/snapshot", async (context) => {
    const row = await context.env.DB.prepare(
      `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
              emergency_mode, operational_interrupted, version,
              operational_note, operations_start_at, operations_end_at, sale_opens_at,
              no_show_after_minutes,
              max_ticket_deferrals,
              notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
              automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
              precall_min_quality, precall_gate_cooldown_minutes,
              heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
              planned_buffer_minutes, logo_object_key, logo_dark_object_key, updated_at
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
    return context.json(dependencies.rowToSnapshot(row));
  });

  app.put("/api/control/:eventId/assist-claims/:aircraftId", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (!isOperationalActor(actor)) return context.json(unauthorizedResponse(), 403);

    const target = new URL(context.req.url);
    target.pathname = `/internal/events/${encodeURIComponent(eventId)}/assist-claims/${encodeURIComponent(context.req.param("aircraftId"))}`;
    const body = await context.req.json().catch(() => ({ action: "ACQUIRE_OR_RENEW" }));
    const response = await coordinatorStub(context.env, eventId, eventCoordinatorNamespace).fetch(
      new Request(target, {
        method: "PUT",
        headers: operatorHeaders(actor, "application/json"),
        body: JSON.stringify(body),
      }),
    );
    return new Response(response.body, response);
  });

  app.delete("/api/control/:eventId/assist-claims/:aircraftId", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (!isOperationalActor(actor)) return context.json(unauthorizedResponse(), 403);

    const target = new URL(context.req.url);
    target.pathname = `/internal/events/${encodeURIComponent(eventId)}/assist-claims/${encodeURIComponent(context.req.param("aircraftId"))}`;
    const response = await coordinatorStub(context.env, eventId, eventCoordinatorNamespace).fetch(
      new Request(target, { method: "DELETE", headers: operatorHeaders(actor) }),
    );
    return new Response(response.body, response);
  });

  app.post("/api/control/:eventId/dispatch-recommendation-leases", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (!isOperationalActor(actor)) return context.json(unauthorizedResponse(), 403);

    const target = new URL(context.req.url);
    target.pathname = `/internal/events/${encodeURIComponent(eventId)}/dispatch-recommendation-leases`;
    const body: unknown = await context.req.json().catch(() => null);
    const response = await coordinatorStub(context.env, eventId, eventCoordinatorNamespace).fetch(
      new Request(target, {
        method: "POST",
        headers: operatorHeaders(actor, "application/json"),
        body: JSON.stringify(body),
      }),
    );
    return new Response(response.body, response);
  });

  app.delete("/api/control/:eventId/dispatch-recommendation-leases/:leaseId", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (!isOperationalActor(actor)) return context.json(unauthorizedResponse(), 403);

    const target = new URL(context.req.url);
    target.pathname = `/internal/events/${encodeURIComponent(eventId)}/dispatch-recommendation-leases/${encodeURIComponent(context.req.param("leaseId"))}`;
    const response = await coordinatorStub(context.env, eventId, eventCoordinatorNamespace).fetch(
      new Request(target, { method: "DELETE", headers: operatorHeaders(actor) }),
    );
    return new Response(response.body, response);
  });
}
