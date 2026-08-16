import { describe, expect, it } from "vitest";
import { applyDemoSeed, createD1TestDatabase } from "../test-support/migrated-database";
import { loadResourceDayHistory } from "./history-service";
import {
  buildAircraftBlockStatement,
  buildPilotPauseEventStatement,
  buildResourceDayRotationStatement,
  pairPilotPauseEvents,
} from "./resource-day-history";

describe("resource day history queries", () => {
  it("executes the bounded aircraft projection against migrated SQLite", async () => {
    const testDatabase = createD1TestDatabase();
    try {
      applyDemoSeed(testDatabase.database);
      testDatabase.database.exec(`
        INSERT INTO flight_groups
          (id, operation_day_id, resource_group_id, communication_number, status,
           created_at, updated_at, product_id)
        VALUES
          ('history-group', 'demo-2026', 'rg-panorama', 42, 'COMPLETED',
           '2026-07-11T08:30:00.000Z', '2026-07-11T09:40:00.000Z', 'panorama-20');
        INSERT INTO rotations
          (id, operation_day_id, flight_group_id, aircraft_id, pilot_id, status,
           called_at, departed_at, landed_at, completed_at, created_at, updated_at,
           usable_capacity)
        VALUES
          ('history-rotation', 'demo-2026', 'history-group', 'aircraft-a',
           '550e8400-e29b-41d4-a716-446655440100', 'COMPLETED',
           '2026-07-11T09:00:00.000Z', '2026-07-11T09:10:00.000Z',
           '2026-07-11T09:30:00.000Z', '2026-07-11T09:40:00.000Z',
           '2026-07-11T08:30:00.000Z', '2026-07-11T09:40:00.000Z', 4);
        INSERT INTO operational_blocks
          (id, operation_day_id, scope_type, scope_id, block_type, status, reason,
           started_at, cleared_at, device_id)
        VALUES
          ('history-block', 'demo-2026', 'AIRCRAFT', 'aircraft-a', 'REFUELING',
           'CLEARED', 'synthetic verification', '2026-07-11T09:45:00.000Z',
           '2026-07-11T10:00:00.000Z', 'technical-scaffold');
      `);

      const result = await loadResourceDayHistory(
        testDatabase.d1,
        "demo-2026",
        { scopeType: "AIRCRAFT", scopeId: "aircraft-a" },
        "2026-07-11T12:00:00.000Z",
      );

      expect(result).toMatchObject({
        status: "READY",
        history: {
          rotations: [
            {
              rotationId: "history-rotation",
              communicationLabel: "F-PA-042",
              aircraftRegistration: "D-EDEM",
              pilotOperationalCode: "P-01",
            },
          ],
          blocks: [
            {
              id: "history-block",
              type: "REFUELING",
              active: false,
            },
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain("synthetic verification");
    } finally {
      testDatabase.close();
    }
  });

  it("selects the allowed resource identifier without interpolating its value", () => {
    const hostileId = "pilot' OR 1=1 --";
    const statement = buildResourceDayRotationStatement(
      "event-1",
      { scopeType: "PILOT", scopeId: hostileId },
      "2026-07-11T07:00:00.000Z",
      "2026-07-11T18:00:00.000Z",
    );

    expect(statement.sql).toContain("r.pilot_id = ?2");
    expect(statement.sql).not.toContain(hostileId);
    expect(statement.sql).not.toMatch(/reason|payload_json|public_code/i);
    expect(statement.bindings).toEqual([
      "event-1",
      hostileId,
      "2026-07-11T07:00:00.000Z",
      "2026-07-11T18:00:00.000Z",
    ]);
  });

  it("keeps aircraft blocks and pilot pause events bounded and anonymous", () => {
    const aircraft = buildAircraftBlockStatement(
      "event-1",
      "aircraft-1",
      "2026-07-11T07:00:00.000Z",
      "2026-07-11T18:00:00.000Z",
    );
    const pilot = buildPilotPauseEventStatement("event-1", "pilot-1", "2026-07-11T18:00:00.000Z");

    expect(aircraft.sql).toContain("block_type IN ('REFUELING', 'PAUSE', 'INTERRUPTION')");
    expect(aircraft.sql).not.toContain("reason");
    expect(pilot.sql).toContain("aggregate_type = 'PILOT'");
    expect(pilot.sql).not.toContain("payload_json");
  });
});

describe("pilot pause pairing", () => {
  it("pairs repeated and unmatched append-only events deterministically", () => {
    const result = pairPilotPauseEvents(
      [
        {
          id: "unmatched-end",
          sequence: 1,
          eventType: "PILOT_PAUSE_ENDED",
          occurredAt: "2026-07-11T06:55:00.000Z",
        },
        {
          id: "start-before-window",
          sequence: 2,
          eventType: "PILOT_PAUSE_STARTED",
          occurredAt: "2026-07-11T06:58:00.000Z",
        },
        {
          id: "repeated-start",
          sequence: 3,
          eventType: "PILOT_PAUSE_STARTED",
          occurredAt: "2026-07-11T07:02:00.000Z",
        },
        {
          id: "end",
          sequence: 4,
          eventType: "PILOT_PAUSE_ENDED",
          occurredAt: "2026-07-11T07:12:00.000Z",
        },
        {
          id: "open-start",
          sequence: 5,
          eventType: "PILOT_PAUSE_STARTED",
          occurredAt: "2026-07-11T08:00:00.000Z",
        },
      ],
      "2026-07-11T07:00:00.000Z",
      "2026-07-11T09:00:00.000Z",
    );

    expect(result).toEqual([
      {
        id: "pilot-pause-start-before-window",
        type: "PAUSE",
        startedAt: "2026-07-11T07:00:00.000Z",
        endedAt: "2026-07-11T07:12:00.000Z",
        active: false,
      },
      {
        id: "pilot-pause-open-start",
        type: "PAUSE",
        startedAt: "2026-07-11T08:00:00.000Z",
        endedAt: null,
        active: true,
      },
    ]);
  });

  it("ignores invalid and fully out-of-window pause pairs", () => {
    const result = pairPilotPauseEvents(
      [
        {
          id: "old-start",
          sequence: 1,
          eventType: "PILOT_PAUSE_STARTED",
          occurredAt: "2026-07-11T06:00:00.000Z",
        },
        {
          id: "old-end",
          sequence: 2,
          eventType: "PILOT_PAUSE_ENDED",
          occurredAt: "2026-07-11T06:30:00.000Z",
        },
        {
          id: "invalid-start",
          sequence: 3,
          eventType: "PILOT_PAUSE_STARTED",
          occurredAt: "invalid",
        },
        {
          id: "valid-end",
          sequence: 4,
          eventType: "PILOT_PAUSE_ENDED",
          occurredAt: "2026-07-11T07:30:00.000Z",
        },
      ],
      "2026-07-11T07:00:00.000Z",
      "2026-07-11T09:00:00.000Z",
    );

    expect(result).toEqual([]);
  });
});
