import { describe, expect, it } from "vitest";
import { expectedReviewAtFromPause } from "./flight-line-pause";
import supervisorSource from "./flight-line-supervisor.tsx?raw";
import appSource from "./LegacyApp.tsx?raw";

describe("Flight Line Supervisor", () => {
  it("keeps every aircraft visible and makes the aircraft the primary operational object", () => {
    expect(appSource).toContain("const operationalAircraft = board?.aircraft ?? []");
    expect(appSource).toContain("<FlightLineSupervisorConsole");
    expect(supervisorSource).toContain('className="flight-line-console"');
    expect(supervisorSource).toContain('className="console-status-matrix"');
    expect(supervisorSource).toContain("Nächste Gruppen");
    expect(supervisorSource).toContain("Vorgeschlagene Zuordnung");
    expect(appSource).toContain("Wieder verfügbar");
  });

  it("uses real controls for search, resource filtering and alternate group selection", () => {
    expect(supervisorSource).toContain('type="search"');
    expect(supervisorSource).toContain("Alle Ressourcen");
    expect(supervisorSource).toContain("onOpenDisposition");
    expect(supervisorSource).toContain("onOpenDetails");
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
