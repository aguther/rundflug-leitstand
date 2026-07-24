import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import routerSource from "./FeatureRouter.tsx?raw";
import assistSource from "./flight-line-assist.tsx?raw";
import sharedFlightLineSource from "./flight-line-shared.tsx?raw";
import flightLineSource from "./flight-line-view.tsx?raw";
import sharedSource from "./operation-workspace.tsx?raw";

const assistStyles = readFileSync(
  new URL("./features/flight-line/flight-line-assist-v15.css", import.meta.url),
  "utf8",
);
const sharedFlightLineStyles = readFileSync(
  new URL("./features/flight-line/flight-line-v12.css", import.meta.url),
  "utf8",
);

const appSource = `${routerSource}\n${flightLineSource}\n${sharedSource}`;
const assistFlowSource = `${assistSource}\n${sharedFlightLineSource}`;

describe("Flight Line Assist", () => {
  it("is directly addressable as a separate tablet and phone surface", () => {
    expect(appSource).toContain('window.location.pathname === "/flight-line/assist"');
    expect(appSource).toContain('path === "/flight-line/assist"');
    expect(appSource).toContain("<FlightLineAssist");
    expect(assistSource).toContain("flight-assist-v15");
  });

  it("uses the shared status timeline and exposes state-dependent operational actions", () => {
    expect(assistSource).toContain("Flugzeug übernehmen");
    expect(assistSource).toContain("Übernehmen");
    expect(assistSource).toContain("BookingGroupAssignmentDialog");
    expect(assistSource).toContain("Tanken");
    expect(assistSource).toContain("Pause");
    expect(assistSource).toContain("Nicht verfügbar");
    expect(assistSource).toContain("Flugzeug freigeben");
    expect(sharedFlightLineSource).toContain("FlightProgress");
    expect(assistSource).toContain("CompactCurrentRotation");
    expect(assistSource).toContain("CompactHistory");
    expect(assistSource).toContain('activeRotation?.status === "LANDED"');
    expect(assistSource).not.toContain("Zustand nach Abschluss");
    expect(assistSource).toContain('runRotationAction("refueling", activeRotation, "REFUELING")');
    expect(assistSource).toContain('runRotationAction("paused", activeRotation, "PAUSED")');
    expect(assistSource).toContain('runRotationAction("inactive", activeRotation, "INACTIVE")');
    expect(assistSource).toContain('runAircraftStateAction("primary", "AVAILABLE")');
    expect(assistSource).toContain("!requiresAvailableReset &&");
    expect(assistSource).toContain("Coffee");
    expect(assistSource).toContain("AircraftPickerMeta");
    expect(assistSource).toContain("{aircraft.resourceGroupName}");
    expect(assistSource).toContain("gateLabel ? (");
    expect(assistSource).not.toContain("rotation?.communicationLabel");
    expect(assistSource).toContain("CurrentAircraftStateMarker");
    expect(assistSource).not.toContain("assist-v15-operational-state");
    expect(assistSource).toContain('{ value: "current", label: "Aktuell" }');
    expect(assistSource).toContain("rotation={assignedRotation}");
    expect(assistSource).not.toContain("latestRotationForAircraft");
    expect(assistStyles).toContain(".assist-v15-picker-meta");
    expect(assistStyles).toContain("display: grid");
    expect(assistSource).toContain(
      'aria-pressed={activeAircraft.operationalState === "REFUELING"}',
    );
    expect(assistSource).toContain("PilotChangeIcon");
    expect(assistSource).toContain("primaryAircraftActionPresentation");
    expect(assistSource).not.toContain("Wird übernommen …");
    expect(assistSource).toContain("Übernahme läuft für");
    expect(assistSource).toContain("claimingAircraftId");
    expect(assistSource).toContain("busy={isClaiming}");
    expect(assistSource).toContain('" assist-v15-claim--takeover"');
    expect(assistSource).toContain(
      ["busyLabel={`Übernahme läuft für $", "{entry.registration}`}"].join(""),
    );
    expect(assistStyles).toContain("width: 164px");
    expect(assistSource).not.toContain("assist-v15-claim-zone");
    expect(assistStyles).not.toContain(".assist-v15-claim-zone");
    expect(assistStyles).toContain("grid-template-columns: 40px minmax(0, 1fr) 48px");
    expect(assistStyles).toContain("grid-column: 1 / -1");
    expect(assistStyles).toContain("width: 100%");
    expect(assistStyles).toContain("font-size: 0.82rem");
    expect(assistStyles).toContain("grid-template-rows: minmax(46px, 1fr) var(--control-compact)");
    expect(assistStyles).toContain("height: var(--control-compact)");
    expect(assistStyles).toContain("max-height: var(--control-compact)");
    expect(assistStyles).toContain('.assist-v15-claim[aria-busy="true"]');
    expect(assistStyles).toContain("white-space: nowrap");
    expect(assistStyles).toContain("cursor: wait");
    expect(assistStyles).toContain(".assist-v15-claim--takeover:not(:disabled)");
    expect(assistStyles).toContain("border-color: var(--ui-warning)");
    expect(assistStyles).toContain("--progress-node-size: 28px");
    expect(assistStyles).toContain("font-size: 0.75rem");
    expect(sharedFlightLineStyles).toMatch(
      /\.flight-director-current-state-marker \{[\s\S]*?grid-template-rows: var\(--progress-node-size\) 18px;[\s\S]*?gap: 4px;[\s\S]*?background: transparent;/,
    );
    expect(sharedFlightLineStyles).toMatch(
      /\.flight-director-current-state-marker small \{[\s\S]*?min-height: 18px;[\s\S]*?line-height: 18px;/,
    );
    expect(sharedFlightLineStyles).not.toMatch(
      /\.flight-director-current-state-marker small \{[\s\S]*?position: absolute;/,
    );
    expect(assistStyles).toMatch(
      /@media \(min-width: 561px\) \{[\s\S]*?article > \.flight-director-current-state-marker \{[\s\S]*?align-self: center;/,
    );
    expect(assistStyles).toContain("justify-content: center");
    expect(assistStyles).toContain(".flight-director-current-rotation.is-booking-groups-only");
    expect(assistStyles).toContain("min-height: 2.3em");
    expect(assistStyles).toContain("-webkit-line-clamp: 2");
    expect(assistStyles).toContain("grid-template-columns: repeat(4, 56px)");
    expect(assistStyles).toContain("scrollbar-width: thin");
    expect(assistStyles).toContain("::-webkit-scrollbar-thumb");
  });

  it("uses the shared design system and Lucide instead of a duplicated shell", () => {
    expect(assistSource).toContain('from "lucide-react"');
    expect(assistSource).toContain('from "./design-system/components"');
    expect(assistSource).toContain("<Button");
    expect(assistSource).toContain("<IconButton");
    expect(assistSource).toContain("<PageHeader");
    expect(assistSource).toContain("<Panel");
    expect(assistSource).not.toContain("<StatusPill");
    expect(assistSource).not.toContain("<svg");
    expect(assistSource).not.toContain("assist-header");
    expect(assistSource).not.toContain("<BrandMark");
    expect(assistSource).not.toContain("<ThemeToggle");
    expect(sharedFlightLineSource).toContain("PilotAssignmentDialogs");
    expect(sharedFlightLineSource).toContain("primaryAircraftActionLabel");
  });

  it("V161-FL-020: uses the generic pilot assignment confirmation in Assist", () => {
    expect(assistSource).toContain("<PilotAssignmentDialogs");
    expect(sharedFlightLineSource).toMatch(
      /onClick=\{submitPilotAssignment\}[\s\S]*?>\s*Pilot zuweisen\s*<\/Button>/,
    );
    expect(sharedFlightLineSource).not.toContain('?.operationalCode ?? ""} zuweisen');
  });

  it("offers manual presence, missing, recall and deferral actions", () => {
    expect(assistSource).toContain("onGroupAttendance");
    expect(assistSource).toContain("onGroupMissing");
    expect(assistSource).toContain("onGroupRecall");
    expect(assistSource).toContain("onGroupDefer");
    expect(sharedFlightLineSource).toMatch(/\$\{communicationLabel\} anwesend/);
    expect(sharedFlightLineSource).toMatch(/\$\{communicationLabel\} nicht da/);
    expect(sharedFlightLineSource).toMatch(/\$\{communicationLabel\} nachrufen/);
    expect(sharedFlightLineSource).toMatch(/\$\{communicationLabel\} zurückstellen/);
    expect(sharedFlightLineSource).toContain('className="flight-director-queue-actions"');
    expect(sharedFlightLineSource).toContain("<IconButton");
    expect(sharedFlightLineSource).not.toContain('<CheckCircle2 aria-hidden="true" /> Anwesend');
  });

  it("shows only anonymous operational identifiers and counts", () => {
    expect(assistSource).not.toContain("communicationLabel");
    expect(sharedFlightLineSource).toContain("formatBookingGroupLabel");
    expect(sharedFlightLineSource).toContain("<span>{rotationGroupLabels(rotation)}</span>");
    expect(assistFlowSource).toContain("ticketCount");
    expect(assistSource).not.toMatch(/guestName|phoneNumber|payment/i);
  });

  it("renews and releases the login-owned server claim", () => {
    expect(assistSource).toContain("board.assistClaims");
    expect(assistSource).toContain("5 * 60_000");
    expect(assistSource).toContain("10 * 60_000");
    expect(assistSource).toContain("claimedByCurrentOperator");
    expect(assistSource).toContain("await onClaim(entry.id)");
    expect(assistSource).toContain("await onRelease(claimedAircraftId)");
    expect(assistSource).toMatch(
      /const actionBusy =\s*releasing \|\|[\s\S]*busyRotationIds\?\.has/,
    );
    expect(assistSource).toContain("aria-busy={releasing}");
    expect(assistSource).toMatch(
      /disabled=\{releasing\}[\s\S]*label=\{`Pilot für \$\{activeAircraft\.registration\} wechseln`\}/,
    );
  });

  it("renders exclusive selection and work modes and clears state on release or claim loss", () => {
    expect(assistSource).toContain("if (!activeAircraft)");
    expect(assistSource).toContain("is-selection-mode");
    expect(assistSource).toContain("is-work-mode");
    expect(assistSource).toContain("serverClaimSeen");
    expect(assistSource).toContain("hat die Betreuung dieses Flugzeugs übernommen");
    expect(assistSource).toContain("onClaimUnavailable");
    expect(assistSource).not.toContain("assist-v15-workspace");
    expect(assistSource).not.toContain('className="assist-v15-groups"');
    expect(assistSource).toContain("setAssignmentOpen(true)");
    expect(flightLineSource).toContain("setSelectedAircraftId(null)");
    expect(flightLineSource).toContain("setSelectedQueueGroupIds([])");
    expect(flightLineSource).toContain("claimedAssistAircraftId");
  });

  it("uses stable grids and a history overlay constrained by the current rotation", () => {
    expect(assistStyles).toContain("grid-template-columns: 42px minmax(0, 1fr) auto");
    expect(assistStyles).toContain(".assist-v15-current-pane");
    expect(assistStyles).toContain(".assist-v15-history-pane");
    expect(assistStyles).toContain("height: auto");
    expect(assistStyles).toContain("position: absolute");
    expect(assistStyles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(assistStyles).toMatch(
      /\.flight-assist-v15 \.flight-director-compact-table\.history > div > span \{[\s\S]*?text-align: left;/,
    );
    expect(assistStyles).toMatch(
      /\.flight-director-compact-table\.history[\s\S]*?> span:last-child \{[\s\S]*?text-align: left;/,
    );
    expect(assistStyles).not.toContain("minmax(620px");
  });

  it("separates header, actions and natural-height rotation details", () => {
    expect(assistSource).toContain('className="assist-v15-aircraft-panel"');
    expect(assistSource).toContain('className="assist-v15-actions"');
    expect(assistSource).toContain('className="assist-v15-rotation-panel"');
    expect(assistSource).toContain('className="assist-v15-release"');
    expect(assistSource).toContain('aria-label="Flugzeug freigeben"');
    expect(assistSource).toContain('className="assist-v15-release-label"');
    expect(assistStyles).toContain(".assist-v15-release-label");
    expect(assistStyles).not.toContain(".assist-v15-release span");
    expect(assistSource).not.toContain("assist-v15-release-phone");
    expect(assistSource).toContain("assist-v15-current-pane");
    expect(assistSource).toContain("assist-v15-history-pane");
    expect(assistSource).toContain("BookingGroupAssignmentDialog");
  });

  it("allows the shared unavailable abort during boarding and off-block", () => {
    expect(assistSource).toContain(
      'assignedRotation && ["CALLED", "IN_FLIGHT", "LANDED"].includes(assignedRotation.status)',
    );
    expect(assistSource).toContain("disabled={!unavailableAllowed || actionBusy}");
    expect(flightLineSource).toContain("ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE");
  });

  it("clears transient touch hover colors while preserving pressed states", () => {
    expect(sharedFlightLineStyles).toContain("@media (hover: none)");
    expect(sharedFlightLineStyles).toContain(
      '.assist-v15-action-bar .ds-icon-button:hover:not(:disabled):not([aria-pressed="true"])',
    );
  });
});
