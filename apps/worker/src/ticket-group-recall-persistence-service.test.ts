import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type StoredTicketGroupRecall,
  TicketGroupRecallPersistenceService,
} from "./ticket-group-recall-persistence-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedStatement {
  sql: string;
  parameters: unknown[];
  all: () => Promise<{ results: StoredTicketGroupRecall[] }>;
}

function createDatabase(allResults: StoredTicketGroupRecall[][]) {
  const preparedStatements: PreparedStatement[] = [];
  const queuedResults = [...allResults];
  const batch = vi.fn(async (statements: PreparedStatement[]) => statements);
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => {
      const statement: PreparedStatement = {
        sql,
        parameters,
        all: async () => ({ results: queuedResults.shift() ?? [] }),
      };
      preparedStatements.push(statement);
      return statement;
    },
  }));
  return {
    database: { prepare, batch } as unknown as D1Database,
    preparedStatements,
    batch,
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
    version: 17,
    operational_note: "",
    updated_at: "2026-08-09T10:00:00.000Z",
  };
}

function storedRecall(id = "synthetic-recall"): StoredTicketGroupRecall {
  return {
    id,
    ticket_group_id: "synthetic-ticket-group",
    sequence: 2,
    started_at: "2026-08-09T10:00:00.000Z",
    expires_at: "2026-08-09T10:05:00.000Z",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ticket group recall persistence service", () => {
  it("deduplicates group ids and binds the optional expiry filter", async () => {
    const recall = storedRecall();
    const { database, preparedStatements } = createDatabase([[recall]]);
    const service = new TicketGroupRecallPersistenceService(
      { DB: database } as unknown as Env,
      vi.fn(),
    );

    const result = await service.loadOpen(
      "synthetic-event",
      ["synthetic-ticket-group", "other-ticket-group", "synthetic-ticket-group"],
      "2026-08-09T10:01:00.000Z",
    );

    expect(result).toEqual([recall]);
    expect(preparedStatements).toHaveLength(1);
    expect(preparedStatements[0]?.sql).toContain("ticket_group_id IN (?2, ?3)");
    expect(preparedStatements[0]?.sql).toContain("recall.expires_at > ?4");
    expect(preparedStatements[0]?.parameters).toEqual([
      "synthetic-event",
      "synthetic-ticket-group",
      "other-ticket-group",
      "2026-08-09T10:01:00.000Z",
    ]);
  });

  it("persists expiration, audit and outbox atomically before publishing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:06:00.000Z"));
    const { database, batch } = createDatabase([[storedRecall()]]);
    const broadcast = vi.fn();
    const service = new TicketGroupRecallPersistenceService(
      { DB: database } as unknown as Env,
      broadcast,
    );

    await service.expire(storedEvent());

    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batch.mock.calls[0]?.[0] ?? [];
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(statements).toHaveLength(4);
    expect(sql).toContain("UPDATE operation_days SET version");
    expect(sql).toContain("UPDATE ticket_group_recalls");
    expect(sql).toContain("INSERT INTO operational_events");
    expect(sql).toContain("INSERT INTO outbox");
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "TICKET_GROUP_RECALL_EXPIRED",
        event: expect.objectContaining({ version: 18 }),
      }),
    );
    expect(batch.mock.invocationCallOrder[0]).toBeLessThan(
      broadcast.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
