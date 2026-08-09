import type { FactoryResetResponse } from "@rundflug/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import type { AuthorizedDevice } from "./device-authorization";
import { registerFactoryResetRoutes } from "./factory-reset-routes";
import type { Env } from "./types";

const COMMAND_ID = "550e8400-e29b-41d4-a716-446655440060";
const EVENT_ID = "synthetic-event";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440061";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440062";
const NOW = new Date("2026-08-09T18:00:00.000Z");
const REQUEST_HASH = "b".repeat(64);
const BROWSER_BINDING_HASH = "c".repeat(64);
const GRANT_HASH = "d".repeat(64);
const GRANT_TOKEN = "synthetic-reset-setup-grant-token";
const GRANT_EXPIRES_AT = "2026-08-09T18:30:00.000Z";

function adminActor(role: SessionActor["role"] = "ADMIN"): SessionActor {
  return {
    accountId: ACCOUNT_ID,
    loginCode: "ADMIN-01",
    role,
    sessionId: "synthetic-session",
    deviceId: DEVICE_ID,
  };
}

function adminDevice(role: AuthorizedDevice["role"] = "ADMIN"): AuthorizedDevice {
  return {
    id: DEVICE_ID,
    role,
    accountId: ACCOUNT_ID,
    loginCode: "ADMIN-01",
  };
}

function resetBody(overrides?: Record<string, unknown>) {
  return {
    commandId: COMMAND_ID,
    eventId: EVENT_ID,
    reason: "Synthetic reset for route verification",
    adminPin: "123456",
    confirmation: "WERKSZUSTAND",
    retainRecoveryBackup: false,
    deleteAllBackups: false,
    ...overrides,
  };
}

function jsonRequest(body: unknown) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

type ResetReceipt = {
  request_hash: string;
  completed_at: string;
  r2_cleanup_pending: number;
  response_json: string;
  setup_browser_binding_hash: string | null;
};

function createApp(input?: {
  prior?: ResetReceipt | null;
  actor?: SessionActor | null;
  device?: AuthorizedDevice | null;
  browserBindingHash?: string | null;
  loginAllowed?: boolean;
  account?: { pin_hash: string } | null;
  pinValid?: boolean;
  grantToken?: string | null;
  eventIds?: string[];
  backupFails?: boolean;
  coordinatorFails?: boolean;
  batchFails?: boolean;
  cleanupFails?: boolean;
}) {
  const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => {
      const statement = {
        sql,
        bindings,
        first: async () => {
          if (sql.includes("system_reset_receipts")) {
            return input && "prior" in input ? (input.prior ?? null) : null;
          }
          if (sql.includes("operator_accounts")) {
            return input && "account" in input ? (input.account ?? null) : { pin_hash: "pin-hash" };
          }
          return null;
        },
      };
      prepared.push(statement);
      return statement;
    },
    all: async () => ({ results: (input?.eventIds ?? [EVENT_ID]).map((id) => ({ id })) }),
  }));
  const batch = vi.fn(async (_statements: unknown[]) => {
    if (input?.batchFails) throw new Error("synthetic D1 batch failure");
    return [];
  });
  const actor = input && "actor" in input ? (input.actor ?? null) : adminActor();
  const device = input && "device" in input ? (input.device ?? null) : adminDevice();
  const authorizeSession = vi.fn(async () => actor);
  const authorizeDevice = vi.fn(async () => device);
  const sessionBrowserBindingHash = vi.fn(async () =>
    input && "browserBindingHash" in input
      ? (input.browserBindingHash ?? null)
      : BROWSER_BINDING_HASH,
  );
  const allowLoginAttempt = vi.fn(async () => input?.loginAllowed ?? true);
  const verifyPin = vi.fn(async () => input?.pinValid ?? true);
  const resetSetupToken = vi.fn(async () =>
    input && "grantToken" in input ? (input.grantToken ?? null) : GRANT_TOKEN,
  );
  const resetSetupCookie = vi.fn(() => "reset-setup-cookie=token; HttpOnly");
  const factoryResetRequestHash = vi.fn(async () => REQUEST_HASH);
  const sha256Hex = vi.fn(async () => GRANT_HASH);
  const resetSetupGrantExpiry = vi.fn(() => GRANT_EXPIRES_AT);
  const createPortableBackup = vi.fn(async () => {
    if (input?.backupFails) throw new Error("synthetic backup failure");
    return { key: "backups/synthetic-recovery.json", checksum: "synthetic-checksum" };
  });
  const clearFactoryResetCoordinators = vi.fn(async () => {
    if (input?.coordinatorFails) throw new Error("synthetic coordinator failure");
  });
  const factoryResetStatements = vi.fn(() => []);
  const finishR2Cleanup = vi.fn(
    async (_env: Env, _commandId: string, response: FactoryResetResponse) => {
      if (input?.cleanupFails) throw new Error("synthetic cleanup failure");
      return { ...response, r2BackupsDeleted: true };
    },
  );
  const coordinatorNamespace = { synthetic: "namespace" };
  const env: Env = Object.assign(Object.create(null), {
    APP_ENV: "development",
    ADMIN_RECOVERY_RATE_LIMITER: { limit: vi.fn() },
    DB: { prepare, batch },
    EVENT_COORDINATOR: coordinatorNamespace,
  });
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerFactoryResetRoutes(app, {
    allowLoginAttempt,
    authorizeDevice,
    authorizeSession,
    clearFactoryResetCoordinators,
    createPortableBackup,
    factoryResetRequestHash,
    factoryResetStatements,
    finishR2Cleanup,
    now: () => NOW,
    resetSetupCookie,
    resetSetupGrantExpiry,
    resetSetupToken,
    sessionBrowserBindingHash,
    sha256Hex,
    verifyPin,
  });
  return {
    app,
    env,
    prepare,
    batch,
    prepared,
    coordinatorNamespace,
    authorizeSession,
    authorizeDevice,
    sessionBrowserBindingHash,
    allowLoginAttempt,
    verifyPin,
    resetSetupToken,
    resetSetupCookie,
    factoryResetRequestHash,
    sha256Hex,
    resetSetupGrantExpiry,
    createPortableBackup,
    clearFactoryResetCoordinators,
    factoryResetStatements,
    finishR2Cleanup,
  };
}

async function requestReset(
  app: ReturnType<typeof createApp>["app"],
  env: Env,
  body: unknown = resetBody(),
  eventId = EVENT_ID,
) {
  return app.request(
    `https://worker.test/api/admin/events/${eventId}/factory-reset`,
    jsonRequest(body),
    env,
  );
}

describe("factory reset route", () => {
  it("rejects invalid input and a mismatched path event before hashing", async () => {
    const { app, env, factoryResetRequestHash, prepare } = createApp();

    const invalid = await requestReset(app, env, { confirmation: "RESET" });
    const mismatch = await requestReset(app, env, resetBody(), "different-event");

    expect([invalid.status, mismatch.status]).toEqual([400, 400]);
    expect(factoryResetRequestHash).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requires the original browser binding for an idempotent replay", async () => {
    const { app, env, authorizeSession } = createApp({
      browserBindingHash: "different-browser",
      prior: {
        request_hash: REQUEST_HASH,
        completed_at: NOW.toISOString(),
        r2_cleanup_pending: 0,
        response_json: JSON.stringify({
          resetComplete: true,
          setupRequired: true,
          recoveryBackupKey: null,
          r2BackupsDeleted: false,
        }),
        setup_browser_binding_hash: BROWSER_BINDING_HASH,
      },
    });

    const response = await requestReset(app, env);

    expect(response.status).toBe(403);
    expect(authorizeSession).not.toHaveBeenCalled();
  });

  it("rejects a reused command ID with a different request hash", async () => {
    const { app, env } = createApp({
      prior: {
        request_hash: "different-request-hash",
        completed_at: NOW.toISOString(),
        r2_cleanup_pending: 0,
        response_json: "{}",
        setup_browser_binding_hash: BROWSER_BINDING_HASH,
      },
    });

    const response = await requestReset(app, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("finishes pending R2 cleanup during a valid replay", async () => {
    const priorResponse: FactoryResetResponse = {
      resetComplete: true,
      setupRequired: true,
      recoveryBackupKey: null,
      r2BackupsDeleted: false,
    };
    const { app, env, finishR2Cleanup, resetSetupToken, resetSetupCookie } = createApp({
      prior: {
        request_hash: REQUEST_HASH,
        completed_at: NOW.toISOString(),
        r2_cleanup_pending: 1,
        response_json: JSON.stringify(priorResponse),
        setup_browser_binding_hash: BROWSER_BINDING_HASH,
      },
    });

    const response = await requestReset(app, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ r2BackupsDeleted: true });
    expect(finishR2Cleanup).toHaveBeenCalledWith(env, COMMAND_ID, priorResponse);
    expect(resetSetupToken).toHaveBeenCalledWith(env, COMMAND_ID, NOW.toISOString());
    expect(resetSetupCookie).toHaveBeenCalledWith(GRANT_TOKEN, expect.any(Request));
  });

  it("requires both an ADMIN session and ADMIN device", async () => {
    const { app, env, sessionBrowserBindingHash } = createApp({
      actor: adminActor("FLIGHT_DIRECTOR"),
    });

    const response = await requestReset(app, env);

    expect(response.status).toBe(403);
    expect(sessionBrowserBindingHash).not.toHaveBeenCalled();
  });

  it("requires a browser-bound session before rate limiting", async () => {
    const { app, env, allowLoginAttempt } = createApp({ browserBindingHash: null });

    const response = await requestReset(app, env);

    expect(response.status).toBe(403);
    expect(allowLoginAttempt).not.toHaveBeenCalled();
  });

  it("rate-limits PIN attempts by administrator account", async () => {
    const { app, env, allowLoginAttempt, verifyPin } = createApp({ loginAllowed: false });

    const response = await requestReset(app, env);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(allowLoginAttempt).toHaveBeenCalledWith(
      env.ADMIN_RECOVERY_RATE_LIMITER,
      expect.any(Request),
      ACCOUNT_ID,
    );
    expect(verifyPin).not.toHaveBeenCalled();
  });

  it("rejects an incorrect active account PIN", async () => {
    const { app, env, batch } = createApp({ pinValid: false });

    const response = await requestReset(app, env);

    expect(response.status).toBe(403);
    expect(batch).not.toHaveBeenCalled();
  });

  it("requires a configured reset-to-setup grant", async () => {
    const { app, env, sha256Hex } = createApp({ grantToken: null });

    const response = await requestReset(app, env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RESET_SETUP_NOT_CONFIGURED" },
    });
    expect(sha256Hex).not.toHaveBeenCalled();
  });

  it("fails safely when the recovery backup cannot be created", async () => {
    const { app, env, clearFactoryResetCoordinators } = createApp({ backupFails: true });

    const response = await requestReset(app, env, resetBody({ retainRecoveryBackup: true }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FACTORY_RESET_BACKUP_FAILED" },
    });
    expect(clearFactoryResetCoordinators).not.toHaveBeenCalled();
  });

  it("fails before D1 deletion when a coordinator cannot be cleared", async () => {
    const { app, env, batch } = createApp({ coordinatorFails: true });

    const response = await requestReset(app, env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FACTORY_RESET_COORDINATOR_FAILED" },
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("maps reset-batch failure without starting R2 deletion", async () => {
    const { app, env, finishR2Cleanup } = createApp({ batchFails: true });

    const response = await requestReset(app, env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FACTORY_RESET_DATABASE_FAILED" },
    });
    expect(finishR2Cleanup).not.toHaveBeenCalled();
  });

  it("creates a recovery backup and commits the reset context", async () => {
    const {
      app,
      env,
      batch,
      coordinatorNamespace,
      createPortableBackup,
      clearFactoryResetCoordinators,
      factoryResetStatements,
      resetSetupCookie,
    } = createApp({ eventIds: [EVENT_ID, "historical-event"] });

    const response = await requestReset(app, env, resetBody({ retainRecoveryBackup: true }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resetComplete: true,
      setupRequired: true,
      recoveryBackupKey: "backups/synthetic-recovery.json",
      r2BackupsDeleted: false,
    });
    expect(createPortableBackup).toHaveBeenCalledWith(env, NOW, "FACTORY_RESET");
    expect(clearFactoryResetCoordinators).toHaveBeenCalledWith(coordinatorNamespace, [
      EVENT_ID,
      "historical-event",
    ]);
    expect(factoryResetStatements).toHaveBeenCalledWith(
      env,
      COMMAND_ID,
      REQUEST_HASH,
      NOW.toISOString(),
      false,
      expect.objectContaining({ recoveryBackupKey: "backups/synthetic-recovery.json" }),
      GRANT_HASH,
      GRANT_EXPIRES_AT,
      BROWSER_BINDING_HASH,
    );
    expect(batch).toHaveBeenCalledOnce();
    expect(resetSetupCookie).toHaveBeenCalledWith(GRANT_TOKEN, expect.any(Request));
    expect(factoryResetStatements.mock.calls.flat()).not.toContain("123456");
  });

  it("returns completed R2 deletion after the reset batch", async () => {
    const { app, env, finishR2Cleanup } = createApp();

    const response = await requestReset(app, env, resetBody({ deleteAllBackups: true }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ r2BackupsDeleted: true });
    expect(finishR2Cleanup).toHaveBeenCalledOnce();
  });

  it("returns 202 with a setup grant when R2 deletion remains pending", async () => {
    const { app, env, resetSetupCookie } = createApp({ cleanupFails: true });

    const response = await requestReset(app, env, resetBody({ deleteAllBackups: true }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ r2BackupsDeleted: false });
    expect(resetSetupCookie).toHaveBeenCalledWith(GRANT_TOKEN, expect.any(Request));
  });
});
