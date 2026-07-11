import { APP_NAME, REQUIREMENTS_VERSION } from "@rundflug/config";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
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
