import { describe, expect, it, vi } from "vitest";
import { RecurringOperationalRuleCommandService } from "./recurring-operational-rule-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type RecurringRuleCommand = Parameters<
  RecurringOperationalRuleCommandService["handleRecurringOperationalRule"]
>[0];

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

function createCommand(ruleExpectedVersion: number | null): RecurringRuleCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-director",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "UPSERT_RECURRING_OPERATIONAL_RULE",
    payload: {
      ruleId: "550e8400-e29b-41d4-a716-446655440002",
      ruleExpectedVersion,
      rule: {
        scopeType: "AIRCRAFT",
        scopeId: "aircraft-one",
        kind: "REFUELING",
        triggerMetric: "COMPLETED_ROTATIONS",
        intervalValue: 5,
        minimumDurationMinutes: 8,
        typicalDurationMinutes: 12,
        maximumDurationMinutes: 18,
      },
      reason: "Synthetic recurring refueling rule",
    },
  };
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

describe("recurring operational rule command service", () => {
  it("creates a due rule occurrence atomically without changing aircraft state", async () => {
    const { db, batches } = createDatabase([
      null,
      { id: "aircraft-one" },
      null,
      { reset_at: "2026-08-08T06:00:00.000Z" },
      {
        completed_rotations: 5,
        operating_minutes: 95,
        last_rotation_id: "rotation-five",
      },
    ]);
    const broadcast = vi.fn();
    const service = new RecurringOperationalRuleCommandService(
      { DB: db } as unknown as Env,
      broadcast,
    );

    const response = await service.handleRecurringOperationalRule(
      createCommand(null),
      currentEvent(),
    );
    const result = (await response.json()) as { accepted: boolean; eventType: string };

    expect(result).toMatchObject({
      accepted: true,
      eventType: "RECURRING_OPERATIONAL_RULE_CREATED",
    });
    expect(broadcast).toHaveBeenCalledOnce();
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "INSERT INTO recurring_operational_rules")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO planned_operational_constraints")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(batch.some(({ sql }) => sql.includes("UPDATE aircraft SET operational_state"))).toBe(
      false,
    );
  });

  it("rejects a stale rule version before persistence", async () => {
    const { db, batches } = createDatabase([
      {
        id: "550e8400-e29b-41d4-a716-446655440002",
        version: 2,
        status: "ACTIVE",
        scope_type: "AIRCRAFT",
        scope_id: "aircraft-one",
        operation_kind: "REFUELING",
        trigger_metric: "COMPLETED_ROTATIONS",
        interval_value: 5,
        progress_value: 1,
        minimum_duration_minutes: 8,
        typical_duration_minutes: 12,
        maximum_duration_minutes: 18,
        sequence_number: 0,
        last_reset_at: "2026-08-08T06:00:00.000Z",
        open_plan_id: null,
      },
    ]);
    const broadcast = vi.fn();
    const service = new RecurringOperationalRuleCommandService(
      { DB: db } as unknown as Env,
      broadcast,
    );

    const response = await service.handleRecurringOperationalRule(createCommand(1), currentEvent());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RECURRING_RULE_VERSION_CONFLICT", currentVersion: 2 },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
