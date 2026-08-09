import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import { registerSetupRoutes } from "./setup-routes";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440050";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440051";
const AUDIT_ID = "550e8400-e29b-41d4-a716-446655440052";
const OUTBOX_ID = "550e8400-e29b-41d4-a716-446655440053";
const DEVELOPMENT_DEVICE_ID = "550e8400-e29b-41d4-a716-446655440054";
const DEVELOPMENT_CREDENTIAL_HASH = "a".repeat(64);
const NOW = new Date("2026-08-09T17:00:00.000Z");

const resetGrant = {
  command_id: "synthetic-reset-command",
  completed_at: "2026-08-09T16:30:00.000Z",
  setup_grant_expires_at: "2026-08-09T17:30:00.000Z",
};

function setupBody(overrides?: Record<string, unknown>) {
  return {
    setupCode: "synthetic-setup-code",
    adminPin: "123456",
    eventId: EVENT_ID,
    name: "Synthetic event",
    eventDate: "2026-08-10",
    aerodrome: "EDXX",
    timeZone: "Europe/Berlin",
    adminDeviceId: DEVELOPMENT_DEVICE_ID,
    adminCredentialHash: DEVELOPMENT_CREDENTIAL_HASH,
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

function createApp(input?: {
  appEnv?: Env["APP_ENV"];
  state?: { completed: number; events: number; admins: number } | null;
  recoveryCode?: string | null;
  grant?: typeof resetGrant | null;
  setupAttemptAllowed?: boolean;
  credentialValid?: boolean;
  batchFails?: boolean;
}) {
  const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
  const state = input && "state" in input ? input.state : { completed: 0, events: 0, admins: 0 };
  const prepare = vi.fn((sql: string) => ({
    first: async () => state,
    bind: (...bindings: unknown[]) => {
      const statement = { sql, bindings };
      prepared.push(statement);
      return statement;
    },
  }));
  const batch = vi.fn(async (_statements: unknown[]) => {
    if (input?.batchFails) throw new Error("synthetic batch failure");
    return [];
  });
  const allowSetupAttempt = vi.fn(async () => input?.setupAttemptAllowed ?? true);
  const clearedResetSetupCookie = vi.fn(() => "reset-cookie=; Max-Age=0");
  const clearedSessionCookie = vi.fn(() => "session-cookie=; Max-Age=0");
  const hashPin = vi.fn(async () => "synthetic-pin-hash");
  const installationRecoveryCode = vi.fn(() =>
    input && "recoveryCode" in input ? (input.recoveryCode ?? null) : "server-recovery-code",
  );
  const randomUuid = vi
    .fn<() => string>()
    .mockReturnValueOnce(DEVICE_ID)
    .mockReturnValueOnce(ACCOUNT_ID)
    .mockReturnValueOnce(AUDIT_ID)
    .mockReturnValueOnce(OUTBOX_ID);
  const sha256Hex = vi.fn(async (_value: string | ArrayBuffer) => "server-recovery-hash");
  const validResetSetupGrant = vi.fn(async () =>
    input && "grant" in input ? (input.grant ?? null) : null,
  );
  const verifyCredential = vi.fn(
    async (_provided: string | null, _expectedHash: string | null) =>
      input?.credentialValid ?? true,
  );
  const env: Env = Object.assign(Object.create(null), {
    APP_ENV: input?.appEnv ?? "production",
    ADMIN_RECOVERY_RATE_LIMITER: { limit: vi.fn() },
    DB: { prepare, batch },
  });
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerSetupRoutes(app, {
    allowSetupAttempt,
    clearedResetSetupCookie,
    clearedSessionCookie,
    hashPin,
    installationRecoveryCode,
    now: () => NOW,
    randomUuid,
    sha256Hex,
    validResetSetupGrant,
    verifyCredential,
  });
  return {
    app,
    env,
    prepare,
    batch,
    prepared,
    allowSetupAttempt,
    clearedResetSetupCookie,
    clearedSessionCookie,
    hashPin,
    installationRecoveryCode,
    randomUuid,
    sha256Hex,
    validResetSetupGrant,
    verifyCredential,
  };
}

describe("setup routes", () => {
  it("reports empty setup state and an authorized reset grant", async () => {
    const { app, env } = createApp({ state: null, recoveryCode: null, grant: resetGrant });

    const response = await app.request("https://worker.test/api/setup/status", {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      setupRequired: true,
      setupConfigured: true,
      resetSetupAuthorized: true,
      resetSetupExpiresAt: resetGrant.setup_grant_expires_at,
    });
  });

  it("rejects invalid setup input before reading D1", async () => {
    const { app, env, prepare } = createApp();

    const response = await app.request(
      "https://worker.test/api/setup",
      jsonRequest({ adminPin: "12" }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_SETUP" } });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects setup after any bootstrap state exists", async () => {
    const { app, env, validResetSetupGrant } = createApp({
      state: { completed: 0, events: 1, admins: 0 },
    });

    const response = await app.request(
      "https://worker.test/api/setup",
      jsonRequest(setupBody()),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SETUP_ALREADY_COMPLETED" },
    });
    expect(validResetSetupGrant).not.toHaveBeenCalled();
  });

  it("requires a server recovery code or reset grant", async () => {
    const { app, env, allowSetupAttempt } = createApp({ recoveryCode: null, grant: null });

    const response = await app.request(
      "https://worker.test/api/setup",
      jsonRequest(setupBody()),
      env,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SETUP_NOT_CONFIGURED" },
    });
    expect(allowSetupAttempt).not.toHaveBeenCalled();
  });

  it("rate-limits recovery-code attempts before credential verification", async () => {
    const { app, env, verifyCredential } = createApp({ setupAttemptAllowed: false });

    const response = await app.request(
      "https://worker.test/api/setup",
      jsonRequest(setupBody()),
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(verifyCredential).not.toHaveBeenCalled();
  });

  it("rejects an invalid recovery code without writing D1", async () => {
    const { app, env, batch, sha256Hex, verifyCredential } = createApp({
      credentialValid: false,
    });

    const response = await app.request(
      "https://worker.test/api/setup",
      jsonRequest(setupBody()),
      env,
    );

    expect(response.status).toBe(403);
    expect(sha256Hex).toHaveBeenCalledWith("server-recovery-code");
    expect(verifyCredential).toHaveBeenCalledWith("synthetic-setup-code", "server-recovery-hash");
    expect(batch).not.toHaveBeenCalled();
  });

  it("creates production bootstrap state atomically without browser credentials", async () => {
    const { app, env, batch, prepared, clearedResetSetupCookie, clearedSessionCookie, randomUuid } =
      createApp();

    const response = await app.request(
      "https://worker.test/api/setup",
      jsonRequest(setupBody()),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ eventId: EVENT_ID });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0]).toHaveLength(6);
    expect(randomUuid).toHaveBeenCalledTimes(4);
    const deviceInsert = prepared.find((statement) => statement.sql.includes("paired_devices"));
    expect(deviceInsert?.bindings).toEqual([DEVICE_ID, EVENT_ID, NOW.toISOString(), null]);
    const accountInsert = prepared.find((statement) => statement.sql.includes("operator_accounts"));
    expect(accountInsert?.bindings).toEqual([ACCOUNT_ID, "synthetic-pin-hash", NOW.toISOString()]);
    expect(prepared.some((statement) => statement.sql.includes("operational_events"))).toBe(true);
    expect(prepared.some((statement) => statement.sql.includes("INSERT INTO outbox"))).toBe(true);
    const allBindings = prepared.flatMap((statement) => statement.bindings);
    expect(allBindings).not.toContain("123456");
    expect(allBindings).not.toContain("synthetic-setup-code");
    expect(allBindings).not.toContain(DEVELOPMENT_CREDENTIAL_HASH);
    expect(clearedResetSetupCookie).toHaveBeenCalledOnce();
    expect(clearedSessionCookie).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toContain("reset-cookie=");
    expect(response.headers.get("set-cookie")).toContain("session-cookie=");
  });

  it("preserves development-only device bootstrap compatibility", async () => {
    const { app, env, prepared } = createApp({ appEnv: "development" });

    const response = await app.request(
      "https://worker.test/api/setup",
      jsonRequest(setupBody()),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      eventId: EVENT_ID,
      adminDeviceId: DEVELOPMENT_DEVICE_ID,
    });
    const deviceInsert = prepared.find((statement) => statement.sql.includes("paired_devices"));
    expect(deviceInsert?.bindings).toEqual([
      DEVELOPMENT_DEVICE_ID,
      EVENT_ID,
      NOW.toISOString(),
      DEVELOPMENT_CREDENTIAL_HASH,
    ]);
  });

  it("consumes a reset grant inside the bootstrap batch", async () => {
    const { app, env, batch, prepared, allowSetupAttempt, verifyCredential } = createApp({
      recoveryCode: null,
      grant: resetGrant,
    });

    const response = await app.request(
      "https://worker.test/api/setup",
      jsonRequest(setupBody({ setupCode: undefined })),
      env,
    );

    expect(response.status).toBe(201);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(7);
    expect(allowSetupAttempt).not.toHaveBeenCalled();
    expect(verifyCredential).not.toHaveBeenCalled();
    const grantUpdate = prepared.find((statement) =>
      statement.sql.includes("system_reset_receipts"),
    );
    expect(grantUpdate?.bindings).toEqual([NOW.toISOString(), resetGrant.command_id]);
  });

  it("maps a failed bootstrap batch to the existing conflict response", async () => {
    const { app, env, clearedResetSetupCookie } = createApp({ batchFails: true });

    const response = await app.request(
      "https://worker.test/api/setup",
      jsonRequest(setupBody()),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SETUP_ALREADY_COMPLETED" },
    });
    expect(clearedResetSetupCookie).not.toHaveBeenCalled();
  });
});
