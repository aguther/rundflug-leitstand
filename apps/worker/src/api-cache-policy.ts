import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

export function registerApiCachePolicy(app: WorkerApp): void {
  app.use("/api/*", async (context, next) => {
    await next();
    context.header("cache-control", "no-store");
  });
}
