import { commandEnvelopeSchema } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type RotationTransitionCommand,
  RotationTransitionCommandService,
} from "./rotation-transition-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedStatement {
  sql: string;
  parameters: unknown[];
  first: () => Promise<Record<string, unknown> | null>;
  all: () => Promise<{ results: Record<string, unknown>[] }>;
  run: () => Promise<{ success: true; results: []; meta: { changes: number } }>;
}

function createDatabase(firstRows: Array<Record<string, unknown> | null>) {
  const prepared: PreparedStatement[] = [];
  const batch = vi.fn(async (statements: PreparedStatement[]) => statements);
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => {
      const statement: PreparedStatement = {
        sql,
        parameters,
        first: async () => firstRows.shift() ?? null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, results: [], meta: { changes: 0 } }),
      };
      prepared.push(statement);
      return statement;
    },
  }));
  return {
    database: { prepare, batch } as unknown as D1Database,
    prepare,
    batch,
    prepared,
  };
}

function storedEvent(): StoredEventRow {
  return {
    id: "synthetic-event",
    name: "Synthetic event",
    event_date: "2026-08-09",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    operational_interrupted: 0,
    version: 17,
    operational_note: "",
    updated_at: "2026-08-09T10:00:00.000Z",
  };
}

function command(
  type: "CALL_NEXT" | "MARK_OFF_BLOCK",
  payload: Record<string, unknown>,
): RotationTransitionCommand {
  const parsed = commandEnvelopeSchema.parse({
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-flight-line-device",
    expectedVersion: 17,
    issuedAt: "2026-08-09T10:01:00.000Z",
    type,
    payload,
  });
  if (parsed.type !== type) throw new Error("Unexpected command type.");
  return parsed as RotationTransitionCommand;
}

function createService(database: D1Database) {
  const broadcasts: unknown[] = [];
  const backgroundWork: Promise<unknown>[] = [];
  return {
    service: new RotationTransitionCommandService(
      { DB: database } as unknown as Env,
      (result) => broadcasts.push(result),
      (promise) => backgroundWork.push(promise),
      async () => [],
      () => [],
      async () => [],
    ),
    broadcasts,
    backgroundWork,
  };
}

describe("rotation transition command service", () => {
  it("returns the established not-found response when CALL_NEXT has no draft segment", async () => {
    const { database, batch } = createDatabase([null]);
    const { service, broadcasts, backgroundWork } = createService(database);

    const response = await service.handle(
      command("CALL_NEXT", {
        ticketGroupIds: ["synthetic-group"],
        aircraftId: "synthetic-aircraft",
        pilotId: "synthetic-pilot",
      }),
      storedEvent(),
      "synthetic-operator",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "ROTATION_NOT_FOUND", message: "Keine ausgewählte Gruppe gefunden." },
    });
    expect(batch).not.toHaveBeenCalled();
    expect(broadcasts).toHaveLength(0);
    expect(backgroundWork).toHaveLength(0);
  });

  it("rejects an invalid rotation state before preparing persistence", async () => {
    const { database, batch } = createDatabase([
      {
        id: "synthetic-rotation",
        status: "DRAFT",
        version: 3,
        aircraft_id: "synthetic-aircraft",
        pilot_id: "synthetic-pilot",
        called_at: null,
        forecast_assumed_aircraft_id: null,
        dispatch_plan_revision: null,
        dispatch_batch_id: null,
        dispatch_group_ids_json: "[]",
        dispatch_operation_day_version: null,
        flight_group_product_id: "synthetic-product",
        resource_group_status: "ACTIVE",
      },
    ]);
    const { service, broadcasts } = createService(database);

    const response = await service.handle(
      command("MARK_OFF_BLOCK", { rotationId: "synthetic-rotation" }),
      storedEvent(),
      "synthetic-operator",
    );

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("ROTATION_TRANSITION_NOT_ALLOWED");
    expect(batch).not.toHaveBeenCalled();
    expect(broadcasts).toHaveLength(0);
  });

  it("persists a valid transition, audit, receipt and outbox in one batch before publishing", async () => {
    const { database, batch } = createDatabase([
      {
        id: "synthetic-rotation",
        status: "CALLED",
        version: 3,
        aircraft_id: "synthetic-aircraft",
        pilot_id: "synthetic-pilot",
        called_at: "2026-08-09T10:00:00.000Z",
        forecast_assumed_aircraft_id: null,
        dispatch_plan_revision: null,
        dispatch_batch_id: null,
        dispatch_group_ids_json: "[]",
        dispatch_operation_day_version: null,
        flight_group_product_id: "synthetic-product",
        resource_group_status: "ACTIVE",
      },
    ]);
    const { service, broadcasts, backgroundWork } = createService(database);

    const response = await service.handle(
      command("MARK_OFF_BLOCK", { rotationId: "synthetic-rotation" }),
      storedEvent(),
      "synthetic-operator",
    );
    await Promise.all(backgroundWork);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      accepted: boolean;
      eventType: string;
      event: { version: number };
    };
    expect(payload).toMatchObject({
      accepted: true,
      eventType: "MARK_OFF_BLOCK",
      event: { version: 18 },
    });
    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batch.mock.calls[0]?.[0] ?? [];
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("UPDATE operation_days SET version");
    expect(sql).toContain("UPDATE rotations SET status");
    expect(sql).toContain("INSERT INTO operational_events");
    expect(sql).toContain("INSERT INTO idempotency_receipts");
    expect(sql).toContain("INSERT INTO outbox");
    expect(broadcasts).toHaveLength(1);
  });
});
