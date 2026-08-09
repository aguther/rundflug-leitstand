import type { Hono } from "hono";
import { authorizeSession, type SessionActor } from "./auth";
import { mayAccessFids } from "./fids-authorization";
import { buildProtectedFidsBoard } from "./fids-board-service";
import { loadFidsFilterOptions } from "./fids-filter-options-service";
import { loadFidsPreferences } from "./fids-preferences-storage";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

type EventCoordinatorNamespaceResolver = (env: Env) => Env["EVENT_COORDINATOR"];

const defaultDependencies = {
  authorizeSession,
  buildProtectedFidsBoard,
  loadFidsFilterOptions,
  loadFidsPreferences,
  mayAccessFids,
  performanceNow: () => performance.now(),
};

type FidsControlRouteDependencies = typeof defaultDependencies;

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

export function registerFidsControlRoutes(
  app: WorkerApp,
  eventCoordinatorNamespace: EventCoordinatorNamespaceResolver,
  dependencies: FidsControlRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/fids/preferences", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (!actor || !dependencies.mayAccessFids(actor.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const event = await context.env.DB.prepare("SELECT id FROM operation_days WHERE id = ?1")
      .bind(eventId)
      .first<{ id: string }>();
    if (!event) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    return context.json(
      await dependencies.loadFidsPreferences(context.env.DB, actor.accountId, eventId),
    );
  });

  app.put("/api/control/:eventId/fids/preferences", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (!actor || !dependencies.mayAccessFids(actor.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const namespace = eventCoordinatorNamespace(context.env);
    const stub = namespace.get(namespace.idFromName(eventId));
    const target = new URL(context.req.url);
    target.pathname = `/internal/events/${encodeURIComponent(eventId)}/fids/preferences`;
    const body = await context.req.text();
    const response = await stub.fetch(
      new Request(target, {
        method: "PUT",
        headers: operatorHeaders(actor, "application/json"),
        body,
      }),
    );
    return new Response(response.body, response);
  });

  app.get("/api/control/:eventId/fids/filter-options", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (!actor || !dependencies.mayAccessFids(actor.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const event = await context.env.DB.prepare("SELECT id FROM operation_days WHERE id = ?1")
      .bind(eventId)
      .first<{ id: string }>();
    if (!event) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    return context.json(await dependencies.loadFidsFilterOptions(context.env.DB, eventId));
  });

  app.get("/api/control/:eventId/fids/board", async (context) => {
    const requestStartedAt = dependencies.performanceNow();
    const eventId = context.req.param("eventId");
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (!actor || !dependencies.mayAccessFids(actor.role)) {
      return context.json(unauthorizedResponse(), 403);
    }
    const board = await dependencies.buildProtectedFidsBoard(context.env.DB, {
      eventId,
      accountId: actor.accountId,
      page: context.req.query("page"),
      lowerPage: context.req.query("lowerPage"),
    });
    if (!board) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    const response = context.json(board);
    response.headers.set(
      "server-timing",
      `fids-board;dur=${(dependencies.performanceNow() - requestStartedAt).toFixed(1)}`,
    );
    return response;
  });
}
