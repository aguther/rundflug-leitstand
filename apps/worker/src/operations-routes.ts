import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import { loadOperationsReadModels } from "./operations-read-service";
import { buildOperationsResponse } from "./operations-response-projector";
import type { Env, StoredEventRow } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeDevice,
  loadOperationsReadModels,
  nowIso: () => new Date().toISOString(),
  nowMs: () => Date.now(),
  performanceNow: () => performance.now(),
};

export type OperationsRouteDependencies = typeof defaultDependencies;

export function registerOperationsRoutes(
  app: WorkerApp,
  dependencies: OperationsRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/operations", async (context) => {
    const requestStartedAt = dependencies.performanceNow();
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(
      context.env,
      eventId,
      context.req.raw,
      context.get("sessionActor"),
    );
    if (!device || device.role === "DISPLAY") {
      return context.json(
        {
          error: {
            code: "SESSION_NOT_AUTHORIZED",
            message: "Sitzung für diese Ansicht nicht berechtigt.",
          },
        },
        403,
      );
    }

    const eventRow = await context.env.DB.prepare(
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
         FROM operation_days WHERE id = ?1`,
    )
      .bind(eventId)
      .first<StoredEventRow>();
    if (!eventRow) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    const projectionReadAt = dependencies.nowIso();

    const loadReadModels = dependencies.loadOperationsReadModels;
    const readModels = await loadReadModels(context.env.DB, eventId, projectionReadAt);
    const response = context.json(
      buildOperationsResponse({
        eventId,
        eventRow,
        device,
        readModels,
        forecastReadAt: dependencies.nowIso(),
        nowMs: dependencies.nowMs(),
      }),
    );
    response.headers.set(
      "server-timing",
      `operations;dur=${(dependencies.performanceNow() - requestStartedAt).toFixed(1)}`,
    );
    return response;
  });
}
