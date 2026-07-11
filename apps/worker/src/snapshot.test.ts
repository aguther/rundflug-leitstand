import { describe, expect, it } from "vitest";
import { rowToSnapshot } from "./snapshot";

describe("rowToSnapshot", () => {
  it("maps the SQLite emergency flag to a boolean", () => {
    expect(
      rowToSnapshot({
        id: "demo-2026",
        name: "Demo",
        event_date: "2026-07-11",
        time_zone: "Europe/Berlin",
        status: "PREPARATION",
        emergency_mode: 1,
        version: 2,
        operational_note: "Test",
        updated_at: "2026-07-11T10:00:00.000Z",
      }).emergencyMode,
    ).toBe(true);
  });
});
