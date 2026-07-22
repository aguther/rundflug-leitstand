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
    expect(supervisorSource).toContain('className="flight-director-aircraft-row"');
    expect(supervisorSource).not.toContain("flight-director-aircraft-row selected");
    expect(supervisorSource).toContain("<ModalDialog");
    expect(flightLineSource).toContain("Buchungsgruppen zuweisen");
    expect(flightLineSource).toContain("Gruppen bleiben vollständig zusammen");
    expect(flightLineSource).toContain("Pilot zuweisen");
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
    expect(flightLineSource).toContain("Vor Belegung bitte über „Pilot zuweisen“");
    expect(appSource).not.toContain('className="pilot-assignment"');
  });

  it("keeps the current rotation in the aircraft row and sold tickets full width", () => {
    expect(supervisorSource).toContain('className="flight-director-bottom-grid is-ticket-only"');
    expect(supervisorSource).toContain('className="flight-director-timeline"');
    expect(supervisorSource).toContain("Verkaufte Tickets");
    expect(flightLineSource).toContain("Boarding");
    expect(flightLineSource).toContain("Offblock");
    expect(flightLineSource).toContain("Onblock");
    expect(flightLineSource).toContain("Nicht verfügbar");
    expect(flightLineSource).toContain("PilotChangeIcon");
    expect(flightLineSource).toContain("primaryAircraftActionPresentation");
    expect(supervisorSource).toContain("rotationStateLabels[rotation.status]");
    expect(supervisorSource).not.toContain("Nächster Schritt");
    expect(supervisorSource).not.toContain("<span>Status</span>");
    expect(supervisorSource).not.toContain("<dd>{rotation.status}</dd>");
    expect(supervisorSource).not.toContain('{ value: "tickets", label: "Verkaufte Tickets" }');
  });

  it("shows forecast and actual ticket timing with an open-only filter", () => {
    expect(supervisorSource).toContain("onlyOpenTickets");
    expect(supervisorSource).toContain("Nur offene Tickets");
    expect(supervisorSource).toContain("Zeitfenster");
    expect(supervisorSource).toContain("Off-Block");
    expect(supervisorSource).toContain("On-Block");
    expect(supervisorSource).toContain("formatFlightLineTime");
    expect(supervisorSource).toContain('rotation.status !== "COMPLETED"');
    expect(supervisorSource).toContain("nextTicketSort");
    expect(supervisorSource).toContain("aria-pressed={active}");
    expect(supervisorSource).toContain('className="flight-director-pilot-action"');
    expect(supervisorSource).toContain('{ key: "queue", label: "Queue" }');
    expect(supervisorSource).toContain("queueGroup.queueSequence");
    expect(supervisorSource).toContain("return group.communicationNumber;");
    expect(supervisorSource).not.toContain('<PilotIcon aria-hidden="true" />');
  });

  it("shares assignment UI without repeating the assigned pilot", () => {
    expect(supervisorSource).toContain("BookingGroupAssignmentDialog");
    expect(sharedSource).toContain("BookingGroupAssignmentDialog");
    expect(sharedSource).not.toContain("flight-director-dialog-pilot");
  });

  it("allows the audited unavailable flow during boarding and off-block", () => {
    expect(supervisorSource).toContain('["CALLED", "IN_FLIGHT"].includes(rotation.status)');
    expect(supervisorSource).toContain("disabled={!unavailableAllowed}");
    expect(appSource).toContain("ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE");
  });

  it("supports an optional pause estimate without automatic release", () => {
    expect(expectedReviewAtFromPause(20, Date.parse("2026-07-16T10:00:00.000Z"))).toBe(
      "2026-07-16T10:20:00.000Z",
    );
    expect(expectedReviewAtFromPause(null)).toBeNull();
    expect(appSource).toContain("([10, 20, 30] as const)");
    expect(appSource).toContain("{minutes} Min.");
    expect(appSource).toContain("Dauer unbekannt");
    expect(appSource).not.toContain("Pause starten");
    expect(appSource).toContain('type: "SET_AIRCRAFT_OPERATIONAL_STATE"');
  });
});
