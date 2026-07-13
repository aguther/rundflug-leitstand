import { describe, expect, it } from "vitest";
import forecastMigration from "../migrations/0018_forecast_timelines.sql?raw";
import backupSource from "./backup.ts?raw";
import coordinatorSource from "./event-coordinator.ts?raw";

describe("forecast snapshot retention", () => {
  it("captures a versioned timeline after persisted state changes", () => {
    expect(coordinatorSource).toMatch(
      /private broadcast\([\s\S]*waitUntil\([\s\S]*recalculateForecastTimelines\(result\.event\.eventId\)/,
    );
    expect(coordinatorSource).toMatch(
      /INSERT INTO forecast_snapshots[\s\S]*operation_day_version[\s\S]*predicted_boarding_at[\s\S]*predicted_departure_at[\s\S]*predicted_landing_at[\s\S]*predicted_completion_at/,
    );
  });

  it("keeps snapshots append-only and in portable backups", () => {
    expect(forecastMigration).toMatch(
      /CREATE TRIGGER forecast_snapshots_no_update[\s\S]*BEFORE UPDATE ON forecast_snapshots/,
    );
    expect(forecastMigration).toMatch(
      /CREATE TRIGGER forecast_snapshots_no_delete[\s\S]*BEFORE DELETE ON forecast_snapshots/,
    );
    expect(coordinatorSource).not.toMatch(/UPDATE\s+forecast_snapshots/i);
    expect(coordinatorSource).not.toMatch(/DELETE\s+FROM\s+forecast_snapshots/i);
    expect(backupSource).toContain('"forecast_snapshots"');
  });
});
