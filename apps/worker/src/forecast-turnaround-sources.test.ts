import { describe, expect, it } from "vitest";
import migration from "../migrations/0058_forecast_turnaround_sources.sql?raw";
import historySource from "./forecast-history.ts?raw";

describe("candidate-specific turnaround forecasts", () => {
  it("stores assumptions and append-only snapshot sources while keeping legacy rows readable", () => {
    expect(migration).toContain("forecast_assumed_aircraft_id");
    expect(migration).toContain("turnaround_boarding_minutes");
    expect(migration).toContain("assumed_aircraft_id");
    expect(migration).toContain("DEFAULT 'LEGACY_UNKNOWN'");
  });

  it("exposes the stored source fields through internal forecast history", () => {
    expect(historySource).toContain("fs.boarding_source");
    expect(historySource).toContain("fs.assumed_aircraft_id");
  });
});
