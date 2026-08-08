import { describe, expect, it } from "vitest";
import forecastMigration from "../migrations/0018_forecast_timelines.sql?raw";
import forecastBasisMigration from "../migrations/0029_forecast_snapshot_basis.sql?raw";
import factoryResetForecastMigration from "../migrations/0032_factory_reset_forecast_snapshots.sql?raw";
import backupSource from "./backup.ts?raw";

describe("forecast snapshot retention", () => {
  it("keeps the persisted timeline schema versioned", () => {
    expect(forecastMigration).toContain("CREATE TABLE forecast_snapshots");
    expect(forecastMigration).toContain("operation_day_version");
    expect(forecastMigration).toContain("predicted_boarding_at");
    expect(forecastMigration).toContain("predicted_completion_at");
    expect(forecastBasisMigration).toContain("LEGACY_UNKNOWN");
  });

  it("keeps snapshots append-only and in portable backups", () => {
    expect(forecastMigration).toMatch(
      /CREATE TRIGGER forecast_snapshots_no_update[\s\S]*BEFORE UPDATE ON forecast_snapshots/,
    );
    expect(forecastMigration).toMatch(
      /CREATE TRIGGER forecast_snapshots_no_delete[\s\S]*BEFORE DELETE ON forecast_snapshots/,
    );
    expect(factoryResetForecastMigration).toMatch(
      /BEFORE DELETE ON forecast_snapshots[\s\S]*WHEN COALESCE\(\(SELECT active FROM system_reset_control WHERE singleton = 1\), 0\) = 0/,
    );
    expect(backupSource).toContain('"forecast_snapshots"');
  });
});
