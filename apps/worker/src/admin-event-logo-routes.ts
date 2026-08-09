import type { Context, Hono } from "hono";
import {
  type EventLogoMutationResult,
  type EventLogoRemoveResponse,
  type EventLogoSetResponse,
  removeAdminEventLogo,
  setAdminEventLogo,
} from "./admin-event-logo-service";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import { parseEventLogoTheme, readEventLogoBytes, validateEventLogo } from "./event-logo";
import type { Env } from "./types";

type WorkerEnvironment = {
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
};

type WorkerApp = Hono<WorkerEnvironment>;

const defaultDependencies = {
  authorizeDevice,
  parseEventLogoTheme,
  readEventLogoBytes,
  removeAdminEventLogo,
  setAdminEventLogo,
  validateEventLogo,
};

type AdminEventLogoRouteDependencies = typeof defaultDependencies;

function invalidCommandResponse() {
  return {
    error: { code: "INVALID_COMMAND", message: "Kommando-ID oder Version fehlt." },
  };
}

function mapMutationResult<TBody>(
  context: Context<WorkerEnvironment>,
  result: EventLogoMutationResult<TBody>,
) {
  switch (result.status) {
    case 400:
      return context.json(result.body, 400);
    case 404:
      return context.json(result.body, 404);
    case 409:
      return context.json(result.body, 409);
    default:
      return context.json(result.body);
  }
}

export function registerAdminEventLogoRoutes(
  app: WorkerApp,
  dependencies: AdminEventLogoRouteDependencies = defaultDependencies,
): void {
  app.put("/api/admin/events/:eventId/logo", async (context) => {
    const eventId = context.req.param("eventId");
    const theme = dependencies.parseEventLogoTheme(context.req.query("theme") ?? null);
    if (!theme) {
      return context.json(
        { error: { code: "EVENT_LOGO_THEME_INVALID", message: "Logo-Theme ist ungültig." } },
        400,
      );
    }
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (device?.role !== "ADMIN") {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    const expectedVersion = Number(context.req.header("x-expected-version"));
    const commandId = context.req.header("x-command-id")?.trim();
    if (!commandId || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return context.json(invalidCommandResponse(), 400);
    }
    const result = await dependencies.setAdminEventLogo(context.env, {
      eventId,
      deviceId: device.id,
      commandId,
      expectedVersion,
      theme,
      loadUpload: async () => {
        const bytes = await dependencies.readEventLogoBytes(context.req.raw);
        return {
          bytes,
          mediaType: dependencies.validateEventLogo(
            bytes,
            context.req.header("content-type") ?? null,
          ),
        };
      },
    });
    return mapMutationResult<EventLogoSetResponse>(context, result);
  });

  app.delete("/api/admin/events/:eventId/logo", async (context) => {
    const eventId = context.req.param("eventId");
    const theme = dependencies.parseEventLogoTheme(context.req.query("theme") ?? null);
    if (!theme) {
      return context.json(
        { error: { code: "EVENT_LOGO_THEME_INVALID", message: "Logo-Theme ist ungültig." } },
        400,
      );
    }
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (device?.role !== "ADMIN") {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    const expectedVersion = Number(context.req.header("x-expected-version"));
    const commandId = context.req.header("x-command-id")?.trim();
    if (!commandId || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return context.json(invalidCommandResponse(), 400);
    }
    const result = await dependencies.removeAdminEventLogo(context.env, {
      eventId,
      deviceId: device.id,
      commandId,
      expectedVersion,
      theme,
    });
    return mapMutationResult<EventLogoRemoveResponse>(context, result);
  });
}
