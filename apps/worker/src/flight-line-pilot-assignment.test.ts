import { describe, expect, it } from "vitest";
import migration from "../migrations/0038_aircraft_state_changed_at.sql?raw";

describe("V1.7.0 aircraft state projection", () => {
  it("persists the last real aircraft-state transition", () => {
    expect(migration).toContain("ADD COLUMN operational_state_changed_at TEXT");
    expect(migration).toContain("MAX(oe.occurred_at)");
    expect(migration).toContain("updated_at");
  });
});
