// @ts-expect-error Tests execute in Node while the Worker production config excludes Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyDemoSeed,
  createMigratedTestDatabase,
  describeDatabaseSchema,
  readBaselineSql,
} from "../test-support/migrated-database";

const expectedSchema = JSON.parse(
  readFileSync(new URL("../test-support/v1-12-schema-manifest.json", import.meta.url), "utf8"),
) as ReturnType<typeof describeDatabaseSchema>;

describe("V1.12 database baseline", () => {
  it("recreates the complete legacy end schema from one migration", () => {
    const database = createMigratedTestDatabase();

    expect(describeDatabaseSchema(database)).toEqual(expectedSchema);
    expect(expectedSchema.objectCounts).toEqual({
      tables: 42,
      namedIndexes: 75,
      triggers: 20,
    });
    const planningRunIndexes = database.prepare("PRAGMA index_list('planning_runs')").all() as {
      name: string;
    }[];
    const planningRunIndexNames = planningRunIndexes.map((index) => String(index.name));
    expect(planningRunIndexNames).toEqual(
      expect.arrayContaining(["idx_planning_runs_anchor_run", "idx_planning_runs_previous_run"]),
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    database.close();
  });

  it("keeps the baseline independent from Wrangler migration bookkeeping", () => {
    const database = createMigratedTestDatabase();

    expect(readBaselineSql()).not.toContain("d1_migrations");
    expect(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'd1_migrations'")
        .get(),
    ).toBeUndefined();

    database.close();
  });

  it("contains no guest identity or direct contact columns", () => {
    const database = createMigratedTestDatabase();
    const forbiddenColumn =
      /^(guest_?name|passenger_?name|customer_?name|phone(_number)?|telephone(_number)?|telefon(_nummer)?|mobile(_number)?|email(_address)?)$/i;
    const violations = expectedSchema.tables.flatMap((table) =>
      table.columns
        .map((column) => String(column.name))
        .filter((columnName) => forbiddenColumn.test(columnName))
        .map((columnName) => `${table.name}.${columnName}`),
    );

    expect(violations).toEqual([]);
    database.close();
  });

  it("seeds the promised duration for both synthetic products", () => {
    const database = createMigratedTestDatabase();
    applyDemoSeed(database);

    expect(
      database
        .prepare(
          `SELECT id, reference_duration_minutes, promised_flight_minutes
             FROM products
            WHERE id IN ('panorama-20', 'panorama-30')
            ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: "panorama-20",
        reference_duration_minutes: 20,
        promised_flight_minutes: 20,
      },
      {
        id: "panorama-30",
        reference_duration_minutes: 30,
        promised_flight_minutes: 30,
      },
    ]);

    database.close();
  });
});
