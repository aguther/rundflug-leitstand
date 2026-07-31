// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { EVENT_DELETION_SQL } from "./event-deletion";
import worker from "./index.ts?raw";

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  const migrationsDirectory = new URL("../migrations/", import.meta.url);
  for (const migration of readdirSync(migrationsDirectory)
    .filter((name: string) => /^\d+.*\.sql$/.test(name))
    .toSorted()) {
    database.exec(readFileSync(new URL(migration, migrationsDirectory), "utf8"));
  }
  return database;
}

function seedEvent(database: DatabaseSync, eventId: string, deviceId: string) {
  database
    .prepare(
      `INSERT INTO operation_days (id, name, event_date, created_at, updated_at)
       VALUES (?, ?, '2026-07-27', '2026-07-27T08:00:00.000Z', '2026-07-27T08:00:00.000Z')`,
    )
    .run(eventId, eventId);
  database
    .prepare(
      `INSERT INTO paired_devices
        (id, operation_day_id, label, role, paired_at, last_seen_at)
       VALUES (?, ?, 'Test-Administration', 'ADMIN',
               '2026-07-27T08:00:00.000Z', '2026-07-27T08:00:00.000Z')`,
    )
    .run(deviceId, eventId);
  database
    .prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json)
       VALUES (?, ?, 'TEST_EVENT', '2026-07-27T08:00:00.000Z', ?, 'OPERATION_DAY', ?, 0, '{}')`,
    )
    .run(`${eventId}-audit`, eventId, deviceId, eventId);
}

function executeEventDeletion(database: DatabaseSync, eventId: string) {
  for (const sql of EVENT_DELETION_SQL) {
    const statement = database.prepare(sql.replaceAll("?1", "?"));
    if (sql.includes("?1")) statement.run(eventId);
    else statement.run();
  }
}

describe("disposable event lifecycle", () => {
  it("deletes dependent operational data before the event root", () => {
    expect(
      EVENT_DELETION_SQL.findIndex((sql) => sql.includes("DELETE FROM rotation_tickets")),
    ).toBeLessThan(
      EVENT_DELETION_SQL.findIndex((sql) => sql.includes("DELETE FROM rotations WHERE")),
    );
    expect(
      EVENT_DELETION_SQL.findIndex((sql) => sql.includes("DELETE FROM tickets WHERE")),
    ).toBeLessThan(
      EVENT_DELETION_SQL.findIndex((sql) => sql.includes("DELETE FROM ticket_groups WHERE")),
    );
    expect(
      EVENT_DELETION_SQL.findIndex((sql) => sql.includes("DELETE FROM fids_preferences")),
    ).toBeLessThan(
      EVENT_DELETION_SQL.findIndex((sql) => sql.includes("DELETE FROM operation_days WHERE")),
    );
    expect(EVENT_DELETION_SQL).toContain("DELETE FROM operation_days WHERE id = ?1");
    expect(EVENT_DELETION_SQL).toContain(
      "DELETE FROM aircraft_product_turnaround_overrides WHERE operation_day_id = ?1",
    );
    expect(
      EVENT_DELETION_SQL.findIndex((sql) =>
        sql.includes("DELETE FROM planned_operational_constraints"),
      ),
    ).toBeLessThan(
      EVENT_DELETION_SQL.findIndex((sql) =>
        sql.includes("DELETE FROM recurring_operational_rules"),
      ),
    );
  });

  it("uses the reset control to satisfy the real append-only and foreign-key schema", () => {
    const database = migratedDatabase();
    seedEvent(database, "event-a", "device-a");
    database
      .prepare(
        `INSERT INTO app_bootstrap
          (singleton, operation_day_id, admin_device_id, completed_at)
         VALUES (1, 'event-a', 'device-a', '2026-07-27T08:00:00.000Z')`,
      )
      .run();

    expect(() => executeEventDeletion(database, "event-a")).toThrow(/append-only/);
    database.exec("DELETE FROM app_bootstrap");
    database.exec("UPDATE system_reset_control SET active = 1 WHERE singleton = 1");
    executeEventDeletion(database, "event-a");
    database.exec("UPDATE system_reset_control SET active = 0 WHERE singleton = 1");

    expect(database.prepare("SELECT COUNT(*) AS count FROM operation_days").get()).toEqual({
      count: 0,
    });
  });

  it("rebinds bootstrap before deleting its original event", () => {
    const database = migratedDatabase();
    seedEvent(database, "event-a", "device-a");
    seedEvent(database, "event-b", "device-b");
    database
      .prepare(
        `INSERT INTO app_bootstrap
          (singleton, operation_day_id, admin_device_id, completed_at)
         VALUES (1, 'event-a', 'device-a', '2026-07-27T08:00:00.000Z')`,
      )
      .run();

    database.exec(
      `UPDATE app_bootstrap
          SET operation_day_id = 'event-b', admin_device_id = 'device-b'
        WHERE singleton = 1`,
    );
    database.exec("UPDATE system_reset_control SET active = 1 WHERE singleton = 1");
    executeEventDeletion(database, "event-a");
    database.exec("UPDATE system_reset_control SET active = 0 WHERE singleton = 1");

    expect(
      database
        .prepare("SELECT operation_day_id, admin_device_id FROM app_bootstrap WHERE singleton = 1")
        .get(),
    ).toEqual({ operation_day_id: "event-b", admin_device_id: "device-b" });
  });

  it("requires admin authorization and an exact event-id confirmation", () => {
    const route = worker.match(
      /app\.delete\("\/api\/admin\/events\/:eventId"[\s\S]*?app\.put\("\/api\/admin\/events\/:eventId\/logo"/,
    )?.[0];
    expect(route).toBeTruthy();
    expect(route).toContain('device?.role !== "ADMIN"');
    expect(route).toContain("input.confirmation !== eventId");
    expect(route).toContain("input.expectedVersion");
    expect(route).toContain("event_deletion_receipts");
    expect(route).toContain("UPDATE system_reset_control SET active = 1");
    expect(route).toContain("eventDeletionStatements");
  });

  it("exports only contextual aggregate performance data", () => {
    expect(worker).toContain("/exports/performance-profile.json");
    expect(worker).toContain("average_turnaround_minutes");
    expect(worker).toContain("passengerSeatCounts");
  });
});
