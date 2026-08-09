import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import { registerControlCoordinationRoutes } from "./control-coordination-routes";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const EVENT_ID = "synthetic-event";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440320";

const operationalActor: SessionActor = {
  accountId: ACCOUNT_ID,
  loginCode: "FLIGHT-LINE-01",
  role: "FLIGHT_LINE",
  sessionId: "550e8400-e29b-41d4-a716-446655440321",
  deviceId: "550e8400-e29b-41d4-a716-446655440322",
};

const storedEvent: StoredEventRow = {
  id: EVENT_ID,
  name: "Synthetic event",
  event_date: "2026-08-09",
  aerodrome: "EDXX",
  time_zone: "Europe/Berlin",
  status: "ACTIVE",
  emergency_mode: 0,
  operational_interrupted: 0,
  version: 7,
  operational_note: "",
  operations_start_at: "2026-08-09T08:00:00.000Z",
  operations_end_at: "2026-08-09T18:00:00.000Z",
  updated_at: "2026-08-09T10:00:00.000Z",
};

function createRouteApp(input?: {
  actor?: SessionActor | null;
  event?: StoredEventRow | null;
  upstreamResponse?: Response;
}) {
  const first = vi.fn(async () =>
    input && "event" in input ? (input.event ?? null) : storedEvent,
  );
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: { prepare } as unknown as D1Database,
  }) as Env;
  const authorizeSession = vi.fn(async () =>
    input && "actor" in input ? (input.actor ?? null) : operationalActor,
  );
  const snapshotMapper = vi.fn(rowToSnapshot);
  let forwardedRequest: Request | null = null;
  const stub = {
    fetch: vi.fn(async (request: Request) => {
      forwardedRequest = request;
      return (
        input?.upstreamResponse ??
        Response.json({ forwarded: true }, { status: 202, headers: { "x-upstream": "preserved" } })
      );
    }),
  };
  const namespace = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => stub),
  };
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerControlCoordinationRoutes(app, () => namespace as never, {
    authorizeSession,
    rowToSnapshot: snapshotMapper,
  });
  return {
    app,
    env,
    prepare,
    bind,
    first,
    authorizeSession,
    snapshotMapper,
    namespace,
    stub,
    forwardedRequest: () => forwardedRequest,
  };
}

describe("control coordination routes", () => {
  it("returns the stored event snapshot and preserves not-found behavior", async () => {
    const available = createRouteApp();
    const response = await available.app.request(
      `https://worker.test/api/control/${EVENT_ID}/snapshot`,
      undefined,
      available.env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      eventId: EVENT_ID,
      name: "Synthetic event",
      version: 7,
    });
    expect(available.prepare).toHaveBeenCalledWith(expect.stringContaining("FROM operation_days"));
    expect(available.bind).toHaveBeenCalledWith(EVENT_ID);
    expect(available.snapshotMapper).toHaveBeenCalledWith(storedEvent);

    const missing = createRouteApp({ event: null });
    const missingResponse = await missing.app.request(
      `https://worker.test/api/control/${EVENT_ID}/snapshot`,
      undefined,
      missing.env,
    );
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: { code: "EVENT_NOT_FOUND" },
    });
    expect(missing.snapshotMapper).not.toHaveBeenCalled();
  });

  it.each([null, "CASHIER", "DISPLAY"] as const)(
    "rejects the non-operational role %s before coordinator access",
    async (role) => {
      const actor = role ? { ...operationalActor, role } : null;
      const route = createRouteApp({ actor });
      const response = await route.app.request(
        `https://worker.test/api/control/${EVENT_ID}/assist-claims/aircraft-a`,
        { method: "PUT", body: "{}", headers: { "content-type": "application/json" } },
        route.env,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "SESSION_NOT_AUTHORIZED" },
      });
      expect(route.namespace.idFromName).not.toHaveBeenCalled();
      expect(route.stub.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"] as const)(
    "allows the operational role %s",
    async (role) => {
      const route = createRouteApp({ actor: { ...operationalActor, role } });
      const response = await route.app.request(
        `https://worker.test/api/control/${EVENT_ID}/assist-claims/aircraft-a`,
        { method: "PUT", body: "{}", headers: { "content-type": "application/json" } },
        route.env,
      );

      expect(response.status).toBe(202);
      expect(route.stub.fetch).toHaveBeenCalledOnce();
    },
  );

  it("forwards Assist acquisition with trusted actor headers and query parameters", async () => {
    const route = createRouteApp();
    const body = JSON.stringify({ action: "ACQUIRE_OR_RENEW", expectedVersion: 7 });
    const response = await route.app.request(
      `https://worker.test/api/control/${EVENT_ID}/assist-claims/aircraft%20one?source=browser`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-operator-account-id": "spoofed-account",
          "x-operator-role": "ADMIN",
        },
        body,
      },
      route.env,
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("x-upstream")).toBe("preserved");
    await expect(response.json()).resolves.toEqual({ forwarded: true });
    const forwarded = route.forwardedRequest();
    expect(forwarded?.url).toBe(
      `https://worker.test/internal/events/${EVENT_ID}/assist-claims/aircraft%20one?source=browser`,
    );
    expect(forwarded?.method).toBe("PUT");
    expect(forwarded?.headers.get("content-type")).toBe("application/json");
    expect(forwarded?.headers.get("x-operator-account-id")).toBe(ACCOUNT_ID);
    expect(forwarded?.headers.get("x-operator-login-code")).toBe(operationalActor.loginCode);
    expect(forwarded?.headers.get("x-operator-session-id")).toBe(operationalActor.sessionId);
    expect(forwarded?.headers.get("x-operator-role")).toBe("FLIGHT_LINE");
    expect(forwarded?.headers.get("x-operator-device-id")).toBe(operationalActor.deviceId);
    await expect(forwarded?.text()).resolves.toBe(body);
  });

  it("uses the existing Assist fallback for an invalid JSON body", async () => {
    const route = createRouteApp();
    await route.app.request(
      `https://worker.test/api/control/${EVENT_ID}/assist-claims/aircraft-a`,
      { method: "PUT", body: "{", headers: { "content-type": "application/json" } },
      route.env,
    );

    await expect(route.forwardedRequest()?.json()).resolves.toEqual({
      action: "ACQUIRE_OR_RENEW",
    });
  });

  it("forwards Assist release without a body", async () => {
    const route = createRouteApp();
    await route.app.request(
      `https://worker.test/api/control/${EVENT_ID}/assist-claims/aircraft-a?source=browser`,
      { method: "DELETE" },
      route.env,
    );

    const forwarded = route.forwardedRequest();
    expect(forwarded?.url).toBe(
      `https://worker.test/internal/events/${EVENT_ID}/assist-claims/aircraft-a?source=browser`,
    );
    expect(forwarded?.method).toBe("DELETE");
    expect(forwarded?.headers.has("content-type")).toBe(false);
    await expect(forwarded?.text()).resolves.toBe("");
  });

  it("forwards dispatch lease acquisition and preserves the upstream response", async () => {
    const route = createRouteApp({
      upstreamResponse: new Response("accepted", {
        status: 207,
        headers: { "content-type": "text/plain", "x-upstream": "custom" },
      }),
    });
    const body = JSON.stringify({ aircraftId: "aircraft-a", expectedVersion: 7 });
    const response = await route.app.request(
      `https://worker.test/api/control/${EVENT_ID}/dispatch-recommendation-leases?source=browser`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
      route.env,
    );

    expect(response.status).toBe(207);
    expect(response.headers.get("x-upstream")).toBe("custom");
    await expect(response.text()).resolves.toBe("accepted");
    const forwarded = route.forwardedRequest();
    expect(forwarded?.url).toBe(
      `https://worker.test/internal/events/${EVENT_ID}/dispatch-recommendation-leases?source=browser`,
    );
    expect(forwarded?.method).toBe("POST");
    await expect(forwarded?.text()).resolves.toBe(body);
  });

  it("forwards null for an invalid dispatch lease body", async () => {
    const route = createRouteApp();
    await route.app.request(
      `https://worker.test/api/control/${EVENT_ID}/dispatch-recommendation-leases`,
      { method: "POST", body: "{", headers: { "content-type": "application/json" } },
      route.env,
    );

    await expect(route.forwardedRequest()?.text()).resolves.toBe("null");
  });

  it("forwards dispatch lease release with encoded identifiers and actor headers", async () => {
    const route = createRouteApp();
    await route.app.request(
      `https://worker.test/api/control/${EVENT_ID}/dispatch-recommendation-leases/lease%20one?source=browser`,
      { method: "DELETE" },
      route.env,
    );

    const forwarded = route.forwardedRequest();
    expect(forwarded?.url).toBe(
      `https://worker.test/internal/events/${EVENT_ID}/dispatch-recommendation-leases/lease%20one?source=browser`,
    );
    expect(forwarded?.method).toBe("DELETE");
    expect(forwarded?.headers.get("x-operator-account-id")).toBe(ACCOUNT_ID);
    expect(forwarded?.headers.get("x-operator-role")).toBe("FLIGHT_LINE");
    expect(forwarded?.headers.has("content-type")).toBe(false);
  });
});
