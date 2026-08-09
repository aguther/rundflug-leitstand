import type { Hono } from "hono";
import { authorizeSession, type SessionActor } from "./auth";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = { authorizeSession };

type ControlSessionMiddlewareDependencies = typeof defaultDependencies;

export function registerControlSessionMiddleware(
  app: WorkerApp,
  dependencies: ControlSessionMiddlewareDependencies = defaultDependencies,
): void {
  app.use("/api/control/*", async (context, next) => {
    if (context.req.path.includes("/fids/")) {
      await next();
      return;
    }
    const actor = await dependencies.authorizeSession(context.env, context.req.raw);
    context.set("sessionActor", actor);
    if (actor?.role === "DISPLAY") {
      return context.json(
        {
          error: {
            code: "SESSION_NOT_AUTHORIZED",
            message: "Display-Konten dürfen ausschließlich die FIDS-Anzeige verwenden.",
          },
        },
        403,
      );
    }
    await next();
  });
}
