import { ticketSearchRequestSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import { loadTicketGroupPrintData, searchTicketGroups } from "./ticket-read-service";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeDevice,
  loadTicketGroupPrintData,
  searchTicketGroups,
};

export type TicketReadRouteDependencies = typeof defaultDependencies;

function unauthorizedResponse() {
  return {
    error: {
      code: "SESSION_NOT_AUTHORIZED",
      message: "Sitzung für diese Ansicht nicht berechtigt.",
    },
  };
}

export function registerTicketReadRoutes(
  app: WorkerApp,
  dependencies: TicketReadRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/tickets/search", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (!device || !["CASHIER", "FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"].includes(device.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const searchParams = new URL(context.req.url).searchParams;
    const parsedRequest = ticketSearchRequestSchema.safeParse({
      q: searchParams.get("q") ?? "",
      status: searchParams.get("status") ?? "ACTIVE",
      limit: searchParams.has("limit") ? Number(searchParams.get("limit")) : 20,
      ...(searchParams.has("cursor") ? { cursor: searchParams.get("cursor") ?? "" } : {}),
      ticketGroupIds: searchParams.getAll("id"),
      ...(searchParams.has("soldByAccountId")
        ? { soldByOperatorAccountId: searchParams.get("soldByAccountId") ?? "" }
        : {}),
    });
    if (!parsedRequest.success) {
      return context.json(
        { error: { code: "INVALID_TICKET_SEARCH", message: "Ticketsuche ist ungültig." } },
        400,
      );
    }
    const result = await dependencies.searchTicketGroups(
      context.env.DB,
      eventId,
      parsedRequest.data,
    );
    if (!result.ok) {
      return context.json(
        {
          error: {
            code: "INVALID_TICKET_SEARCH_CURSOR",
            message: "Listencursor ist ungültig.",
          },
        },
        400,
      );
    }
    return context.json(result.response);
  });

  app.get("/api/control/:eventId/ticket-groups/:ticketGroupId/print-data", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (!device || !["CASHIER", "ADMIN"].includes(device.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const result = await dependencies.loadTicketGroupPrintData(
      context.env.DB,
      eventId,
      context.req.param("ticketGroupId"),
    );
    if (result.status === "NOT_FOUND") {
      return context.json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Buchungsgruppe nicht gefunden." } },
        404,
      );
    }
    if (result.status === "CANCELED") {
      return context.json(
        {
          error: {
            code: "TICKET_GROUP_CANCELED",
            message: "Stornierte Tickets werden nicht erneut ausgegeben.",
          },
        },
        409,
      );
    }
    return context.json(result.data);
  });
}
