import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import { registerAuthRoutes } from "./auth-routes";
import type { Env } from "./types";

const NOW = "2026-08-09T08:00:00.000Z";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440001";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440002";

function actor(): SessionActor {
  return {
    accountId: ACCOUNT_ID,
    loginCode: "AD-01",
    role: "ADMIN",
    sessionId: "session-1",
    deviceId: DEVICE_ID,
  };
}

function account(overrides?: Record<string, unknown>) {
  return {
    id: ACCOUNT_ID,
    login_code: "AD-01",
    role: "ADMIN",
    pin_hash: "synthetic-pin-hash",
    active: 1,
    failed_attempts: 0,
    locked_until: null,
    session_version: 3,
    ...overrides,
  };
}

function createApp(input?: {
  actor?: SessionActor | null;
  account?: Record<string, unknown> | null;
  activeEventId?: string | null;
  accounts?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  loginAllowed?: boolean;
  pinValid?: boolean;
}) {
  const statements: Array<{ sql: string; bindings: unknown[]; operation: string }> = [];
  const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: (...bindings: unknown[]) => {
        prepared.push({ sql, bindings });
        return {
          first: async () => {
            statements.push({ sql, bindings, operation: "first" });
            if (sql.includes("FROM operator_accounts WHERE id")) return input?.account ?? null;
            return null;
          },
          all: async () => {
            statements.push({ sql, bindings, operation: "all" });
            if (sql.includes("FROM operator_accounts")) return { results: input?.accounts ?? [] };
            if (sql.includes("FROM operation_days")) return { results: input?.events ?? [] };
            return { results: [] };
          },
          run: async () => {
            statements.push({ sql, bindings, operation: "run" });
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
      first: async () => {
        statements.push({ sql, bindings: [], operation: "first" });
        if (sql.includes("SELECT id FROM operation_days")) {
          return input?.activeEventId ? { id: input.activeEventId } : null;
        }
        return null;
      },
      all: async () => {
        statements.push({ sql, bindings: [], operation: "all" });
        if (sql.includes("FROM operator_accounts")) return { results: input?.accounts ?? [] };
        if (sql.includes("FROM operation_days")) return { results: input?.events ?? [] };
        return { results: [] };
      },
    };
    return statement;
  });
  const batch = vi.fn(async (_statements: unknown[]) => []);
  const authorizeSession = vi.fn(async () => input?.actor ?? null);
  const allowLoginAttempt = vi.fn(async () => input?.loginAllowed ?? true);
  const verifyPin = vi.fn(async () => input?.pinValid ?? true);
  const randomToken = vi.fn(() => "synthetic-session-token");
  const sha256Hex = vi.fn(async () => "synthetic-token-hash");
  const env = {
    DB: { prepare, batch },
    APP_ENV: "development",
  } as unknown as Env;
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerAuthRoutes(app, {
    authorizeSession,
    allowLoginAttempt,
    verifyPin,
    randomToken,
    sha256Hex,
  });
  return {
    app,
    env,
    prepare,
    batch,
    statements,
    prepared,
    authorizeSession,
    allowLoginAttempt,
    verifyPin,
    randomToken,
    sha256Hex,
  };
}

function jsonRequest(body: unknown) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function loginBody() {
  return { accountId: ACCOUNT_ID, pin: "123456", deviceId: DEVICE_ID };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("authentication and session routes", () => {
  it("lists only the projected public account fields", async () => {
    const { app, env, statements } = createApp({
      accounts: [{ id: ACCOUNT_ID, login_code: "AD-01", role: "ADMIN" }],
    });

    const response = await app.request("https://worker.test/api/auth/accounts", {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accounts: [{ id: ACCOUNT_ID, loginCode: "AD-01", role: "ADMIN" }],
    });
    expect(statements[0]?.sql).toContain("active = 1 AND deleted_at IS NULL");
  });

  it("rejects an invalid login body before rate limiting or D1 access", async () => {
    const { app, env, prepare, allowLoginAttempt } = createApp();

    const response = await app.request(
      "https://worker.test/api/auth/login",
      jsonRequest({ accountId: "invalid", pin: "12" }),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "LOGIN_FAILED" } });
    expect(allowLoginAttempt).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("returns the generic login error and retry header when rate limited", async () => {
    const { app, env, prepare } = createApp({ loginAllowed: false });

    const response = await app.request(
      "https://worker.test/api/auth/login",
      jsonRequest(loginBody()),
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "LOGIN_FAILED" } });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("locks an account for fifteen minutes after the fifth failed PIN", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements } = createApp({
      account: account({ failed_attempts: 4 }),
      pinValid: false,
    });

    const response = await app.request(
      "https://worker.test/api/auth/login",
      jsonRequest(loginBody()),
      env,
    );

    expect(response.status).toBe(401);
    expect(statements).toHaveLength(2);
    expect(statements[1]?.sql).toContain("SET failed_attempts = ?1, locked_until = ?2");
    expect(statements[1]?.bindings).toEqual([0, "2026-08-09T08:15:00.000Z", NOW, ACCOUNT_ID]);
  });

  it("creates a bound session, paired device, and secure cookie after valid login", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, batch, prepared, sha256Hex } = createApp({
      account: account(),
      activeEventId: "event-1",
    });

    const response = await app.request(
      "https://worker.test/api/auth/login",
      jsonRequest(loginBody()),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      account: { id: ACCOUNT_ID, loginCode: "AD-01", role: "ADMIN" },
    });
    expect(response.headers.get("set-cookie")).toContain("rls_session=synthetic-session-token");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(sha256Hex).toHaveBeenCalledWith("synthetic-session-token");
    expect(batch).toHaveBeenCalledOnce();
    const batchStatements = batch.mock.calls[0]?.[0] as unknown[];
    expect(batchStatements).toHaveLength(3);
    expect(prepared.some((entry) => entry.sql.includes("INSERT INTO operator_sessions"))).toBe(
      true,
    );
    expect(prepared.some((entry) => entry.sql.includes("INSERT INTO paired_devices"))).toBe(true);
  });

  it("requires a valid session for session details and event selection", async () => {
    const { app, env, prepare } = createApp({ actor: null });

    const [sessionResponse, eventsResponse] = await Promise.all([
      app.request("https://worker.test/api/auth/session", {}, env),
      app.request("https://worker.test/api/auth/events", {}, env),
    ]);

    expect(sessionResponse.status).toBe(401);
    expect(eventsResponse.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("projects the authorized actor and non-archived event catalog", async () => {
    const { app, env, statements } = createApp({
      actor: actor(),
      events: [
        {
          id: "event-1",
          name: "Synthetischer Flugtag",
          event_date: "2026-08-09",
          aerodrome: "EDXX",
          time_zone: "Europe/Berlin",
          status: "ACTIVE",
          archived_at: null,
          template_source_id: null,
          version: 5,
        },
      ],
    });

    const [sessionResponse, eventsResponse] = await Promise.all([
      app.request("https://worker.test/api/auth/session", {}, env),
      app.request("https://worker.test/api/auth/events", {}, env),
    ]);

    await expect(sessionResponse.json()).resolves.toEqual({
      authenticated: true,
      account: { id: ACCOUNT_ID, loginCode: "AD-01", role: "ADMIN" },
    });
    await expect(eventsResponse.json()).resolves.toEqual({
      events: [
        {
          eventId: "event-1",
          name: "Synthetischer Flugtag",
          eventDate: "2026-08-09",
          aerodrome: "EDXX",
          timeZone: "Europe/Berlin",
          status: "ACTIVE",
          archivedAt: null,
          templateSourceId: null,
          version: 5,
        },
      ],
    });
    expect(statements[0]?.sql).toContain("WHERE archived_at IS NULL");
    expect(statements[0]?.sql).toContain("WHEN 'ACTIVE' THEN 0");
    expect(statements[0]?.sql).not.toContain("paired_devices");
  });

  it("revokes an authorized session and always clears the cookie", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements } = createApp({ actor: actor() });

    const response = await app.request(
      "https://worker.test/api/auth/logout",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(statements).toHaveLength(1);
    expect(statements[0]?.bindings).toEqual([NOW, "session-1"]);
  });
});
