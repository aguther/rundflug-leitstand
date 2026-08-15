import { describe, expect, it } from "vitest";
import { createMigratedTestDatabase, type SqliteRow } from "../test-support/migrated-database";

describe("V1.8 public group ticket", () => {
  it("stores protected group codes without personal identity fields", () => {
    const database = createMigratedTestDatabase();
    const columns = database.prepare("PRAGMA table_info(ticket_groups)").all();
    const indexes = database.prepare("PRAGMA index_list(ticket_groups)").all();

    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "public_status_code_hash" }),
        expect.objectContaining({ name: "public_status_code" }),
      ]),
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "idx_ticket_groups_public_status_code_hash", unique: 1 }),
      ]),
    );
    expect(columns.map((column: SqliteRow) => String(column.name))).not.toEqual(
      expect.arrayContaining(["phone", "guest_name", "passenger_name"]),
    );
    database.close();
  });

  it("migrates existing subscriptions to canonical group targets", () => {
    const database = createMigratedTestDatabase();
    const targetKind = database
      .prepare("PRAGMA table_info(web_push_subscriptions)")
      .all()
      .find((column: SqliteRow) => column.name === "target_kind") as
      | { dflt_value: string; notnull: number }
      | undefined;

    expect(targetKind).toMatchObject({ dflt_value: "'GROUP'", notnull: 1 });
    database.close();
  });
});
