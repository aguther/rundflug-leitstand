import { describe, expect, it } from "vitest";
import { createMigratedTestDatabase } from "../test-support/migrated-database";
import { fidsOperatorRoles, mayAccessFids } from "./fids-authorization";

describe("FIDS V1.7.3 persistence and authorization", () => {
  it("persists DISPLAY preferences with compatible defaults and constraints", () => {
    const database = createMigratedTestDatabase();
    database.exec(`
      INSERT INTO operation_days
        (id, name, event_date, time_zone, status, created_at, updated_at)
      VALUES ('event-1', 'Synthetischer Flugtag', '2026-07-22', 'Europe/Berlin',
              'ACTIVE', '2026-07-22T08:00:00Z', '2026-07-22T08:00:00Z');
      INSERT INTO operator_accounts
        (id, login_code, role, pin_hash, active, failed_attempts, session_version,
         created_at, updated_at)
      VALUES ('admin-1', 'ADMIN-01', 'ADMIN', 'synthetic-hash', 1, 0, 1,
              '2026-07-22T08:00:00Z', '2026-07-22T08:00:00Z');
      INSERT INTO operator_sessions
        (id, account_id, session_version, token_hash, device_id, created_at, last_seen_at,
         idle_expires_at, absolute_expires_at)
      VALUES ('session-1', 'admin-1', 1, 'synthetic-token-hash', 'device-1',
              '2026-07-22T08:00:00Z', '2026-07-22T08:00:00Z',
              '2026-07-23T00:00:00Z', '2026-07-23T00:00:00Z');
    `);
    database.exec(`
      INSERT INTO operator_accounts
        (id, login_code, role, pin_hash, active, failed_attempts, session_version,
         created_at, updated_at)
      VALUES ('display-1', 'DISPLAY-01', 'DISPLAY', 'synthetic-hash', 1, 0, 1,
              '2026-07-22T08:00:00Z', '2026-07-22T08:00:00Z');
      INSERT INTO fids_preferences
        (operator_account_id, operation_day_id, visible_rows, layout, theme, version,
         created_at, updated_at)
      VALUES ('display-1', 'event-1', 20, 'DOUBLE', 'DARK', 1,
              '2026-07-22T08:00:00Z', '2026-07-22T08:00:00Z');
    `);
    expect(
      database.prepare("SELECT role FROM operator_accounts WHERE id = 'admin-1'").get(),
    ).toEqual({ role: "ADMIN" });
    expect(
      database.prepare("SELECT account_id FROM operator_sessions WHERE id = 'session-1'").get(),
    ).toEqual({ account_id: "admin-1" });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database
        .prepare(
          `SELECT visible_rows, layout, theme, version, view_mode, priority_group_count,
                  rotation_interval_seconds, group_shared_flights, content_filter_json
             FROM fids_preferences WHERE operator_account_id = 'display-1'`,
        )
        .get(),
    ).toEqual({
      visible_rows: 20,
      layout: "DOUBLE",
      theme: "DARK",
      version: 1,
      view_mode: "FIXED_PAGE",
      priority_group_count: 3,
      rotation_interval_seconds: 12,
      group_shared_flights: 0,
      content_filter_json: '{"productIds":[],"gateIds":[]}',
    });
    expect(() =>
      database.exec(`
        INSERT INTO fids_preferences
          (operator_account_id, operation_day_id, visible_rows, layout, theme, version,
           created_at, updated_at)
        VALUES ('admin-1', 'event-1', 21, 'SINGLE', 'SYSTEM', 0,
                '2026-07-22T08:00:00Z', '2026-07-22T08:00:00Z');
      `),
    ).toThrow();
    expect(() =>
      database.exec(
        "UPDATE fids_preferences SET rotation_interval_seconds = 4 WHERE operator_account_id = 'display-1'",
      ),
    ).toThrow();
    expect(() =>
      database.exec(
        "UPDATE fids_preferences SET group_shared_flights = 2 WHERE operator_account_id = 'display-1'",
      ),
    ).toThrow();
    database.exec("DELETE FROM operator_accounts WHERE id = 'display-1'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM fids_preferences").get()).toEqual({
      count: 0,
    });
    database.close();
  });

  it("allows DISPLAY and ADMIN sessions while rejecting all other FIDS roles", () => {
    expect(fidsOperatorRoles).toEqual(["DISPLAY", "ADMIN"]);
    expect(mayAccessFids("DISPLAY")).toBe(true);
    expect(mayAccessFids("ADMIN")).toBe(true);
    expect(mayAccessFids("CASHIER")).toBe(false);
    expect(mayAccessFids("FLIGHT_LINE")).toBe(false);
    expect(mayAccessFids("FLIGHT_DIRECTOR")).toBe(false);
    expect(mayAccessFids(null)).toBe(false);
  });
});
