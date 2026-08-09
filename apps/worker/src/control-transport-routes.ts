import type { Hono } from "hono";
import { authorizeSession, type SessionActor } from "./auth";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

type EventCoordinatorNamespaceResolver = (env: Env) => Env["EVENT_COORDINATOR"];

const defaultDependencies = { authorizeSession };

export type ControlTransportRouteDependencies = typeof defaultDependencies;

const untrustedOperatorHeaders = [
  "x-device-id",
  "x-device-token",
  "x-operator-account-id",
  "x-operator-login-code",
  "x-operator-session-id",
  "x-operator-role",
  "x-operator-device-id",
] as const;

function sessionRequiredResponse() {
  return { error: { code: "SESSION_REQUIRED", message: "Anmeldung erforderlich." } };
}

function coordinatorStub(
  env: Env,
  eventId: string,
  eventCoordinatorNamespace: EventCoordinatorNamespaceResolver,
) {
  const namespace = eventCoordinatorNamespace(env);
  return namespace.get(namespace.idFromName(eventId));
}

function trustedCommandHeaders(request: Request, actor: SessionActor): Headers {
  const headers = new Headers(request.headers);
  for (const name of untrustedOperatorHeaders) headers.delete(name);
  headers.set("content-type", "application/json");
  headers.set("x-operator-account-id", actor.accountId);
  headers.set("x-operator-login-code", actor.loginCode);
  headers.set("x-operator-session-id", actor.sessionId);
  headers.set("x-operator-role", actor.role);
  headers.set("x-operator-device-id", actor.deviceId);
  return headers;
}

export function registerControlTransportRoutes(
  app: WorkerApp,
  eventCoordinatorNamespace: EventCoordinatorNamespaceResolver,
  dependencies: ControlTransportRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/live", async (context) => {
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    if (!actor && context.env.APP_ENV !== "development") {
      return context.json(sessionRequiredResponse(), 401);
    }
    const eventId = context.req.param("eventId");
    const response = await coordinatorStub(context.env, eventId, eventCoordinatorNamespace).fetch(
      context.req.raw,
    );
    return new Response(response.body, response);
  });

  app.post("/api/control/:eventId/commands", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = context.get("sessionActor");
    if (!actor && context.env.APP_ENV !== "development") {
      return context.json(sessionRequiredResponse(), 401);
    }
    const stub = coordinatorStub(context.env, eventId, eventCoordinatorNamespace);
    const target = new URL(context.req.url);
    target.pathname = `/internal/events/${encodeURIComponent(eventId)}/command`;
    if (!actor) {
      const response = await stub.fetch(new Request(target, context.req.raw));
      return new Response(response.body, response);
    }

    const command = (await context.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!command) {
      return context.json(
        { error: { code: "INVALID_COMMAND", message: "Kommando ist ungültig." } },
        400,
      );
    }
    const response = await stub.fetch(
      new Request(target, {
        method: "POST",
        headers: trustedCommandHeaders(context.req.raw, actor),
        body: JSON.stringify({ ...command, deviceId: actor.deviceId }),
      }),
    );
    return new Response(response.body, response);
  });
}
