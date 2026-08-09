import { type GateDisplayFilter, gateDisplayFilterSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import {
  type FidsProjectionFilter,
  loadFidsProjectionEvent,
  loadFidsProjectionFleet,
  loadFidsProjectionRows,
} from "./fids-board-projection";
import { mapFidsProjectionRow } from "./fids-board-response";
import {
  EMPTY_GATE_DISPLAY_FILTER_JSON,
  withGateDisplayFilterFallback,
} from "./gate-display-filter-storage";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

type CoordinatorNamespace = (env: Env) => Env["EVENT_COORDINATOR"];

const defaultDependencies = {
  loadEvent: loadFidsProjectionEvent,
  loadRows: loadFidsProjectionRows,
  loadFleet: loadFidsProjectionFleet,
};

type PublicBoardDependencies = typeof defaultDependencies;

export function registerPublicBoardRoutes(
  app: WorkerApp,
  coordinatorNamespace: CoordinatorNamespace,
  dependencies: PublicBoardDependencies = defaultDependencies,
) {
  app.get("/api/public/events/:eventId/board", async (context) => {
    const requestStartedAt = performance.now();
    const eventId = context.req.param("eventId");
    const requestedGateId = context.req.query("gateId")?.trim() || null;
    const event = await dependencies.loadEvent(context.env.DB, eventId);
    if (!event) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    const selectedGate = requestedGateId
      ? await withGateDisplayFilterFallback((mode) => {
          const displayFilterProjection =
            mode === "current"
              ? "display_filter_json"
              : `'${EMPTY_GATE_DISPLAY_FILTER_JSON}' AS display_filter_json`;
          return context.env.DB.prepare(
            `SELECT id, label, ${displayFilterProjection} FROM gates
              WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
          )
            .bind(requestedGateId, eventId)
            .first<{ id: string; label: string; display_filter_json: string }>();
        })
      : null;
    if (requestedGateId && !selectedGate) {
      return context.json(
        { error: { code: "GATE_NOT_FOUND", message: "Anzeige-Gate nicht gefunden." } },
        404,
      );
    }
    const displayFilter: GateDisplayFilter = selectedGate
      ? gateDisplayFilterSchema.parse(JSON.parse(selectedGate.display_filter_json))
      : { productIds: [], rotationStatuses: [] };
    const boardReadAt = new Date().toISOString();
    const departedVisibilityCutoff = new Date(
      Date.now() - event.departed_visibility_seconds * 1_000,
    ).toISOString();
    const projectionFilter: FidsProjectionFilter = {
      productIds: displayFilter.productIds,
      gateIds: requestedGateId ? [requestedGateId] : [],
      rotationStatuses: displayFilter.rotationStatuses,
    };
    const rows =
      event.emergency_mode === 1
        ? []
        : await dependencies.loadRows(context.env.DB, {
            eventId,
            filter: projectionFilter,
            departedVisibilityCutoff,
            now: boardReadAt,
            band: "ALL",
            limit: 20,
            offset: 0,
          });
    const fleet =
      event.emergency_mode === 1 ? [] : await dependencies.loadFleet(context.env.DB, eventId);
    const response = context.json({
      eventName: event.name,
      timeZone: event.time_zone,
      selectedGate: selectedGate
        ? { id: selectedGate.id, label: selectedGate.label, displayFilter }
        : null,
      emergencyMode: event.emergency_mode === 1,
      operationalInterrupted: event.operational_interrupted === 1,
      operationalNotice: event.planned_public_note || event.operational_note,
      departedVisibilitySeconds: event.departed_visibility_seconds,
      updatedAt: event.updated_at,
      groups: rows.map((row) => {
        const {
          rowId: _rowId,
          productId: _productId,
          gateId: _gateId,
          bookingGroupLabels: _bookingGroupLabels,
          sharedFlightKey: _sharedFlightKey,
          ...group
        } = mapFidsProjectionRow(row, event, boardReadAt);
        return group;
      }),
      fleet: event.emergency_mode
        ? []
        : fleet.map((aircraft) => ({
            registration: aircraft.registration,
            status: aircraft.operational_state,
            refuelPlanned: aircraft.refuel_planned === 1,
          })),
    });
    response.headers.set(
      "server-timing",
      `public-board;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
    );
    return response;
  });

  app.all("/api/public/events/:eventId/live", async (context) => {
    const eventId = context.req.param("eventId");
    const namespace = coordinatorNamespace(context.env);
    const stub = namespace.get(namespace.idFromName(eventId));
    const response = await stub.fetch(context.req.raw);
    return new Response(response.body, response);
  });
}
