import { describe, expect, it } from "vitest";
import {
  applyDemoSeed,
  createMigratedTestDatabase,
  describeDatabaseSchema,
} from "../test-support/migrated-database";
import backupSource from "./backup.ts?raw";

describe("forecast snapshot retention", () => {
  it("keeps the persisted timeline schema versioned", () => {
    const database = createMigratedTestDatabase();
    const table = describeDatabaseSchema(database).tables.find(
      ({ name }) => name === "forecast_snapshots",
    );
    const columns = Object.fromEntries(table?.columns.map((column) => [column.name, column]) ?? []);

    expect(columns.operation_day_version).toBeTruthy();
    expect(columns.predicted_boarding_at).toBeTruthy();
    expect(columns.predicted_completion_at).toBeTruthy();
    expect(columns.trigger_event_type?.dflt_value).toBe("'LEGACY_UNKNOWN'");
    database.close();
  });

  it("keeps snapshots append-only and in portable backups", () => {
    const database = createMigratedTestDatabase();
    applyDemoSeed(database);
    database.exec(`
      INSERT INTO flight_groups
        (id, operation_day_id, resource_group_id, communication_number, status, created_at, updated_at, product_id)
      VALUES ('forecast-group', 'demo-2026', 'rg-panorama', 999, 'DRAFT',
              '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z', 'panorama-20');
      INSERT INTO rotations
        (id, operation_day_id, flight_group_id, status, created_at, updated_at)
      VALUES ('forecast-rotation', 'demo-2026', 'forecast-group', 'DRAFT',
              '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
      INSERT INTO forecast_snapshots
        (id, operation_day_id, rotation_id, operation_day_version, captured_at, quality,
         lower_minutes, upper_minutes)
      VALUES ('forecast-snapshot', 'demo-2026', 'forecast-rotation', 0,
              '2026-08-15T08:00:00Z', 'STABLE', 1, 2);
    `);

    expect(() => database.exec("UPDATE forecast_snapshots SET quality = 'CHANGING'")).toThrow(
      /append-only/,
    );
    expect(() => database.exec("DELETE FROM forecast_snapshots")).toThrow(/append-only/);
    expect(backupSource).toContain('"forecast_snapshots"');
    database.close();
  });
});
