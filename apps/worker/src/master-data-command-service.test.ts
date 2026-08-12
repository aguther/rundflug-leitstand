import { describe, expect, it, vi } from "vitest";
import { MasterDataCommandService } from "./master-data-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type ReorderCommand = Parameters<MasterDataCommandService["handleCashierProductReorder"]>[0];
type TurnaroundCommand = Parameters<
  MasterDataCommandService["handleAircraftProductTurnaroundOverride"]
>[0];
type DeleteCommand = Parameters<MasterDataCommandService["handleMasterDataDeletion"]>[0];
type ResourceCommand = Parameters<
  MasterDataCommandService["handleResourceAndAircraftMasterData"]
>[0];

function createDatabase(input: {
  firstRows?: Array<Record<string, unknown> | null>;
  allRows?: Array<Array<Record<string, unknown>>>;
}): {
  db: D1Database;
  batches: PreparedQuery[][];
  prepare: ReturnType<typeof vi.fn>;
} {
  const firstRows = input.firstRows ?? [];
  const allRows = input.allRows ?? [];
  const batches: PreparedQuery[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => ({
      sql,
      parameters,
      first: async () => firstRows.shift() ?? null,
      all: async () => ({
        success: true,
        results: allRows.shift() ?? [],
        meta: {},
      }),
    }),
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) => {
    batches.push(statements);
    return statements.map(() => ({ success: true, results: [], meta: {} }));
  });
  return { db: { prepare, batch } as unknown as D1Database, batches, prepare };
}

function currentEvent(status: StoredEventRow["status"] = "PREPARATION"): StoredEventRow {
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

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

function createService(db: D1Database, broadcast = vi.fn()): MasterDataCommandService {
  return new MasterDataCommandService({ DB: db } as unknown as Env, broadcast);
}

function deleteCommand(
  entityType: DeleteCommand["payload"]["entityType"],
  entityId: string,
): DeleteCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440010",
    eventId: "synthetic-event",
    deviceId: "synthetic-admin",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "DELETE_MASTER_DATA",
    payload: {
      entityType,
      entityId,
      reason: "Synthetic cleanup",
      adminPin: "1234",
    },
  };
}

describe("master data command service", () => {
  it("reorders every cashier product atomically with audit and idempotency", async () => {
    const { db, batches } = createDatabase({
      allRows: [[{ id: "product-one" }, { id: "product-two" }]],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: ReorderCommand = {
      commandId: "550e8400-e29b-41d4-a716-446655440001",
      eventId: "synthetic-event",
      deviceId: "synthetic-cashier",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "REORDER_CASHIER_PRODUCTS",
      payload: {
        expectedProductIds: ["product-one", "product-two"],
        orderedProductIds: ["product-two", "product-one"],
      },
    };

    const response = await service.handleCashierProductReorder(command, currentEvent());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "CASHIER_PRODUCT_ORDER_CHANGED",
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    const productUpdates = batch.filter(({ sql }) => sql.includes("SET sort_order = ?1"));
    expect(productUpdates).toHaveLength(2);
    expect(productUpdates.map(({ parameters }) => parameters[0])).toEqual([10, 20]);
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("rejects a stale expected cashier order before persistence", async () => {
    const { db, batches } = createDatabase({
      allRows: [[{ id: "product-one" }, { id: "product-two" }]],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: ReorderCommand = {
      commandId: "550e8400-e29b-41d4-a716-446655440002",
      eventId: "synthetic-event",
      deviceId: "synthetic-cashier",
      expectedVersion: 8,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "REORDER_CASHIER_PRODUCTS",
      payload: {
        expectedProductIds: ["product-two", "product-one"],
        orderedProductIds: ["product-one", "product-two"],
      },
    };

    const response = await service.handleCashierProductReorder(command, currentEvent());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CASHIER_PRODUCT_ORDER_CONFLICT", currentVersion: 9 },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("upserts a turnaround override with versioned audit and outbox persistence", async () => {
    const { db, batches } = createDatabase({
      firstRows: [{ id: "product-one" }, { id: "aircraft-one" }, null],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: TurnaroundCommand = {
      commandId: "550e8400-e29b-41d4-a716-446655440003",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE",
      payload: {
        aircraftId: "aircraft-one",
        productId: "product-one",
        plannedBoardingMinutesOverride: 8,
        plannedDeboardingMinutesOverride: null,
        plannedBufferMinutesOverride: 4,
        reason: "Synthetic turnaround override",
        adminPin: "1234",
      },
    };

    const response = await service.handleAircraftProductTurnaroundOverride(command, currentEvent());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE_UPSERTED",
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "INSERT INTO aircraft_product_turnaround_overrides")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("blocks permanent deletion after preparation before accessing the database", async () => {
    const { db, batches, prepare } = createDatabase({});
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: DeleteCommand = {
      commandId: "550e8400-e29b-41d4-a716-446655440004",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "DELETE_MASTER_DATA",
      payload: {
        entityType: "PRODUCT",
        entityId: "product-one",
        reason: "Synthetic cleanup",
        adminPin: "1234",
      },
    };

    const response = await service.handleMasterDataDeletion(command, currentEvent("ACTIVE"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MASTER_DATA_DELETE_PHASE_LOCKED" },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced product with audit, idempotency and outbox in one batch", async () => {
    const { db, batches } = createDatabase({
      firstRows: [{ name: "Synthetic product" }, { count: 0 }],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: DeleteCommand = {
      commandId: "550e8400-e29b-41d4-a716-446655440005",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "DELETE_MASTER_DATA",
      payload: {
        entityType: "PRODUCT",
        entityId: "product-one",
        reason: "Synthetic cleanup",
        adminPin: "1234",
      },
    };

    const response = await service.handleMasterDataDeletion(command, currentEvent());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "PRODUCT_DELETED",
      aggregate: { type: "PRODUCT", id: "product-one" },
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "DELETE FROM products")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it.each([
    {
      entityType: "GATE" as const,
      entityId: "gate-one",
      firstRows: [{ label: "Gate one" }, { count: 0 }, { count: 0 }, { count: 0 }],
      allRows: [],
      eventType: "GATE_DELETED",
      deleteSql: "DELETE FROM gates",
    },
    {
      entityType: "RESOURCE_GROUP" as const,
      entityId: "resource-one",
      firstRows: [{ name: "Resource one" }, { count: 0 }, { count: 0 }, { count: 0 }],
      allRows: [],
      eventType: "RESOURCE_GROUP_DELETED",
      deleteSql: "DELETE FROM resource_groups",
    },
    {
      entityType: "PILOT" as const,
      entityId: "pilot-one",
      firstRows: [{ operational_code: "P-01" }, { count: 0 }, { count: 0 }],
      allRows: [],
      eventType: "PILOT_DELETED",
      deleteSql: "DELETE FROM pilots",
    },
    {
      entityType: "AIRCRAFT" as const,
      entityId: "aircraft-one",
      firstRows: [{ registration: "D-SYN1" }, { count: 0 }, { count: 0 }],
      allRows: [],
      eventType: "AIRCRAFT_DELETED",
      deleteSql: "DELETE FROM aircraft",
    },
    {
      entityType: "ASSIGNMENT" as const,
      entityId: "aircraft-one",
      firstRows: [{ count: 0 }],
      allRows: [[{ id: "membership-one", registration: "D-SYN1" }]],
      eventType: "AIRCRAFT_RESOURCE_GROUP_ASSIGNMENT_DELETED",
      deleteSql: "DELETE FROM resource_group_memberships",
    },
  ])(
    "deletes an unreferenced $entityType with the matching aggregate event",
    async ({ entityType, entityId, firstRows, allRows, eventType, deleteSql }) => {
      const { db, batches } = createDatabase({ firstRows, allRows });
      const broadcast = vi.fn();
      const service = createService(db, broadcast);

      const response = await service.handleMasterDataDeletion(
        deleteCommand(entityType, entityId),
        currentEvent(),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        accepted: true,
        eventType,
      });
      expect(batches).toHaveLength(1);
      const [batch] = batches;
      if (!batch) throw new Error("Expected one persistence batch");
      expect(findStatement(batch, deleteSql)).toBeDefined();
      expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
      expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
      expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
      expect(broadcast).toHaveBeenCalledOnce();
    },
  );

  it("reports all gate references that block permanent deletion", async () => {
    const { db, batches } = createDatabase({
      firstRows: [{ label: "Gate one" }, { count: 2 }, { count: 3 }, { count: 4 }],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);

    const response = await service.handleMasterDataDeletion(
      deleteCommand("GATE", "gate-one"),
      currentEvent(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "MASTER_DATA_DELETE_BLOCKED",
        message:
          "Löschen nicht möglich. Zuerst entfernen: 2 Ressourcengruppe(n), 3 Produkt(e), 4 Umlauf/Umläufe.",
      },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rejects moving an aircraft while an active rotation owns its lifecycle", async () => {
    const { db, batches } = createDatabase({
      firstRows: [
        { id: "aircraft-one", aircraft_type: "SyntheticType" },
        {
          id: "resource-two",
          compatible_aircraft_types_json: JSON.stringify(["SyntheticType"]),
        },
        {
          id: "membership-one",
          resource_group_id: "resource-one",
          active_from: "2026-08-08T06:00:00.000Z",
        },
        { id: "rotation-one" },
      ],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: ResourceCommand = {
      commandId: "550e8400-e29b-41d4-a716-446655440006",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "ASSIGN_AIRCRAFT_RESOURCE_GROUP",
      payload: {
        aircraftId: "aircraft-one",
        resourceGroupId: "resource-two",
        effectiveAt: "2026-08-08T09:00:00.000Z",
        reason: "Synthetic reassignment",
        adminPin: "1234",
      },
    };

    const response = await service.handleResourceAndAircraftMasterData(command, currentEvent());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AIRCRAFT_LIFECYCLE_ACTIVE" },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
