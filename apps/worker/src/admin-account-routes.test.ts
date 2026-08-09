import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminAccountRoutes } from "./admin-account-routes";
import type { OperatorRole, SessionActor } from "./auth";
import type { Env } from "./types";

const NOW = "2026-08-09T12:00:00.000Z";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440010";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655440011";

function adminActor(role: OperatorRole = "ADMIN"): SessionActor {
  return {
    accountId: ADMIN_ID,
    loginCode: "ADMIN-01",
    role,
    sessionId: "session-admin",
    deviceId: "550e8400-e29b-41d4-a716-446655440012",
  };
}

function createApp(input?: {
  actor?: SessionActor | null;
  accounts?: Array<{ id: string; login_code: string; role: OperatorRole; active: number }>;
  patchChanges?: number;
  deleteChanges?: number;
  deletedAccount?: { role: OperatorRole; active: number } | null;
}) {
  const statements: Array<{ sql: string; bindings: unknown[]; operation: string }> = [];
  const prepare = vi.fn((sql: string) => ({
    all: async () => {
      statements.push({ sql, bindings: [], operation: "all" });
      return { results: input?.accounts ?? [] };
    },
    bind: (...bindings: unknown[]) => ({
      run: async () => {
        statements.push({ sql, bindings, operation: "run" });
        const changes = sql.includes("active = COALESCE")
          ? (input?.patchChanges ?? 1)
          : sql.includes("SET active = 0, deleted_at")
            ? (input?.deleteChanges ?? 1)
            : 1;
        return { success: true, meta: { changes } };
      },
      first: async () => {
        statements.push({ sql, bindings, operation: "first" });
        return input?.deletedAccount ?? null;
      },
    }),
  }));
  const actor = input && "actor" in input ? (input.actor ?? null) : adminActor();
  const authorizeSession = vi.fn(async () => actor);
  const nextLoginCode = vi.fn(async (_env: Env, role: OperatorRole) =>
    role === "CASHIER" ? "KASSE-02" : `${role}-02`,
  );
  const hashPin = vi.fn(async () => "synthetic-pin-hash");
  const env = { DB: { prepare } } as unknown as Env;
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerAdminAccountRoutes(app, { authorizeSession, nextLoginCode, hashPin });
  return { app, env, prepare, statements, authorizeSession, nextLoginCode, hashPin };
}

function jsonRequest(method: "POST" | "PATCH", body: unknown) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("admin operator account routes", () => {
  it("requires an ADMIN session before every account operation", async () => {
    const { app, env, prepare } = createApp({ actor: adminActor("CASHIER") });
    const responses = await Promise.all([
      app.request("https://worker.test/api/admin/operator-accounts", {}, env),
      app.request(
        "https://worker.test/api/admin/operator-accounts",
        jsonRequest("POST", { role: "CASHIER", pin: "123456" }),
        env,
      ),
      app.request(
        `https://worker.test/api/admin/operator-accounts/${OTHER_ID}`,
        jsonRequest("PATCH", { revokeSessions: true }),
        env,
      ),
      app.request(
        `https://worker.test/api/admin/operator-accounts/${OTHER_ID}`,
        { method: "DELETE" },
        env,
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("lists the public account projection including active state", async () => {
    const { app, env, statements } = createApp({
      accounts: [{ id: OTHER_ID, login_code: "KASSE-02", role: "CASHIER", active: 1 }],
    });

    const response = await app.request("https://worker.test/api/admin/operator-accounts", {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accounts: [{ id: OTHER_ID, loginCode: "KASSE-02", role: "CASHIER", active: true }],
    });
    expect(statements[0]?.sql).toContain("WHERE deleted_at IS NULL");
  });

  it("rejects invalid account creation before hashing or D1 access", async () => {
    const { app, env, prepare, hashPin } = createApp();

    const response = await app.request(
      "https://worker.test/api/admin/operator-accounts",
      jsonRequest("POST", { role: "CASHIER", pin: "123" }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_ACCOUNT" } });
    expect(hashPin).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("creates an account with the next role code and a PIN hash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements, nextLoginCode, hashPin } = createApp();

    const response = await app.request(
      "https://worker.test/api/admin/operator-accounts",
      jsonRequest("POST", { role: "CASHIER", pin: "123456" }),
      env,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ loginCode: "KASSE-02", role: "CASHIER", active: true });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(nextLoginCode).toHaveBeenCalledWith(env, "CASHIER");
    expect(hashPin).toHaveBeenCalledWith("123456");
    expect(statements[0]?.sql).toContain("INSERT INTO operator_accounts");
    expect(statements[0]?.bindings.slice(1)).toEqual([
      "KASSE-02",
      "CASHIER",
      "synthetic-pin-hash",
      NOW,
    ]);
  });

  it("keeps the currently authenticated account active", async () => {
    const { app, env, prepare } = createApp();

    const response = await app.request(
      `https://worker.test/api/admin/operator-accounts/${ADMIN_ID}`,
      jsonRequest("PATCH", { active: false }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ACTIVE_SESSION_REQUIRED" },
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("advances the session version when all sessions are revoked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements } = createApp();

    const response = await app.request(
      `https://worker.test/api/admin/operator-accounts/${OTHER_ID}`,
      jsonRequest("PATCH", { revokeSessions: true }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ updated: true });
    expect(statements[0]?.sql).toContain("OR ?5 = 1 THEN session_version + 1");
    expect(statements[0]?.bindings).toEqual([null, null, NOW, OTHER_ID, 1]);
  });

  it("returns not found when an account update changes no row", async () => {
    const { app, env } = createApp({ patchChanges: 0 });

    const response = await app.request(
      `https://worker.test/api/admin/operator-accounts/${OTHER_ID}`,
      jsonRequest("PATCH", { active: true }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ACCOUNT_NOT_FOUND" } });
  });

  it("does not delete the currently authenticated account", async () => {
    const { app, env, prepare } = createApp();

    const response = await app.request(
      `https://worker.test/api/admin/operator-accounts/${ADMIN_ID}`,
      { method: "DELETE" },
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ACTIVE_SESSION_REQUIRED" },
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("protects the last active administrator", async () => {
    const { app, env, statements } = createApp({
      deleteChanges: 0,
      deletedAccount: { role: "ADMIN", active: 1 },
    });

    const response = await app.request(
      `https://worker.test/api/admin/operator-accounts/${OTHER_ID}`,
      { method: "DELETE" },
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "LAST_ACTIVE_ADMIN" } });
    expect(statements).toHaveLength(2);
  });

  it("returns not found when the deleted account does not exist", async () => {
    const { app, env } = createApp({ deleteChanges: 0, deletedAccount: null });

    const response = await app.request(
      `https://worker.test/api/admin/operator-accounts/${OTHER_ID}`,
      { method: "DELETE" },
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ACCOUNT_NOT_FOUND" } });
  });

  it("soft-deletes an account, revokes sessions, and releases active claims", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements } = createApp();

    const response = await app.request(
      `https://worker.test/api/admin/operator-accounts/${OTHER_ID}`,
      { method: "DELETE" },
      env,
    );

    expect(response.status).toBe(204);
    expect(statements.map((statement) => statement.operation)).toEqual(["run", "run", "run"]);
    expect(statements[0]?.sql).toContain("session_version = session_version + 1");
    expect(statements[0]?.bindings).toEqual([NOW, OTHER_ID]);
    expect(statements[1]?.sql).toContain("DELETE FROM dispatch_recommendation_leases");
    expect(statements[2]?.sql).toContain("DELETE FROM flight_line_assist_claims");
  });
});
