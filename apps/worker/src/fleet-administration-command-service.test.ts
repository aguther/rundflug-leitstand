import { describe, expect, it, vi } from "vitest";
import { FleetAdministrationCommandService } from "./fleet-administration-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type FleetCommand = Parameters<FleetAdministrationCommandService["handleFleetAdministration"]>[0];

function createDatabase(firstRows: Array<Record<string, unknown> | null>): {
  db: D1Database;
  batches: PreparedQuery[][];
} {
  const batches: PreparedQuery[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => ({
      sql,
      parameters,
      first: async () => firstRows.shift() ?? null,
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

function aircraftStateCommand(): FleetCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-flight-line",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "SET_AIRCRAFT_OPERATIONAL_STATE",
    payload: {
      aircraftId: "aircraft-one",
      state: "AVAILABLE",
      reason: "Synthetic pause completed",
      expectedReviewAt: null,
    },
  };
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

describe("fleet administration command service", () => {
  it("completes an aircraft pause with audit, idempotency and outbox in one batch", async () => {
    const { db, batches } = createDatabase([
      {
        id: "aircraft-one",
        operational_state: "PAUSED",
        rotations_since_refuel: 3,
        refuel_planned: 0,
        operational_interrupted: 0,
      },
    ]);
    const broadcast = vi.fn();
    const service = new FleetAdministrationCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handleFleetAdministration(
      aircraftStateCommand(),
      currentEvent(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      eventType: "AIRCRAFT_OPERATIONAL_STATE_CHANGED",
      aggregate: { type: "AIRCRAFT", id: "aircraft-one" },
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "UPDATE operation_days")).toBeDefined();
    expect(findStatement(batch, "UPDATE aircraft SET operational_state")).toMatchObject({
      parameters: ["AVAILABLE", 3, 0, expect.any(String), "aircraft-one"],
    });
    expect(findStatement(batch, "UPDATE operational_blocks SET status = 'CLEARED'")).toBeDefined();
    expect(findStatement(batch, "UPDATE recurring_operational_rules")).toMatchObject({
      parameters: [expect.any(String), "synthetic-event", "aircraft-one", "PAUSE"],
    });
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("configures a refuel reminder threshold atomically without changing aircraft state", async () => {
    const { db, batches } = createDatabase([
      {
        id: "aircraft-one",
        operational_state: "AVAILABLE",
        rotations_since_refuel: 3,
        refuel_planned: 0,
        operational_interrupted: 0,
      },
    ]);
    const broadcast = vi.fn();
    const service = new FleetAdministrationCommandService({ DB: db } as unknown as Env, broadcast);
    const command: FleetCommand = {
      commandId: "550e8400-e29b-41d4-a716-446655440003",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD",
      payload: {
        aircraftId: "aircraft-one",
        reminderThreshold: 4,
        reason: "Synthetic refuel reminder",
        adminPin: "1234",
      },
    };

    const response = await service.handleFleetAdministration(command, currentEvent());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "AIRCRAFT_REFUEL_THRESHOLD_CONFIGURED",
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "UPDATE aircraft SET refuel_reminder_threshold")).toMatchObject({
      parameters: [4, expect.any(String), "aircraft-one"],
    });
    expect(batch.some(({ sql }) => sql.includes("SET operational_state ="))).toBe(false);
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("rejects lifecycle-owned aircraft states before persistence", async () => {
    const { db, batches } = createDatabase([
      {
        id: "aircraft-one",
        operational_state: "IN_FLIGHT",
        rotations_since_refuel: 3,
        refuel_planned: 0,
        operational_interrupted: 0,
      },
    ]);
    const broadcast = vi.fn();
    const service = new FleetAdministrationCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handleFleetAdministration(
      aircraftStateCommand(),
      currentEvent(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AIRCRAFT_LIFECYCLE_ACTIVE" },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rejects pausing a pilot assigned to an active rotation", async () => {
    const { db, batches } = createDatabase([
      {
        id: "pilot-one",
        operational_code: "P-01",
        active: 1,
        paused: 0,
      },
      { id: "rotation-one" },
    ]);
    const broadcast = vi.fn();
    const service = new FleetAdministrationCommandService({ DB: db } as unknown as Env, broadcast);
    const command: FleetCommand = {
      commandId: "550e8400-e29b-41d4-a716-446655440002",
      eventId: "synthetic-event",
      deviceId: "synthetic-director",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "SET_PILOT_PAUSE",
      payload: {
        pilotId: "pilot-one",
        paused: true,
        reason: "Synthetic scheduled pause",
        expectedReviewAt: "2026-08-08T08:30:00.000Z",
      },
    };

    const response = await service.handleFleetAdministration(command, currentEvent());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PILOT_ASSIGNED_ACTIVE_ROTATION" },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
