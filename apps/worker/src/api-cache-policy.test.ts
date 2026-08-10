import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { registerApiCachePolicy } from "./api-cache-policy";
import type { Env } from "./types";

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  registerApiCachePolicy(app as never);
  app.get("/api/example", (context) => {
    context.header("cache-control", "public, max-age=3600");
    return context.json({ ok: true }, 202);
  });
  app.get("/outside", (context) => context.text("outside"));
  return app;
}

describe("operational API cache policy", () => {
  it("overrides route caching for every API response", async () => {
    const response = await createApp().request("https://worker.test/api/example");

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("does not attach the policy outside the API surface", async () => {
    const response = await createApp().request("https://worker.test/outside");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
  });
});
