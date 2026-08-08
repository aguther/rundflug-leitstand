import type { CommandEnvelope } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import { RotationCorrectionCommandService } from "./rotation-correction-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

interface QueryResponses {
  first: Record<string, unknown>[];
  all: Record<string, unknown>[][];
}

function createDatabase(responses: QueryResponses): {
  db: D1Database;
  batches: PreparedQuery[][];
} {
  const batches: PreparedQuery[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => {
      const statement: PreparedQuery & {
        first: () => Promise<Record<string, unknown> | null>;
        all: () => Promise<{ results: Record<string, unknown>[] }>;
      } = {
        sql,
        parameters,
        first: async () => responses.first.shift() ?? null,
        all: async () => ({ results: responses.all.shift() ?? [] }),
      };
      return statement;
    },
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
    version: 7,
    operational_note: "",
    updated_at: "2026-08-08T08:00:00.000Z",
  };
}

function commandBase() {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-device",
    expectedVersion: 7,
    issuedAt: "2026-08-08T08:00:00.000Z",
  };
}

function findStatement(batch: PreparedQuery[], fragment: string): PreparedQuery {
  const statement = batch.find(({ sql }) => sql.includes(fragment));
  if (!statement) throw new Error(`Missing statement containing ${fragment}`);
  return statement;
}

function onlyBatch(batches: PreparedQuery[][]): PreparedQuery[] {
  expect(batches).toHaveLength(1);
  const [batch] = batches;
  if (!batch) throw new Error("Expected one persistence batch");
  return batch;
}

function payloadFrom(statement: PreparedQuery): Record<string, unknown> {
  const payload = statement.parameters.find(
    (parameter) => typeof parameter === "string" && parameter.startsWith("{"),
  );
  expect(payload).toBeTypeOf("string");
  return JSON.parse(payload as string) as Record<string, unknown>;
}

describe("rotation correction command service", () => {
  it("reduces capacity and persists whole-group requeueing atomically", async () => {
    const { db, batches } = createDatabase({
      first: [
        {
          id: "rotation-source",
          status: "DRAFT",
          version: 3,
          called_at: null,
          usable_capacity: 4,
          aircraft_id: "aircraft-one",
          flight_group_id: "flight-group-source",
          resource_group_id: "resource-group-one",
          baseline_capacity: 4,
        },
        { next_number: 102 },
      ],
      all: [
        [
          {
            ticket_group_id: "ticket-group-kept",
            product_id: "product-one",
            queue_sequence: 1,
            gate_id: "gate-one",
            segment_size: 2,
            assigned_at: "2026-08-08T07:00:00.000Z",
          },
          {
            ticket_group_id: "ticket-group-requeued",
            product_id: "product-one",
            queue_sequence: 2,
            gate_id: "gate-one",
            segment_size: 2,
            assigned_at: "2026-08-08T07:01:00.000Z",
          },
        ],
      ],
    });
    const broadcast = vi.fn();
    const service = new RotationCorrectionCommandService({ DB: db } as unknown as Env, broadcast);
    const command = {
      ...commandBase(),
      type: "SET_ROTATION_CAPACITY",
      payload: {
        rotationId: "rotation-source",
        usableCapacity: 2,
        reason: "Synthetic capacity correction",
      },
    } satisfies Extract<CommandEnvelope, { type: "SET_ROTATION_CAPACITY" }>;

    const response = await service.handleRotationCapacity(command, currentEvent());
    const result = (await response.json()) as { accepted: boolean; eventType: string };

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ accepted: true, eventType: "ROTATION_CAPACITY_CHANGED" });
    expect(broadcast).toHaveBeenCalledOnce();
    const batch = onlyBatch(batches);
    expect(findStatement(batch, "UPDATE rotation_tickets SET released_at")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(payloadFrom(findStatement(batch, "'ROTATION_CAPACITY_CHANGED'"))).toMatchObject({
      usableCapacity: 2,
      keptTicketGroupIds: ["ticket-group-kept"],
      requeuedTicketGroupIds: ["ticket-group-requeued"],
      targetCanceled: false,
    });
  });

  it("moves every ticket in a group and records the manual deviation in one batch", async () => {
    const { db, batches } = createDatabase({
      first: [
        {
          id: "ticket-group-one",
          product_id: "product-one",
          version: 2,
          resource_group_id: "resource-group-one",
          group_size: 2,
        },
        {
          id: "rotation-target",
          status: "DRAFT",
          resource_group_id: "resource-group-one",
          target_capacity: 4,
          occupied_seats: 1,
          incompatible_product_tickets: 0,
        },
      ],
      all: [
        [
          {
            id: "rotation-source",
            status: "DRAFT",
            aircraft_id: "aircraft-one",
            rotation_group_count: 1,
          },
        ],
      ],
    });
    const broadcast = vi.fn();
    const service = new RotationCorrectionCommandService({ DB: db } as unknown as Env, broadcast);
    const command = {
      ...commandBase(),
      type: "MOVE_TICKET_GROUP",
      payload: {
        ticketGroupId: "ticket-group-one",
        targetRotationId: "rotation-target",
        reason: "Synthetic manual move",
      },
    } satisfies Extract<CommandEnvelope, { type: "MOVE_TICKET_GROUP" }>;

    const response = await service.handleManualTicketGroupMove(command, currentEvent());
    const result = (await response.json()) as { accepted: boolean; eventType: string };

    expect(result).toMatchObject({ accepted: true, eventType: "TICKET_GROUP_MOVED" });
    expect(broadcast).toHaveBeenCalledOnce();
    const batch = onlyBatch(batches);
    expect(
      findStatement(batch, "SELECT ?1, id, ?2 FROM tickets WHERE ticket_group_id"),
    ).toBeDefined();
    expect(findStatement(batch, "SET status = 'CANCELED'")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(payloadFrom(findStatement(batch, "'TICKET_GROUP_MOVED'"))).toMatchObject({
      sourceRotationIds: ["rotation-source"],
      targetRotationId: "rotation-target",
      groupSize: 2,
      manualDeviationFromAutomaticQueue: true,
    });
  });

  it("records post-departure manifest corrections without approval semantics", async () => {
    const { db, batches } = createDatabase({
      first: [
        { id: "ticket-group-one", version: 4, group_size: 2 },
        {
          id: "rotation-target",
          status: "IN_FLIGHT",
          capacity: 1,
          occupied_seats: 0,
        },
      ],
      all: [
        [
          {
            id: "rotation-source",
            status: "IN_FLIGHT",
            assigned_tickets: 2,
          },
        ],
      ],
    });
    const broadcast = vi.fn();
    const service = new RotationCorrectionCommandService({ DB: db } as unknown as Env, broadcast);
    const command = {
      ...commandBase(),
      type: "CORRECT_ROTATION_MANIFEST",
      payload: {
        ticketGroupId: "ticket-group-one",
        targetRotationId: "rotation-target",
        reason: "Synthetic post-departure correction",
        adminPin: "0000",
      },
    } satisfies Extract<CommandEnvelope, { type: "CORRECT_ROTATION_MANIFEST" }>;

    const response = await service.handleRotationManifestCorrection(command, currentEvent());
    const result = (await response.json()) as { accepted: boolean; eventType: string };

    expect(result).toMatchObject({ accepted: true, eventType: "ROTATION_MANIFEST_CORRECTED" });
    expect(broadcast).toHaveBeenCalledOnce();
    const batch = onlyBatch(batches);
    expect(findStatement(batch, "INSERT INTO rotation_manifest_corrections")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO idempotency_receipts")).toBeDefined();
    expect(findStatement(batch, "INSERT INTO outbox")).toBeDefined();
    expect(payloadFrom(findStatement(batch, "'ROTATION_MANIFEST_CORRECTED'"))).toMatchObject({
      sourceRotationIds: ["rotation-source"],
      targetRotationId: "rotation-target",
      capacityExceeded: true,
      wholeGroupPreserved: true,
      administrativeCorrection: true,
      safetyApproval: false,
    });
  });
});
