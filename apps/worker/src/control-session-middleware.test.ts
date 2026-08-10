import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import { registerControlSessionMiddleware } from "./control-session-middleware";
import type { Env } from "./types";

const displayActor: SessionActor = {
  accountId: "550e8400-e29b-41d4-a716-446655440320",
  loginCode: "DISPLAY-01",
  role: "DISPLAY",
  sessionId: "550e8400-e29b-41d4-a716-446655440321",
  deviceId: "550e8400-e29b-41d4-a716-446655440322",
};

function middlewareApp(actor: SessionActor | null) {
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
  }) as Env;
  const authorizeSession = vi.fn(async () => actor);
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerControlSessionMiddleware(app, { authorizeSession });
  app.get("/api/control/:eventId/snapshot", (context) =>
    context.json({ role: context.get("sessionActor")?.role ?? null }),
  );
  app.get("/api/control/:eventId/fids/board", (context) => context.json({ fids: true }));
  app.get("/api/control/:eventId/live", (context) => context.json({ live: true }));
  return { app, env, authorizeSession };
}

describe("control session middleware", () => {
  it("stores non-display sessions for regular control routes", async () => {
    const admin = { ...displayActor, role: "ADMIN" as const };
    const { app, env, authorizeSession } = middlewareApp(admin);
    const response = await app.request(
      "https://worker.test/api/control/synthetic-event/snapshot",
      undefined,
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: "ADMIN" });
    expect(authorizeSession).toHaveBeenCalledTimes(1);
  });

  it("restricts display accounts to FIDS routes", async () => {
    const { app, env } = middlewareApp(displayActor);
    const response = await app.request(
      "https://worker.test/api/control/synthetic-event/snapshot",
      undefined,
      env,
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SESSION_NOT_AUTHORIZED" },
    });
  });

  it("lets FIDS routes perform their own authorization", async () => {
    const { app, env, authorizeSession } = middlewareApp(displayActor);
    const response = await app.request(
      "https://worker.test/api/control/synthetic-event/fids/board",
      undefined,
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ fids: true });
    expect(authorizeSession).not.toHaveBeenCalled();
  });

  it("lets the live transport perform its own authorization for display accounts", async () => {
    const { app, env, authorizeSession } = middlewareApp(displayActor);
    const response = await app.request(
      "https://worker.test/api/control/synthetic-event/live",
      undefined,
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ live: true });
    expect(authorizeSession).not.toHaveBeenCalled();
  });
});
