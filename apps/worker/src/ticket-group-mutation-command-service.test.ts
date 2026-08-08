import { describe, expect, it, vi } from "vitest";
import { TicketGroupMutationCommandService } from "./ticket-group-mutation-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type TicketGroupMutationCommand = Parameters<
  TicketGroupMutationCommandService["handleTicketGroupMutation"]
>[0];

function createDatabase(input: {
  first: Record<string, unknown>[];
  all: Record<string, unknown>[][];
}): { db: D1Database; batches: PreparedQuery[][] } {
  const batches: PreparedQuery[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => ({
      sql,
      parameters,
      first: async () => input.first.shift() ?? null,
      all: async () => ({ results: input.all.shift() ?? [] }),
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
    version: 11,
    operational_note: "",
    max_ticket_deferrals: 2,
    no_show_after_minutes: 10,
    updated_at: "2026-08-08T08:00:00.000Z",
  };
}

function commandBase() {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-device",
    expectedVersion: 11,
    issuedAt: "2026-08-08T08:00:00.000Z",
  };
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

describe("ticket group mutation command service", () => {
  it("moves the second deferral to clarification and closes its recall atomically", async () => {
    const { db, batches } = createDatabase({
      first: [
        {
          id: "ticket-group-one",
          product_id: "product-one",
          version: 3,
          deferral_count: 1,
          resource_group_id: "resource-group-one",
          group_size: 2,
        },
        { gate_id: "gate-one", reference_capacity: 4 },
      ],
      all: [
        [
          {
            id: "rotation-one",
            status: "CALLED",
            called_at: "2026-08-08T07:30:00.000Z",
            aircraft_id: "aircraft-one",
            rotation_group_count: 1,
          },
        ],
      ],
    });
    const broadcast = vi.fn();
    const recall = {
      id: "recall-one",
      ticket_group_id: "ticket-group-one",
      sequence: 1,
      started_at: "2026-08-08T07:31:00.000Z",
      expires_at: "2026-08-08T07:36:00.000Z",
    };
    const loadRecalls = vi.fn(async () => [recall]);
    const recallClosureStatement = {
      sql: "UPDATE ticket_group_recalls SET ended_at",
      parameters: [],
    } as unknown as D1PreparedStatement;
    const closeRecalls = vi.fn(() => [recallClosureStatement]);
    const service = new TicketGroupMutationCommandService(
      { DB: db } as unknown as Env,
      broadcast,
      loadRecalls,
      closeRecalls,
    );
    const command = {
      ...commandBase(),
      type: "DEFER_TICKET_GROUP",
      payload: { ticketGroupId: "ticket-group-one", reason: "Synthetic second deferral" },
    } satisfies TicketGroupMutationCommand;

    const response = await service.handleTicketGroupMutation(command, currentEvent());
    const result = (await response.json()) as { accepted: boolean; eventType: string };

    expect(result).toMatchObject({ accepted: true, eventType: "TICKET_GROUP_DEFERRED" });
    expect(loadRecalls).toHaveBeenCalledWith(
      "synthetic-event",
      ["ticket-group-one"],
      expect.any(String),
    );
    expect(closeRecalls).toHaveBeenCalledWith(
      expect.objectContaining({ recalls: [recall], reason: "DEFERRED" }),
    );
    expect(broadcast).toHaveBeenCalledOnce();
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(batch).toContain(recallClosureStatement);
    expect(findStatement(batch, "UPDATE rotation_tickets SET released_at")).toBeDefined();
    expect(findStatement(batch, "UPDATE ticket_groups SET status = ?1").parameters[0]).toBe(
      "CLARIFICATION",
    );
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
  });

  it("rejects no-show before the configured deadline without persistence", async () => {
    const calledAt = new Date().toISOString();
    const { db, batches } = createDatabase({
      first: [
        {
          id: "ticket-group-one",
          product_id: "product-one",
          version: 3,
          deferral_count: 0,
          resource_group_id: "resource-group-one",
          group_size: 2,
        },
      ],
      all: [
        [
          {
            id: "rotation-one",
            status: "CALLED",
            called_at: calledAt,
            aircraft_id: "aircraft-one",
            rotation_group_count: 1,
          },
        ],
      ],
    });
    const service = new TicketGroupMutationCommandService(
      { DB: db } as unknown as Env,
      vi.fn(),
      vi.fn(async () => []),
      vi.fn(() => []),
    );
    const command = {
      ...commandBase(),
      type: "MARK_NO_SHOW",
      payload: { ticketGroupId: "ticket-group-one", reason: "Synthetic no-show" },
    } satisfies TicketGroupMutationCommand;

    const response = await service.handleTicketGroupMutation(command, currentEvent());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NO_SHOW_DEADLINE_NOT_REACHED" },
    });
    expect(batches).toHaveLength(0);
  });
});
