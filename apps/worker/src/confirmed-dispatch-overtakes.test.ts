// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0067_confirmed_dispatch_overtakes.sql?raw";

describe("confirmed dispatch overtakes migration", () => {
  it("adds independent non-negative counters with compatible defaults", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE rotations (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE forecast_snapshots (id TEXT PRIMARY KEY) STRICT;
      INSERT INTO rotations VALUES ('rotation-existing');
      INSERT INTO forecast_snapshots VALUES ('snapshot-existing');
    `);
    database.exec(migration);

    expect(
      database
        .prepare("SELECT dispatch_confirmed_overtake_count AS count FROM rotations WHERE id = ?")
        .get("rotation-existing"),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT dispatch_confirmed_overtake_count AS count FROM forecast_snapshots WHERE id = ?",
        )
        .get("snapshot-existing"),
    ).toEqual({ count: 0 });
    expect(() =>
      database
        .prepare("UPDATE rotations SET dispatch_confirmed_overtake_count = -1 WHERE id = ?")
        .run("rotation-existing"),
    ).toThrow(/CHECK constraint failed/);
  });
});
