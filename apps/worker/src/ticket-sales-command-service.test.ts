import { describe, expect, it, vi } from "vitest";
import { TicketSalesCommandService } from "./ticket-sales-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type TicketSaleCommand = Parameters<TicketSalesCommandService["handleTicketSale"]>[0];

function createDatabase(firstRows: Array<Record<string, unknown> | null>) {
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

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

function command(): TicketSaleCommand {
  return {
    commandId: "e7c17c97-9b20-48f1-9d50-1e56845ae1d9",
    eventId: "synthetic-event",
    deviceId: "synthetic-cashier",
    expectedVersion: 9,
    issuedAt: "2026-08-11T10:00:00.000Z",
    type: "SELL_TICKET_GROUP",
    payload: {
      productId: "synthetic-product",
      ticketCount: 2,
      standby: false,
      oversizeSplitAcknowledged: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
    },
  };
}

function currentEvent(): StoredEventRow {
  return {
    id: "synthetic-event",
    name: "Synthetic event",
    event_date: "2026-08-11",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    operational_interrupted: 0,
    operations_end_at: "2026-08-11T18:00:00.000Z",
    version: 9,
    operational_note: "",
    updated_at: "2026-08-11T10:00:00.000Z",
  };
}

describe("ticket sales command service", () => {
  it("persists sale state, audit, idempotency and outbox in one batch", async () => {
    const { db, batches } = createDatabase([
      {
        id: "synthetic-product",
        code: "SYN",
        name: "Synthetic product",
        resource_group_id: "synthetic-resource-group",
        gate_id: "synthetic-gate",
        gate_label: "Synthetic gate",
        price_cents: 2500,
        sale_enabled: 1,
        sale_closes_at: null,
        weight_classes_json: '["NOT_CAPTURED"]',
        resource_group_status: "ACTIVE",
        effective_group_capacity: 4,
      },
      { public_code_exists: 0 },
      { next_queue_sequence: 3, next_flight_number: 104, next_ticket_number: 208 },
    ]);
    const broadcast = vi.fn();
    const service = new TicketSalesCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handleTicketSale(
      command(),
      currentEvent(),
      "synthetic-cashier-account",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      eventType: "TICKET_GROUP_SOLD",
      saleReceipt: { groupSize: 2 },
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one sale persistence batch");
    expect(findStatement(batch, "UPDATE operation_days")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO ticket_groups").parameters).toContain(
      "synthetic-cashier-account",
    );
    expect(batch.filter(({ sql }) => sql.includes("INSERT INTO tickets"))).toHaveLength(2);
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });
});
