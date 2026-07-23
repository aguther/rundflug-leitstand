import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectedReviewAtFromPause } from "./flight-line-pause";
import sharedSource from "./flight-line-shared.tsx?raw";
import supervisorSource from "./flight-line-supervisor.tsx?raw";
import appSource from "./flight-line-view.tsx?raw";

const flightLineSource = `${supervisorSource}\n${sharedSource}`;
const flightLineStyles = readFileSync(
  new URL("./features/flight-line/flight-line-v12.css", import.meta.url),
  "utf8",
);

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

  it("V161-FL-020: keeps the pilot assignment confirmation free of the selected pilot code", () => {
    expect(sharedSource).toMatch(
      /onClick=\{submitPilotAssignment\}[\s\S]*?>\s*Pilot zuweisen\s*<\/Button>/,
    );
    expect(sharedSource).not.toContain('?.operationalCode ?? ""} zuweisen');
  });

  it("keeps the current rotation in the aircraft row and sold tickets full width", () => {
    expect(supervisorSource).toContain('className="flight-director-bottom-grid is-ticket-only"');
    expect(supervisorSource).toContain('className="flight-director-timeline"');
    expect(supervisorSource).toContain("Verkaufte Tickets");
    expect(supervisorSource).toContain(
      "formatBookingGroupLabel(rotation.productCode, group.communicationNumber)",
    );
    expect(supervisorSource).toContain("<span>{rotation.communicationLabel}</span>");
    expect(flightLineSource).toContain("Boarding");
    expect(flightLineSource).toContain("Offblock");
    expect(flightLineSource).toContain("Onblock");
    expect(flightLineSource).toContain("Nicht verfügbar");
    expect(flightLineSource).toContain("PilotChangeIcon");
    expect(flightLineSource).toContain("primaryAircraftActionPresentation");
    expect(supervisorSource).toContain("phaseIcon(rotation)");
    expect(supervisorSource).not.toContain("Nächster Schritt");
    expect(supervisorSource).not.toContain("<span>Status</span>");
    expect(supervisorSource).not.toContain("<dd>{rotation.status}</dd>");
    expect(supervisorSource).not.toContain('{ value: "tickets", label: "Verkaufte Tickets" }');
  });

  it("shows forecast and actual ticket timing with an open-only filter", () => {
    expect(supervisorSource).toContain("onlyOpenTickets");
    expect(supervisorSource).toContain("useState(true)");
    expect(supervisorSource).toContain("Nur offene Tickets");
    expect(supervisorSource).toContain("Zeitfenster");
    expect(supervisorSource).toContain("Off-Block");
    expect(supervisorSource).toContain("On-Block");
    expect(supervisorSource).toContain("formatFlightLineTime");
    expect(supervisorSource).toContain('rotation.status !== "COMPLETED"');
    expect(supervisorSource).toContain("nextTicketSort");
    expect(supervisorSource).toContain("aria-pressed={active}");
    expect(supervisorSource).toContain('className="flight-director-aircraft-details"');
    expect(supervisorSource).toContain('{ key: "queue", label: "Queue", Icon: ListOrdered }');
    expect(supervisorSource).toContain("queueGroup.queueSequence");
    expect(supervisorSource).toContain("return group.communicationNumber;");
    expect(supervisorSource).not.toContain('<PilotIcon aria-hidden="true" />');
  });

  it("shares assignment UI without repeating the assigned pilot", () => {
    expect(supervisorSource).toContain("BookingGroupAssignmentDialog");
    expect(sharedSource).toContain("BookingGroupAssignmentDialog");
    expect(sharedSource).not.toContain("flight-director-dialog-pilot");
    expect(supervisorSource).toContain("onDefer={onGroupDefer}");
  });

  it("keeps the compact tablet row free of decorative and repeated content", () => {
    expect(supervisorSource).toMatch(/flight-director-aircraft-name">\s*<span>/);
    expect(supervisorSource).toContain("entry.resourceGroupShortCode");
    expect(supervisorSource).not.toContain("Pilot wechseln");
    expect(flightLineStyles).toContain("min-width: 1040px");
    expect(flightLineStyles).toContain("@media (min-width: 768px) and (max-width: 1180px)");
    expect(flightLineStyles).toContain("grid-template-columns: repeat(6, var(--control-touch))");
  });

  it("allows the audited unavailable flow during boarding and off-block", () => {
    expect(supervisorSource).toContain(
      '["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status)',
    );
    expect(supervisorSource).toContain("disabled={!unavailableAllowed || actionBusy}");
    expect(supervisorSource).toMatch(
      /className="flight-line-status-action state-refueling"[\s\S]*?turnaroundActionAllowed/,
    );
    expect(supervisorSource).toContain('runRotationAction(rotation, "refueling", "REFUELING")');
    expect(supervisorSource).toContain('runRotationAction(rotation, "paused", "PAUSED")');
    expect(supervisorSource).toContain('runRotationAction(rotation, "inactive", "INACTIVE")');
    expect(appSource).toContain("ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE");
  });

  it("uses accessible icon headers and a scrollbar-stable compact ticket table", () => {
    expect(supervisorSource).toContain('label: "Ticketgruppe"');
    expect(supervisorSource).toContain('label: "Fluggruppe"');
    expect(supervisorSource).toContain('label: "GoToGate-Aktiv"');
    expect(supervisorSource).toContain("HeaderIcon");
    expect(supervisorSource).toContain("title={column.label}");
    expect(flightLineStyles).toContain("min-width: 940px");
    expect(flightLineStyles).toContain("scrollbar-gutter: stable");
    expect(flightLineStyles).toMatch(
      /\.flight-director-ticket-overview > header \{[\s\S]*?flex: 0 0 auto;/,
    );
  });

  it("draws timeline connectors only in the gaps between the three center icons", () => {
    expect(flightLineStyles).toContain("--progress-node-size: 26px");
    expect(flightLineStyles).toContain("--progress-line-offset: 15px");
    expect(flightLineStyles).toContain("left: calc(50% + var(--progress-line-offset))");
    expect(flightLineStyles).toContain(
      "width: calc(100% + var(--progress-gap) - var(--progress-line-span))",
    );
    expect(flightLineStyles).toContain(
      ".flight-director-progress--detailed .flight-director-progress-node",
    );
    expect(flightLineStyles).toContain("font-size: 0.75rem");
    expect(flightLineStyles).toContain("transform: translateY(11px)");
    expect(flightLineStyles).toMatch(
      /li:is\(\[data-step="boarding"\], \[data-step="offblock"\]\)::after/,
    );
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
