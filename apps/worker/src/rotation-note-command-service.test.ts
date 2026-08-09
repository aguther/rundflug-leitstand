import { commandEnvelopeSchema } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import { RotationNoteCommandService } from "./rotation-note-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedStatement {
  sql: string;
  parameters: unknown[];
  first: () => Promise<Record<string, unknown> | null>;
}

function createDatabase(firstRow: Record<string, unknown> | null) {
  let row = firstRow;
  const batch = vi.fn(async (statements: PreparedStatement[]) => statements);
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => {
      const statement: PreparedStatement = {
        sql,
        parameters,
        first: async () => {
          const result = row;
          row = null;
          return result;
        },
      };
      return statement;
    },
  }));
  return {
    database: { prepare, batch } as unknown as D1Database,
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

function noteCommand() {
  const parsed = commandEnvelopeSchema.parse({
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-flight-line-device",
    expectedVersion: 17,
    issuedAt: "2026-08-09T10:01:00.000Z",
    type: "SET_ROTATION_NOTE",
    payload: {
      rotationId: "synthetic-rotation",
      note: "Synthetic operational note",
      reason: "Synthetic coordination reason",
    },
  });
  if (parsed.type !== "SET_ROTATION_NOTE") throw new Error("Unexpected command type.");
  return parsed;
}

describe("rotation note command service", () => {
  it("returns the established not-found response without persistence", async () => {
    const { database, batch } = createDatabase(null);
    const broadcast = vi.fn();
    const service = new RotationNoteCommandService({ DB: database } as unknown as Env, broadcast);

    const response = await service.handle(noteCommand(), storedEvent());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." },
    });
    expect(batch).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("persists note, audit, receipt and outbox atomically before publishing", async () => {
    const { database, batch } = createDatabase({ id: "synthetic-rotation", version: 3 });
    const broadcast = vi.fn();
    const service = new RotationNoteCommandService({ DB: database } as unknown as Env, broadcast);

    const response = await service.handle(noteCommand(), storedEvent());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      accepted: boolean;
      eventType: string;
      event: { version: number };
    };
    expect(payload).toMatchObject({
      accepted: true,
      eventType: "ROTATION_NOTE_SET",
      event: { version: 18 },
    });
    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batch.mock.calls[0]?.[0] ?? [];
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("UPDATE operation_days SET version");
    expect(sql).toContain("UPDATE rotations SET operational_note");
    expect(sql).toContain("INSERT INTO operational_events");
    expect(sql).toContain("INSERT INTO idempotency_receipts");
    expect(sql).toContain("INSERT INTO outbox");
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(batch.mock.invocationCallOrder[0]).toBeLessThan(
      broadcast.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
