import type { CloneEventRequest } from "@rundflug/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerAdminEventCloneRoutes } from "./admin-event-clone-routes";
import { type AdminEventCloneResult, cloneAdminEvent } from "./admin-event-clone-service";
import type { SessionActor } from "./auth";
import type { AuthorizedDevice } from "./device-authorization";
import type { Env } from "./types";

const SOURCE_EVENT_ID = "synthetic-source";
const TARGET_EVENT_ID = "synthetic-target";
const ADMIN_DEVICE_ID = "550e8400-e29b-41d4-a716-446655440100";
const COMMAND_ID = "550e8400-e29b-41d4-a716-446655440101";
const NOW = new Date("2026-08-09T20:00:00.000Z");

const cloneRequest: CloneEventRequest = {
  commandId: COMMAND_ID,
  expectedSourceVersion: 7,
  eventId: TARGET_EVENT_ID,
  name: "Synthetic target event",
  eventDate: "2027-08-09",
  aerodrome: "EDXX",
  timeZone: "Europe/Berlin",
  restartMode: "KEEP_MASTER_DATA",
};

function adminDevice(role: AuthorizedDevice["role"] = "ADMIN"): AuthorizedDevice {
  return {
    id: ADMIN_DEVICE_ID,
    role,
    accountId: "550e8400-e29b-41d4-a716-446655440102",
    loginCode: "ADMIN-01",
  };
}

function createRouteApp(input?: {
  device?: AuthorizedDevice | null;
  result?: AdminEventCloneResult;
}) {
  const database = Object.create(null) as D1Database;
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: database,
  }) as Env;
  const device = input && "device" in input ? (input.device ?? null) : adminDevice();
  const authorizeDevice = vi.fn(async () => device);
  const result = input?.result ?? {
    status: 201,
    body: { eventId: TARGET_EVENT_ID, templateSourceId: SOURCE_EVENT_ID },
  };
  const cloneEvent = vi.fn(async () => result);
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerAdminEventCloneRoutes(app, {
    authorizeDevice,
    cloneAdminEvent: cloneEvent,
  });
  return { app, env, authorizeDevice, cloneEvent };
}

function jsonRequest(body: unknown) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

describe("admin event clone route", () => {
  it("requires an ADMIN device before parsing or cloning", async () => {
    for (const device of [null, adminDevice("FLIGHT_DIRECTOR")]) {
      const { app, env, cloneEvent } = createRouteApp({ device });

      const response = await app.request(
        `https://worker.test/api/admin/events/${SOURCE_EVENT_ID}/clone`,
        jsonRequest(cloneRequest),
        env,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
      expect(cloneEvent).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid event input before calling the clone service", async () => {
    const { app, env, cloneEvent } = createRouteApp();

    const response = await app.request(
      `https://worker.test/api/admin/events/${SOURCE_EVENT_ID}/clone`,
      jsonRequest({ ...cloneRequest, eventId: "Invalid event id" }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_EVENT" } });
    expect(cloneEvent).not.toHaveBeenCalled();
  });

  it("maps service success and conflict results without changing their payloads", async () => {
    const created = createRouteApp();
    const conflictResult: AdminEventCloneResult = {
      status: 409,
      body: {
        error: { code: "STALE_VERSION", message: "Synthetic stale version." },
      },
    };
    const conflict = createRouteApp({ result: conflictResult });

    const [createdResponse, conflictResponse] = await Promise.all([
      created.app.request(
        `https://worker.test/api/admin/events/${SOURCE_EVENT_ID}/clone`,
        jsonRequest(cloneRequest),
        created.env,
      ),
      conflict.app.request(
        `https://worker.test/api/admin/events/${SOURCE_EVENT_ID}/clone`,
        jsonRequest(cloneRequest),
        conflict.env,
      ),
    ]);

    expect(createdResponse.status).toBe(201);
    await expect(createdResponse.json()).resolves.toEqual({
      eventId: TARGET_EVENT_ID,
      templateSourceId: SOURCE_EVENT_ID,
    });
    expect(created.cloneEvent).toHaveBeenCalledWith(
      created.env,
      SOURCE_EVENT_ID,
      ADMIN_DEVICE_ID,
      cloneRequest,
    );
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toEqual(conflictResult.body);
  });
});

interface MockStatement {
  sql: string;
  bindings: unknown[];
  first: () => Promise<unknown>;
  all: () => Promise<{ results: Record<string, unknown>[] }>;
}

const sourceEvent = {
  version: 7,
  no_show_after_minutes: 15,
  max_ticket_deferrals: 2,
  notification_lead_minutes: 20,
  child_reference_weight_kg: 35,
  normal_reference_weight_kg: 80,
  heavy_reference_weight_kg: 110,
  planned_boarding_minutes: 5,
  planned_deboarding_minutes: 3,
  planned_buffer_minutes: 2,
};

const sourceRows = {
  gates: [
    {
      id: "source-gate",
      label: "Synthetic gate",
      gate_type: "FLIGHT_LINE",
      active: 1,
      sort_order: 1,
      travel_lead_minutes: 4,
      display_filter_json: JSON.stringify({
        productIds: ["source-product"],
        rotationStatuses: ["CALLED"],
      }),
    },
  ],
  groups: [
    {
      id: "source-group",
      name: "Synthetic group",
      short_code: "SYN",
      gate_id: "source-gate",
      reference_capacity: 3,
      compatible_aircraft_types_json: JSON.stringify(["C172"]),
    },
  ],
  products: [
    {
      id: "source-product",
      resource_group_id: "source-group",
      gate_id: "source-gate",
      name: "Synthetic flight",
      price_cents: 5000,
      capacity_warning_threshold: 12,
      capacity_critical_threshold: 4,
      code: "SYN-20",
      public_description: "",
      child_companion_required: 0,
      sort_order: 1,
      weight_classes_json: JSON.stringify(["NOT_CAPTURED"]),
      reference_capacity: 3,
      reference_duration_minutes: 20,
      promised_flight_minutes: 15,
      planned_boarding_minutes_override: null,
      planned_deboarding_minutes_override: null,
      planned_buffer_minutes_override: null,
    },
  ],
  pilots: [{ id: "source-pilot", operational_code: "P-01", active: 1 }],
  memberships: [
    {
      id: "source-membership",
      resource_group_id: "source-group",
      aircraft_id: "source-aircraft",
    },
  ],
  turnaroundOverrides: [
    {
      aircraft_id: "source-aircraft",
      product_id: "source-product",
      planned_boarding_minutes_override: 6,
      planned_deboarding_minutes_override: 4,
      planned_buffer_minutes_override: 3,
    },
  ],
};

function createServiceEnvironment(input?: {
  appEnv?: Env["APP_ENV"];
  credential?: { credential_hash: string | null } | null;
  receipt?: { operation_day_id: string; device_id: string; response_json: string } | null;
  existing?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  rows?: Partial<typeof sourceRows>;
}) {
  const prepared: MockStatement[] = [];
  const batched: MockStatement[][] = [];
  const mergedRows = { ...sourceRows, ...input?.rows };
  const rowsFor = (sql: string): Record<string, unknown>[] => {
    if (sql.includes("FROM gates")) return mergedRows.gates;
    if (sql.includes("FROM resource_groups")) return mergedRows.groups;
    if (sql.includes("FROM products")) return mergedRows.products;
    if (sql.includes("FROM pilots")) return mergedRows.pilots;
    if (sql.includes("FROM resource_group_memberships")) return mergedRows.memberships;
    if (sql.includes("FROM aircraft_product_turnaround_overrides")) {
      return mergedRows.turnaroundOverrides;
    }
    return [];
  };
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => {
      const statement: MockStatement = {
        sql,
        bindings,
        first: async () => {
          if (sql.includes("SELECT credential_hash")) {
            return input && "credential" in input ? (input.credential ?? null) : null;
          }
          if (sql.includes("FROM idempotency_receipts")) {
            return input && "receipt" in input ? (input.receipt ?? null) : null;
          }
          if (sql === "SELECT id FROM operation_days WHERE id = ?1") {
            return input && "existing" in input ? (input.existing ?? null) : null;
          }
          if (sql === "SELECT * FROM operation_days WHERE id = ?1") {
            return input && "source" in input ? (input.source ?? null) : sourceEvent;
          }
          return null;
        },
        all: async () => ({ results: rowsFor(sql) }),
      };
      prepared.push(statement);
      return statement;
    },
  }));
  const batch = vi.fn(async (statements: MockStatement[]) => {
    batched.push(statements);
    return statements.map(() => ({ meta: { changes: 1 } }));
  });
  const database = Object.assign(Object.create(null), { prepare, batch }) as D1Database;
  const env = Object.assign(Object.create(null), {
    APP_ENV: input?.appEnv ?? "production",
    DATA_JURISDICTION: "eu",
    DB: database,
  }) as Env;
  return { env, prepared, batched, prepare, batch };
}

function deterministicIds() {
  let sequence = 0;
  return vi.fn(() => `synthetic-id-${++sequence}` as ReturnType<typeof crypto.randomUUID>);
}

function findStatement(statements: MockStatement[], fragment: string): MockStatement {
  const statement = statements.find((candidate) => candidate.sql.includes(fragment));
  expect(statement, `statement containing ${fragment}`).toBeDefined();
  if (!statement) throw new Error(`Missing statement: ${fragment}`);
  return statement;
}

describe("admin event clone service", () => {
  it("replays a matching receipt and rejects a receipt owned by another source", async () => {
    const storedResponse = {
      eventId: TARGET_EVENT_ID,
      templateSourceId: SOURCE_EVENT_ID,
    };
    const matching = createServiceEnvironment({
      receipt: {
        operation_day_id: SOURCE_EVENT_ID,
        device_id: ADMIN_DEVICE_ID,
        response_json: JSON.stringify(storedResponse),
      },
    });
    const conflicting = createServiceEnvironment({
      receipt: {
        operation_day_id: "another-source",
        device_id: ADMIN_DEVICE_ID,
        response_json: JSON.stringify(storedResponse),
      },
    });

    await expect(
      cloneAdminEvent(matching.env, SOURCE_EVENT_ID, ADMIN_DEVICE_ID, cloneRequest),
    ).resolves.toEqual({ status: 200, body: storedResponse });
    await expect(
      cloneAdminEvent(conflicting.env, SOURCE_EVENT_ID, ADMIN_DEVICE_ID, cloneRequest),
    ).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "IDEMPOTENCY_CONFLICT" } },
    });
    expect(matching.batch).not.toHaveBeenCalled();
    expect(conflicting.batch).not.toHaveBeenCalled();
  });

  it("rejects an existing target, a missing source and a stale source version", async () => {
    const existing = createServiceEnvironment({ existing: { id: TARGET_EVENT_ID } });
    const missing = createServiceEnvironment({ source: null });
    const stale = createServiceEnvironment({ source: { ...sourceEvent, version: 8 } });

    const results = await Promise.all([
      cloneAdminEvent(existing.env, SOURCE_EVENT_ID, ADMIN_DEVICE_ID, cloneRequest),
      cloneAdminEvent(missing.env, SOURCE_EVENT_ID, ADMIN_DEVICE_ID, cloneRequest),
      cloneAdminEvent(stale.env, SOURCE_EVENT_ID, ADMIN_DEVICE_ID, cloneRequest),
    ]);

    expect(results.map((result) => result.status)).toEqual([409, 404, 409]);
    expect(
      results.map((result) => ("error" in result.body ? result.body.error.code : null)),
    ).toEqual(["EVENT_ID_EXISTS", "EVENT_NOT_FOUND", "STALE_VERSION"]);
    expect(existing.batch).not.toHaveBeenCalled();
    expect(missing.batch).not.toHaveBeenCalled();
    expect(stale.batch).not.toHaveBeenCalled();
  });

  it("atomically clones portable master data and remaps internal relationships", async () => {
    const { env, batched } = createServiceEnvironment({
      appEnv: "development",
      credential: { credential_hash: "synthetic-legacy-hash" },
    });
    const randomUUID = deterministicIds();

    const result = await cloneAdminEvent(env, SOURCE_EVENT_ID, ADMIN_DEVICE_ID, cloneRequest, {
      now: () => NOW,
      randomUUID,
    });

    expect(result).toEqual({
      status: 201,
      body: {
        eventId: TARGET_EVENT_ID,
        templateSourceId: SOURCE_EVENT_ID,
        adminDeviceId: "synthetic-id-4",
      },
    });
    expect(batched).toHaveLength(1);
    const statements = batched[0] ?? [];
    expect(statements).toHaveLength(11);
    const gate = findStatement(statements, "INSERT INTO gates");
    const group = findStatement(statements, "INSERT INTO resource_groups");
    const product = findStatement(statements, "INSERT INTO products");
    const membership = findStatement(statements, "INSERT INTO resource_group_memberships");
    const override = findStatement(statements, "INSERT INTO aircraft_product_turnaround_overrides");
    expect(gate.bindings[0]).toBe("synthetic-id-1");
    expect(JSON.parse(String(gate.bindings[7]))).toEqual({
      productIds: ["synthetic-id-3"],
      rotationStatuses: ["CALLED"],
    });
    expect(group.bindings[5]).toBe("synthetic-id-1");
    expect(product.bindings[2]).toBe("synthetic-id-2");
    expect(product.bindings[13]).toBe("synthetic-id-1");
    expect(membership.bindings[2]).toBe("synthetic-id-2");
    expect(membership.bindings[3]).toBe("source-aircraft");
    expect(membership.bindings[5]).toBe("synthetic-id-4");
    expect(override.bindings[1]).toBe("source-aircraft");
    expect(override.bindings[2]).toBe("synthetic-id-3");
    const pairedDevice = findStatement(statements, "INSERT INTO paired_devices");
    expect(pairedDevice.bindings).toEqual([
      "synthetic-id-4",
      TARGET_EVENT_ID,
      NOW.toISOString(),
      "synthetic-legacy-hash",
    ]);
    expect(findStatement(statements, "INSERT INTO operational_events").sql).toContain(
      "EVENT_CREATED_FROM_TEMPLATE",
    );
    expect(findStatement(statements, "INSERT INTO outbox").sql).toContain(
      "EVENT_CREATED_FROM_TEMPLATE",
    );
    const receipt = findStatement(statements, "INSERT INTO idempotency_receipts");
    expect(receipt.bindings.slice(0, 3)).toEqual([COMMAND_ID, SOURCE_EVENT_ID, ADMIN_DEVICE_ID]);
  });

  it("creates an empty production restart without exposing a legacy device id", async () => {
    const { env, batched, prepared } = createServiceEnvironment({ appEnv: "production" });
    const randomUUID = deterministicIds();

    const result = await cloneAdminEvent(
      env,
      SOURCE_EVENT_ID,
      ADMIN_DEVICE_ID,
      { ...cloneRequest, restartMode: "EMPTY" },
      { now: () => NOW, randomUUID },
    );

    expect(result).toEqual({
      status: 201,
      body: { eventId: TARGET_EVENT_ID, templateSourceId: SOURCE_EVENT_ID },
    });
    expect(prepared.some((statement) => statement.sql.includes("SELECT credential_hash"))).toBe(
      false,
    );
    expect(batched).toHaveLength(1);
    const statements = batched[0] ?? [];
    expect(statements).toHaveLength(5);
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("INSERT INTO operation_days");
    expect(sql).toContain("INSERT INTO paired_devices");
    expect(sql).toContain("INSERT INTO operational_events");
    expect(sql).toContain("INSERT INTO outbox");
    expect(sql).toContain("INSERT INTO idempotency_receipts");
    expect(sql).not.toMatch(
      /INSERT INTO (gates|resource_groups|products|pilots|resource_group_memberships|aircraft_product_turnaround_overrides)/,
    );
    expect(findStatement(statements, "INSERT INTO paired_devices").bindings[3]).toBeNull();
  });
});
