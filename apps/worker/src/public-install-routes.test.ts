import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import { registerPublicInstallRoutes } from "./public-install-routes";
import type { Env } from "./types";

function createApp(row: { product_code: string; communication_number: number } | null) {
  const first = vi.fn(async () => row);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  const assetsFetch = vi.fn(async () => new Response("asset fallback", { status: 200 }));
  const env = {
    DB: { prepare },
    ASSETS: { fetch: assetsFetch },
  } as unknown as Env;
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerPublicInstallRoutes(app);
  return { app, env, prepare, bind, first, assetsFetch };
}

describe("public install routes", () => {
  it("rejects invalid manifest targets without a database lookup", async () => {
    const { app, env, prepare } = createApp(null);

    const response = await app.request(
      "https://worker.test/api/public/pwa-manifest/unknown/INVALID",
      undefined,
      env,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: { code: "PUBLIC_TARGET_NOT_FOUND", message: "Statusseite nicht gefunden." },
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("builds a private ticket manifest from the resolved communication label", async () => {
    const { app, env, prepare, bind, first } = createApp({
      product_code: "PAN20",
      communication_number: 8021,
    });

    const response = await app.request(
      "https://worker.test/api/public/pwa-manifest/ticket/RECALLTICKETA22",
      undefined,
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    await expect(response.json()).resolves.toMatchObject({
      id: "/ticket/RECALLTICKETA22",
      start_url: "/ticket/RECALLTICKETA22",
      name: "G-PAN20-8021",
      short_name: "G-PAN20-8021",
      display: "standalone",
      icons: [
        { src: "/icons/pwa/ticket/icon-192.png", purpose: "any" },
        { src: "/icons/pwa/ticket/icon-512.png", purpose: "any" },
        { src: "/icons/pwa/ticket/maskable-192.png", purpose: "maskable" },
        { src: "/icons/pwa/ticket/maskable-512.png", purpose: "maskable" },
      ],
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("uses the asset fallback for malformed public status paths", async () => {
    const { app, env, assetsFetch, prepare } = createApp(null);

    const response = await app.request("https://worker.test/ticket/not-valid", undefined, env);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("asset fallback");
    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
  });
});
