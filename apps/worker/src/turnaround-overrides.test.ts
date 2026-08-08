import { describe, expect, it } from "vitest";
import migration from "../migrations/0057_turnaround_phase_overrides.sql?raw";
import workerSource from "./index.ts?raw";

describe("turnaround phase override persistence", () => {
  it("adds nullable product phases and a versioned aircraft-product table", () => {
    expect(migration).toContain("planned_boarding_minutes_override");
    expect(migration).toContain("aircraft_product_turnaround_overrides");
    expect(migration).toContain("PRIMARY KEY (operation_day_id, aircraft_id, product_id)");
    expect(migration).toContain("version INTEGER NOT NULL DEFAULT 0");
  });

  it("projects effective values and their source without exposing them to public boards", () => {
    expect(workerSource).toContain("resolveTurnaroundProfile");
    expect(workerSource).toContain("aircraftProductTurnaroundOverrides");
    expect(workerSource).toContain("effectiveTurnaroundProfile");
  });
});
