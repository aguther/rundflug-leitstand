/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { countFidsProjectionRows, loadFidsProjectionRows } from "../src/fids-board-projection";

const projectionBase = {
  eventId: "event-fids-split",
  filter: { productIds: [], gateIds: [], rotationStatuses: [] },
  departedVisibilityCutoff: "2026-08-02T10:00:00.000Z",
  now: "2026-08-02T10:00:15.000Z",
};

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
    DROP TABLE IF EXISTS planned_operational_constraints;
    DROP TABLE IF EXISTS ticket_group_recalls;
    DROP TABLE IF EXISTS rotation_tickets;
    DROP TABLE IF EXISTS tickets;
    DROP TABLE IF EXISTS ticket_groups;
    DROP TABLE IF EXISTS rotations;
    DROP TABLE IF EXISTS flight_groups;
    DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS gates;
    DROP TABLE IF EXISTS aircraft;
    DROP TABLE IF EXISTS resource_groups;

    CREATE TABLE resource_groups (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      operational_note TEXT NOT NULL
    );
    CREATE TABLE gates (id TEXT PRIMARY KEY, label TEXT NOT NULL);
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      gate_id TEXT
    );
    CREATE TABLE aircraft (
      id TEXT PRIMARY KEY,
      registration TEXT,
      operational_state TEXT,
      refuel_planned INTEGER
    );
    CREATE TABLE flight_groups (
      id TEXT PRIMARY KEY,
      resource_group_id TEXT NOT NULL,
      product_id TEXT,
      communication_number INTEGER NOT NULL,
      precalled_at TEXT,
      precall_decision_status TEXT,
      queue_position INTEGER
    );
    CREATE TABLE rotations (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      flight_group_id TEXT NOT NULL,
      gate_id TEXT,
      aircraft_id TEXT,
      status TEXT NOT NULL,
      dispatch_order INTEGER,
      predicted_boarding_at TEXT,
      predicted_completion_at TEXT,
      prediction_quality TEXT,
      prediction_lower_minutes INTEGER,
      prediction_upper_minutes INTEGER,
      prediction_updated_at TEXT,
      dispatch_batch_id TEXT,
      dispatch_unplanned_reason TEXT,
      departed_at TEXT
    );
    CREATE TABLE ticket_groups (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      communication_number INTEGER NOT NULL
    );
    CREATE TABLE tickets (id TEXT PRIMARY KEY, ticket_group_id TEXT NOT NULL);
    CREATE TABLE rotation_tickets (
      rotation_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      released_at TEXT
    );
    CREATE TABLE ticket_group_recalls (
      id TEXT PRIMARY KEY,
      ticket_group_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE planned_operational_constraints (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      status TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      public_note TEXT NOT NULL,
      activated_at TEXT NOT NULL
    );

    INSERT INTO resource_groups VALUES ('resource-a', 'ACTIVE', '');
    INSERT INTO gates VALUES ('gate-a', 'Flight Line A');
    INSERT INTO products VALUES ('product-a', 'Rundflug', 'RF', 'gate-a');

    INSERT INTO flight_groups VALUES
      ('flight-actionable', 'resource-a', 'product-a', 11, NULL, NULL, 1),
      ('flight-recent-new', 'resource-a', 'product-a', 12, NULL, NULL, 2),
      ('flight-recent-old', 'resource-a', 'product-a', 13, NULL, NULL, 3),
      ('flight-prepare', 'resource-a', 'product-a', 14, NULL, 'PREPARE', 4),
      ('flight-lower', 'resource-a', 'product-a', 15, NULL, 'WAITING', 5),
      ('flight-expired', 'resource-a', 'product-a', 16, NULL, NULL, 6);

    INSERT INTO rotations VALUES
      ('rotation-actionable', 'event-fids-split', 'flight-actionable', 'gate-a', NULL,
       'CALLED', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       '2026-08-02T09:50:00.000Z'),
      ('rotation-recent-new', 'event-fids-split', 'flight-recent-new', 'gate-a', NULL,
       'LANDED', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       '2026-08-02T10:00:10.000Z'),
      ('rotation-recent-old', 'event-fids-split', 'flight-recent-old', 'gate-a', NULL,
       'IN_FLIGHT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       '2026-08-02T10:00:05.000Z'),
      ('rotation-prepare', 'event-fids-split', 'flight-prepare', 'gate-a', NULL,
       'DRAFT', 4, '2026-08-02T10:20:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
      ('rotation-lower', 'event-fids-split', 'flight-lower', 'gate-a', NULL,
       'DRAFT', 5, '2026-08-02T10:25:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
      ('rotation-expired', 'event-fids-split', 'flight-expired', 'gate-a', NULL,
       'COMPLETED', 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       '2026-08-02T09:59:59.000Z');
  `);
});

describe("protected FIDS split projection integration", () => {
  it("keeps recent departures in priority order and out of lower paging", async () => {
    const [actionableTotal, recentDepartureTotal] = await Promise.all([
      countFidsProjectionRows(env.DB, { ...projectionBase, band: "ACTIONABLE" }),
      countFidsProjectionRows(env.DB, { ...projectionBase, band: "RECENT_DEPARTURE" }),
    ]);
    const actionableRows = await loadFidsProjectionRows(env.DB, {
      ...projectionBase,
      band: "ACTIONABLE",
      limit: 8,
      offset: 0,
    });
    const recentDepartureRows = await loadFidsProjectionRows(env.DB, {
      ...projectionBase,
      band: "RECENT_DEPARTURE",
      limit: 8,
      offset: 0,
    });
    const prepareRows = await loadFidsProjectionRows(env.DB, {
      ...projectionBase,
      band: "PREPARE",
      limit: 1,
      offset: 0,
    });
    const lowerRows = await loadFidsProjectionRows(env.DB, {
      ...projectionBase,
      band: "LOWER",
      excludedRowIds: prepareRows.map((row) => row.row_id),
      limit: 8,
      offset: 0,
    });

    expect(actionableTotal).toBe(1);
    expect(recentDepartureTotal).toBe(2);
    expect(
      [...actionableRows, ...recentDepartureRows, ...prepareRows].map((row) => row.rotation_id),
    ).toEqual([
      "rotation-actionable",
      "rotation-recent-new",
      "rotation-recent-old",
      "rotation-prepare",
    ]);
    expect(lowerRows.map((row) => row.rotation_id)).toEqual(["rotation-lower"]);
    expect(lowerRows.some((row) => row.rotation_id.startsWith("rotation-recent"))).toBe(false);
    expect(lowerRows.some((row) => row.rotation_id === "rotation-expired")).toBe(false);
  });
});
