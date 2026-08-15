import { commandEnvelopeSchema } from "@rundflug/contracts/operations-dispatch";
import { assertRoleMayExecute, DomainRuleError } from "@rundflug/domain";
import { describe, expect, it } from "vitest";
import {
  applyDemoSeed,
  createMigratedTestDatabase,
  type SqliteRow,
} from "../test-support/migrated-database";

describe("V1.11 aktiver Gruppennachruf", () => {
  it("trennt den öffentlichen Nachruf vom bisherigen Queue-Kommando und berechtigt die drei Rollen", () => {
    const commandBase = {
      commandId: "836fa884-8c1e-48ab-9a9e-a4e61ac889b6",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-line",
      expectedVersion: 11,
      issuedAt: "2026-08-10T08:00:00.000Z",
    };
    const commands = [
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "START_TICKET_GROUP_RECALL",
        payload: { ticketGroupId: "synthetic-ticket-group" },
      }),
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "CLEAR_TICKET_GROUP_RECALL",
        payload: {
          ticketGroupId: "synthetic-ticket-group",
          recallId: "c3321176-e877-48fe-b90e-33cd944bcd8d",
        },
      }),
      commandEnvelopeSchema.parse({
        ...commandBase,
        type: "RESTORE_TICKET_GROUP_TO_QUEUE",
        payload: { ticketGroupId: "synthetic-ticket-group" },
      }),
    ];

    expect(commands.map((command) => command.type)).toEqual([
      "START_TICKET_GROUP_RECALL",
      "CLEAR_TICKET_GROUP_RECALL",
      "RESTORE_TICKET_GROUP_TO_QUEUE",
    ]);
    for (const command of commands) {
      for (const role of ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"] as const) {
        expect(() => assertRoleMayExecute(role, command.type)).not.toThrow();
      }
      for (const role of ["CASHIER", "DISPLAY"] as const) {
        expect(() => assertRoleMayExecute(role, command.type)).toThrow(DomainRuleError);
      }
    }
  });

  it("persistiert Sequenz, Zeitraum und höchstens einen aktiven Vorgang je Gruppe", () => {
    const database = createMigratedTestDatabase();
    applyDemoSeed(database);
    database.exec(`
      INSERT INTO ticket_groups
        (id, operation_day_id, product_id, queue_sequence, status, sold_at)
      VALUES
        ('synthetic-ticket-group', 'demo-2026', 'panorama-20', 100, 'WAITING',
         '2026-08-10T08:00:00.000Z');
      INSERT INTO ticket_group_recalls
        (id, operation_day_id, ticket_group_id, sequence, started_at, expires_at)
      VALUES
        ('recall-1', 'demo-2026', 'synthetic-ticket-group', 1,
         '2026-08-10T08:10:00.000Z', '2026-08-10T08:20:00.000Z');
    `);

    expect(() =>
      database.exec(`
        INSERT INTO ticket_group_recalls
          (id, operation_day_id, ticket_group_id, sequence, started_at, expires_at)
        VALUES
          ('recall-2', 'demo-2026', 'synthetic-ticket-group', 2,
           '2026-08-10T08:11:00.000Z', '2026-08-10T08:21:00.000Z');
      `),
    ).toThrow(/UNIQUE constraint failed/);

    database.exec(`
      UPDATE ticket_group_recalls
         SET ended_at = '2026-08-10T08:12:00.000Z', end_reason = 'MANUAL'
       WHERE id = 'recall-1';
      INSERT INTO ticket_group_recalls
        (id, operation_day_id, ticket_group_id, sequence, started_at, expires_at)
      VALUES
        ('recall-2', 'demo-2026', 'synthetic-ticket-group', 2,
         '2026-08-10T08:13:00.000Z', '2026-08-10T08:23:00.000Z');
    `);
    expect(
      database.prepare("SELECT sequence FROM ticket_group_recalls WHERE ended_at IS NULL").get(),
    ).toMatchObject({ sequence: 2 });

    expect(() =>
      database.exec(`
        INSERT INTO ticket_group_recalls
          (id, operation_day_id, ticket_group_id, sequence, started_at, expires_at)
        VALUES
          ('recall-invalid', 'demo-2026', 'synthetic-ticket-group', 3,
           '2026-08-10T08:30:00.000Z', '2026-08-10T08:30:00.000Z');
      `),
    ).toThrow(/CHECK constraint failed/);
  });

  it("dedupliziert Push pro Nachruf-ID und adressiert ausschließlich die konkrete Buchungsgruppe", () => {
    const database = createMigratedTestDatabase();
    const recallIndex = database
      .prepare("PRAGMA index_info('uq_web_push_deliveries_recall')")
      .all()
      .map((row: SqliteRow) => ({ ...row }));
    expect(recallIndex.map((row: SqliteRow) => row.name)).toEqual([
      "subscription_id",
      "ticket_group_recall_id",
    ]);
  });

  it("nimmt keine Namen oder frei formulierten öffentlichen Texte in den Vorgang auf", () => {
    const database = createMigratedTestDatabase();
    const recallColumns = database
      .prepare("PRAGMA table_info('ticket_group_recalls')")
      .all()
      .map((row: SqliteRow) => String(row.name));
    expect(recallColumns).not.toEqual(
      expect.arrayContaining(["guest_name", "passenger_name", "phone_number"]),
    );
    const command = commandEnvelopeSchema.parse({
      commandId: "d35d70d4-c302-431a-89b8-83b7cad9d198",
      eventId: "synthetic-event",
      deviceId: "synthetic-flight-line",
      expectedVersion: 11,
      issuedAt: "2026-08-10T08:00:00.000Z",
      type: "START_TICKET_GROUP_RECALL",
      payload: {
        ticketGroupId: "synthetic-ticket-group",
        message: "This free text must not cross the contract boundary",
        text: "This field must be removed as well",
      },
    });

    expect(command.payload).toEqual({ ticketGroupId: "synthetic-ticket-group" });
  });
});
