import { describe, expect, it, vi } from "vitest";
import { PilotAssignmentCommandService } from "./pilot-assignment-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type PilotAssignmentCommand = Parameters<
  PilotAssignmentCommandService["handleAircraftPilotAssignment"]
>[0];

function createDatabase(input: {
  firstRows: Array<Record<string, unknown> | null>;
  allRows?: Array<Array<Record<string, unknown>>>;
}): {
  db: D1Database;
  batches: PreparedQuery[][];
} {
  const batches: PreparedQuery[][] = [];
  const allRows = input.allRows ?? [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => ({
      sql,
      parameters,
      first: async () => input.firstRows.shift() ?? null,
      all: async () => ({
        success: true,
        results: allRows.shift() ?? [],
        meta: {},
      }),
    }),
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) => {
    batches.push(statements);
    return statements.map(() => ({ success: true, results: [], meta: {} }));
  });
  return { db: { prepare, batch } as unknown as D1Database, batches };
}

function currentEvent(): StoredEventRow {
  return {
    id: "synthetic-event",
    name: "Synthetic event",
    event_date: "2026-08-08",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    version: 9,
    operational_note: "",
    updated_at: "2026-08-08T08:00:00.000Z",
  };
}

function command(reassign: boolean): PilotAssignmentCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-director",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "ASSIGN_AIRCRAFT_PILOT",
    payload: {
      aircraftId: "aircraft-one",
      pilotId: "pilot-one",
      reassign,
    },
  };
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

describe("pilot assignment command service", () => {
  it("updates a called rotation and aircraft assignment in one audited batch", async () => {
    const { db, batches } = createDatabase({
      firstRows: [
        { id: "aircraft-one", current_pilot_id: "pilot-old" },
        {
          id: "rotation-one",
          status: "CALLED",
          version: 3,
          pilot_id: "pilot-old",
        },
        { id: "pilot-one", operational_code: "P-01" },
        null,
      ],
      allRows: [[]],
    });
    const broadcast = vi.fn();
    const service = new PilotAssignmentCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handleAircraftPilotAssignment(command(false), currentEvent());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      eventType: "AIRCRAFT_PILOT_CHANGED",
      aggregate: { type: "AIRCRAFT", id: "aircraft-one" },
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "UPDATE operation_days")).toBeDefined();
    expect(
      findStatement(batch, "UPDATE resource_group_memberships SET current_pilot_id = ?1"),
    ).toMatchObject({
      parameters: ["pilot-one", "synthetic-event", "aircraft-one"],
    });
    expect(findStatement(batch, "UPDATE rotations SET pilot_id = ?1")).toMatchObject({
      parameters: ["pilot-one", expect.any(String), "rotation-one", 3],
    });
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("requires explicit confirmation before moving a pilot from another idle aircraft", async () => {
    const { db, batches } = createDatabase({
      firstRows: [
        { id: "aircraft-one", current_pilot_id: null },
        null,
        { id: "pilot-one", operational_code: "P-01" },
        null,
      ],
      allRows: [
        [
          {
            aircraft_id: "aircraft-two",
            registration: "D-SYN2",
            has_active_rotation: 0,
          },
        ],
      ],
    });
    const broadcast = vi.fn();
    const service = new PilotAssignmentCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handleAircraftPilotAssignment(command(false), currentEvent());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PILOT_REASSIGN_CONFIRMATION_REQUIRED",
        aircraftId: "aircraft-two",
        aircraftRegistration: "D-SYN2",
      },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("blocks pilot changes after offblock before loading a replacement pilot", async () => {
    const { db, batches } = createDatabase({
      firstRows: [
        { id: "aircraft-one", current_pilot_id: "pilot-old" },
        {
          id: "rotation-one",
          status: "IN_FLIGHT",
          version: 4,
          pilot_id: "pilot-old",
        },
      ],
    });
    const broadcast = vi.fn();
    const service = new PilotAssignmentCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handleAircraftPilotAssignment(command(false), currentEvent());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AIRCRAFT_PILOT_CHANGE_BLOCKED" },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
