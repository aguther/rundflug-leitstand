import { describe, expect, it, vi } from "vitest";
import { createMigratedTestDatabase } from "../test-support/migrated-database";
import {
  DispatchRecommendationLeaseService,
  type StoredDispatchRecommendationLease,
} from "./dispatch-recommendation-lease-service";
import { EVENT_DELETION_SQL } from "./event-deletion";
import { FACTORY_RESET_DELETE_TABLES } from "./factory-reset";
import type { Env } from "./types";

type DatabaseSync = ReturnType<typeof createMigratedTestDatabase>;

interface LeasePreparedQuery {
  sql: string;
  parameters: unknown[];
  first: () => Promise<unknown>;
  all: () => Promise<{ results: Record<string, unknown>[] }>;
}

function createLeaseService(
  firstRows: unknown[],
  allRows: Array<Array<Record<string, unknown>>> = [],
) {
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]): LeasePreparedQuery => ({
      sql,
      parameters,
      first: async () => firstRows.shift() ?? null,
      all: async () => ({ results: allRows.shift() ?? [] }),
    }),
  }));
  const batch = vi.fn(async (statements: LeasePreparedQuery[]) => statements);
  const waitUntil = vi.fn();
  const recalculate = vi.fn();
  const schedule = vi.fn(async () => undefined);
  return {
    service: new DispatchRecommendationLeaseService(
      { DB: { prepare, batch } as unknown as D1Database } as unknown as Env,
      waitUntil,
      () => null,
      recalculate,
      schedule,
    ),
    batch,
    prepare,
    recalculate,
    schedule,
    waitUntil,
  };
}

const leaseUrl = new URL(
  "https://worker.test/internal/events/event-a/dispatch-recommendation-leases",
);

function leaseRequest(
  body: unknown,
  input: {
    role?: string | null;
    accountId?: string | null;
    deviceId?: string | null;
    method?: string;
  } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (input.accountId !== null) {
    headers.set("x-operator-account-id", input.accountId ?? "account-a");
  }
  if (input.deviceId !== null) {
    headers.set("x-operator-device-id", input.deviceId ?? "device-a");
  }
  if (input.role !== null) headers.set("x-operator-role", input.role ?? "FLIGHT_DIRECTOR");
  return new Request(leaseUrl, {
    method: input.method ?? "POST",
    headers,
    body: input.method === "DELETE" ? null : JSON.stringify(body),
  });
}

const acquireLease = {
  commandId: "00e971df-23d5-4d28-9107-92b447416202",
  aircraftId: "aircraft-a",
  expectedVersion: 7,
} as const;

function storedLease(
  overrides: Partial<StoredDispatchRecommendationLease> = {},
): StoredDispatchRecommendationLease {
  return {
    id: "00e971df-23d5-4d28-9107-92b447416203",
    operation_day_id: "event-a",
    aircraft_id: "aircraft-a",
    operator_account_id: "account-a",
    device_id: "device-a",
    acquire_command_id: acquireLease.commandId,
    dispatch_plan_revision: "plan-a",
    dispatch_batch_id: "batch-a",
    dispatch_order: 1,
    ticket_group_ids_json: '["group-a"]',
    occupied_seats: 2,
    available_seats: 1,
    decision_reasons_json: '["CAPACITY_OPTIMIZED"]',
    operation_day_version: 7,
    member_rotation_ids_json: '["rotation-a"]',
    status: "ACTIVE",
    acquired_at: "2026-08-12T09:00:00.000Z",
    expires_at: "2099-08-12T09:01:30.000Z",
    version: 1,
    ...overrides,
  };
}

function createLeaseDatabase(): DatabaseSync {
  const database = createMigratedTestDatabase();
  database.exec(`
    INSERT INTO operation_days (id, name, event_date, created_at, updated_at)
    VALUES ('event-a', 'Synthetic', '2026-08-15', '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
    INSERT INTO aircraft
      (id, registration, aircraft_type, passenger_seats, created_at, updated_at)
    VALUES
      ('aircraft-a', 'D-TSTA', 'SYNTHETIC', 3, '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z'),
      ('aircraft-b', 'D-TSTB', 'SYNTHETIC', 3, '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
    INSERT INTO operator_accounts
      (id, login_code, role, pin_hash, created_at, updated_at)
    VALUES
      ('account-a', 'FD-01', 'FLIGHT_DIRECTOR', 'synthetic-hash', '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z'),
      ('account-b', 'FD-02', 'FLIGHT_DIRECTOR', 'synthetic-hash', '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
  `);
  return database;
}

function insertLease(
  database: DatabaseSync,
  input: {
    id: string;
    aircraftId: string;
    accountId: string;
    deviceId: string;
    commandId: string;
    batchId: string;
  },
) {
  database
    .prepare(
      `INSERT INTO dispatch_recommendation_leases
        (id, operation_day_id, aircraft_id, operator_account_id, device_id,
         acquire_command_id, dispatch_plan_revision, dispatch_batch_id, dispatch_order,
         ticket_group_ids_json, occupied_seats, available_seats, decision_reasons_json,
         status, acquired_at, expires_at)
       VALUES (?, 'event-a', ?, ?, ?, ?, 'plan-a', ?, 1, '["group-a"]', 2, 1,
               '["CAPACITY_OPTIMIZED"]', 'ACTIVE', '2026-08-03T19:00:00.000Z',
               '2026-08-03T19:01:30.000Z')`,
    )
    .run(
      input.id,
      input.aircraftId,
      input.accountId,
      input.deviceId,
      input.commandId,
      input.batchId,
    );
}

describe("dispatch recommendation lease authorization and concurrency", () => {
  it("rejects incomplete and unauthorized sessions before reading operational data", async () => {
    const incomplete = createLeaseService([]);
    const incompleteResponse = await incomplete.service.handleRequest(
      leaseRequest(acquireLease, { accountId: null }),
      leaseUrl,
    );
    expect(incompleteResponse.status).toBe(401);
    await expect(incompleteResponse.json()).resolves.toMatchObject({
      error: { code: "SESSION_NOT_AUTHORIZED" },
    });
    expect(incomplete.prepare).not.toHaveBeenCalled();

    const unauthorized = createLeaseService([]);
    const unauthorizedResponse = await unauthorized.service.handleRequest(
      leaseRequest(acquireLease, { role: "CASHIER" }),
      leaseUrl,
    );
    expect(unauthorizedResponse.status).toBe(403);
    await expect(unauthorizedResponse.json()).resolves.toMatchObject({
      error: { code: "ROLE_NOT_AUTHORIZED" },
    });
    expect(unauthorized.prepare).not.toHaveBeenCalled();
  });

  it("rejects missing events and malformed acquisitions without persistence", async () => {
    const missingEvent = createLeaseService([null]);
    const missingEventResponse = await missingEvent.service.handleRequest(
      leaseRequest(acquireLease),
      leaseUrl,
    );
    expect(missingEventResponse.status).toBe(404);
    await expect(missingEventResponse.json()).resolves.toMatchObject({
      error: { code: "EVENT_NOT_FOUND" },
    });

    const malformed = createLeaseService([{ version: 7 }]);
    const malformedResponse = await malformed.service.handleRequest(
      leaseRequest({ ...acquireLease, commandId: "not-a-uuid" }),
      leaseUrl,
    );
    expect(malformedResponse.status).toBe(400);
    await expect(malformedResponse.json()).resolves.toMatchObject({
      error: { code: "INVALID_DISPATCH_RECOMMENDATION_LEASE" },
    });
    expect(malformed.batch).not.toHaveBeenCalled();
  });

  it("rejects stale acquisition versions before resolving a recommendation", async () => {
    const { service, batch, recalculate } = createLeaseService([{ version: 8 }]);

    const response = await service.handleRequest(leaseRequest(acquireLease), leaseUrl);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_VERSION", currentVersion: 8 },
    });
    expect(batch).not.toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
  });

  it("returns an active idempotent acquisition without creating another lease", async () => {
    const { service, batch, recalculate } = createLeaseService([{ version: 7 }, storedLease()]);

    const response = await service.handleRequest(leaseRequest(acquireLease), leaseUrl);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      leaseId: "00e971df-23d5-4d28-9107-92b447416203",
      aircraftId: "aircraft-a",
      groupIds: ["group-a"],
      decisionReasons: ["CAPACITY_OPTIMIZED"],
    });
    expect(batch).not.toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
  });

  it("detects idempotency conflicts and completed acquisitions", async () => {
    const conflict = createLeaseService([
      { version: 7 },
      storedLease({ device_id: "different-device" }),
    ]);
    const conflictResponse = await conflict.service.handleRequest(
      leaseRequest(acquireLease),
      leaseUrl,
    );
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const completed = createLeaseService([{ version: 7 }, storedLease({ status: "RELEASED" })]);
    const completedResponse = await completed.service.handleRequest(
      leaseRequest(acquireLease),
      leaseUrl,
    );
    expect(completedResponse.status).toBe(409);
    await expect(completedResponse.json()).resolves.toMatchObject({
      error: { code: "DISPATCH_RECOMMENDATION_LEASE_FINISHED" },
    });
  });

  it("rejects missing, unavailable, and unclaimed aircraft", async () => {
    const missing = createLeaseService([{ version: 7 }, null, null]);
    const missingResponse = await missing.service.handleRequest(
      leaseRequest(acquireLease),
      leaseUrl,
    );
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: { code: "AIRCRAFT_NOT_FOUND" },
    });

    const unavailable = createLeaseService([
      { version: 7 },
      null,
      {
        id: "aircraft-a",
        passenger_seats: 3,
        operational_state: "MAINTENANCE",
        resource_group_id: "resource-a",
        current_pilot_id: null,
      },
    ]);
    const unavailableResponse = await unavailable.service.handleRequest(
      leaseRequest(acquireLease),
      leaseUrl,
    );
    expect(unavailableResponse.status).toBe(409);
    await expect(unavailableResponse.json()).resolves.toMatchObject({
      error: { code: "AIRCRAFT_NOT_AVAILABLE" },
    });

    const unclaimed = createLeaseService([
      { version: 7 },
      null,
      {
        id: "aircraft-a",
        passenger_seats: 3,
        operational_state: "AVAILABLE",
        resource_group_id: "resource-a",
        current_pilot_id: null,
      },
      null,
    ]);
    const unclaimedResponse = await unclaimed.service.handleRequest(
      leaseRequest(acquireLease, { role: "FLIGHT_LINE" }),
      leaseUrl,
    );
    expect(unclaimedResponse.status).toBe(409);
    await expect(unclaimedResponse.json()).resolves.toMatchObject({
      error: { code: "AIRCRAFT_ASSIST_CLAIM_REQUIRED" },
    });
  });

  it("treats release of a missing lease as an idempotent no-op", async () => {
    const releaseUrl = new URL(`${leaseUrl.href}/missing-lease`);
    const { service, batch, schedule } = createLeaseService([{ version: 7 }, null]);

    const response = await service.handleRequest(
      leaseRequest(null, { method: "DELETE" }),
      releaseUrl,
    );

    expect(response.status).toBe(204);
    expect(batch).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("releases an owned active lease atomically before scheduling a forecast", async () => {
    const releaseUrl = new URL(`${leaseUrl.href}/00e971df-23d5-4d28-9107-92b447416203`);
    const { service, batch, schedule, waitUntil } = createLeaseService([
      { version: 7 },
      storedLease(),
    ]);

    const response = await service.handleRequest(
      leaseRequest(null, { method: "DELETE" }),
      releaseUrl,
    );

    expect(response.status).toBe(204);
    expect(batch).toHaveBeenCalledOnce();
    const statements = batch.mock.calls[0]?.[0] ?? [];
    expect(statements.map(({ sql }) => sql).join("\n")).toMatch(
      /UPDATE dispatch_recommendation_leases[\s\S]*INSERT INTO operational_events[\s\S]*INSERT INTO outbox/,
    );
    expect(schedule).toHaveBeenCalledWith("event-a", "DISPATCH_RECOMMENDATION_LEASE_CHANGED");
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("rejects an operator-device lease that is already held for another aircraft", async () => {
    const { service, batch } = createLeaseService([
      { version: 7 },
      null,
      {
        id: "aircraft-a",
        passenger_seats: 3,
        operational_state: "AVAILABLE",
        resource_group_id: "resource-a",
        current_pilot_id: null,
      },
      storedLease({ aircraft_id: "aircraft-b" }),
    ]);

    const response = await service.handleRequest(leaseRequest(acquireLease), leaseUrl);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DISPATCH_RECOMMENDATION_LEASE_ALREADY_HELD" },
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("returns no recommendation when the current plan has no eligible unreserved batch", async () => {
    const { service, batch, recalculate } = createLeaseService([
      { version: 7 },
      null,
      {
        id: "aircraft-a",
        passenger_seats: 3,
        operational_state: "AVAILABLE",
        resource_group_id: "resource-a",
        current_pilot_id: null,
      },
      null,
      null,
      { dispatch_plan_revision: "plan-a" },
    ]);

    const response = await service.handleRequest(leaseRequest(acquireLease), leaseUrl);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DISPATCH_RECOMMENDATION_NOT_AVAILABLE" },
    });
    expect(batch).not.toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
  });

  it("acquires the current complete batch and expires obsolete leases atomically", async () => {
    const planningRows = [
      {
        attendance_status: "PRESENT",
        communication_number: 17,
        created_at: "2026-08-12T08:00:00.000Z",
        dispatch_batch_id: "batch-a",
        dispatch_confirmed_overtake_count: 0,
        dispatch_decision_reasons_json: '["CAPACITY_OPTIMIZED","QUEUE_ORDER"]',
        dispatch_group_ids_json: '["group-a","group-b"]',
        dispatch_occupied_seats: 3,
        dispatch_order: 1,
        dispatch_plan_revision: "plan-a",
        dispatch_projected_overtake_count: 0,
        dispatch_wave: 1,
        gate_id: "gate-a",
        group_ids_json: '["group-a"]',
        precall_decision_status: "GO_TO_GATE",
        precalled_at: "2026-08-12T08:55:00.000Z",
        prediction_updated_at: "2026-08-12T08:54:00.000Z",
        product_id: "product-a",
        queue_sequence: 1,
        reference_duration_minutes: 20,
        reserved_by_active_lease: 0,
        rotation_id: "rotation-a",
        segment_order: 1,
        sold_at: "2026-08-12T07:30:00.000Z",
        standby: 0,
        ticket_count: 1,
      },
      {
        attendance_status: "PRESENT",
        communication_number: 18,
        created_at: "2026-08-12T08:01:00.000Z",
        dispatch_batch_id: "batch-a",
        dispatch_confirmed_overtake_count: 0,
        dispatch_decision_reasons_json: '["CAPACITY_OPTIMIZED","QUEUE_ORDER"]',
        dispatch_group_ids_json: '["group-a","group-b"]',
        dispatch_occupied_seats: 3,
        dispatch_order: 1,
        dispatch_plan_revision: "plan-a",
        dispatch_projected_overtake_count: 0,
        dispatch_wave: 1,
        gate_id: "gate-a",
        group_ids_json: '["group-b"]',
        precall_decision_status: "GO_TO_GATE",
        precalled_at: "2026-08-12T08:55:00.000Z",
        prediction_updated_at: "2026-08-12T08:54:00.000Z",
        product_id: "product-a",
        queue_sequence: 2,
        reference_duration_minutes: 20,
        reserved_by_active_lease: 0,
        rotation_id: "rotation-b",
        segment_order: 1,
        sold_at: "2026-08-12T07:31:00.000Z",
        standby: 0,
        ticket_count: 2,
      },
    ];
    const obsoleteLease = {
      aircraft_id: "aircraft-b",
      dispatch_batch_id: "batch-old",
      id: "lease-old",
      version: 3,
    };
    const { service, batch, recalculate, schedule, waitUntil } = createLeaseService(
      [
        { version: 7 },
        null,
        {
          current_pilot_id: "pilot-a",
          id: "aircraft-a",
          operational_state: "AVAILABLE",
          passenger_seats: 3,
          resource_group_id: "resource-a",
        },
        null,
        null,
        { dispatch_plan_revision: "plan-a" },
      ],
      [planningRows, [obsoleteLease]],
    );

    const response = await service.handleRequest(leaseRequest(acquireLease), leaseUrl);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      aircraftId: "aircraft-a",
      availableSeats: 0,
      batchId: "batch-a",
      decisionReasons: ["CAPACITY_OPTIMIZED", "QUEUE_ORDER"],
      dispatchOrder: 1,
      groupIds: ["group-a", "group-b"],
      occupiedSeats: 3,
      planRevision: "plan-a",
    });
    expect(recalculate).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledOnce();
    const statements = batch.mock.calls[0]?.[0] ?? [];
    expect(statements).toHaveLength(5);
    expect(statements.map(({ sql }) => sql).join("\n")).toMatch(
      /LEASE_EXPIRED[\s\S]*INSERT INTO dispatch_recommendation_leases[\s\S]*LEASE_ACQUIRED/,
    );
    expect(schedule).toHaveBeenCalledWith("event-a", "DISPATCH_RECOMMENDATION_LEASE_CHANGED");
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("returns only each ticket group's first eligible draft segment", async () => {
    const rows = [
      {
        rotation_id: "rotation-second",
        created_at: "2026-08-12T09:01:00.000Z",
        segment_order: 2,
        communication_number: 2,
        queue_sequence: 4,
        group_ids_json: '["group-shared"]',
      },
      {
        rotation_id: "rotation-first",
        created_at: "2026-08-12T09:00:00.000Z",
        segment_order: 1,
        communication_number: 1,
        queue_sequence: 4,
        group_ids_json: '["group-shared"]',
      },
      {
        rotation_id: "rotation-independent",
        created_at: "2026-08-12T09:02:00.000Z",
        segment_order: 1,
        communication_number: 3,
        queue_sequence: 7,
        group_ids_json: '["group-independent", 42]',
      },
    ];
    const { service } = createLeaseService([], [rows]);

    await expect(service.eligibleDraftMembers("event-a", "resource-a")).resolves.toEqual([
      { rotationId: "rotation-first", queueSequence: 4 },
      { rotationId: "rotation-independent", queueSequence: 7 },
    ]);
  });
});

describe("short-lived dispatch recommendation leases (F-BRD-010, Q-ZUV-020)", () => {
  it("enforces one active batch, aircraft and operator-device lease", () => {
    const database = createLeaseDatabase();
    insertLease(database, {
      id: "lease-a",
      aircraftId: "aircraft-a",
      accountId: "account-a",
      deviceId: "device-a",
      commandId: "command-a",
      batchId: "batch-a",
    });

    expect(() =>
      insertLease(database, {
        id: "lease-batch-conflict",
        aircraftId: "aircraft-b",
        accountId: "account-b",
        deviceId: "device-b",
        commandId: "command-b",
        batchId: "batch-a",
      }),
    ).toThrow(/UNIQUE/);
    expect(() =>
      insertLease(database, {
        id: "lease-aircraft-conflict",
        aircraftId: "aircraft-a",
        accountId: "account-b",
        deviceId: "device-b",
        commandId: "command-c",
        batchId: "batch-b",
      }),
    ).toThrow(/UNIQUE/);
    expect(() =>
      insertLease(database, {
        id: "lease-device-conflict",
        aircraftId: "aircraft-b",
        accountId: "account-a",
        deviceId: "device-a",
        commandId: "command-d",
        batchId: "batch-b",
      }),
    ).toThrow(/UNIQUE/);

    database.exec(
      "UPDATE dispatch_recommendation_leases SET status = 'EXPIRED' WHERE id = 'lease-a'",
    );
    expect(() =>
      insertLease(database, {
        id: "lease-b",
        aircraftId: "aircraft-a",
        accountId: "account-a",
        deviceId: "device-a",
        commandId: "command-e",
        batchId: "batch-a",
      }),
    ).not.toThrow();
  });

  it("persists the event version and exact draft rotation members", () => {
    const database = createLeaseDatabase();
    insertLease(database, {
      id: "lease-versioned",
      aircraftId: "aircraft-a",
      accountId: "account-a",
      deviceId: "device-a",
      commandId: "command-versioned",
      batchId: "batch-versioned",
    });

    const lease = database
      .prepare(
        `SELECT operation_day_version, member_rotation_ids_json
         FROM dispatch_recommendation_leases
         WHERE id = 'lease-versioned'`,
      )
      .get() as { operation_day_version: number; member_rotation_ids_json: string };

    expect(lease.operation_day_version).toBe(0);
    expect(JSON.parse(lease.member_rotation_ids_json)).toEqual([]);
  });

  it("participates in every destructive lifecycle", () => {
    expect(FACTORY_RESET_DELETE_TABLES).toContain("dispatch_recommendation_leases");
    expect(EVENT_DELETION_SQL).toContain(
      "DELETE FROM dispatch_recommendation_leases WHERE operation_day_id = ?1",
    );
  });
});
