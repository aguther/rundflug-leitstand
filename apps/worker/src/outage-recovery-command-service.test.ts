import { describe, expect, it, vi } from "vitest";
import { OutageRecoveryCommandService } from "./outage-recovery-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

type StageCommand = Parameters<OutageRecoveryCommandService["handleStageOutageRecovery"]>[0];
type ApproveCommand = Parameters<OutageRecoveryCommandService["handleApproveOutageRecovery"]>[0];
type ApplyCommand = Parameters<OutageRecoveryCommandService["handleApplyOutageRecovery"]>[0];

function createDatabase(input: {
  firstRows?: Array<Record<string, unknown> | null>;
  allRows?: Array<Array<Record<string, unknown>>>;
}): {
  db: D1Database;
  batches: PreparedQuery[][];
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
  return { db: { prepare, batch } as unknown as D1Database, batches };
}

function currentEvent(version: number): StoredEventRow {
  return {
    id: "synthetic-event",
    name: "Synthetic event",
    event_date: "2026-08-09",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    version,
    operational_note: "",
    updated_at: "2026-08-09T08:00:00.000Z",
  };
}

function createService(db: D1Database, broadcast = vi.fn()): OutageRecoveryCommandService {
  return new OutageRecoveryCommandService({ DB: db } as unknown as Env, broadcast);
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

function commandBase(commandId: string, deviceId: string, expectedVersion: number) {
  return {
    commandId,
    eventId: "synthetic-event",
    deviceId,
    expectedVersion,
    issuedAt: "2026-08-09T08:00:00.000Z",
  } as const;
}

describe("outage recovery command service", () => {
  it("stages a conflict-free paper sale atomically with audit and idempotency", async () => {
    const { db, batches } = createDatabase({
      firstRows: [null],
      allRows: [[], [], []],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: StageCommand = {
      ...commandBase("550e8400-e29b-41d4-a716-446655440001", "synthetic-cashier", 9),
      type: "STAGE_OUTAGE_RECOVERY",
      payload: {
        batchId: "550e8400-e29b-41d4-a716-446655440101",
        entries: [
          {
            id: "550e8400-e29b-41d4-a716-446655440201",
            type: "PAPER_SALE",
            originalOccurredAt: "2026-08-08T09:00:00.000Z",
            paperSequence: 1,
            paperReference: "SYNTHETIC-RECEIPT-1",
            payload: {
              productId: "synthetic-product",
              publicTicketCodes: ["ABCDEFGHJKLM"],
              paymentStatus: "PAID",
              paymentMethod: "CASH",
            },
          },
        ],
      },
    };

    const response = await service.handleStageOutageRecovery(command, currentEvent(9));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "OUTAGE_RECOVERY_STAGED",
      aggregate: {
        type: "RECOVERY_BATCH",
        id: "550e8400-e29b-41d4-a716-446655440101",
      },
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "UPDATE operation_days")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outage_recovery_batches")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outage_recovery_entries")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("rejects a duplicate recovery batch before persistence", async () => {
    const { db, batches } = createDatabase({
      firstRows: [{ id: "550e8400-e29b-41d4-a716-446655440102" }],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: StageCommand = {
      ...commandBase("550e8400-e29b-41d4-a716-446655440002", "synthetic-cashier", 9),
      type: "STAGE_OUTAGE_RECOVERY",
      payload: {
        batchId: "550e8400-e29b-41d4-a716-446655440102",
        entries: [
          {
            id: "550e8400-e29b-41d4-a716-446655440202",
            type: "PAPER_SALE",
            originalOccurredAt: "2026-08-08T09:00:00.000Z",
            paperSequence: 1,
            paperReference: "SYNTHETIC-RECEIPT-2",
            payload: {
              productId: "synthetic-product",
              publicTicketCodes: ["ABCDEFGHJKMN"],
              paymentStatus: "PAID",
              paymentMethod: "CASH",
            },
          },
        ],
      },
    };

    const response = await service.handleStageOutageRecovery(command, currentEvent(9));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RECOVERY_BATCH_ALREADY_EXISTS" },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("approves a staged batch with versioned audit, receipt, and outbox", async () => {
    const { db, batches } = createDatabase({
      firstRows: [
        {
          id: "550e8400-e29b-41d4-a716-446655440103",
          status: "STAGED",
          created_by_device_id: "synthetic-cashier",
          simulated_against_version: 9,
          version: 0,
        },
      ],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: ApproveCommand = {
      ...commandBase("550e8400-e29b-41d4-a716-446655440003", "synthetic-admin", 10),
      type: "APPROVE_OUTAGE_RECOVERY",
      payload: {
        batchId: "550e8400-e29b-41d4-a716-446655440103",
        adminPin: "1234",
      },
    };

    const response = await service.handleApproveOutageRecovery(command, currentEvent(10));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "OUTAGE_RECOVERY_APPROVED",
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    expect(findStatement(batch, "SET status = 'APPROVED'")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO operational_events")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("enforces four-eyes approval before persistence", async () => {
    const { db, batches } = createDatabase({
      firstRows: [
        {
          id: "550e8400-e29b-41d4-a716-446655440104",
          status: "STAGED",
          created_by_device_id: "synthetic-admin",
          simulated_against_version: 9,
          version: 0,
        },
      ],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: ApproveCommand = {
      ...commandBase("550e8400-e29b-41d4-a716-446655440004", "synthetic-admin", 10),
      type: "APPROVE_OUTAGE_RECOVERY",
      payload: {
        batchId: "550e8400-e29b-41d4-a716-446655440104",
        adminPin: "1234",
      },
    };

    const response = await service.handleApproveOutageRecovery(command, currentEvent(10));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "OUTAGE_RECOVERY_FOUR_EYES_REQUIRED" },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("applies a paper sale without cashier attribution and preserves the effective gate", async () => {
    const ticketHash = "a".repeat(64);
    const groupHash = "b".repeat(64);
    const { db, batches } = createDatabase({
      firstRows: [
        {
          id: "550e8400-e29b-41d4-a716-446655440106",
          status: "APPROVED",
          created_by_device_id: "synthetic-cashier",
          approved_by_device_id: "synthetic-admin",
          simulated_against_version: 9,
          version: 1,
        },
        { maximum: 100 },
      ],
      allRows: [
        [
          {
            id: "550e8400-e29b-41d4-a716-446655440206",
            source_entry_id: "550e8400-e29b-41d4-a716-446655440306",
            entry_type: "PAPER_SALE",
            original_occurred_at: "2026-08-08T09:00:00.000Z",
            paper_sequence: 1,
            paper_reference: "SYNTHETIC-RECEIPT-6",
            payload_json: JSON.stringify({
              productId: "synthetic-product",
              publicGroupCodeHash: groupHash,
              publicTicketCodeHashes: [ticketHash],
              paymentStatus: "PAID",
              paymentMethod: "CASH",
            }),
            status: "STAGED",
          },
        ],
        [
          {
            id: "synthetic-product",
            resource_group_id: "synthetic-resource-group",
            gate_id: "synthetic-gate",
            price_cents: 2500,
          },
        ],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: ApplyCommand = {
      ...commandBase("550e8400-e29b-41d4-a716-446655440006", "synthetic-admin", 11),
      type: "APPLY_OUTAGE_RECOVERY",
      payload: {
        batchId: "550e8400-e29b-41d4-a716-446655440106",
        adminPin: "1234",
      },
    };

    const response = await service.handleApplyOutageRecovery(command, currentEvent(11));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "OUTAGE_RECOVERY_APPLIED",
    });
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (!batch) throw new Error("Expected one persistence batch");
    const ticketGroupInsert = findStatement(batch, "INSERT INTO ticket_groups");
    expect(ticketGroupInsert.sql).not.toContain("sold_by_operator_account_id");
    const rotationInsert = findStatement(batch, "INSERT INTO rotations");
    expect(rotationInsert.sql).toMatch(/flight_group_id, gate_id, status/);
    expect(rotationInsert.parameters).toContain("synthetic-gate");
    expect(findStatement(batch, "recorded_after_outage")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("rejects application after the live event version has advanced", async () => {
    const { db, batches } = createDatabase({
      firstRows: [
        {
          id: "550e8400-e29b-41d4-a716-446655440105",
          status: "APPROVED",
          created_by_device_id: "synthetic-cashier",
          approved_by_device_id: "synthetic-admin",
          simulated_against_version: 9,
          version: 1,
        },
      ],
    });
    const broadcast = vi.fn();
    const service = createService(db, broadcast);
    const command: ApplyCommand = {
      ...commandBase("550e8400-e29b-41d4-a716-446655440005", "synthetic-admin", 12),
      type: "APPLY_OUTAGE_RECOVERY",
      payload: {
        batchId: "550e8400-e29b-41d4-a716-446655440105",
        adminPin: "1234",
      },
    };

    const response = await service.handleApplyOutageRecovery(command, currentEvent(12));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "OUTAGE_RECOVERY_APPLICATION_STALE" },
    });
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
