import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperatorRole, SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import type { Env } from "./types";

const NOW = "2026-08-09T14:00:00.000Z";
const EVENT_ID = "550e8400-e29b-41d4-a716-446655440020";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440021";

function actor(): SessionActor {
  return {
    accountId: "550e8400-e29b-41d4-a716-446655440022",
    loginCode: "LEIT-01",
    role: "FLIGHT_DIRECTOR",
    sessionId: "session-director",
    deviceId: DEVICE_ID,
  };
}

function createEnvironment(input: {
  appEnv: Env["APP_ENV"];
  actor?: SessionActor | null;
  device?: { role: OperatorRole; credential_hash: string | null } | null;
  credentialValid?: boolean;
}) {
  const statements: Array<{ sql: string; bindings: unknown[]; operation: string }> = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => ({
      first: async () => {
        statements.push({ sql, bindings, operation: "first" });
        return input.device ?? null;
      },
      run: async () => {
        statements.push({ sql, bindings, operation: "run" });
        return { success: true, meta: { changes: 1 } };
      },
    }),
  }));
  const authorizeSession = vi.fn(async () => input.actor ?? null);
  const verifyCredential = vi.fn(async () => input.credentialValid ?? false);
  const env = { APP_ENV: input.appEnv, DB: { prepare } } as unknown as Env;
  return { env, statements, prepare, authorizeSession, verifyCredential };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("device authorization", () => {
  it("projects the trusted session actor without reading legacy device credentials", async () => {
    const context = createEnvironment({ appEnv: "production", actor: actor() });

    const authorized = await authorizeDevice(
      context.env,
      EVENT_ID,
      new Request("https://worker.test/api/control/event"),
      undefined,
      context,
    );

    expect(authorized).toEqual({
      id: DEVICE_ID,
      role: "FLIGHT_DIRECTOR",
      accountId: actor().accountId,
      loginCode: "LEIT-01",
    });
    expect(context.prepare).not.toHaveBeenCalled();
  });

  it("uses a preauthorized actor without resolving the session again", async () => {
    const context = createEnvironment({ appEnv: "production", actor: null });

    const authorized = await authorizeDevice(
      context.env,
      EVENT_ID,
      new Request("https://worker.test/api/control/event"),
      actor(),
      context,
    );

    expect(authorized?.accountId).toBe(actor().accountId);
    expect(context.authorizeSession).not.toHaveBeenCalled();
  });

  it("never evaluates legacy device headers outside development", async () => {
    const context = createEnvironment({ appEnv: "production", actor: null, credentialValid: true });

    const authorized = await authorizeDevice(
      context.env,
      EVENT_ID,
      new Request("https://worker.test/api/control/event", {
        headers: { "x-device-id": DEVICE_ID, "x-device-token": "synthetic-token" },
      }),
      undefined,
      context,
    );

    expect(authorized).toBeNull();
    expect(context.prepare).not.toHaveBeenCalled();
    expect(context.verifyCredential).not.toHaveBeenCalled();
  });

  it("rejects a development request without an explicit legacy device ID", async () => {
    const context = createEnvironment({ appEnv: "development", actor: null });

    const authorized = await authorizeDevice(
      context.env,
      EVENT_ID,
      new Request("https://worker.test/api/control/event"),
      undefined,
      context,
    );

    expect(authorized).toBeNull();
    expect(context.prepare).not.toHaveBeenCalled();
  });

  it("rejects invalid development credentials without updating last_seen_at", async () => {
    const context = createEnvironment({
      appEnv: "development",
      actor: null,
      device: { role: "ADMIN", credential_hash: "a".repeat(64) },
      credentialValid: false,
    });

    const authorized = await authorizeDevice(
      context.env,
      EVENT_ID,
      new Request("https://worker.test/api/control/event", {
        headers: { "x-device-id": DEVICE_ID, "x-device-token": "synthetic-token" },
      }),
      undefined,
      context,
    );

    expect(authorized).toBeNull();
    expect(context.statements).toHaveLength(1);
    expect(context.statements[0]?.operation).toBe("first");
  });

  it("accepts valid development credentials and records last_seen_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const context = createEnvironment({
      appEnv: "development",
      actor: null,
      device: { role: "ADMIN", credential_hash: "a".repeat(64) },
      credentialValid: true,
    });

    const authorized = await authorizeDevice(
      context.env,
      EVENT_ID,
      new Request("https://worker.test/api/control/event", {
        headers: { "x-device-id": DEVICE_ID, "x-device-token": "synthetic-token" },
      }),
      undefined,
      context,
    );

    expect(authorized).toEqual({
      id: DEVICE_ID,
      role: "ADMIN",
      accountId: null,
      loginCode: null,
    });
    expect(context.verifyCredential).toHaveBeenCalledWith("synthetic-token", "a".repeat(64));
    expect(context.statements[1]).toMatchObject({
      operation: "run",
      bindings: [NOW, DEVICE_ID],
    });
    expect(context.statements[1]?.sql).toContain("UPDATE paired_devices SET last_seen_at");
  });
});
