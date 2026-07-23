// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import coordinatorSource from "./event-coordinator.ts?raw";
import { fidsOperatorRoles, mayAccessFids } from "./fids-authorization";
import workerSource from "./index.ts?raw";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

describe("FIDS V1.7.3 persistence and authorization", () => {
  it("migrates existing accounts safely and enforces DISPLAY preference constraints", () => {
    const database = new DatabaseSync(":memory:");
    const migrations = readdirSync(migrationsDirectory)
      .filter((name: string) => /^\d{4}.*\.sql$/.test(name))
      .sort();
    for (const name of migrations.filter((entry: string) => entry < "0041")) {
      database.exec(readFileSync(`${migrationsDirectory}/${name}`, "utf8"));
    }
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
    database.exec(
      readFileSync(`${migrationsDirectory}/0041_fids_display_accounts_and_preferences.sql`, "utf8"),
    );
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
    expect(() =>
      database.exec(`
        INSERT INTO fids_preferences
          (operator_account_id, operation_day_id, visible_rows, layout, theme, version,
           created_at, updated_at)
        VALUES ('admin-1', 'event-1', 21, 'SINGLE', 'SYSTEM', 0,
                '2026-07-22T08:00:00Z', '2026-07-22T08:00:00Z');
      `),
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

    const route = workerSource.slice(
      workerSource.indexOf('app.on("GET", eventRoutes("/fids/preferences")'),
      workerSource.indexOf('app.on("GET", eventRoutes("/operations")'),
    );
    expect(route).toContain("!actor || !mayAccessFids(actor.role)");
    expect(route).toContain("actor.accountId");
    expect(route).toContain('headers.set("x-operator-session-id", actor.sessionId)');
    expect(route).not.toContain('context.req.header("x-operator-account-id")');
    expect(coordinatorSource).toContain("!mayAccessFids(role)");
    expect(workerSource).toContain('actor?.role === "DISPLAY"');
    expect(workerSource).toContain('context.req.path.endsWith("/fids/preferences")');
  });

  it("serializes version checks, audit, idempotency and a non-sensitive outbox message", () => {
    const handlerStart = coordinatorSource.indexOf("private async handleFidsPreferences");
    const handler = coordinatorSource.slice(
      handlerStart,
      coordinatorSource.indexOf("private async ensureForecastAlarm", handlerStart),
    );
    expect(handler).toContain("currentVersion !== input.expectedVersion");
    expect(handler).toContain('command_type !== "UPDATE_FIDS_PREFERENCES"');
    expect(handler).toContain("await this.env.DB.batch([");
    expect(handler).toContain("'FIDS_PREFERENCES_CHANGED'");
    expect(handler).toContain("operatorAccountId: accountId");
    expect(handler).not.toContain("operatorLoginCode: loginCode");
    expect(handler).not.toContain("operatorSessionId: sessionId");
    expect(handler).toContain("JSON.stringify({ version: next.version })");
    expect(handler).not.toMatch(/pin|token/i);
  });
});
