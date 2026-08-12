import { describe, expect, it, vi } from "vitest";
import { PlannedOperationCommandService } from "./planned-operation-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type PlannedOperationCommand = Parameters<
  PlannedOperationCommandService["handlePlannedOperation"]
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
    version: 5,
    operational_note: "",
    updated_at: "2026-08-08T08:00:00.000Z",
  };
}

function createCommand(planExpectedVersion: number | null): PlannedOperationCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-director",
    expectedVersion: 5,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "UPSERT_PLANNED_OPERATION",
    payload: {
      planId: "550e8400-e29b-41d4-a716-446655440002",
      planExpectedVersion,
      scopeType: "EVENT",
      scopeId: "synthetic-event",
      kind: "PAUSE",
      effectMode: "BLOCKING",
      durationMultiplierPercent: null,
      startMode: "TIME_WINDOW",
      earliestStartAt: "2026-08-08T09:00:00.000Z",
      latestStartAt: "2026-08-08T09:15:00.000Z",
      afterRotationId: null,
      minimumDurationMinutes: 10,
      typicalDurationMinutes: 15,
      maximumDurationMinutes: 20,
      publicNote: "",
    },
  };
}

function existingPlan(overrides: Record<string, unknown> = {}) {
  return {
    constraint_kind: "PAUSE",
    duration_multiplier_percent: null,
    effect_mode: "BLOCKING",
    id: "550e8400-e29b-41d4-a716-446655440002",
    recurring_rule_id: null,
    scope_type: "EVENT",
    status: "PLANNED",
    version: 2,
    ...overrides,
  };
}

function cancelCommand(planExpectedVersion = 2): PlannedOperationCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440003",
    deviceId: "synthetic-director",
    eventId: "synthetic-event",
    expectedVersion: 5,
    issuedAt: "2026-08-08T08:00:00.000Z",
    payload: {
      planExpectedVersion,
      planId: "550e8400-e29b-41d4-a716-446655440002",
    },
    type: "CANCEL_PLANNED_OPERATION",
  } as PlannedOperationCommand;
}

function slowdownCommand(active: boolean, planExpectedVersion = 2): PlannedOperationCommand {
  return {
    commandId: active
      ? "550e8400-e29b-41d4-a716-446655440004"
      : "550e8400-e29b-41d4-a716-446655440005",
    deviceId: "synthetic-director",
    eventId: "synthetic-event",
    expectedVersion: 5,
    issuedAt: "2026-08-08T08:00:00.000Z",
    payload: {
      active,
      planExpectedVersion,
      planId: "550e8400-e29b-41d4-a716-446655440002",
    },
    type: "SET_PLANNED_SLOWDOWN_ACTIVE",
  } as PlannedOperationCommand;
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

describe("planned operation command service", () => {
  it("creates a plan with audit, idempotency and outbox in one batch", async () => {
    const { db, batches } = createDatabase([null]);
    const broadcast = vi.fn();
    const service = new PlannedOperationCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handlePlannedOperation(
      createCommand(null),
      currentEvent(),
      "FLIGHT_DIRECTOR",
    );
    const result = (await response.json()) as { accepted: boolean; eventType: string };

    expect(result).toMatchObject({ accepted: true, eventType: "PLANNED_OPERATION_CREATED" });
    expect(broadcast).toHaveBeenCalledOnce();
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "INSERT INTO planned_operational_constraints")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(batch.some(({ sql }) => sql.includes("UPDATE aircraft SET operational_state"))).toBe(
      false,
    );
    expect(batch.some(({ sql }) => sql.includes("UPDATE resource_groups SET status"))).toBe(false);
  });

  it("rejects a stale plan version before persistence", async () => {
    const { db, batches } = createDatabase([
      {
        id: "550e8400-e29b-41d4-a716-446655440002",
        version: 2,
        status: "PLANNED",
        constraint_kind: "PAUSE",
        scope_type: "EVENT",
        effect_mode: "BLOCKING",
        duration_multiplier_percent: null,
        recurring_rule_id: null,
      },
    ]);
    const broadcast = vi.fn();
    const service = new PlannedOperationCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handlePlannedOperation(
      createCommand(1),
      currentEvent(),
      "FLIGHT_DIRECTOR",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PLANNED_OPERATION_VERSION_CONFLICT", currentVersion: 2 },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("updates an editable plan with optimistic versioning", async () => {
    const { db, batches } = createDatabase([existingPlan()]);
    const broadcast = vi.fn();
    const service = new PlannedOperationCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handlePlannedOperation(
      createCommand(2),
      currentEvent(),
      "FLIGHT_DIRECTOR",
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "PLANNED_OPERATION_UPDATED",
    });
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    const update = findStatement(batch, "UPDATE planned_operational_constraints");
    expect(update.parameters).toContain(3);
    expect(update.parameters.at(-1)).toBe(2);
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("cancels a plan and resets its recurring rule in the same batch", async () => {
    const { db, batches } = createDatabase([
      existingPlan({ recurring_rule_id: "recurring-rule-1" }),
    ]);
    const broadcast = vi.fn();
    const service = new PlannedOperationCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handlePlannedOperation(
      cancelCommand(),
      currentEvent(),
      "FLIGHT_DIRECTOR",
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "RECURRING_OPERATION_OCCURRENCE_SKIPPED",
    });
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "SET status = 'CANCELED'")).toBeDefined();
    expect(findStatement(batch, "UPDATE recurring_operational_rules")).toBeDefined();
  });

  it.each([
    {
      active: true,
      existing: existingPlan({
        constraint_kind: "OTHER",
        duration_multiplier_percent: 175,
        effect_mode: "SLOWDOWN",
      }),
      expectedEventType: "PLANNED_SLOWDOWN_STARTED",
      expectedStatus: "ACTIVE",
    },
    {
      active: false,
      existing: existingPlan({
        constraint_kind: "OTHER",
        duration_multiplier_percent: 175,
        effect_mode: "SLOWDOWN",
        status: "ACTIVE",
      }),
      expectedEventType: "PLANNED_SLOWDOWN_ENDED",
      expectedStatus: "CLEARED",
    },
  ])("sets slowdown active=$active without a resource stop", async (testCase) => {
    const { db, batches } = createDatabase([testCase.existing]);
    const broadcast = vi.fn();
    const service = new PlannedOperationCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handlePlannedOperation(
      slowdownCommand(testCase.active),
      currentEvent(),
      "FLIGHT_DIRECTOR",
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: testCase.expectedEventType,
    });
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    const update = findStatement(batch, "effect_mode = 'SLOWDOWN'");
    expect(update.parameters[0]).toBe(testCase.expectedStatus);
    const audit = findStatement(batch, "INSERT INTO operational_events");
    expect(String(audit.parameters.at(-1))).toContain('"durationMultiplierPercent":175');
    expect(String(audit.parameters.at(-1))).toContain('"informationalOnly":true');
  });

  it.each([
    {
      command: cancelCommand(),
      existing: null,
      expectedCode: "PLANNED_OPERATION_NOT_FOUND",
      status: 404,
    },
    {
      command: cancelCommand(),
      existing: existingPlan({ status: "ACTIVE" }),
      expectedCode: "PLANNED_OPERATION_NOT_CANCELABLE",
      status: 409,
    },
    {
      command: slowdownCommand(true),
      existing: existingPlan(),
      expectedCode: "PLANNED_OPERATION_EFFECT_MISMATCH",
      status: 409,
    },
    {
      command: slowdownCommand(false),
      existing: existingPlan({ effect_mode: "SLOWDOWN" }),
      expectedCode: "PLANNED_OPERATION_STATUS_MISMATCH",
      status: 409,
    },
  ])("rejects invalid transitions with $expectedCode", async (testCase) => {
    const { db, batches } = createDatabase([testCase.existing]);
    const broadcast = vi.fn();
    const service = new PlannedOperationCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handlePlannedOperation(
      testCase.command,
      currentEvent(),
      "FLIGHT_DIRECTOR",
    );

    expect(response.status).toBe(testCase.status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: testCase.expectedCode },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
