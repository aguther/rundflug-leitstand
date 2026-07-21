import { describe, expect, it } from "vitest";
import { expectedReviewAtFromPause } from "./flight-line-pause";
import sharedSource from "./flight-line-shared.tsx?raw";
import supervisorSource from "./flight-line-supervisor.tsx?raw";
import appSource from "./flight-line-view.tsx?raw";

const flightLineSource = `${supervisorSource}\n${sharedSource}`;

describe("Flight Line Supervisor", () => {
  it("keeps every aircraft visible and makes the aircraft the primary operational object", () => {
    expect(appSource).toContain("const operationalAircraft = board?.aircraft ?? []");
    expect(appSource).toContain("<FlightLineSupervisorConsole");
    expect(supervisorSource).toContain('className="flight-director-v15"');
    expect(supervisorSource).toContain("flight-director-aircraft-row selected");
    expect(supervisorSource).toContain("<ModalDialog");
    expect(supervisorSource).toContain("Buchungsgruppen zuweisen");
    expect(supervisorSource).toContain("Gruppen bleiben vollständig zusammen");
    expect(supervisorSource).toContain("Pilot zuweisen");
    expect(supervisorSource).not.toContain("flight-line-console-header");
    expect(supervisorSource).not.toContain("aircraft-selector-rail");
    expect(supervisorSource).not.toContain("expanded");
    expect(appSource).toContain("Belegung bestätigen & Boarding starten");
    expect(appSource).not.toContain('label: "NEXT"');
    expect(flightLineSource).toContain("Verfügbar setzen");
  });

  it("uses real controls for search, resource filtering and separate pilot assignment", () => {
    expect(supervisorSource).toContain("<SearchField");
    expect(supervisorSource).toContain("Alle Ressourcen");
    expect(supervisorSource).toContain("onAssignPilot");
    expect(supervisorSource).not.toContain("PILOT_REASSIGN_CONFIRMATION_REQUIRED");
    expect(supervisorSource).toContain("Vor Belegung bitte über „Pilot zuweisen“");
    expect(appSource).not.toContain('className="pilot-assignment"');
  });

  it("keeps current rotation and sold tickets visible side by side like the approved concept", () => {
    expect(supervisorSource).toContain('className="flight-director-bottom-grid"');
    expect(supervisorSource).toContain("Aktueller Umlauf");
    expect(supervisorSource).toContain("Verkaufte Tickets");
    expect(flightLineSource).toContain("Boarding");
    expect(flightLineSource).toContain("Offblock");
    expect(flightLineSource).toContain("Onblock");
    expect(flightLineSource).toContain("Abschluss / Folgestatus");
    expect(supervisorSource).toContain("rotationStateLabels[rotation.status]");
    expect(supervisorSource).not.toContain("<dd>{rotation.status}</dd>");
    expect(supervisorSource).not.toContain('{ value: "tickets", label: "Verkaufte Tickets" }');
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
