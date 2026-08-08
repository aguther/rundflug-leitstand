import { type CommandEnvelope, commandEnvelopeSchema } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import { loadCommandPreflightReads, plannedOperationExpectation } from "./command-preflight";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

function createCommand(
  values: Omit<CommandEnvelope, "commandId" | "eventId" | "deviceId" | "issuedAt">,
): CommandEnvelope {
  return commandEnvelopeSchema.parse({
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-device",
    issuedAt: "2026-08-08T08:00:00.000Z",
    ...values,
  });
}

function createDatabase(rows: Array<Record<string, unknown> | null>): {
  db: D1Database;
  batch: ReturnType<typeof vi.fn>;
  prepared: PreparedQuery[];
} {
  const prepared: PreparedQuery[] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => {
      const statement = { sql, parameters };
      prepared.push(statement);
      return statement;
    },
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) =>
    statements.map((_, index) => ({
      success: true,
      results: rows[index] ? [rows[index]] : [],
      meta: {},
    })),
  );

  // The mock intentionally implements only the D1 methods exercised by this adapter.
  const db = { prepare, batch } as unknown as D1Database;
  return { db, batch, prepared };
}

describe("command preflight", () => {
  it("loads the event, aggregate, claim and optional rotation in one batch", async () => {
    const command = createCommand({
      type: "MARK_OFF_BLOCK",
      expectedVersion: 7,
      observedEventVersion: 7,
      preconditions: [
        {
          aggregateType: "ROTATION",
          aggregateId: "synthetic-rotation",
          expectedVersion: 3,
        },
      ],
      payload: { rotationId: "synthetic-rotation" },
    });
    const { db, batch, prepared } = createDatabase([
      { id: "synthetic-event", version: 7 },
      { version: 3 },
      { aircraft_id: "synthetic-aircraft", revision: 9 },
      { aircraft_id: "synthetic-aircraft" },
    ]);

    const result = await loadCommandPreflightReads({
      db,
      command,
      deviceRole: "FLIGHT_LINE",
      operatorAccountId: "synthetic-operator",
      nowIso: "2026-08-08T08:00:00.000Z",
    });

    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith(prepared);
    expect(result.batchCount).toBe(1);
    expect(result.statementCount).toBe(4);
    expect(result.aggregateVersion).toBe(3);
    expect(result.activeOperatorClaim).toEqual({
      aircraft_id: "synthetic-aircraft",
      revision: 9,
    });
    expect(result.targetRotationAircraftId).toBe("synthetic-aircraft");
  });

  it("loads a linked plan in the same batch without a redundant rotation lookup", async () => {
    const plannedOperationId = "550e8400-e29b-41d4-a716-446655440010";
    const command = createCommand({
      type: "SET_AIRCRAFT_OPERATIONAL_STATE",
      expectedVersion: 11,
      observedEventVersion: 11,
      preconditions: [
        {
          aggregateType: "AIRCRAFT",
          aggregateId: "synthetic-aircraft",
          expectedVersion: 5,
        },
      ],
      payload: {
        aircraftId: "synthetic-aircraft",
        state: "PAUSED",
        reason: "Synthetic maintenance pause",
        expectedReviewAt: null,
        plannedOperationId,
      },
    });
    const plan = {
      scope_type: "AIRCRAFT",
      scope_id: "synthetic-aircraft",
      status: "PLANNED",
      effect_mode: "BLOCKING",
    };
    const { db, batch, prepared } = createDatabase([
      { id: "synthetic-event", version: 11 },
      { version: 5 },
      plan,
      { aircraft_id: "synthetic-aircraft", revision: 4 },
    ]);

    const result = await loadCommandPreflightReads({
      db,
      command,
      deviceRole: "FLIGHT_LINE",
      operatorAccountId: "synthetic-operator",
      nowIso: "2026-08-08T08:00:00.000Z",
    });

    expect(batch).toHaveBeenCalledOnce();
    expect(result.statementCount).toBe(4);
    expect(result.plannedOperation).toEqual(plan);
    expect(prepared.filter(({ sql }) => sql.includes("FROM rotations"))).toHaveLength(0);
  });

  it("uses only the event statement when no optional preflight read applies", async () => {
    const command = createCommand({
      type: "SET_RESOURCE_GROUP_NOTICE",
      expectedVersion: 2,
      payload: { resourceGroupId: "synthetic-group", note: "Synthetic notice" },
    });
    const { db, batch } = createDatabase([{ id: "synthetic-event", version: 2 }]);

    const result = await loadCommandPreflightReads({
      db,
      command,
      deviceRole: "ADMIN",
      operatorAccountId: null,
      nowIso: "2026-08-08T08:00:00.000Z",
    });

    expect(batch).toHaveBeenCalledOnce();
    expect(result.statementCount).toBe(1);
    expect(result.aggregateVersion).toBeNull();
    expect(result.plannedOperation).toBeNull();
    expect(result.activeOperatorClaim).toBeNull();
  });

  it("describes linked plan validation without performing persistence", () => {
    const plannedOperationId = "550e8400-e29b-41d4-a716-446655440010";
    const command = createCommand({
      type: "SET_EVENT_INTERRUPTION",
      expectedVersion: 3,
      payload: {
        interrupted: true,
        reason: "Synthetic operational interruption",
        expectedReviewAt: null,
        plannedOperationId,
      },
    });

    expect(plannedOperationExpectation(command)).toEqual({
      kind: "supported",
      plannedOperationId,
      scopeType: "EVENT",
      scopeId: "synthetic-event",
      activating: true,
    });
  });
});
