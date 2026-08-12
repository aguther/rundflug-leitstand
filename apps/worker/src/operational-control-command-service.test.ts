import type { CommandEnvelope } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import { OperationalControlCommandService } from "./operational-control-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type ControlCommand = Extract<
  CommandEnvelope,
  {
    type:
      | "TRIGGER_EMERGENCY"
      | "CLEAR_EMERGENCY"
      | "SET_EVENT_INTERRUPTION"
      | "SET_RESOURCE_GROUP_STATUS"
      | "SET_RESOURCE_GROUP_NOTICE";
  }
>;

function createDatabase(firstResults: Array<Record<string, unknown> | null> = []) {
  const batches: PreparedQuery[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => ({
      sql,
      parameters,
      first: async () => firstResults.shift() ?? null,
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
    id: "event-one",
    name: "Synthetic event",
    event_date: "2026-08-08",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    operational_interrupted: 0,
    version: 7,
    operational_note: "",
    updated_at: "2026-08-08T08:00:00.000Z",
  };
}

function command<T extends ControlCommand["type"]>(
  type: T,
  payload: Extract<ControlCommand, { type: T }>["payload"],
): Extract<ControlCommand, { type: T }> {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "event-one",
    deviceId: "device-one",
    expectedVersion: 7,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type,
    payload,
  } as Extract<ControlCommand, { type: T }>;
}

function createService(db: D1Database) {
  const broadcast = vi.fn();
  return {
    service: new OperationalControlCommandService({ DB: db } as unknown as Env, broadcast),
    broadcast,
  };
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

function auditPayload(batch: PreparedQuery[]): Record<string, unknown> {
  const statement = findStatement(batch, "INSERT INTO operational_events");
  return JSON.parse(String(statement.parameters.at(-1))) as Record<string, unknown>;
}

describe("operational control command service", () => {
  it.each([
    ["TRIGGER_EMERGENCY", { reason: "Synthetic emergency" }, "EMERGENCY_MODE_TRIGGERED", 1],
    [
      "CLEAR_EMERGENCY",
      { reason: "Synthetic all clear", adminPin: "1234" },
      "EMERGENCY_MODE_CLEARED",
      0,
    ],
  ] as const)(
    "persists %s as an audited operation-day transition",
    async (type, payload, eventType, mode) => {
      const { db, batches } = createDatabase();
      const { service, broadcast } = createService(db);

      const response = await service.handle(command(type, payload), currentEvent());

      await expect(response.json()).resolves.toMatchObject({ accepted: true, eventType });
      expect(findStatement(batches[0] ?? [], "UPDATE operation_days").parameters[0]).toBe(mode);
      expect(auditPayload(batches[0] ?? [])).toEqual({ reason: payload.reason });
      expect(broadcast).toHaveBeenCalledOnce();
    },
  );

  it("starts an event interruption and activates its planned constraint atomically", async () => {
    const { db, batches } = createDatabase();
    const { service } = createService(db);
    const plannedOperationId = "550e8400-e29b-41d4-a716-446655440099";

    const response = await service.handle(
      command("SET_EVENT_INTERRUPTION", {
        interrupted: true,
        reason: "Synthetic weather interruption",
        expectedReviewAt: "2026-08-08T09:00:00.000Z",
        plannedOperationId,
      }),
      currentEvent(),
    );

    await expect(response.json()).resolves.toMatchObject({
      eventType: "EVENT_OPERATION_INTERRUPTED",
      event: { operationalInterrupted: true },
    });
    const batch = batches[0] ?? [];
    expect(findStatement(batch, "INSERT INTO operational_blocks")).toBeDefined();
    expect(findStatement(batch, "UPDATE planned_operational_constraints").parameters[0]).toBe(
      "ACTIVE",
    );
    expect(auditPayload(batch)).toMatchObject({
      interrupted: true,
      plannedOperationId,
      informationalOnly: true,
    });
  });

  it("resumes event operations and clears the open block", async () => {
    const { db, batches } = createDatabase();
    const { service } = createService(db);

    const response = await service.handle(
      command("SET_EVENT_INTERRUPTION", {
        interrupted: false,
        reason: "Synthetic operations resumed",
        expectedReviewAt: null,
      }),
      currentEvent(),
    );

    await expect(response.json()).resolves.toMatchObject({
      eventType: "EVENT_OPERATION_RESUMED",
      event: { operationalInterrupted: false },
    });
    expect(findStatement(batches[0] ?? [], "UPDATE operational_blocks")).toBeDefined();
  });

  it("rejects a resource-group command for an unknown group", async () => {
    const { db, batches } = createDatabase([null]);
    const { service } = createService(db);

    const response = await service.handle(
      command("SET_RESOURCE_GROUP_NOTICE", { resourceGroupId: "group-one", note: "Info" }),
      currentEvent(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RESOURCE_GROUP_NOT_FOUND" },
    });
    expect(batches).toHaveLength(0);
  });

  it.each([
    ["PAUSED", "INSERT INTO operational_blocks", "PAUSE", "ACTIVE"],
    ["INTERRUPTED", "INSERT INTO operational_blocks", "INTERRUPTION", "ACTIVE"],
    ["ACTIVE", "UPDATE operational_blocks", undefined, "CLEARED"],
  ] as const)(
    "persists resource group status %s with the matching block transition",
    async (status, blockSql, blockType, plannedStatus) => {
      const { db, batches } = createDatabase([{ id: "group-one" }]);
      const { service } = createService(db);
      const response = await service.handle(
        command("SET_RESOURCE_GROUP_STATUS", {
          resourceGroupId: "group-one",
          status,
          reason: "Synthetic status change",
          expectedReviewAt: status === "ACTIVE" ? null : "2026-08-08T09:00:00.000Z",
          plannedOperationId: "550e8400-e29b-41d4-a716-446655440099",
        }),
        currentEvent(),
      );

      await expect(response.json()).resolves.toMatchObject({
        eventType: "RESOURCE_GROUP_STATUS_CHANGED",
        aggregate: { type: "RESOURCE_GROUP", id: "group-one" },
      });
      const batch = batches[0] ?? [];
      const block = findStatement(batch, blockSql);
      if (blockType) expect(block.parameters).toContain(blockType);
      expect(findStatement(batch, "UPDATE planned_operational_constraints").parameters[0]).toBe(
        plannedStatus,
      );
    },
  );

  it("stores a resource-group notice as informational text only", async () => {
    const { db, batches } = createDatabase([{ id: "group-one" }]);
    const { service } = createService(db);

    const response = await service.handle(
      command("SET_RESOURCE_GROUP_NOTICE", {
        resourceGroupId: "group-one",
        note: "Synthetic public information",
      }),
      currentEvent(),
    );

    await expect(response.json()).resolves.toMatchObject({
      eventType: "RESOURCE_GROUP_NOTICE_SET",
    });
    expect(findStatement(batches[0] ?? [], "operational_note").parameters[0]).toBe(
      "Synthetic public information",
    );
    expect(auditPayload(batches[0] ?? [])).toEqual({
      note: "Synthetic public information",
      resourceGroupId: "group-one",
      informationalOnly: true,
    });
  });
});
