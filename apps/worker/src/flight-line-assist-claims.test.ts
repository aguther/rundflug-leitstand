import { describe, expect, it } from "vitest";
import {
  applyDemoSeed,
  createMigratedTestDatabase,
  type SqliteRow,
} from "../test-support/migrated-database";
import { FACTORY_RESET_DELETE_TABLES } from "./factory-reset";

describe("loginbasierte Flight-Line-Assist-Betreuungsreservierung (F-INT-070)", () => {
  it("stores at most one expiring login claim per aircraft", () => {
    const database = createMigratedTestDatabase();
    applyDemoSeed(database);
    database.exec(`
      INSERT INTO operator_accounts
        (id, login_code, role, pin_hash, created_at, updated_at)
      VALUES
        ('assist-a', 'FL-TEST-A', 'FLIGHT_LINE', 'synthetic-hash', '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z'),
        ('assist-b', 'FL-TEST-B', 'FLIGHT_LINE', 'synthetic-hash', '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
      INSERT INTO flight_line_assist_claims
        (operation_day_id, aircraft_id, operator_account_id, claimed_at, expires_at)
      VALUES ('demo-2026', 'aircraft-a', 'assist-a', '2026-08-15T08:00:00Z', '2026-08-15T08:05:00Z');
    `);

    expect(() =>
      database.exec(`
        INSERT INTO flight_line_assist_claims
          (operation_day_id, aircraft_id, operator_account_id, claimed_at, expires_at)
        VALUES ('demo-2026', 'aircraft-a', 'assist-b', '2026-08-15T08:01:00Z', '2026-08-15T08:06:00Z');
      `),
    ).toThrow(/UNIQUE/);
    database.close();
  });

  it("keeps claim persistence free of personal data", () => {
    const database = createMigratedTestDatabase();
    const columns = database
      .prepare("PRAGMA table_info(flight_line_assist_claims)")
      .all()
      .map((column: SqliteRow) => String(column.name));

    expect(columns).not.toEqual(expect.arrayContaining(["phone", "email"]));
    database.close();
  });

  it("removes ephemeral claims during a full factory reset", () => {
    expect(FACTORY_RESET_DELETE_TABLES).toContain("flight_line_assist_claims");
    expect(FACTORY_RESET_DELETE_TABLES.indexOf("dispatch_recommendation_leases")).toBeLessThan(
      FACTORY_RESET_DELETE_TABLES.indexOf("flight_line_assist_claims"),
    );
  });
});
