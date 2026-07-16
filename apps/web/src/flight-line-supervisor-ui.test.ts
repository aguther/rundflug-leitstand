import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import { expectedReviewAtFromPause } from "./flight-line-pause";

describe("Flight Line Supervisor", () => {
  it("keeps every aircraft visible and makes the aircraft the primary operational object", () => {
    expect(appSource).toContain("const operationalAircraft = board?.aircraft ?? []");
    expect(appSource).toContain('className="flight-supervisor"');
    expect(appSource).toContain("Ausgewähltes Flugzeug");
    expect(appSource).toContain("Wieder verfügbar");
  });

  it("supports an optional pause estimate without automatic release", () => {
    expect(expectedReviewAtFromPause("20", false, Date.parse("2026-07-16T10:00:00.000Z"))).toBe(
      "2026-07-16T10:20:00.000Z",
    );
    expect(expectedReviewAtFromPause("20", true)).toBeNull();
    expect(expectedReviewAtFromPause("0", false)).toBeNull();
    expect(appSource).toContain("Das Flugzeug wird nicht automatisch freigegeben");
    expect(appSource).toContain('type: "SET_AIRCRAFT_OPERATIONAL_STATE"');
  });
});
