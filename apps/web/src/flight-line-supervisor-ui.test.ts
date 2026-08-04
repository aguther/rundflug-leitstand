import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import analyticsViewportSource from "./features/flight-line/analytics-diagram-viewport.ts?raw";
import analyticsContentSource from "./features/flight-line/FlightDirectorAnalyticsContent.tsx?raw";
import analyticsDialogSource from "./features/flight-line/FlightDirectorAnalyticsDialog.tsx?raw";
import operationsDialogSource from "./features/flight-line/FlightDirectorOperationsDialog.tsx?raw";
import operationalPlanSource from "./features/operations/OperationalPlanPanel.tsx?raw";
import { expectedReviewAtFromPause } from "./flight-line-pause";
import sharedSource from "./flight-line-shared.tsx?raw";
import supervisorSource from "./flight-line-supervisor.tsx?raw";
import appSource from "./flight-line-view.tsx?raw";

const flightLineSource = `${supervisorSource}\n${sharedSource}\n${operationsDialogSource}\n${operationalPlanSource}\n${analyticsDialogSource}\n${analyticsContentSource}`;
const flightLineStyles = readFileSync(
  new URL("./features/flight-line/flight-line-v12.css", import.meta.url),
  "utf8",
);

describe("Flight Director", () => {
  it("keeps every aircraft visible and makes the aircraft the primary operational object", () => {
    expect(appSource).toContain("const operationalAircraft = board?.aircraft ?? []");
    expect(appSource).toContain("<FlightLineSupervisorConsole");
    expect(supervisorSource).toContain('className="flight-director-v15"');
    expect(supervisorSource).toContain('className="flight-director-aircraft-row"');
    expect(supervisorSource).not.toContain("flight-director-aircraft-row selected");
    expect(analyticsDialogSource).toContain("<ModalDialog");
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
    expect(flightLineSource).toContain("Vor dem Boarding einen Piloten zuweisen.");
    expect(appSource).not.toContain('className="pilot-assignment"');
  });

  it("aligns the operational status, action and resource filter on the shared control row", () => {
    expect(supervisorSource).toContain("<StatusPill");
    expect(flightLineStyles).toContain(
      ".flight-director-header-actions .flight-director-resource-filter",
    );
    expect(flightLineStyles).toMatch(
      /\.flight-director-header-actions > \.ds-button,[\s\S]*?min-height: var\(--control-default\);/,
    );
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
    expect(supervisorSource).toContain("Voraufruf fällig");
    expect(supervisorSource).toContain("Keine Prognosekapazität");
    expect(supervisorSource).toContain("Kein passendes Flugzeug");
  });

  it("shares assignment UI without repeating the assigned pilot", () => {
    expect(supervisorSource).toContain("BookingGroupAssignmentDialog");
    expect(sharedSource).toContain("BookingGroupAssignmentDialog");
    expect(sharedSource).not.toContain("flight-director-dialog-pilot");
    expect(supervisorSource).toContain("onDefer={onGroupDefer}");
    expect(supervisorSource).toContain("dispatchLease={dispatchLease}");
    expect(supervisorSource).toContain("await onReserveAssignment(entry.id)");
    expect(supervisorSource).toContain("dispatchLease.release()");
    expect(supervisorSource).not.toMatch(/for \(const .*selectedQueueGroupIds/);
    expect(sharedSource).toContain("Empfehlung · Umlauf");
    expect(sharedSource).toContain("recommendationMatchesSelection");
  });

  it("keeps the compact tablet row free of decorative and repeated content", () => {
    expect(supervisorSource).toMatch(/flight-director-aircraft-name">\s*<span>/);
    expect(supervisorSource).toContain("entry.resourceGroupShortCode");
    expect(supervisorSource).not.toContain("Pilot wechseln");
    expect(flightLineStyles).toContain("min-width: 1088px");
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
    expect(supervisorSource).toContain('label: "Voraufruf"');
    expect(supervisorSource).toContain("HeaderIcon");
    expect(supervisorSource).toContain("title={column.label}");
    expect(flightLineStyles).toContain("min-width: 1088px");
    expect(flightLineStyles).toContain("scrollbar-gutter: stable");
    expect(flightLineStyles).toMatch(
      /\.flight-director-compact-head \{[\s\S]*?position: sticky;[\s\S]*?z-index: 5;[\s\S]*?isolation: isolate;/,
    );
    expect(flightLineStyles).toMatch(
      /\.flight-director-ticket-overview > header \{[\s\S]*?flex: 0 0 auto;/,
    );
  });

  it("opens one lazy daily analytics dialog from the header, aircraft and group rows", () => {
    expect(supervisorSource).toContain("Auswertungen");
    expect(supervisorSource).toContain("FlightDirectorAnalyticsDialog");
    expect(supervisorSource).toContain('setAnalyticsSelection({ tab: "aircraft", id: entry.id })');
    expect(supervisorSource).toContain(
      'setAnalyticsSelection({ tab: "groups", id: ticketGroupId, rotationId })',
    );
    expect(analyticsDialogSource).toContain("lazy(() =>");
    expect(analyticsDialogSource).toContain('{ value: "groups", label: "Ticketgruppen" }');
    expect(analyticsDialogSource).toContain('{ value: "aircraft", label: "Flugzeuge" }');
    expect(analyticsDialogSource).toContain('{ value: "pilots", label: "Piloten" }');
    expect(analyticsContentSource).toContain("<LineChart");
    expect(analyticsContentSource).toContain("resourceTimelineRotations");
    expect(analyticsContentSource).toContain("Alle zugehörigen");
    expect(analyticsContentSource).toContain("DiagramZoomControls");
    expect(analyticsViewportSource).toMatch(
      /ANALYTICS_ZOOM_LEVELS[^=]*= \[1, 1\.5, 2, 3, 4\.5, 6, 8, 12, 16, 24, 32\]/,
    );
    expect(analyticsViewportSource).toContain("analyticsZoomLevelsForSpan");
    expect(analyticsContentSource).toContain("<th>Ticketgruppe</th>");
    expect(analyticsViewportSource).toContain(
      'addEventListener("wheel", listener, { passive: false })',
    );
    expect(analyticsContentSource).toContain("isAnimationActive={false}");
    expect(analyticsContentSource).toContain("{group.label}");
    expect(flightLineStyles).toContain("overflow-x: scroll");
    expect(flightLineStyles).toMatch(/\.flight-director-forecast-chart\s*\{[^}]*overflow: hidden;/);
    expect(flightLineStyles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(analyticsContentSource).toContain("Prognose öffnen");
    expect(analyticsContentSource).toContain(
      'className="flight-director-analytics-table is-resource-history"',
    );
    expect(analyticsContentSource).toMatch(
      /Prognose für \$\{rotation\.communicationLabel\} öffnen/,
    );
    expect(flightLineStyles).toMatch(
      /\.flight-director-analytics-table\.is-resource-history\s*\{[^}]*min-width:\s*860px;[^}]*table-layout:\s*fixed;/s,
    );
    expect(analyticsDialogSource).toContain(
      "Organisatorische Übersicht · keine Dienst-, Flugzeit- oder Einsatzfreigabe.",
    );
  });

  it("V1120-QA-010 classifies diagnosis failures by the structured API error code", () => {
    expect(supervisorSource).toContain("analysisSnapshotRequiresRefresh(error)");
    expect(supervisorSource).toContain(
      "Der Betriebsstand hat sich geändert. Ansicht aktualisieren und Export erneut starten.",
    );
    expect(supervisorSource).toContain(
      "Diagnose-Momentaufnahme konnte nicht erstellt werden. Bitte erneut versuchen.",
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
    expect(appSource).not.toContain("setTimeout");
    expect(appSource).toContain('type: "SET_AIRCRAFT_OPERATIONAL_STATE"');
  });

  it("centralizes Flight Director controls in the prioritized operations dialog", () => {
    expect(supervisorSource).toContain("operationalSummary");
    expect(supervisorSource).toContain("Betrieb");
    expect(operationsDialogSource).toContain(
      'type OperationsTab = "operations" | "plan" | "resources"',
    );
    expect(operationsDialogSource).toContain('{ value: "operations", label: "Betrieb" }');
    expect(operationsDialogSource).toContain('{ value: "plan", label: "Betriebsplan" }');
    expect(operationsDialogSource).toContain('{ value: "resources", label: "Ressourcengruppen" }');
    expect(operationsDialogSource).toContain("Not-Halt aktiv");
    expect(appSource).toContain("Betrieb unterbrochen");
    expect(appSource).toContain("Betrieb normal");
    expect(appSource).toContain('type: "SET_OPERATIONAL_NOTE"');
    expect(appSource).toContain('type: "SET_RESOURCE_GROUP_NOTICE"');
    expect(appSource).toContain('type: "SET_RESOURCE_GROUP_STATUS"');
    expect(appSource).toContain(
      'const FLIGHT_DIRECTOR_AUDIT_REASON = "Operative Entscheidung Flight Director"',
    );
    expect(appSource).toContain('type: "SET_PILOT_PAUSE"');
    expect(operationsDialogSource).not.toContain("Pilotenpausen");
    expect(operationsDialogSource).not.toContain("Begründung für Zustandsänderungen");
    expect(operationsDialogSource).toContain("Die Aufhebung bleibt ausschließlich");
    expect(operationsDialogSource).toContain("Admin-Bereich möglich.");
    expect(operationsDialogSource.match(/<ModalDialog/g)).toHaveLength(1);
    expect(appSource).not.toContain('<details className="emergency-control">');
  });

  it("provides explicit published, editing and deletion states for operational notices", () => {
    expect(operationsDialogSource).toContain("type NoticeEditorTarget =");
    expect(operationsDialogSource).toContain('kind: "event"');
    expect(operationsDialogSource).toContain('kind: "resource"');
    expect(operationsDialogSource).toContain("OperationalNoticeEditor");
    expect(operationsDialogSource).toContain("publishedEventNotice");
    expect(operationsDialogSource).toContain("Hinweis veröffentlichen");
    expect(operationsDialogSource).toContain("Hinweis bearbeiten");
    expect(operationsDialogSource).toContain("Speichern");
    expect(operationsDialogSource).toContain("Löschen");
    expect(operationsDialogSource).toContain('onPublishEventNotice("")');
    expect(operationsDialogSource).toContain(
      'onPublishResourceNotice(noticeTarget.resourceGroupId, "")',
    );
    expect(operationsDialogSource).toContain("returnFromNoticeEditor");
    expect(operationsDialogSource).toContain("flight-director-event-notice-summary");
    expect(operationsDialogSource).not.toContain("flight-director-published-notice");
  });

  it("orders resource actions with a stable notice action before the destructive ending", () => {
    const statusList = operationsDialogSource.slice(
      operationsDialogSource.indexOf("const resourceStatusActions"),
      operationsDialogSource.indexOf("const endedStatusAction"),
    );
    expect(statusList.indexOf('label: "Aktiv"')).toBeLessThan(statusList.indexOf('label: "Pause"'));
    expect(statusList.indexOf('label: "Pause"')).toBeLessThan(
      statusList.indexOf('label: "Unterbrochen"'),
    );
    expect(statusList).not.toContain('label: "Beendet"');

    const actionMarkup = operationsDialogSource.slice(
      operationsDialogSource.indexOf('className="flight-director-operation-actions"'),
      operationsDialogSource.indexOf(
        "</div>",
        operationsDialogSource.indexOf('className="flight-director-operation-actions"'),
      ),
    );
    expect(actionMarkup.indexOf("flight-director-notice-action")).toBeLessThan(
      actionMarkup.indexOf("endedStatusAction.label"),
    );
    expect(flightLineStyles).toMatch(
      /\.flight-director-notice-action \{[\s\S]*?inline-size: 11\.5rem;[\s\S]*?flex: 0 0 11\.5rem;/,
    );
  });
});
