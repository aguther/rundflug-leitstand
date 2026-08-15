import { describe, expect, it } from "vitest";
import { createMigratedTestDatabase } from "../test-support/migrated-database";

describe("candidate-specific turnaround forecasts", () => {
  it("stores assumptions and append-only snapshot sources while keeping legacy rows readable", () => {
    const database = createMigratedTestDatabase();
    const rotationColumns = database.prepare("PRAGMA table_info(rotations)").all();
    const snapshotColumns = database.prepare("PRAGMA table_info(forecast_snapshots)").all();

    expect(rotationColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "forecast_assumed_aircraft_id" }),
        expect.objectContaining({ name: "turnaround_boarding_minutes" }),
      ]),
    );
    expect(snapshotColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "assumed_aircraft_id" }),
        expect.objectContaining({ name: "boarding_source", dflt_value: "'LEGACY_UNKNOWN'" }),
      ]),
    );
    database.close();
  });
});
