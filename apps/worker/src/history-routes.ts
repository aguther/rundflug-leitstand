import {
  forecastHistoryQuerySchema,
  operationalHistoryQuerySchema,
  resourceDayHistoryQuerySchema,
} from "@rundflug/contracts";
import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import {
  loadAuditHistory,
  loadForecastHistory,
  loadOperationalHistory,
  loadResourceDayHistory,
} from "./history-service";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeDevice,
  loadAuditHistory,
  loadForecastHistory,
  loadOperationalHistory,
  loadResourceDayHistory,
};

export type HistoryRouteDependencies = typeof defaultDependencies;

function unauthorizedResponse() {
  return {
    error: {
      code: "SESSION_NOT_AUTHORIZED",
      message: "Sitzung für diese Ansicht nicht berechtigt.",
    },
  };
}

async function isAuthorized(
  dependencies: HistoryRouteDependencies,
  env: Env,
  eventId: string,
  request: Request,
): Promise<boolean> {
  const device = await dependencies.authorizeDevice(env, eventId, request);
  return Boolean(device && ["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role));
}

export function registerHistoryRoutes(
  app: WorkerApp,
  dependencies: HistoryRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/history", async (context) => {
    const eventId = context.req.param("eventId");
    if (!(await isAuthorized(dependencies, context.env, eventId, context.req.raw))) {
      return context.json(unauthorizedResponse(), 403);
    }
    return context.json(
      await dependencies.loadAuditHistory(context.env.DB, eventId, {
        eventType: context.req.query("eventType"),
        aggregateType: context.req.query("aggregateType"),
        aggregateId: context.req.query("aggregateId"),
        deviceId: context.req.query("deviceId"),
        since: context.req.query("since"),
        until: context.req.query("until"),
        limit: context.req.query("limit"),
      }),
    );
  });

  app.get("/api/control/:eventId/history/operations", async (context) => {
    const eventId = context.req.param("eventId");
    if (!(await isAuthorized(dependencies, context.env, eventId, context.req.raw))) {
      return context.json(unauthorizedResponse(), 403);
    }
    const parsedQuery = operationalHistoryQuerySchema.safeParse({
      ticketId: context.req.query("ticketId"),
      ticketGroupId: context.req.query("ticketGroupId"),
      rotationId: context.req.query("rotationId"),
      flightGroupId: context.req.query("flightGroupId"),
      aircraftId: context.req.query("aircraftId"),
      pilotId: context.req.query("pilotId"),
      productId: context.req.query("productId"),
      resourceGroupId: context.req.query("resourceGroupId"),
      gateId: context.req.query("gateId"),
      communicationNumber: context.req.query("communicationNumber"),
      ticketStatus: context.req.query("ticketStatus"),
      rotationStatus: context.req.query("rotationStatus"),
      since: context.req.query("since"),
      until: context.req.query("until"),
      limit: context.req.query("limit"),
      offset: context.req.query("offset"),
    });
    if (!parsedQuery.success) {
      return context.json(
        {
          error: {
            code: "HISTORY_FILTERS_INVALID",
            message: "Die Historienfilter sind ungültig.",
          },
        },
        400,
      );
    }
    return context.json(
      await dependencies.loadOperationalHistory(context.env.DB, eventId, parsedQuery.data),
    );
  });

  app.get("/api/control/:eventId/history/forecasts", async (context) => {
    const eventId = context.req.param("eventId");
    if (!(await isAuthorized(dependencies, context.env, eventId, context.req.raw))) {
      return context.json(unauthorizedResponse(), 403);
    }
    const parsedQuery = forecastHistoryQuerySchema.safeParse({
      rotationId: context.req.query("rotationId"),
      aircraftId: context.req.query("aircraftId"),
      pilotId: context.req.query("pilotId"),
      since: context.req.query("since"),
      until: context.req.query("until"),
      limit: context.req.query("limit"),
      offset: context.req.query("offset"),
    });
    if (!parsedQuery.success) {
      return context.json(
        {
          error: {
            code: "FORECAST_FILTERS_INVALID",
            message: "Die Prognosefilter sind ungültig.",
          },
        },
        400,
      );
    }
    return context.json(
      await dependencies.loadForecastHistory(context.env.DB, eventId, parsedQuery.data),
    );
  });

  app.get("/api/control/:eventId/history/resources", async (context) => {
    const eventId = context.req.param("eventId");
    if (!(await isAuthorized(dependencies, context.env, eventId, context.req.raw))) {
      return context.json(unauthorizedResponse(), 403);
    }
    const parsedQuery = resourceDayHistoryQuerySchema.safeParse({
      scopeType: context.req.query("scopeType"),
      scopeId: context.req.query("scopeId"),
    });
    if (!parsedQuery.success) {
      return context.json(
        {
          error: {
            code: "RESOURCE_HISTORY_FILTERS_INVALID",
            message: "Die Ressourcenfilter sind ungültig.",
          },
        },
        400,
      );
    }
    const result = await dependencies.loadResourceDayHistory(
      context.env.DB,
      eventId,
      parsedQuery.data,
    );
    if (result.status === "EVENT_NOT_FOUND") {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    if (result.status === "RESOURCE_NOT_FOUND") {
      return context.json(
        { error: { code: "RESOURCE_NOT_FOUND", message: "Ressource nicht gefunden." } },
        404,
      );
    }
    return context.json(result.history);
  });
}
