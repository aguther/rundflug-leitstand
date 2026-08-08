import { describe, expect, it, vi } from "vitest";
import { ProductSalesCommandService } from "./product-sales-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type ProductSalesCommand = Parameters<
  ProductSalesCommandService["handleProductSalesConfiguration"]
>[0];

function createDatabase(firstRows: Array<Record<string, unknown> | null>): {
  db: D1Database;
  batches: PreparedQuery[][];
  prepare: ReturnType<typeof vi.fn>;
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
  return { db: { prepare, batch } as unknown as D1Database, batches, prepare };
}

function currentEvent(status: StoredEventRow["status"] = "ACTIVE"): StoredEventRow {
  return {
    id: "synthetic-event",
    name: "Synthetic event",
    event_date: "2026-08-08",
    time_zone: "Europe/Berlin",
    status,
    emergency_mode: 0,
    version: 9,
    operational_note: "",
    updated_at: "2026-08-08T08:00:00.000Z",
  };
}

function command(overrides: Partial<ProductSalesCommand["payload"]> = {}): ProductSalesCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-admin",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "CONFIGURE_PRODUCT_SALES",
    payload: {
      productId: "product-one",
      saleEnabled: false,
      saleClosesAt: "2026-08-08T16:00:00.000Z",
      warningThreshold: 20,
      criticalThreshold: 10,
      reason: "Synthetic sales configuration",
      adminPin: "1234",
      ...overrides,
    },
  };
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

describe("product sales command service", () => {
  it("persists a live sales configuration with audit, idempotency and outbox atomically", async () => {
    const { db, batches } = createDatabase([{ id: "product-one", sale_enabled: 1 }]);
    const broadcast = vi.fn();
    const service = new ProductSalesCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handleProductSalesConfiguration(command(), currentEvent());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      eventType: "PRODUCT_SALES_CONFIGURED",
      aggregate: { type: "PRODUCT", id: "product-one" },
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "UPDATE operation_days")).toBeDefined();
    expect(findStatement(batch, "UPDATE products SET sale_enabled")).toMatchObject({
      parameters: [
        0,
        "2026-08-08T16:00:00.000Z",
        20,
        10,
        expect.any(String),
        "product-one",
        "synthetic-event",
      ],
    });
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("rejects inverted capacity thresholds before reading or writing the database", async () => {
    const { db, batches, prepare } = createDatabase([]);
    const broadcast = vi.fn();
    const service = new ProductSalesCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handleProductSalesConfiguration(
      command({ warningThreshold: 10, criticalThreshold: 20 }),
      currentEvent(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CAPACITY_THRESHOLDS_INVALID" },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rejects disabling product sales during preparation without persistence", async () => {
    const { db, batches } = createDatabase([{ id: "product-one", sale_enabled: 1 }]);
    const broadcast = vi.fn();
    const service = new ProductSalesCommandService({ DB: db } as unknown as Env, broadcast);

    const response = await service.handleProductSalesConfiguration(
      command(),
      currentEvent("PREPARATION"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PRODUCT_LIVE_SALES_NOT_AVAILABLE" },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
