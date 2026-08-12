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
type MasterCommand = Parameters<MasterDataCommandService["handleMasterData"]>[0];
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
  const nextAll = async () => ({
    success: true,
    results: allRows.shift() ?? [],
    meta: {},
  });
  const prepare = vi.fn((sql: string) => ({
    all: nextAll,
    bind: (...parameters: unknown[]) => ({
      sql,
      parameters,
      first: async () => firstRows.shift() ?? null,
      all: nextAll,
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

function gateCommand(overrides: Record<string, unknown> = {}): MasterCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440020",
    eventId: "synthetic-event",
    deviceId: "synthetic-admin",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "UPSERT_GATE",
    payload: {
      gateId: "gate-one",
      label: "Gate one",
      gateType: "FLIGHT_LINE",
      active: true,
      sortOrder: 10,
      travelLeadMinutes: 5,
      displayFilter: { productIds: [], rotationStatuses: [] },
      reason: "Synthetic gate update",
      adminPin: "1234",
      ...overrides,
    },
  } as MasterCommand;
}

function productCommand(overrides: Record<string, unknown> = {}): MasterCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440021",
    eventId: "synthetic-event",
    deviceId: "synthetic-admin",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "UPSERT_PRODUCT",
    payload: {
      productId: "product-one",
      resourceGroupId: "resource-one",
      gateId: "gate-one",
      name: "Synthetic panorama",
      code: "PAN",
      publicDescription: "Synthetic product",
      priceCents: 5000,
      referenceCapacity: 4,
      referenceDurationMinutes: 20,
      promisedFlightMinutes: 15,
      plannedBoardingMinutesOverride: null,
      plannedDeboardingMinutesOverride: null,
      plannedBufferMinutesOverride: null,
      childCompanionRequired: false,
      weightClasses: ["NORMAL"],
      reason: "Synthetic product update",
      adminPin: "1234",
      ...overrides,
    },
  } as MasterCommand;
}

function resourceGroupCommand(overrides: Record<string, unknown> = {}): ResourceCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440022",
    eventId: "synthetic-event",
    deviceId: "synthetic-admin",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "UPSERT_RESOURCE_GROUP",
    payload: {
      resourceGroupId: "resource-one",
      name: "Resource one",
      shortCode: "R1",
      gateId: "gate-one",
      referenceCapacity: 4,
      compatibleAircraftTypes: ["SyntheticType"],
      automaticPrecallEnabled: true,
      aircraftIds: ["aircraft-one"],
      reason: "Synthetic resource update",
      adminPin: "1234",
      ...overrides,
    },
  } as ResourceCommand;
}

function aircraftCommand(overrides: Record<string, unknown> = {}): ResourceCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440023",
    eventId: "synthetic-event",
    deviceId: "synthetic-admin",
    expectedVersion: 9,
    issuedAt: "2026-08-08T08:00:00.000Z",
    type: "UPSERT_AIRCRAFT",
    payload: {
      aircraftId: "aircraft-one",
      registration: "D-SYN1",
      aircraftType: "SyntheticType",
      passengerSeats: 4,
      maximumPassengerPayloadKg: 320,
      reason: "Synthetic aircraft update",
      adminPin: "1234",
      ...overrides,
    },
  } as ResourceCommand;
}

function assignmentCommand(overrides: Record<string, unknown> = {}): ResourceCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440024",
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
      ...overrides,
    },
  } as ResourceCommand;
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

describe("master data invariant guards", () => {
  it("rejects duplicate gates, invalid display references, and deactivation in use", async () => {
    const duplicate = createDatabase({ firstRows: [{ id: "gate-two" }, null] });
    await expect(
      createService(duplicate.db).handleMasterData(gateCommand(), currentEvent()),
    ).resolves.toMatchObject({ status: 409 });
    expect(duplicate.batches).toHaveLength(0);

    const invalidFilter = createDatabase({
      firstRows: [null, null, { count: 1 }],
    });
    const invalidFilterResponse = await createService(invalidFilter.db).handleMasterData(
      gateCommand({
        displayFilter: { productIds: ["product-one", "product-two"], rotationStatuses: [] },
      }),
      currentEvent(),
    );
    await expect(invalidFilterResponse.json()).resolves.toMatchObject({
      error: { code: "GATE_DISPLAY_FILTER_REFERENCE_INVALID" },
    });

    const activeUse = createDatabase({ firstRows: [null, null, { count: 2 }] });
    const activeUseResponse = await createService(activeUse.db).handleMasterData(
      gateCommand({ active: false }),
      currentEvent(),
    );
    await expect(activeUseResponse.json()).resolves.toMatchObject({
      error: { code: "GATE_IN_ACTIVE_USE" },
    });
  });

  it("retains an existing gate display filter and persists a valid update", async () => {
    const { db, batches } = createDatabase({
      firstRows: [
        null,
        {
          display_filter_json: JSON.stringify({
            productIds: ["product-one"],
            rotationStatuses: ["CALLED"],
          }),
        },
        { count: 1 },
      ],
    });
    const response = await createService(db).handleMasterData(
      gateCommand({ displayFilter: undefined }),
      currentEvent(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ eventType: "GATE_UPSERTED" });
    expect(batches).toHaveLength(1);
    expect(findStatement(batches[0] ?? [], "INSERT INTO gates").parameters).toContain(
      JSON.stringify({ productIds: ["product-one"], rotationStatuses: ["CALLED"] }),
    );
  });

  it("rejects invalid product references, duplicate codes, and active resource changes", async () => {
    const invalidReference = createDatabase({
      firstRows: [null, { id: "gate-one" }, null, null, { next_sort_order: 10 }],
    });
    const invalidReferenceResponse = await createService(invalidReference.db).handleMasterData(
      productCommand(),
      currentEvent(),
    );
    await expect(invalidReferenceResponse.json()).resolves.toMatchObject({
      error: { code: "PRODUCT_REFERENCE_INVALID" },
    });

    const duplicateCode = createDatabase({
      firstRows: [
        { id: "resource-one" },
        { id: "gate-one" },
        { id: "product-two" },
        null,
        { next_sort_order: 10 },
      ],
    });
    const duplicateResponse = await createService(duplicateCode.db).handleMasterData(
      productCommand(),
      currentEvent(),
    );
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      error: { code: "PRODUCT_CODE_EXISTS" },
    });

    const activeQueue = createDatabase({
      firstRows: [
        { id: "resource-one" },
        { id: "gate-one" },
        null,
        { resource_group_id: "resource-old", sort_order: 10, open_tickets: 2 },
        { next_sort_order: 20 },
      ],
    });
    const activeQueueResponse = await createService(activeQueue.db).handleMasterData(
      productCommand(),
      currentEvent(),
    );
    await expect(activeQueueResponse.json()).resolves.toMatchObject({
      error: { code: "PRODUCT_RESOURCE_CHANGE_ACTIVE_QUEUE" },
    });
  });

  it("persists a valid product with the next cashier order", async () => {
    const { db, batches } = createDatabase({
      firstRows: [{ id: "resource-one" }, { id: "gate-one" }, null, null, { next_sort_order: 30 }],
    });
    const response = await createService(db).handleMasterData(productCommand(), currentEvent());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ eventType: "PRODUCT_UPSERTED" });
    expect(findStatement(batches[0] ?? [], "INSERT INTO products").parameters).toContain(30);
  });

  it("guards turnaround references, existence, and expected override versions", async () => {
    const basePayload = {
      aircraftId: "aircraft-one",
      productId: "product-one",
      expectedOverrideVersion: 2,
      reason: "Synthetic override cleanup",
      adminPin: "1234",
    };
    const deleteOverride = {
      commandId: "550e8400-e29b-41d4-a716-446655440025",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE",
      payload: basePayload,
    } as TurnaroundCommand;

    const invalidReference = createDatabase({ firstRows: [null, { id: "aircraft-one" }, null] });
    const invalidResponse = await createService(
      invalidReference.db,
    ).handleAircraftProductTurnaroundOverride(deleteOverride, currentEvent());
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: { code: "TURNAROUND_OVERRIDE_REFERENCE_INVALID" },
    });

    const missing = createDatabase({
      firstRows: [{ id: "product-one" }, { id: "aircraft-one" }, null],
    });
    const missingResponse = await createService(missing.db).handleAircraftProductTurnaroundOverride(
      deleteOverride,
      currentEvent(),
    );
    expect(missingResponse.status).toBe(404);

    const stale = createDatabase({
      firstRows: [{ id: "product-one" }, { id: "aircraft-one" }, { version: 3 }],
    });
    const staleResponse = await createService(stale.db).handleAircraftProductTurnaroundOverride(
      deleteOverride,
      currentEvent(),
    );
    await expect(staleResponse.json()).resolves.toMatchObject({
      error: { code: "TURNAROUND_OVERRIDE_STALE_VERSION", currentVersion: 3 },
    });
  });

  it("deletes a turnaround override atomically at its expected version", async () => {
    const { db, batches } = createDatabase({
      firstRows: [{ id: "product-one" }, { id: "aircraft-one" }, { version: 2 }],
    });
    const command = {
      commandId: "550e8400-e29b-41d4-a716-446655440026",
      eventId: "synthetic-event",
      deviceId: "synthetic-admin",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE",
      payload: {
        aircraftId: "aircraft-one",
        productId: "product-one",
        expectedOverrideVersion: 2,
        reason: "Synthetic override cleanup",
        adminPin: "1234",
      },
    } as TurnaroundCommand;

    const response = await createService(db).handleAircraftProductTurnaroundOverride(
      command,
      currentEvent(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      eventType: "AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE_DELETED",
    });
    expect(
      findStatement(batches[0] ?? [], "DELETE FROM aircraft_product_turnaround_overrides"),
    ).toBeDefined();
  });

  it("rejects invalid and unchanged cashier order requests", async () => {
    const invalid = createDatabase({ allRows: [[{ id: "product-one" }, { id: "product-two" }]] });
    const invalidCommand = {
      commandId: "550e8400-e29b-41d4-a716-446655440027",
      eventId: "synthetic-event",
      deviceId: "synthetic-cashier",
      expectedVersion: 9,
      issuedAt: "2026-08-08T08:00:00.000Z",
      type: "REORDER_CASHIER_PRODUCTS",
      payload: {
        expectedProductIds: ["product-one", "product-two"],
        orderedProductIds: ["product-one", "unknown-product"],
      },
    } as ReorderCommand;
    const invalidResponse = await createService(invalid.db).handleCashierProductReorder(
      invalidCommand,
      currentEvent(),
    );
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: { code: "CASHIER_PRODUCT_ORDER_INVALID" },
    });

    const unchanged = createDatabase({
      allRows: [[{ id: "product-one" }, { id: "product-two" }]],
    });
    const unchangedResponse = await createService(unchanged.db).handleCashierProductReorder(
      {
        ...invalidCommand,
        payload: {
          expectedProductIds: ["product-one", "product-two"],
          orderedProductIds: ["product-one", "product-two"],
        },
      },
      currentEvent(),
    );
    expect(unchangedResponse.status).toBe(400);
  });
});

describe("resource and aircraft master-data guards", () => {
  it.each([
    {
      rows: [null, null, null],
      code: "GATE_NOT_AVAILABLE",
    },
    {
      rows: [{ id: "gate-one" }, { id: "resource-two" }, null],
      code: "RESOURCE_GROUP_NAME_EXISTS",
    },
    {
      rows: [{ id: "gate-one" }, null, { id: "resource-two" }],
      code: "RESOURCE_GROUP_SHORT_CODE_EXISTS",
    },
  ])("rejects resource-group conflicts with $code", async ({ rows, code }) => {
    const { db, batches } = createDatabase({ firstRows: rows });
    const response = await createService(db).handleResourceAndAircraftMasterData(
      resourceGroupCommand(),
      currentEvent(),
    );
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(batches).toHaveLength(0);
  });

  it("rejects unknown aircraft and active membership changes", async () => {
    const unknown = createDatabase({
      firstRows: [{ id: "gate-one" }, null, null],
      allRows: [[], [], []],
    });
    const unknownResponse = await createService(unknown.db).handleResourceAndAircraftMasterData(
      resourceGroupCommand(),
      currentEvent(),
    );
    await expect(unknownResponse.json()).resolves.toMatchObject({
      error: { code: "RESOURCE_GROUP_AIRCRAFT_INVALID" },
    });

    const active = createDatabase({
      firstRows: [{ id: "gate-one" }, null, null],
      allRows: [
        [{ id: "aircraft-one" }],
        [
          {
            id: "membership-one",
            aircraft_id: "aircraft-one",
            resource_group_id: "resource-two",
          },
        ],
        [{ aircraft_id: "aircraft-one" }],
      ],
    });
    const activeResponse = await createService(active.db).handleResourceAndAircraftMasterData(
      resourceGroupCommand(),
      currentEvent(),
    );
    await expect(activeResponse.json()).resolves.toMatchObject({
      error: { code: "AIRCRAFT_LIFECYCLE_ACTIVE" },
    });
  });

  it("updates resource-group membership changes in the same event batch", async () => {
    const { db, batches } = createDatabase({
      firstRows: [{ id: "gate-one" }, null, null],
      allRows: [
        [{ id: "aircraft-one" }, { id: "aircraft-two" }],
        [
          {
            id: "membership-one",
            aircraft_id: "aircraft-one",
            resource_group_id: "resource-one",
          },
          {
            id: "membership-two",
            aircraft_id: "aircraft-two",
            resource_group_id: "resource-two",
          },
        ],
        [],
      ],
    });
    const response = await createService(db).handleResourceAndAircraftMasterData(
      resourceGroupCommand({ aircraftIds: ["aircraft-two"] }),
      currentEvent(),
    );

    expect(response.status).toBe(200);
    const batch = batches[0] ?? [];
    expect(batch.filter(({ sql }) => sql.includes("active_until = ?1"))).toHaveLength(2);
    expect(findStatement(batch, "INSERT INTO resource_group_memberships")).toBeDefined();
  });

  it("guards aircraft registration and active lifecycle while permitting a safe update", async () => {
    for (const [rows, code] of [
      [[{ id: "aircraft-two" }, null], "AIRCRAFT_REGISTRATION_EXISTS"],
      [[null, { id: "rotation-one" }], "AIRCRAFT_LIFECYCLE_ACTIVE"],
    ] as const) {
      const guarded = createDatabase({ firstRows: [...rows] });
      const response = await createService(guarded.db).handleResourceAndAircraftMasterData(
        aircraftCommand(),
        currentEvent(),
      );
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
    }

    const valid = createDatabase({ firstRows: [null, null] });
    const response = await createService(valid.db).handleResourceAndAircraftMasterData(
      aircraftCommand(),
      currentEvent(),
    );
    expect(response.status).toBe(200);
    expect(findStatement(valid.batches[0] ?? [], "INSERT INTO aircraft")).toBeDefined();
  });

  it.each([
    {
      rows: [null, null, null, null],
      overrides: {},
      code: "ASSIGNMENT_REFERENCE_INVALID",
      status: 404,
    },
    {
      rows: [
        { id: "aircraft-one", aircraft_type: "SyntheticType" },
        { id: "resource-two", compatible_aircraft_types_json: "[]" },
        {
          id: "membership-one",
          resource_group_id: "resource-two",
          active_from: "2026-08-08T06:00:00.000Z",
        },
        null,
      ],
      overrides: {},
      code: "ASSIGNMENT_UNCHANGED",
      status: 409,
    },
    {
      rows: [
        { id: "aircraft-one", aircraft_type: "SyntheticType" },
        { id: "resource-two", compatible_aircraft_types_json: "[]" },
        {
          id: "membership-one",
          resource_group_id: "resource-one",
          active_from: "2026-08-08T10:00:00.000Z",
        },
        null,
      ],
      overrides: {},
      code: "ASSIGNMENT_TIME_INVALID",
      status: 409,
    },
    {
      rows: [
        { id: "aircraft-one", aircraft_type: "SyntheticType" },
        {
          id: "resource-two",
          compatible_aircraft_types_json: JSON.stringify(["OtherType"]),
        },
        null,
        null,
      ],
      overrides: {},
      code: "AIRCRAFT_TYPE_INCOMPATIBLE",
      status: 409,
    },
  ])("rejects invalid assignment with $code", async ({ rows, overrides, code, status }) => {
    const { db } = createDatabase({ firstRows: rows });
    const response = await createService(db).handleResourceAndAircraftMasterData(
      assignmentCommand(overrides),
      currentEvent(),
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("closes the prior assignment before inserting a compatible replacement", async () => {
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
        null,
      ],
    });
    const response = await createService(db).handleResourceAndAircraftMasterData(
      assignmentCommand(),
      currentEvent(),
    );

    expect(response.status).toBe(200);
    const batch = batches[0] ?? [];
    expect(
      findStatement(batch, "UPDATE resource_group_memberships SET active_until"),
    ).toBeDefined();
    expect(findStatement(batch, "INSERT INTO resource_group_memberships")).toBeDefined();
  });
});
