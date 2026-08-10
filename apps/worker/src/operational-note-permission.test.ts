import { assertRoleMayExecute, DomainRuleError } from "@rundflug/domain";
import { describe, expect, it, vi } from "vitest";
import { OperationalNoteCommandService } from "./operational-note-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedStatement {
  sql: string;
  parameters: unknown[];
}

type OperationalNoteCommand = Parameters<OperationalNoteCommandService["handle"]>[0];

function createDatabase() {
  const batch = vi.fn(async (statements: PreparedStatement[]) => statements);
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]): PreparedStatement => ({ sql, parameters }),
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
    event_date: "2026-08-10",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    version: 17,
    operational_note: "Previous note",
    updated_at: "2026-08-10T10:00:00.000Z",
  };
}

function operationalNoteCommand(): OperationalNoteCommand {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-flight-director",
    expectedVersion: 17,
    issuedAt: "2026-08-10T10:01:00.000Z",
    type: "SET_OPERATIONAL_NOTE",
    payload: { note: "Synthetic operational note" },
  };
}

describe("SET_OPERATIONAL_NOTE authorization and persistence", () => {
  it("allows only Flight Director and Admin", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "SET_OPERATIONAL_NOTE")).not.toThrow();
    expect(() => assertRoleMayExecute("ADMIN", "SET_OPERATIONAL_NOTE")).not.toThrow();
    for (const role of ["CASHIER", "FLIGHT_LINE", "DISPLAY"] as const) {
      expect(() => assertRoleMayExecute(role, "SET_OPERATIONAL_NOTE")).toThrow(DomainRuleError);
    }
  });

  it("persists note, audit, receipt and outbox atomically before publishing", async () => {
    const { database, batch } = createDatabase();
    const broadcast = vi.fn();
    const service = new OperationalNoteCommandService(
      { DB: database } as unknown as Env,
      broadcast,
    );

    const response = await service.handle(operationalNoteCommand(), storedEvent());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      eventType: "OPERATIONAL_NOTE_SET",
      event: { version: 18, operationalNote: "Synthetic operational note" },
    });
    expect(batch).toHaveBeenCalledOnce();
    const statements = batch.mock.calls[0]?.[0] ?? [];
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("UPDATE operation_days");
    expect(sql).toContain("WHERE id = ?4 AND version = ?5");
    expect(sql).toContain("INSERT INTO operational_events");
    expect(sql).toContain("INSERT INTO idempotency_receipts");
    expect(sql).toContain("INSERT INTO outbox");
    expect(batch.mock.invocationCallOrder[0]).toBeLessThan(
      broadcast.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
