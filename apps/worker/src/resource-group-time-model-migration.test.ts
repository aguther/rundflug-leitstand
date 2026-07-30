// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0054_remove_resource_group_planned_rotation.sql?raw";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

describe("resource-group time-model migration 0054", () => {
  it("removes only the obsolete duration while preserving data and constraints", () => {
    const database = new DatabaseSync(":memory:");
    for (const name of readdirSync(migrationsDirectory)
      .filter((entry: string) => /^\d{4}_.+\.sql$/.test(entry) && entry < "0054")
      .sort()) {
      database.exec(readFileSync(`${migrationsDirectory}/${name}`, "utf8"));
    }
    database.exec(`
      INSERT INTO operation_days
        (id, name, event_date, time_zone, status, version, created_at, updated_at)
      VALUES
        ('event-1', 'Testtag', '2026-07-30', 'Europe/Berlin', 'PREPARATION', 0,
         '2026-07-30T08:00:00.000Z', '2026-07-30T08:00:00.000Z');
      INSERT INTO resource_groups
        (id, operation_day_id, name, short_code, status, version, created_at, updated_at,
         reference_capacity, planned_rotation_minutes, compatible_aircraft_types_json,
         automatic_precall_enabled)
      VALUES
        ('group-1', 'event-1', 'Panorama', 'PAN', 'ACTIVE', 3,
         '2026-07-30T08:00:00.000Z', '2026-07-30T09:00:00.000Z',
         4, 47, '["C172"]', 0);
    `);

    database.exec(migration);

    const columns = database.prepare("PRAGMA table_info(resource_groups)").all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).not.toContain("planned_rotation_minutes");
    expect(
      database
        .prepare(
          `SELECT id, operation_day_id, name, short_code, status, version, reference_capacity,
                compatible_aircraft_types_json, automatic_precall_enabled
           FROM resource_groups WHERE id = 'group-1'`,
        )
        .get(),
    ).toEqual({
      id: "group-1",
      operation_day_id: "event-1",
      name: "Panorama",
      short_code: "PAN",
      status: "ACTIVE",
      version: 3,
      reference_capacity: 4,
      compatible_aircraft_types_json: '["C172"]',
      automatic_precall_enabled: 0,
    });
    expect(
      database
        .prepare("PRAGMA index_list(resource_groups)")
        .all()
        .map((entry: { name: string }) => String(entry.name)),
    ).toContain("idx_resource_groups_operation_day_short_code");
    expect(database.prepare("PRAGMA foreign_key_list(resource_groups)").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "operation_days", from: "operation_day_id" }),
      ]),
    );
    expect(
      String(
        (
          database
            .prepare(
              "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'resource_groups'",
            )
            .get() as { sql: string }
        ).sql,
      ),
    ).toContain("STRICT");
  });
});
