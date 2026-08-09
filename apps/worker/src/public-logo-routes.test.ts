import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import { registerPublicLogoRoutes } from "./public-logo-routes";
import type { Env } from "./types";

function createApp(input?: {
  event?: Record<string, unknown> | null;
  objects?: Record<string, { body: string }>;
}) {
  const bindings: unknown[][] = [];
  const prepare = vi.fn(() => ({
    bind: (...values: unknown[]) => {
      bindings.push(values);
      return { first: async () => input?.event ?? null };
    },
  }));
  const get = vi.fn(async (key: string) => input?.objects?.[key] ?? null);
  const env = { DB: { prepare }, BACKUPS: { get } } as unknown as Env;
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerPublicLogoRoutes(app);
  return { app, env, prepare, bindings, get };
}

function eventLogos(overrides?: Record<string, unknown>) {
  return {
    logo_object_key: "event-logos/event-1/light.svg",
    logo_media_type: "image/svg+xml",
    logo_dark_object_key: "event-logos/event-1/dark.png",
    logo_dark_media_type: "image/png",
    ...overrides,
  };
}

describe("public event logo route", () => {
  it("rejects an invalid theme without reading D1 or R2", async () => {
    const { app, env, prepare, get } = createApp();

    const response = await app.request(
      "https://worker.test/api/public/events/event-1/logo?theme=contrast",
      {},
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EVENT_LOGO_THEME_INVALID" },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("returns an unknown event without reading R2", async () => {
    const { app, env, bindings, get } = createApp({ event: null });

    const response = await app.request(
      "https://worker.test/api/public/events/event-1/logo?theme=light",
      {},
      env,
    );

    expect(response.status).toBe(404);
    expect(bindings).toEqual([["event-1"]]);
    expect(get).not.toHaveBeenCalled();
  });

  it("delivers the requested variant with bounded public caching and security headers", async () => {
    const lightKey = "event-logos/event-1/light.svg";
    const { app, env, get } = createApp({
      event: eventLogos(),
      objects: { [lightKey]: { body: "<svg></svg>" } },
    });

    const response = await app.request(
      "https://worker.test/api/public/events/event-1/logo?theme=light",
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("<svg></svg>");
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-event-logo-theme")).toBe("light");
    expect(get).toHaveBeenCalledWith(lightKey);
  });

  it("falls back to the opposite stored variant when the requested object is unavailable", async () => {
    const lightKey = "event-logos/event-1/light.svg";
    const darkKey = "event-logos/event-1/dark.png";
    const { app, env, get } = createApp({
      event: eventLogos(),
      objects: { [darkKey]: { body: "synthetic-png" } },
    });

    const response = await app.request(
      "https://worker.test/api/public/events/event-1/logo?theme=light",
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("synthetic-png");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-event-logo-theme")).toBe("dark");
    expect(get).toHaveBeenNthCalledWith(1, lightKey);
    expect(get).toHaveBeenNthCalledWith(2, darkKey);
  });

  it("returns not found when neither theme has a stored object", async () => {
    const { app, env, get } = createApp({ event: eventLogos(), objects: {} });

    const response = await app.request(
      "https://worker.test/api/public/events/event-1/logo?theme=dark",
      {},
      env,
    );

    expect(response.status).toBe(404);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
