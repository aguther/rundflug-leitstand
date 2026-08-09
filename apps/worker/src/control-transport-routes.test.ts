import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import {
  type ControlTransportRouteDependencies,
  registerControlTransportRoutes,
} from "./control-transport-routes";
import type { Env } from "./types";

const EVENT_ID = "synthetic event";

const sessionActor: SessionActor = {
  accountId: "550e8400-e29b-41d4-a716-446655440380",
  loginCode: "FLIGHT-LINE-01",
  role: "FLIGHT_LINE",
  sessionId: "550e8400-e29b-41d4-a716-446655440381",
  deviceId: "550e8400-e29b-41d4-a716-446655440382",
};

function createRouteApp(input?: {
  appEnv?: Env["APP_ENV"];
  liveActor?: SessionActor | null;
  commandActor?: SessionActor | null;
  upstreamResponse?: () => Response;
}) {
  const env = Object.assign(Object.create(null), {
    APP_ENV: input?.appEnv ?? "production",
    DATA_JURISDICTION: "eu",
  }) as Env;
  const authorizeSession = vi.fn(async () =>
    input && "liveActor" in input ? (input.liveActor ?? null) : sessionActor,
  );
  let forwardedRequest: Request | null = null;
  const stub = {
    fetch: vi.fn(async (request: Request) => {
      forwardedRequest = request;
      return (
        input?.upstreamResponse?.() ??
        Response.json({ forwarded: true }, { status: 202, headers: { "x-upstream": "preserved" } })
      );
    }),
  };
  const namespace = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => stub),
  };
  const eventCoordinatorNamespace = vi.fn(() => namespace as never);
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  app.use("*", async (context, next) => {
    context.set(
      "sessionActor",
      input && "commandActor" in input ? (input.commandActor ?? null) : sessionActor,
    );
    await next();
  });
  registerControlTransportRoutes(app, eventCoordinatorNamespace, {
    authorizeSession,
  } as ControlTransportRouteDependencies);
  return {
    app,
    env,
    authorizeSession,
    eventCoordinatorNamespace,
    namespace,
    stub,
    forwardedRequest: () => forwardedRequest,
  };
}

describe("control transport routes", () => {
  it("requires a production session before accessing the live coordinator", async () => {
    const route = createRouteApp({ liveActor: null });
    const response = await route.app.request(
      `https://worker.test/api/control/${encodeURIComponent(EVENT_ID)}/live`,
      undefined,
      route.env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "SESSION_REQUIRED", message: "Anmeldung erforderlich." },
    });
    expect(route.eventCoordinatorNamespace).not.toHaveBeenCalled();
    expect(route.stub.fetch).not.toHaveBeenCalled();
  });

  it.each(["production", "development"] as const)(
    "forwards an allowed live request unchanged in %s",
    async (appEnv) => {
      const route = createRouteApp({
        appEnv,
        liveActor: appEnv === "development" ? null : sessionActor,
      });
      const response = await route.app.request(
        `https://worker.test/api/control/${encodeURIComponent(EVENT_ID)}/live?transport=poll`,
        { headers: { "x-synthetic-client": "flight-line-1" } },
        route.env,
      );

      expect(response.status).toBe(202);
      expect(response.headers.get("x-upstream")).toBe("preserved");
      await expect(response.json()).resolves.toEqual({ forwarded: true });
      expect(route.authorizeSession).toHaveBeenCalledWith(route.env, expect.any(Request));
      expect(route.eventCoordinatorNamespace).toHaveBeenCalledWith(route.env);
      expect(route.namespace.idFromName).toHaveBeenCalledWith(EVENT_ID);
      const forwarded = route.forwardedRequest();
      expect(forwarded?.url).toBe(
        `https://worker.test/api/control/${encodeURIComponent(EVENT_ID)}/live?transport=poll`,
      );
      expect(forwarded?.headers.get("x-synthetic-client")).toBe("flight-line-1");
    },
  );

  it("requires a production session before accessing the command coordinator", async () => {
    const route = createRouteApp({ commandActor: null });
    const response = await route.app.request(
      `https://worker.test/api/control/${encodeURIComponent(EVENT_ID)}/commands`,
      { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
      route.env,
    );

    expect(response.status).toBe(401);
    expect(route.eventCoordinatorNamespace).not.toHaveBeenCalled();
    expect(route.stub.fetch).not.toHaveBeenCalled();
  });

  it("preserves the legacy development command transport", async () => {
    const route = createRouteApp({ appEnv: "development", commandActor: null });
    const body = JSON.stringify({ type: "SYNTHETIC_COMMAND", deviceId: "legacy-device" });
    const response = await route.app.request(
      `https://worker.test/api/control/${encodeURIComponent(EVENT_ID)}/commands?source=local`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-id": "legacy-device",
          "x-device-token": "synthetic-token",
        },
        body,
      },
      route.env,
    );

    expect(response.status).toBe(202);
    const forwarded = route.forwardedRequest();
    expect(forwarded?.url).toBe(
      `https://worker.test/internal/events/${encodeURIComponent(EVENT_ID)}/command?source=local`,
    );
    expect(forwarded?.headers.get("x-device-id")).toBe("legacy-device");
    expect(forwarded?.headers.get("x-device-token")).toBe("synthetic-token");
    await expect(forwarded?.text()).resolves.toBe(body);
  });

  it("rejects an invalid authenticated command before coordinator access", async () => {
    const route = createRouteApp();
    const response = await route.app.request(
      `https://worker.test/api/control/${encodeURIComponent(EVENT_ID)}/commands`,
      { method: "POST", body: "{", headers: { "content-type": "application/json" } },
      route.env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_COMMAND", message: "Kommando ist ungültig." },
    });
    expect(route.stub.fetch).not.toHaveBeenCalled();
  });

  it("replaces untrusted command origins with the authenticated session", async () => {
    const route = createRouteApp({
      upstreamResponse: () =>
        new Response("accepted", {
          status: 207,
          headers: { "content-type": "text/plain", "x-upstream": "custom" },
        }),
    });
    const response = await route.app.request(
      `https://worker.test/api/control/${encodeURIComponent(EVENT_ID)}/commands?source=browser`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-id": "spoofed-device",
          "x-device-token": "spoofed-token",
          "x-operator-account-id": "spoofed-account",
          "x-operator-login-code": "spoofed-login",
          "x-operator-session-id": "spoofed-session",
          "x-operator-role": "ADMIN",
          "x-operator-device-id": "spoofed-operator-device",
          "x-synthetic-client": "flight-line-1",
        },
        body: JSON.stringify({
          type: "SYNTHETIC_COMMAND",
          commandId: "command-a",
          deviceId: "spoofed-body-device",
        }),
      },
      route.env,
    );

    expect(response.status).toBe(207);
    expect(response.headers.get("x-upstream")).toBe("custom");
    await expect(response.text()).resolves.toBe("accepted");
    const forwarded = route.forwardedRequest();
    expect(forwarded?.url).toBe(
      `https://worker.test/internal/events/${encodeURIComponent(EVENT_ID)}/command?source=browser`,
    );
    expect(forwarded?.method).toBe("POST");
    expect(forwarded?.headers.get("content-type")).toBe("application/json");
    expect(forwarded?.headers.get("x-device-id")).toBeNull();
    expect(forwarded?.headers.get("x-device-token")).toBeNull();
    expect(forwarded?.headers.get("x-operator-account-id")).toBe(sessionActor.accountId);
    expect(forwarded?.headers.get("x-operator-login-code")).toBe(sessionActor.loginCode);
    expect(forwarded?.headers.get("x-operator-session-id")).toBe(sessionActor.sessionId);
    expect(forwarded?.headers.get("x-operator-role")).toBe(sessionActor.role);
    expect(forwarded?.headers.get("x-operator-device-id")).toBe(sessionActor.deviceId);
    expect(forwarded?.headers.get("x-synthetic-client")).toBe("flight-line-1");
    await expect(forwarded?.json()).resolves.toEqual({
      type: "SYNTHETIC_COMMAND",
      commandId: "command-a",
      deviceId: sessionActor.deviceId,
    });
  });
});
