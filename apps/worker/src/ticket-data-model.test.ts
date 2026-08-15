import { describe, expect, it } from "vitest";
import anonymityDecision from "../../../docs/adr/0006-vollstaendig-anonyme-identitaeten.md?raw";
import { createMigratedTestDatabase, type SqliteRow } from "../test-support/migrated-database";

const columnsOf = (table: string) => {
  const database = createMigratedTestDatabase();
  return database
    .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
    .all()
    .map((row: SqliteRow) => String(row.name));
};

describe("anonymous V1 ticket data model", () => {
  it("stores the complete operational ticket record without contact data", () => {
    expect(columnsOf("ticket_groups")).toEqual(
      expect.arrayContaining([
        "operation_day_id",
        "product_id",
        "queue_sequence",
        "standby",
        "status",
        "sold_at",
        "version",
      ]),
    );
    expect(columnsOf("tickets")).toEqual(
      expect.arrayContaining([
        "ticket_group_id",
        "public_code_hash",
        "status",
        "weight_class",
        "individual_weight_kg",
        "payment_status",
        "price_cents",
        "created_at",
      ]),
    );
    expect(columnsOf("rotation_tickets")).toEqual(
      expect.arrayContaining(["rotation_id", "ticket_id"]),
    );
    for (const table of ["ticket_groups", "tickets", "rotation_tickets"]) {
      expect(columnsOf(table)).not.toEqual(
        expect.arrayContaining(["phone", "telefon", "guest_name", "passenger_name"]),
      );
    }
  });

  it("keeps explicit Web Push consent pseudonymously linked to the ticket", () => {
    const database = createMigratedTestDatabase();
    expect(columnsOf("web_push_subscriptions")).toEqual(
      expect.arrayContaining(["ticket_id", "consented_at", "delete_after", "status"]),
    );
    const ticketForeignKey = database
      .prepare("PRAGMA foreign_key_list('web_push_subscriptions')")
      .all()
      .find((row: SqliteRow) => row.from === "ticket_id");
    expect(ticketForeignKey).toMatchObject({ table: "tickets", to: "id" });
    expect(columnsOf("web_push_subscriptions")).not.toEqual(
      expect.arrayContaining(["phone", "telefon", "guest_name", "passenger_name"]),
    );
    expect(anonymityDecision).toMatch(
      /Telefonnummern werden weder verpflichtend noch optional erfasst/i,
    );
  });

  it("normalizes the complete stable flight-group and queue model", () => {
    const database = createMigratedTestDatabase();
    expect(columnsOf("flight_groups")).toEqual(
      expect.arrayContaining([
        "operation_day_id",
        "resource_group_id",
        "communication_number",
        "status",
      ]),
    );
    expect(columnsOf("rotations")).toEqual(expect.arrayContaining(["flight_group_id", "gate_id"]));
    expect(columnsOf("rotation_tickets")).toEqual(
      expect.arrayContaining(["rotation_id", "ticket_id"]),
    );
    const uniqueFlightGroupIndex = database
      .prepare("PRAGMA index_list('flight_groups')")
      .all()
      .find((row: SqliteRow) => Number(row.unique) === 1);
    expect(uniqueFlightGroupIndex).toBeDefined();
  });
});
