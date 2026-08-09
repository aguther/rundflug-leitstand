import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminSecurityRoutes } from "./admin-security-routes";
import type { SessionActor } from "./auth";
import type { AuthorizedDevice } from "./device-authorization";
import type { Env } from "./types";

const NOW = "2026-08-09T15:00:00.000Z";
const EVENT_ID = "550e8400-e29b-41d4-a716-446655440030";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440031";
const CREDENTIAL_HASH = "b".repeat(64);

function adminActor(): SessionActor {
  return {
    accountId: "550e8400-e29b-41d4-a716-446655440032",
    loginCode: "ADMIN-01",
    role: "ADMIN",
    sessionId: "session-admin",
    deviceId: DEVICE_ID,
  };
}

function authorizedAdmin(): AuthorizedDevice {
  return {
    id: DEVICE_ID,
    role: "ADMIN",
    accountId: adminActor().accountId,
    loginCode: "ADMIN-01",
  };
}

function createApp(input?: {
  appEnv?: Env["APP_ENV"];
  actor?: SessionActor | null;
  authorizedDevice?: AuthorizedDevice | null;
  activeEventId?: string | null;
  legacyContext?: { operation_day_id: string; role: string; credential_hash: string | null } | null;
  operationDayExists?: boolean;
  recoveryDevice?: { role: string } | null;
  adminPinHashes?: string[];
  credentialValid?: boolean;
  pinValid?: boolean;
  recoveryAllowed?: boolean;
}) {
  const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
  const operations: Array<{ sql: string; bindings: unknown[]; operation: string }> = [];
  const prepare = vi.fn((sql: string) => {
    const first = async () => {
      operations.push({ sql, bindings: [], operation: "first" });
      return input?.activeEventId ? { id: input.activeEventId } : null;
    };
    const all = async () => {
      operations.push({ sql, bindings: [], operation: "all" });
      return { results: (input?.adminPinHashes ?? []).map((pin_hash) => ({ pin_hash })) };
    };
    const bind = (...bindings: unknown[]) => {
      prepared.push({ sql, bindings });
      return {
        first: async () => {
          operations.push({ sql, bindings, operation: "first" });
          if (sql.includes("SELECT operation_day_id, role, credential_hash")) {
            return input?.legacyContext ?? null;
          }
          if (sql.includes("SELECT id FROM operation_days WHERE id")) {
            return input?.operationDayExists === false ? null : { id: EVENT_ID };
          }
          if (sql.includes("SELECT role FROM paired_devices")) {
            return input?.recoveryDevice ?? null;
          }
          return null;
        },
      };
    };
    return { first, all, bind };
  });
  const batch = vi.fn(async (_statements: unknown[]) => []);
  const actor = input && "actor" in input ? (input.actor ?? null) : adminActor();
  const authorizedDevice =
    input && "authorizedDevice" in input ? (input.authorizedDevice ?? null) : authorizedAdmin();
  const authorizeSession = vi.fn(async () => actor);
  const authorizeDevice = vi.fn(async () => authorizedDevice);
  const verifyCredential = vi.fn(async () => input?.credentialValid ?? true);
  const verifyPin = vi.fn(async () => input?.pinValid ?? true);
  const allowAdminDeviceRecoveryAttempt = vi.fn(async () => input?.recoveryAllowed ?? true);
  const env = {
    APP_ENV: input?.appEnv ?? "development",
    ADMIN_PIN_HASH: "a".repeat(64),
    ADMIN_RECOVERY_RATE_LIMITER: {},
    DB: { prepare, batch },
  } as unknown as Env;
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerAdminSecurityRoutes(app, {
    authorizeSession,
    authorizeDevice,
    verifyCredential,
    verifyPin,
    allowAdminDeviceRecoveryAttempt,
  });
  return {
    app,
    env,
    prepare,
    batch,
    prepared,
    operations,
    authorizeSession,
    authorizeDevice,
    verifyCredential,
    verifyPin,
    allowAdminDeviceRecoveryAttempt,
  };
}

function jsonRequest(body: unknown, headers?: Record<string, string>) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function recoveryBody() {
  return { adminPin: "123456", credentialHash: CREDENTIAL_HASH };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("device context and admin security routes", () => {
  it("returns the preferred event context for a trusted session", async () => {
    const context = createApp({ activeEventId: EVENT_ID });

    const response = await context.app.request(
      "https://worker.test/api/device/context",
      {},
      context.env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ eventId: EVENT_ID, role: "ADMIN" });
    expect(context.operations[0]?.sql).toContain("WHEN 'ACTIVE' THEN 0");
  });

  it("requires a session in production without evaluating legacy headers", async () => {
    const context = createApp({ appEnv: "production", actor: null });

    const response = await context.app.request(
      "https://worker.test/api/device/context",
      { headers: { "x-device-id": DEVICE_ID, "x-device-token": "synthetic-token" } },
      context.env,
    );

    expect(response.status).toBe(401);
    expect(context.prepare).not.toHaveBeenCalled();
    expect(context.verifyCredential).not.toHaveBeenCalled();
  });

  it("accepts a valid legacy device context only in development", async () => {
    const context = createApp({
      actor: null,
      legacyContext: {
        operation_day_id: EVENT_ID,
        role: "FLIGHT_LINE",
        credential_hash: "a".repeat(64),
      },
    });

    const response = await context.app.request(
      "https://worker.test/api/device/context",
      { headers: { "x-device-id": DEVICE_ID, "x-device-token": "synthetic-token" } },
      context.env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ eventId: EVENT_ID, role: "FLIGHT_LINE" });
    expect(context.verifyCredential).toHaveBeenCalledWith("synthetic-token", "a".repeat(64));
  });

  it("rejects invalid legacy device credentials", async () => {
    const context = createApp({
      actor: null,
      credentialValid: false,
      legacyContext: {
        operation_day_id: EVENT_ID,
        role: "ADMIN",
        credential_hash: "a".repeat(64),
      },
    });

    const response = await context.app.request(
      "https://worker.test/api/device/context",
      { headers: { "x-device-id": DEVICE_ID, "x-device-token": "wrong-token" } },
      context.env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "DEVICE_REQUIRED" } });
  });

  it("validates the admin PIN body before authorization", async () => {
    const context = createApp();

    const response = await context.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/verify-pin`,
      jsonRequest({ adminPin: "12" }),
      context.env,
    );

    expect(response.status).toBe(400);
    expect(context.authorizeDevice).not.toHaveBeenCalled();
  });

  it("accepts an ADMIN session without consulting the legacy admin hash", async () => {
    const context = createApp();

    const response = await context.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/verify-pin`,
      jsonRequest({ adminPin: "123456" }),
      context.env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(context.verifyCredential).not.toHaveBeenCalled();
  });

  it("requires the legacy admin hash when no session actor exists", async () => {
    const context = createApp({ actor: null, credentialValid: false });

    const response = await context.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/verify-pin`,
      jsonRequest({ adminPin: "123456" }),
      context.env,
    );

    expect(response.status).toBe(403);
    expect(context.verifyCredential).toHaveBeenCalledWith("123456", "a".repeat(64));
  });

  it("disables legacy device recovery outside development", async () => {
    const context = createApp({ appEnv: "production" });

    const response = await context.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/recover-device`,
      jsonRequest(recoveryBody(), { "x-device-id": DEVICE_ID }),
      context.env,
    );

    expect(response.status).toBe(410);
    expect(context.allowAdminDeviceRecoveryAttempt).not.toHaveBeenCalled();
    expect(context.prepare).not.toHaveBeenCalled();
  });

  it("rate limits legacy recovery before reading recovery state", async () => {
    const context = createApp({ recoveryAllowed: false });

    const response = await context.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/recover-device`,
      jsonRequest(recoveryBody(), { "x-device-id": DEVICE_ID }),
      context.env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(context.prepare).not.toHaveBeenCalled();
  });

  it("rejects recovery when the current device is not an ADMIN device", async () => {
    const context = createApp({
      recoveryDevice: { role: "FLIGHT_LINE" },
      adminPinHashes: ["synthetic-pin-hash"],
    });

    const response = await context.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/recover-device`,
      jsonRequest(recoveryBody(), { "x-device-id": DEVICE_ID }),
      context.env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_RECOVERY_REJECTED" },
    });
    expect(context.batch).not.toHaveBeenCalled();
  });

  it("rejects recovery when no active ADMIN PIN matches", async () => {
    const context = createApp({
      recoveryDevice: { role: "ADMIN" },
      adminPinHashes: ["synthetic-pin-hash"],
      pinValid: false,
    });

    const response = await context.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/recover-device`,
      jsonRequest(recoveryBody(), { "x-device-id": DEVICE_ID }),
      context.env,
    );

    expect(response.status).toBe(403);
    expect(context.verifyPin).toHaveBeenCalledWith("123456", "synthetic-pin-hash");
    expect(context.batch).not.toHaveBeenCalled();
  });

  it("updates one ADMIN device and records audit and outbox entries without the PIN", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const context = createApp({
      recoveryDevice: { role: "ADMIN" },
      adminPinHashes: ["synthetic-pin-hash"],
    });

    const response = await context.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/recover-device`,
      jsonRequest(recoveryBody(), { "x-device-id": DEVICE_ID }),
      context.env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      eventId: EVENT_ID,
      adminDeviceId: DEVICE_ID,
      role: "ADMIN",
    });
    expect(context.batch).toHaveBeenCalledOnce();
    expect(context.verifyPin).toHaveBeenCalledWith("123456", "synthetic-pin-hash");
    const statements = context.batch.mock.calls[0]?.[0] as unknown[];
    expect(statements).toHaveLength(3);
    const recoveryStatements = context.prepared.slice(-3);
    expect(recoveryStatements[0]?.sql).toContain("UPDATE paired_devices");
    expect(recoveryStatements[1]?.sql).toContain("ADMIN_DEVICE_CREDENTIAL_RECOVERED");
    expect(recoveryStatements[2]?.sql).toContain("INSERT INTO outbox");
    const serializedBindings = JSON.stringify(recoveryStatements.map((entry) => entry.bindings));
    expect(serializedBindings).not.toContain("123456");
    expect(recoveryStatements[1]?.bindings[4]).toBe(
      JSON.stringify({ deviceId: DEVICE_ID, recovery: "ADMIN_PIN" }),
    );
  });

  it("creates an ADMIN legacy device when no existing device is found", async () => {
    const context = createApp({
      recoveryDevice: null,
      adminPinHashes: ["synthetic-pin-hash"],
    });

    const response = await context.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/recover-device`,
      jsonRequest(recoveryBody(), { "x-device-id": DEVICE_ID }),
      context.env,
    );

    expect(response.status).toBe(200);
    expect(context.prepared.at(-3)?.sql).toContain("INSERT INTO paired_devices");
  });
});
