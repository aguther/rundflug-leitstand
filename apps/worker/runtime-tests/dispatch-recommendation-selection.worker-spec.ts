/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { EventCoordinator } from "../src/event-coordinator";

const leaseUrl =
  "https://internal.test/internal/events/event-dispatch-runtime/dispatch-recommendation-leases";
const leaseCommandId = "b3c6a88a-546f-4b1f-8f13-46b0263d350f";

interface LeaseRequestInput {
  method?: "POST" | "DELETE";
  leaseId?: string;
  commandId?: string;
  expectedVersion?: number;
  deviceId?: string;
  role?: string;
}

function leaseRequest(input: LeaseRequestInput = {}): Request {
  const method = input.method ?? "POST";
  return new Request(input.leaseId ? `${leaseUrl}/${input.leaseId}` : leaseUrl, {
    method,
    headers: {
      "content-type": "application/json",
      "x-operator-account-id": "account-dispatch-runtime",
      "x-operator-device-id": input.deviceId ?? "device-dispatch-runtime",
      "x-operator-role": input.role ?? "ADMIN",
    },
    ...(method === "POST"
      ? {
          body: JSON.stringify({
            commandId: input.commandId ?? leaseCommandId,
            aircraftId: "opened-aircraft",
            expectedVersion: input.expectedVersion ?? 7,
          }),
        }
      : {}),
  });
}

async function dispatchLeaseRequest(input: LeaseRequestInput = {}): Promise<Response> {
  const stub = env.EVENT_COORDINATOR.getByName("event-dispatch-runtime");
  return runInDurableObject(stub, async (instance: EventCoordinator) =>
    instance.fetch(leaseRequest(input)),
  );
}

async function executeStatements(sql: string): Promise<void> {
  for (const statement of sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await env.DB.prepare(statement).run();
  }
}

beforeEach(async () => {
  await executeStatements(`
    DROP TABLE IF EXISTS outbox;
    DROP TABLE IF EXISTS operational_events;
    DROP TABLE IF EXISTS planning_runs;
    DROP TABLE IF EXISTS dispatch_recommendation_leases;
    DROP TABLE IF EXISTS rotation_tickets;
    DROP TABLE IF EXISTS tickets;
    DROP TABLE IF EXISTS ticket_groups;
    DROP TABLE IF EXISTS rotations;
    DROP TABLE IF EXISTS flight_groups;
    DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS resource_group_memberships;
    DROP TABLE IF EXISTS aircraft;
    DROP TABLE IF EXISTS operator_accounts;
    DROP TABLE IF EXISTS operation_days;

    CREATE TABLE operation_days (id TEXT PRIMARY KEY, version INTEGER NOT NULL);
    CREATE TABLE planning_runs (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      operation_day_version INTEGER NOT NULL,
      calculation_now TEXT NOT NULL,
      dispatch_plan_revision TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE operator_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE aircraft (
      id TEXT PRIMARY KEY,
      passenger_seats INTEGER NOT NULL,
      operational_state TEXT NOT NULL
    );
    CREATE TABLE resource_group_memberships (
      operation_day_id TEXT NOT NULL,
      resource_group_id TEXT NOT NULL,
      aircraft_id TEXT NOT NULL,
      current_pilot_id TEXT,
      active_until TEXT
    );
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      resource_group_id TEXT NOT NULL,
      gate_id TEXT NOT NULL,
      reference_duration_minutes INTEGER NOT NULL
    );
    CREATE TABLE flight_groups (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      resource_group_id TEXT NOT NULL,
      queue_position INTEGER,
      communication_number INTEGER NOT NULL,
      precalled_at TEXT,
      precall_decision_status TEXT
    );
    CREATE TABLE rotations (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      flight_group_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      gate_id TEXT,
      prediction_updated_at TEXT,
      dispatch_plan_revision TEXT,
      dispatch_batch_id TEXT,
      dispatch_order INTEGER,
      dispatch_wave INTEGER,
      dispatch_group_ids_json TEXT NOT NULL DEFAULT '[]',
      dispatch_occupied_seats INTEGER,
      dispatch_decision_reasons_json TEXT NOT NULL DEFAULT '[]',
      dispatch_confirmed_overtake_count INTEGER NOT NULL DEFAULT 0,
      dispatch_projected_overtake_count INTEGER NOT NULL DEFAULT 0,
      booking_segment_order INTEGER NOT NULL DEFAULT 1,
      dispatch_decision_details_json TEXT
    );
    CREATE TABLE ticket_groups (
      id TEXT PRIMARY KEY,
      queue_sequence INTEGER NOT NULL,
      communication_number INTEGER NOT NULL,
      sold_at TEXT NOT NULL,
      status TEXT NOT NULL,
      standby INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tickets (
      id TEXT PRIMARY KEY,
      ticket_group_id TEXT NOT NULL,
      attendance_status TEXT NOT NULL
    );
    CREATE TABLE rotation_tickets (
      rotation_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      released_at TEXT
    );
    CREATE TABLE dispatch_recommendation_leases (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      aircraft_id TEXT NOT NULL,
      operator_account_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      acquire_command_id TEXT NOT NULL UNIQUE,
      dispatch_plan_revision TEXT NOT NULL,
      dispatch_batch_id TEXT NOT NULL,
      dispatch_order INTEGER NOT NULL,
      ticket_group_ids_json TEXT NOT NULL,
      occupied_seats INTEGER NOT NULL,
      available_seats INTEGER NOT NULL,
      decision_reasons_json TEXT NOT NULL,
      decision_details_json TEXT,
      operation_day_version INTEGER NOT NULL DEFAULT 0,
      member_rotation_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released_at TEXT,
      expired_at TEXT,
      consumed_at TEXT,
      invalidated_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX dispatch_recommendation_leases_active_batch
      ON dispatch_recommendation_leases(operation_day_id, dispatch_batch_id)
      WHERE status = 'ACTIVE';
    CREATE UNIQUE INDEX dispatch_recommendation_leases_active_aircraft
      ON dispatch_recommendation_leases(operation_day_id, aircraft_id)
      WHERE status = 'ACTIVE';
    CREATE UNIQUE INDEX dispatch_recommendation_leases_active_device
      ON dispatch_recommendation_leases(operation_day_id, operator_account_id, device_id)
      WHERE status = 'ACTIVE';
    CREATE TABLE operational_events (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE outbox (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    INSERT INTO operation_days VALUES ('event-dispatch-runtime', 7);
    INSERT INTO planning_runs VALUES (
      'planning-run-current', 'event-dispatch-runtime', 7,
      '2026-08-05T09:00:00.000Z', 'plan-current', 'SUCCEEDED'
    );
    INSERT INTO operator_accounts VALUES ('account-dispatch-runtime');
    INSERT INTO aircraft VALUES ('opened-aircraft', 3, 'AVAILABLE');
    INSERT INTO resource_group_memberships VALUES
      ('event-dispatch-runtime', 'resource-a', 'opened-aircraft', 'pilot-a', NULL);
    INSERT INTO products VALUES ('product-a', 'resource-a', 'gate-a', 20);
    INSERT INTO flight_groups VALUES
      ('flight-early', 'product-a', 'resource-a', 1, 101, '2026-08-05T09:00:00.000Z', 'GO_TO_GATE'),
      ('flight-between', 'product-a', 'resource-a', 2, 102, '2026-08-05T09:00:00.000Z', 'GO_TO_GATE'),
      ('flight-pair', 'product-a', 'resource-a', 3, 103, '2026-08-05T09:00:00.000Z', 'GO_TO_GATE');
    INSERT INTO rotations VALUES
      ('rotation-early', 'event-dispatch-runtime', 'flight-early', 'DRAFT',
       '2026-08-05T08:00:00.000Z', 'gate-a', '2026-08-05T09:00:00.000Z',
       'plan-current', 'batch-current', 1, 1, '["group-early","group-pair"]', 3,
       '["CAPACITY_OPTIMIZED","QUEUE_ORDER"]', 0, 0, 1, NULL),
      ('rotation-between', 'event-dispatch-runtime', 'flight-between', 'DRAFT',
       '2026-08-05T08:01:00.000Z', 'gate-a', '2026-08-05T09:00:00.000Z',
       'plan-current', 'batch-later', 2, 1, '["group-between"]', 1,
       '["MUST_SERVE_MAX_OVERTAKES"]', 0, 2, 1, NULL),
      ('rotation-pair', 'event-dispatch-runtime', 'flight-pair', 'DRAFT',
       '2026-08-05T08:02:00.000Z', 'gate-a', '2026-08-05T09:00:00.000Z',
       'plan-current', 'batch-current', 1, 1, '["group-early","group-pair"]', 3,
       '["CAPACITY_OPTIMIZED","QUEUE_ORDER"]', 0, 0, 1, NULL);
    INSERT INTO ticket_groups VALUES
      ('group-early', 1, 101, '2026-08-05T08:00:00.000Z', 'QUEUED', 0),
      ('group-between', 2, 102, '2026-08-05T08:01:00.000Z', 'QUEUED', 0),
      ('group-pair', 3, 103, '2026-08-05T08:02:00.000Z', 'QUEUED', 0);
    INSERT INTO tickets VALUES
      ('ticket-early', 'group-early', 'UNKNOWN'),
      ('ticket-between', 'group-between', 'UNKNOWN'),
      ('ticket-pair-a', 'group-pair', 'UNKNOWN'),
      ('ticket-pair-b', 'group-pair', 'UNKNOWN');
    INSERT INTO rotation_tickets VALUES
      ('rotation-early', 'ticket-early', NULL),
      ('rotation-between', 'ticket-between', NULL),
      ('rotation-pair', 'ticket-pair-a', NULL),
      ('rotation-pair', 'ticket-pair-b', NULL);
  `);
});

describe("dispatch recommendation acquisition", () => {
  it("leases the same current batch as FIDS instead of feeding projected debt back", async () => {
    const response = await dispatchLeaseRequest();
    const body = (await response.json()) as {
      planRevision: string;
      batchId: string;
      groupIds: string[];
    };

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      planRevision: "plan-current",
      batchId: "batch-current",
      groupIds: ["group-early", "group-pair"],
    });
    const audit = await env.DB.prepare(
      `SELECT payload_json FROM operational_events
        WHERE event_type = 'DISPATCH_RECOMMENDATION_LEASE_ACQUIRED'`,
    ).first<{ payload_json: string }>();
    expect(JSON.parse(audit?.payload_json ?? "{}")).toMatchObject({
      selectionSource: "CURRENT_PLAN_BATCH",
      fallbackReason: null,
    });
  });

  it("replays, rejects conflicts and stale versions, and releases the owned lease once", async () => {
    const acquired = await dispatchLeaseRequest();
    const lease = (await acquired.json()) as {
      leaseId: string;
      expiresAt: string;
      error?: unknown;
    };
    expect(acquired.status, JSON.stringify(lease)).toBe(200);
    expect(Date.parse(lease.expiresAt)).toBeGreaterThan(Date.now());

    const replay = await dispatchLeaseRequest();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ leaseId: lease.leaseId });

    const conflict = await dispatchLeaseRequest({ deviceId: "different-dispatch-device" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });

    const stale = await dispatchLeaseRequest({
      commandId: "b3c6a88a-546f-4b1f-8f13-46b0263d3510",
      expectedVersion: 6,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: { code: "STALE_VERSION", currentVersion: 7 },
    });

    const foreignRelease = await dispatchLeaseRequest({
      method: "DELETE",
      leaseId: lease.leaseId,
      deviceId: "different-dispatch-device",
    });
    expect(foreignRelease.status).toBe(204);
    expect(
      await env.DB.prepare("SELECT status FROM dispatch_recommendation_leases WHERE id = ?1")
        .bind(lease.leaseId)
        .first<{ status: string }>(),
    ).toEqual({ status: "ACTIVE" });

    const released = await dispatchLeaseRequest({ method: "DELETE", leaseId: lease.leaseId });
    expect(released.status).toBe(204);
    expect(
      await env.DB.prepare(
        "SELECT status, version FROM dispatch_recommendation_leases WHERE id = ?1",
      )
        .bind(lease.leaseId)
        .first<{ status: string; version: number }>(),
    ).toEqual({ status: "RELEASED", version: 2 });

    const finishedReplay = await dispatchLeaseRequest();
    expect(finishedReplay.status).toBe(409);
    expect(await finishedReplay.json()).toMatchObject({
      error: { code: "DISPATCH_RECOMMENDATION_LEASE_FINISHED" },
    });
    expect(
      await env.DB.prepare(
        "SELECT event_type FROM operational_events ORDER BY occurred_at, event_type",
      ).all<{ event_type: string }>(),
    ).toMatchObject({
      results: [
        { event_type: "DISPATCH_RECOMMENDATION_LEASE_ACQUIRED" },
        { event_type: "DISPATCH_RECOMMENDATION_LEASE_RELEASED" },
      ],
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox").first<{ count: number }>(),
    ).toEqual({ count: 2 });
  });
});
