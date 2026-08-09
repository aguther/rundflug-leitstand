import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerAdminEventDeletionRoutes } from "./admin-event-deletion-routes";
import {
  type AdminEventDeletionInput,
  type AdminEventDeletionResult,
  deleteAdminEvent,
} from "./admin-event-deletion-service";
import type { SessionActor } from "./auth";
import type { AuthorizedDevice } from "./device-authorization";
import type { EventDeletionResponse } from "./event-deletion";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const SOURCE_EVENT_ID = "synthetic-source";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440110";
const COMMAND_ID = "550e8400-e29b-41d4-a716-446655440111";
const NOW = new Date("2026-08-09T21:00:00.000Z");

const deletionInput: AdminEventDeletionInput = {
  commandId: COMMAND_ID,
  expectedVersion: 7,
  confirmation: EVENT_ID,
  reason: "Synthetic event cleanup",
};

function deletionBody(overrides?: Partial<EventDeletionResponse>): EventDeletionResponse {
  return {
    deleted: true,
    eventId: EVENT_ID,
    setupRequired: true,
    assetCleanupPending: true,
    ...overrides,
  };
}

function createRouteApp(result?: AdminEventDeletionResult) {
  const database = Object.create(null) as D1Database;
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: database,
  }) as Env;
  const serviceResult = result ?? { status: 200, body: deletionBody() };
  const deleteEvent = vi.fn(async () => serviceResult);
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerAdminEventDeletionRoutes(app, { deleteAdminEvent: deleteEvent });
  return { app, env, deleteEvent };
}

function deleteRequest(body: unknown, headers?: Record<string, string>) {
  return {
    method: "DELETE",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

describe("admin event deletion route", () => {
  it("requires command id, version, exact confirmation and a reason", async () => {
    const invalidBodies = [
      { ...deletionInput, commandId: "" },
      { ...deletionInput, expectedVersion: -1 },
      { ...deletionInput, confirmation: "another-event" },
      { ...deletionInput, reason: "x" },
    ];

    for (const body of invalidBodies) {
      const { app, env, deleteEvent } = createRouteApp();
      const response = await app.request(
        `https://worker.test/api/admin/events/${EVENT_ID}`,
        deleteRequest(body),
        env,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "EVENT_DELETE_CONFIRMATION_INVALID" },
      });
      expect(deleteEvent).not.toHaveBeenCalled();
    }
  });

  it("normalizes the reason, honors the source header and maps pending cleanup", async () => {
    const pending: AdminEventDeletionResult = { status: 202, body: deletionBody() };
    const { app, env, deleteEvent } = createRouteApp(pending);

    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}`,
      deleteRequest(
        { ...deletionInput, reason: `  ${deletionInput.reason}  ` },
        { "x-event-id": SOURCE_EVENT_ID },
      ),
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(pending.body);
    expect(deleteEvent).toHaveBeenCalledWith(
      env,
      EVENT_ID,
      SOURCE_EVENT_ID,
      deletionInput,
      expect.any(Request),
    );
  });
});

interface MockStatement {
  sql: string;
  bindings: unknown[];
  first: () => Promise<unknown>;
  all: () => Promise<{ results: unknown[] }>;
}

interface DeletionEnvironmentInput {
  appEnv?: Env["APP_ENV"];
  prior?: Record<string, unknown> | null;
  event?: Record<string, unknown> | null;
  eventCount?: number;
  bootstrapEventId?: string | null;
  sessionRebindEvent?: { id: string } | null;
  replacement?: { id: string; admin_device_id: string } | null;
  credential?: { credential_hash: string | null } | null;
  coordinatorOk?: boolean;
}

function createServiceEnvironment(input?: DeletionEnvironmentInput) {
  const prepared: MockStatement[] = [];
  const batched: MockStatement[][] = [];
  const event =
    input && "event" in input
      ? (input.event ?? null)
      : {
          id: EVENT_ID,
          version: 7,
          logo_object_key: "logos/light.svg",
          logo_dark_object_key: "logos/dark.svg",
        };
  const prepare = vi.fn((sql: string) => {
    const statement: MockStatement = {
      sql,
      bindings: [],
      first: async () => {
        if (sql.includes("FROM event_deletion_receipts")) {
          return input && "prior" in input ? (input.prior ?? null) : null;
        }
        if (sql.includes("FROM operation_days WHERE id = ?1")) return event;
        if (sql === "SELECT COUNT(*) AS count FROM operation_days") {
          return { count: input?.eventCount ?? 1 };
        }
        if (sql.includes("FROM app_bootstrap WHERE singleton = 1")) {
          return input?.bootstrapEventId ? { operation_day_id: input.bootstrapEventId } : null;
        }
        if (sql.includes("SELECT id") && sql.includes("WHERE id <> ?1")) {
          return input && "sessionRebindEvent" in input
            ? (input.sessionRebindEvent ?? null)
            : { id: SOURCE_EVENT_ID };
        }
        if (sql.includes("SELECT operation_day.id")) {
          return input && "replacement" in input
            ? (input.replacement ?? null)
            : { id: SOURCE_EVENT_ID, admin_device_id: "replacement-admin" };
        }
        if (sql.includes("SELECT credential_hash")) {
          return input && "credential" in input ? (input.credential ?? null) : null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
    };
    const bind = (...bindings: unknown[]) => {
      statement.bindings = bindings;
      return statement;
    };
    prepared.push(statement);
    return Object.assign(statement, { bind });
  });
  const batch = vi.fn(async (statements: MockStatement[]) => {
    batched.push(statements);
    return statements.map(() => ({ meta: { changes: 1 } }));
  });
  const database = Object.assign(Object.create(null), { prepare, batch }) as D1Database;
  const coordinatorFetch = vi.fn(
    async () => new Response(null, { status: input?.coordinatorOk === false ? 409 : 204 }),
  );
  const coordinator = Object.assign(Object.create(null), { fetch: coordinatorFetch });
  const idFromName = vi.fn(() => ({ name: EVENT_ID }));
  const get = vi.fn(() => coordinator);
  const coordinatorNamespace = Object.assign(Object.create(null), { idFromName, get });
  const env = Object.assign(Object.create(null), {
    APP_ENV: input?.appEnv ?? "production",
    DATA_JURISDICTION: "eu",
    DB: database,
    EVENT_COORDINATOR: coordinatorNamespace,
  }) as Env;
  return { env, prepared, batched, batch, coordinatorFetch };
}

function authorizedDevice(role: AuthorizedDevice["role"] = "ADMIN"): AuthorizedDevice {
  return {
    id: DEVICE_ID,
    role,
    accountId: "550e8400-e29b-41d4-a716-446655440112",
    loginCode: "ADMIN-01",
  };
}

function serviceDependencies(input?: {
  actor?: AuthorizedDevice | null;
  browserBindingHash?: string | null;
  cleanup?: "success" | "failure";
  credentialValid?: boolean;
}) {
  const authorizeDevice = vi.fn(async () =>
    input && "actor" in input ? (input.actor ?? null) : authorizedDevice(),
  );
  const sessionBrowserBindingHash = vi.fn(async () =>
    input && "browserBindingHash" in input ? (input.browserBindingHash ?? null) : "browser-hash",
  );
  const verifyCredential = vi.fn(async () => input?.credentialValid ?? false);
  const finishEventDeletionAssetCleanup = vi.fn(
    async (
      _env: Env,
      _commandId: string,
      _logoObjectKeys: readonly string[],
      response: EventDeletionResponse,
    ) => {
      if (input?.cleanup === "failure") throw new Error("Synthetic R2 failure");
      return { ...response, assetCleanupPending: false };
    },
  );
  return {
    authorizeDevice,
    finishEventDeletionAssetCleanup,
    now: () => NOW,
    sessionBrowserBindingHash,
    sha256Hex: vi.fn(async () => "request-hash"),
    verifyCredential,
  };
}

function request(headers?: Record<string, string>): Request {
  return new Request(`https://worker.test/api/admin/events/${EVENT_ID}`, {
    ...(headers ? { headers } : {}),
  });
}

function findStatement(statements: MockStatement[], fragment: string): MockStatement {
  const statement = statements.find((candidate) => candidate.sql.includes(fragment));
  expect(statement, `statement containing ${fragment}`).toBeDefined();
  if (!statement) throw new Error(`Missing statement: ${fragment}`);
  return statement;
}

describe("admin event deletion service", () => {
  it("authenticates a replay from its receipt and resumes pending asset cleanup", async () => {
    const storedResponse = deletionBody();
    const { env, batch } = createServiceEnvironment({
      prior: {
        request_hash: "request-hash",
        actor_device_id: DEVICE_ID,
        browser_binding_hash: "browser-hash",
        legacy_credential_hash: null,
        r2_cleanup_pending: 1,
        logo_object_keys_json: JSON.stringify(["logos/light.svg"]),
        response_json: JSON.stringify(storedResponse),
      },
    });
    const dependencies = serviceDependencies();

    const result = await deleteAdminEvent(
      env,
      EVENT_ID,
      SOURCE_EVENT_ID,
      deletionInput,
      request(),
      dependencies,
    );

    expect(result).toEqual({
      status: 200,
      body: { ...storedResponse, assetCleanupPending: false },
    });
    expect(dependencies.authorizeDevice).not.toHaveBeenCalled();
    expect(dependencies.finishEventDeletionAssetCleanup).toHaveBeenCalledWith(
      env,
      COMMAND_ID,
      ["logos/light.svg"],
      storedResponse,
    );
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects unauthorized and conflicting receipt replays", async () => {
    const prior = {
      request_hash: "different-hash",
      actor_device_id: DEVICE_ID,
      browser_binding_hash: "browser-hash",
      legacy_credential_hash: null,
      r2_cleanup_pending: 0,
      logo_object_keys_json: "[]",
      response_json: JSON.stringify(deletionBody()),
    };
    const unauthorized = createServiceEnvironment({ prior });
    const conflict = createServiceEnvironment({ prior });

    const [unauthorizedResult, conflictResult] = await Promise.all([
      deleteAdminEvent(
        unauthorized.env,
        EVENT_ID,
        SOURCE_EVENT_ID,
        deletionInput,
        request(),
        serviceDependencies({ browserBindingHash: null }),
      ),
      deleteAdminEvent(
        conflict.env,
        EVENT_ID,
        SOURCE_EVENT_ID,
        deletionInput,
        request(),
        serviceDependencies(),
      ),
    ]);

    expect(unauthorizedResult).toMatchObject({
      status: 403,
      body: { error: { code: "ADMIN_REQUIRED" } },
    });
    expect(conflictResult).toMatchObject({
      status: 409,
      body: { error: { code: "IDEMPOTENCY_CONFLICT" } },
    });
  });

  it("requires a newly authorized ADMIN before loading the target event", async () => {
    const { env, prepared, batch } = createServiceEnvironment();
    const dependencies = serviceDependencies({ actor: authorizedDevice("FLIGHT_DIRECTOR") });

    const result = await deleteAdminEvent(
      env,
      EVENT_ID,
      SOURCE_EVENT_ID,
      deletionInput,
      request(),
      dependencies,
    );

    expect(result).toMatchObject({
      status: 403,
      body: { error: { code: "ADMIN_REQUIRED" } },
    });
    expect(dependencies.authorizeDevice).toHaveBeenCalledWith(
      env,
      SOURCE_EVENT_ID,
      expect.any(Request),
    );
    expect(prepared.some((statement) => statement.sql.includes("FROM operation_days WHERE"))).toBe(
      false,
    );
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects missing, stale and busy events before destructive persistence", async () => {
    const missing = createServiceEnvironment({ event: null });
    const stale = createServiceEnvironment({ event: { id: EVENT_ID, version: 8 } });
    const busy = createServiceEnvironment({ coordinatorOk: false });

    const results = await Promise.all([
      deleteAdminEvent(
        missing.env,
        EVENT_ID,
        SOURCE_EVENT_ID,
        deletionInput,
        request(),
        serviceDependencies(),
      ),
      deleteAdminEvent(
        stale.env,
        EVENT_ID,
        SOURCE_EVENT_ID,
        deletionInput,
        request(),
        serviceDependencies(),
      ),
      deleteAdminEvent(
        busy.env,
        EVENT_ID,
        SOURCE_EVENT_ID,
        deletionInput,
        request(),
        serviceDependencies(),
      ),
    ]);

    expect(results.map((result) => result.status)).toEqual([404, 409, 409]);
    expect(
      results.map((result) => ("error" in result.body ? result.body.error.code : null)),
    ).toEqual(["EVENT_NOT_FOUND", "EVENT_VERSION_CONFLICT", "EVENT_BUSY"]);
    expect(missing.batch).not.toHaveBeenCalled();
    expect(stale.batch).not.toHaveBeenCalled();
    expect(busy.batch).not.toHaveBeenCalled();
  });

  it("requires replacement event and bootstrap administration before deletion", async () => {
    const missingSessionTarget = createServiceEnvironment({
      eventCount: 2,
      sessionRebindEvent: null,
    });
    const missingBootstrapAdmin = createServiceEnvironment({
      eventCount: 2,
      bootstrapEventId: EVENT_ID,
      sessionRebindEvent: { id: SOURCE_EVENT_ID },
      replacement: null,
    });

    const results = await Promise.all([
      deleteAdminEvent(
        missingSessionTarget.env,
        EVENT_ID,
        SOURCE_EVENT_ID,
        deletionInput,
        request(),
        serviceDependencies(),
      ),
      deleteAdminEvent(
        missingBootstrapAdmin.env,
        EVENT_ID,
        SOURCE_EVENT_ID,
        deletionInput,
        request(),
        serviceDependencies(),
      ),
    ]);

    expect(
      results.map((result) => ("error" in result.body ? result.body.error.code : null)),
    ).toEqual(["EVENT_DELETE_REPLACEMENT_MISSING", "EVENT_DELETE_BOOTSTRAP_REPLACEMENT_MISSING"]);
    expect(missingSessionTarget.batch).not.toHaveBeenCalled();
    expect(missingBootstrapAdmin.batch).not.toHaveBeenCalled();
  });

  it("deletes the last event atomically and keeps failed R2 cleanup resumable", async () => {
    const { env, batched, coordinatorFetch } = createServiceEnvironment({ eventCount: 1 });
    const dependencies = serviceDependencies({ cleanup: "failure" });

    const result = await deleteAdminEvent(
      env,
      EVENT_ID,
      SOURCE_EVENT_ID,
      deletionInput,
      request(),
      dependencies,
    );

    expect(result).toEqual({ status: 202, body: deletionBody() });
    expect(coordinatorFetch).toHaveBeenCalledWith(
      `https://internal/events/${EVENT_ID}/factory-reset`,
      { method: "POST" },
    );
    expect(batched).toHaveLength(1);
    const statements = batched[0] ?? [];
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("UPDATE system_reset_control SET active = 1");
    expect(sql).toContain("DELETE FROM app_bootstrap");
    expect(sql).toContain("DELETE FROM operation_days WHERE id = ?1");
    expect(sql).toContain("DELETE FROM operator_sessions");
    expect(sql).toContain("DELETE FROM operator_accounts");
    expect(sql).toContain("UPDATE system_reset_control SET active = 0");
    const receipt = findStatement(statements, "INSERT INTO event_deletion_receipts");
    expect(receipt.bindings.slice(0, 9)).toEqual([
      COMMAND_ID,
      "request-hash",
      SOURCE_EVENT_ID,
      EVENT_ID,
      7,
      DEVICE_ID,
      "browser-hash",
      null,
      NOW.toISOString(),
    ]);
    expect(dependencies.finishEventDeletionAssetCleanup).toHaveBeenCalledWith(
      env,
      COMMAND_ID,
      ["logos/light.svg", "logos/dark.svg"],
      deletionBody(),
    );
  });

  it("rebinds bootstrap and active sessions when other events remain", async () => {
    const { env, batched } = createServiceEnvironment({
      eventCount: 2,
      bootstrapEventId: EVENT_ID,
      sessionRebindEvent: { id: SOURCE_EVENT_ID },
      replacement: { id: SOURCE_EVENT_ID, admin_device_id: "replacement-admin" },
    });
    const dependencies = serviceDependencies();

    const result = await deleteAdminEvent(
      env,
      EVENT_ID,
      SOURCE_EVENT_ID,
      deletionInput,
      request(),
      dependencies,
    );

    expect(result).toEqual({
      status: 200,
      body: deletionBody({ setupRequired: false, assetCleanupPending: false }),
    });
    const statements = batched[0] ?? [];
    expect(findStatement(statements, "UPDATE app_bootstrap").bindings).toEqual([
      SOURCE_EVENT_ID,
      "replacement-admin",
      EVENT_ID,
    ]);
    expect(findStatement(statements, "UPDATE paired_devices").bindings).toEqual([
      SOURCE_EVENT_ID,
      NOW.toISOString(),
      EVENT_ID,
    ]);
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).not.toContain("DELETE FROM operator_sessions");
    expect(sql).not.toContain("DELETE FROM operator_accounts");
  });
});
