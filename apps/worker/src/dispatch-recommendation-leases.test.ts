// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import leaseMigration from "../migrations/0064_dispatch_recommendation_leases.sql?raw";
import memberMigration from "../migrations/0066_dispatch_recommendation_lease_members.sql?raw";
import coordinatorSource from "./event-coordinator.ts?raw";
import { EVENT_DELETION_SQL } from "./event-deletion";
import { FACTORY_RESET_DELETE_TABLES } from "./factory-reset";
import workerSource from "./index.ts?raw";

function createLeaseDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE operation_days (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE aircraft (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE operator_accounts (id TEXT PRIMARY KEY) STRICT;
  `);
  database.exec(leaseMigration);
  database.exec(memberMigration);
  database.exec(`
    INSERT INTO operation_days (id) VALUES ('event-a');
    INSERT INTO aircraft (id) VALUES ('aircraft-a'), ('aircraft-b');
    INSERT INTO operator_accounts (id) VALUES ('account-a'), ('account-b');
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

  it("serializes acquisition with CALL_NEXT and consumes a matching lease atomically", () => {
    expect(coordinatorSource).toContain("DISPATCH_RECOMMENDATION_LEASE_TTL_MS = 90_000");
    expect(coordinatorSource).toContain("enqueueDispatchRecommendationLease");
    expect(coordinatorSource).toContain("this.commandTail.then");
    expect(coordinatorSource).toContain("DISPATCH_RECOMMENDATION_LEASE_MISMATCH");
    expect(coordinatorSource).toContain("DISPATCH_RECOMMENDATION_LEASE_EXPIRED");
    expect(coordinatorSource).toContain("DISPATCH_RECOMMENDATION_LEASE_CONSUMED");
    expect(coordinatorSource).toContain("status = 'CONSUMED', consumed_at");
    expect(coordinatorSource).toContain("lease.operator_account_id === operatorAccountId");
    expect(coordinatorSource).toContain("lease.device_id === command.deviceId");
    expect(coordinatorSource).toContain("lease.aircraft_id === command.payload.aircraftId");
    expect(coordinatorSource).not.toContain("lease.operation_day_version === current.version");
    expect(coordinatorSource).toContain("createDispatchPlan({");
    expect(coordinatorSource).toContain("maximumWaves: 1");
    expect(coordinatorSource).toContain("selectReusableDispatchBatch({");
    expect(coordinatorSource).toContain('selectionSource = "TARGETED_REPLAN"');
    expect(coordinatorSource).toContain(
      "confirmedOvertakeCount: row.dispatch_confirmed_overtake_count",
    );
    expect(coordinatorSource).not.toContain(
      "priorOvertakeCount: row.dispatch_projected_overtake_count",
    );
    expect(coordinatorSource).toContain("rotationAlias}.booking_segment_order");
    expect(coordinatorSource).not.toContain(
      "ORDER BY COALESCE(candidate_group.queue_position, candidate_group.communication_number)",
    );
    expect(coordinatorSource).toContain("calculateConfirmedOvertakeIncrements({");
    expect(coordinatorSource).toContain("dispatch_confirmed_overtake_count + ?1");
    expect(coordinatorSource).toContain("confirmedOvertakes:");
    expect(coordinatorSource).toContain('reason: "MANUAL_OVERRIDE"');
    expect(coordinatorSource).toContain("manualOverrideLeaseStatements");
    expect(coordinatorSource).toContain(
      'row.precalled_at !== null || row.precall_decision_status === "GO_TO_GATE"',
    );
    expect(coordinatorSource).not.toContain("row.forecast_assumed_aircraft_id === aircraft.id");
    expect(coordinatorSource).toContain("lease.member_rotation_ids_json");
    expect(coordinatorSource).toContain("rotationId === selectedMemberRotationIds[index]");
    expect(coordinatorSource).toContain("lease.occupied_seats === selectedSeatCount");
    expect(coordinatorSource).toContain(
      "dispatch_order, ticket_group_ids_json, occupied_seats, available_seats",
    );
    expect(coordinatorSource).toContain("'DISPATCH_LEASE', ?5, ?6, ?7)");
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

  it("authorizes its routes and participates in every destructive lifecycle", () => {
    expect(workerSource).toContain('eventRoutes("/dispatch-recommendation-leases")');
    expect(workerSource).toContain('eventRoutes("/dispatch-recommendation-leases/:leaseId")');
    expect(FACTORY_RESET_DELETE_TABLES).toContain("dispatch_recommendation_leases");
    expect(EVENT_DELETION_SQL).toContain(
      "DELETE FROM dispatch_recommendation_leases WHERE operation_day_id = ?1",
    );
    expect(workerSource).toContain(
      "DELETE FROM dispatch_recommendation_leases WHERE operator_account_id = ?1",
    );
    expect(workerSource).toContain("segment_group.precalled_at");
    expect(workerSource).toContain("precalledAt: group.precalled_at");
    expect(workerSource).toContain("dispatchReservationByGroupId.get(group.id) ?? null");
  });
});
