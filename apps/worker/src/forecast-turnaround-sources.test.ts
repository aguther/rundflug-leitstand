import { describe, expect, it } from "vitest";
import migration from "../migrations/0058_forecast_turnaround_sources.sql?raw";
import coordinatorSource from "./event-coordinator.ts?raw";
import historySource from "./forecast-history.ts?raw";

describe("candidate-specific turnaround forecasts", () => {
  it("stores assumptions and append-only snapshot sources while keeping legacy rows readable", () => {
    expect(migration).toContain("forecast_assumed_aircraft_id");
    expect(migration).toContain("turnaround_boarding_minutes");
    expect(migration).toContain("assumed_aircraft_id");
    expect(migration).toContain("DEFAULT 'LEGACY_UNKNOWN'");
  });

  it("freezes the confirmed profile at CALL_NEXT and clears the forecast assumption", () => {
    expect(coordinatorSource).toContain("confirmedTurnaroundProfile");
    expect(coordinatorSource).toContain("forecast_assumed_aircraft_id");
    expect(coordinatorSource).toContain("CASE WHEN ?5 = 'CALL_NEXT' THEN NULL");
  });

  it("exposes the stored source fields through internal forecast history", () => {
    expect(historySource).toContain("fs.boarding_source");
    expect(historySource).toContain("fs.assumed_aircraft_id");
  });
});
