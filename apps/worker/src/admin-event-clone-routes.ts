import { cloneEventRequestSchema } from "@rundflug/contracts";
import type { Hono } from "hono";
import { cloneAdminEvent } from "./admin-event-clone-service";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeDevice,
  cloneAdminEvent,
};

type AdminEventCloneRouteDependencies = typeof defaultDependencies;

export function registerAdminEventCloneRoutes(
  app: WorkerApp,
  dependencies: AdminEventCloneRouteDependencies = defaultDependencies,
): void {
  app.post("/api/admin/events/:sourceEventId/clone", async (context) => {
    const sourceEventId = context.req.param("sourceEventId");
    const sourceAdmin = await dependencies.authorizeDevice(
      context.env,
      sourceEventId,
      context.req.raw,
    );
    if (sourceAdmin?.role !== "ADMIN") {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }

    const parsed = cloneEventRequestSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_EVENT", message: "Veranstaltungsdaten sind unvollständig." } },
        400,
      );
    }

    const result = await dependencies.cloneAdminEvent(
      context.env,
      sourceEventId,
      sourceAdmin.id,
      parsed.data,
    );
    switch (result.status) {
      case 201:
        return context.json(result.body, 201);
      case 404:
        return context.json(result.body, 404);
      case 409:
        return context.json(result.body, 409);
      default:
        return context.json(result.body);
    }
  });
}
