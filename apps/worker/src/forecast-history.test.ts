import { describe, expect, it } from "vitest";
import { buildForecastHistoryStatement } from "./forecast-history";

describe("forecast history query", () => {
  it("binds every filter and never interpolates identifiers", () => {
    const hostileRotationId = "rotation' OR 1=1 --";
    const statement = buildForecastHistoryStatement("event-1", {
      rotationId: hostileRotationId,
      aircraftId: "aircraft-1",
      pilotId: "pilot-1",
      since: "2026-07-11T08:00:00.000Z",
      until: "2026-07-11T18:00:00.000Z",
      limit: 25,
      offset: 50,
    });

    expect(statement.sql).not.toContain(hostileRotationId);
    expect(statement.sql).toContain("fs.rotation_id = ?2");
    expect(statement.sql).toContain("r.aircraft_id = ?3");
    expect(statement.sql).toContain("r.pilot_id = ?4");
    expect(statement.sql).toContain("fs.captured_at >= ?5");
    expect(statement.sql).toContain("fs.captured_at <= ?6");
    expect(statement.sql).toContain("LIMIT ?7 OFFSET ?8");
    expect(statement.bindings).toEqual([
      "event-1",
      hostileRotationId,
      "aircraft-1",
      "pilot-1",
      "2026-07-11T08:00:00.000Z",
      "2026-07-11T18:00:00.000Z",
      25,
      50,
    ]);
  });

  it("compares every forecast phase with confirmed actual timestamps", () => {
    const statement = buildForecastHistoryStatement("event-1", { limit: 100, offset: 0 });

    expect(statement.sql).toContain("boarding_deviation_minutes");
    expect(statement.sql).toContain("departure_deviation_minutes");
    expect(statement.sql).toContain("landing_deviation_minutes");
    expect(statement.sql).toContain("completion_deviation_minutes");
    expect(statement.sql).toContain("COUNT(*) OVER()");
    expect(statement.bindings).toEqual(["event-1", 100, 0]);
  });
});
