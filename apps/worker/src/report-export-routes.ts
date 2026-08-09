import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import {
  generateDailyReportCsv,
  generateDailyReportPdf,
  generateTicketExportCsv,
  loadPerformanceProfile,
} from "./report-export-service";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeDevice,
  generateDailyReportCsv,
  generateDailyReportPdf,
  generateTicketExportCsv,
  loadPerformanceProfile,
};

export type ReportExportRouteDependencies = typeof defaultDependencies;

function unauthorizedResponse() {
  return {
    error: {
      code: "SESSION_NOT_AUTHORIZED",
      message: "Sitzung für diese Ansicht nicht berechtigt.",
    },
  };
}

function eventNotFoundResponse() {
  return { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } };
}

export function registerReportExportRoutes(
  app: WorkerApp,
  dependencies: ReportExportRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/reports/daily.csv", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (!device || !["ADMIN", "CASHIER"].includes(device.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const result = await dependencies.generateDailyReportCsv(context.env.DB, eventId);
    if (result.status === "EVENT_NOT_FOUND") {
      return context.json(eventNotFoundResponse(), 404);
    }
    return new Response(result.body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tagesbericht-${eventId}.csv"`,
        "cache-control": "no-store",
      },
    });
  });

  app.get("/api/control/:eventId/exports/performance-profile.json", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (!device || !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const result = await dependencies.loadPerformanceProfile(context.env.DB, eventId);
    if (result.status === "EVENT_NOT_FOUND") {
      return context.json(eventNotFoundResponse(), 404);
    }
    return context.json(result.body, 200, {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="leistungsprofil-${eventId}.json"`,
    });
  });

  app.get("/api/control/:eventId/exports/tickets.csv", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (!device || !["ADMIN", "CASHIER", "FLIGHT_DIRECTOR"].includes(device.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const csv = await dependencies.generateTicketExportCsv(context.env.DB, eventId);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rohdaten-tickets-${eventId}.csv"`,
        "cache-control": "no-store",
      },
    });
  });

  app.get("/api/control/:eventId/reports/daily.pdf", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (!device || !["ADMIN", "CASHIER", "FLIGHT_DIRECTOR"].includes(device.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const result = await dependencies.generateDailyReportPdf(context.env.DB, eventId);
    if (result.status === "EVENT_NOT_FOUND") {
      return context.json(eventNotFoundResponse(), 404);
    }
    return new Response(
      result.body.buffer.slice(
        result.body.byteOffset,
        result.body.byteOffset + result.body.byteLength,
      ) as ArrayBuffer,
      {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="tagesbericht-${eventId}.pdf"`,
          "cache-control": "no-store",
        },
      },
    );
  });
}
