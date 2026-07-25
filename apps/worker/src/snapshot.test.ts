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
        operational_interrupted: 0,
        version: 2,
        operational_note: "Test",
        updated_at: "2026-07-11T10:00:00.000Z",
      }).emergencyMode,
    ).toBe(true);
  });

  it("keeps normal interruption separate from emergency mode", () => {
    const snapshot = rowToSnapshot({
      id: "demo-2026",
      name: "Demo",
      event_date: "2026-07-11",
      time_zone: "Europe/Berlin",
      status: "ACTIVE",
      emergency_mode: 0,
      operational_interrupted: 1,
      version: 3,
      operational_note: "",
      updated_at: "2026-07-11T10:00:00.000Z",
    });
    expect(snapshot.emergencyMode).toBe(false);
    expect(snapshot.operationalInterrupted).toBe(true);
  });

  it("reports independently stored light and dark logo variants", () => {
    const snapshot = rowToSnapshot({
      id: "demo-2026",
      name: "Demo",
      event_date: "2026-07-11",
      time_zone: "Europe/Berlin",
      status: "ACTIVE",
      emergency_mode: 0,
      operational_interrupted: 0,
      version: 4,
      operational_note: "",
      logo_object_key: "event-logos/demo-2026/light.svg",
      logo_dark_object_key: null,
      updated_at: "2026-07-11T10:00:00.000Z",
    });

    expect(snapshot.logoVariants).toEqual({ light: true, dark: false });
  });
});
