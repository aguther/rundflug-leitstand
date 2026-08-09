import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import { loadDevices } from "./device-read-service";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeDevice,
  loadDevices,
};

export type DeviceRouteDependencies = typeof defaultDependencies;

export function registerDeviceRoutes(
  app: WorkerApp,
  dependencies: DeviceRouteDependencies = defaultDependencies,
): void {
  app.get("/api/control/:eventId/devices", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (device?.role !== "ADMIN") {
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

    return context.json({ devices: await dependencies.loadDevices(context.env.DB, eventId) });
  });
}
