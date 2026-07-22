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
    expect(assistSource).toContain("Zustand nach Abschluss");
    expect(assistSource).toContain('onSetAircraftState(activeAircraft.id, "AVAILABLE")');
    expect(assistSource).toContain("!requiresAvailableReset &&");
    expect(assistSource).toContain("Coffee");
    expect(assistSource).toContain("AircraftPickerMeta");
    expect(assistSource).toContain("assist-v15-operational-state");
    expect(assistStyles).toContain(".assist-v15-picker-meta");
    expect(assistStyles).toContain("display: grid");
    expect(assistSource).toContain(
      'aria-pressed={activeAircraft.operationalState === "REFUELING"}',
    );
    expect(assistSource).toContain("PilotChangeIcon");
    expect(assistSource).toContain("primaryAircraftActionPresentation");
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
    expect(assistSource).toContain("<StatusPill");
    expect(assistSource).not.toContain("<svg");
    expect(assistSource).not.toContain("assist-header");
    expect(assistSource).not.toContain("<BrandMark");
    expect(assistSource).not.toContain("<ThemeToggle");
    expect(sharedFlightLineSource).toContain("PilotAssignmentDialogs");
    expect(sharedFlightLineSource).toContain("primaryAircraftActionLabel");
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
    expect(assistSource).toContain("communicationLabel");
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
    expect(assistStyles).toContain("grid-column: 1 / -1");
    expect(assistStyles).toContain("position: absolute");
    expect(assistStyles).not.toContain("minmax(620px");
  });

  it("separates header, actions and natural-height rotation details", () => {
    expect(assistSource).toContain('className="assist-v15-aircraft-panel"');
    expect(assistSource).toContain('className="assist-v15-actions"');
    expect(assistSource).toContain('className="assist-v15-rotation-panel"');
    expect(assistSource).toContain('className="assist-v15-release"');
    expect(assistSource).not.toContain("assist-v15-release-phone");
    expect(assistSource).toContain("assist-v15-current-pane");
    expect(assistSource).toContain("assist-v15-history-pane");
    expect(assistSource).toContain("BookingGroupAssignmentDialog");
  });

  it("allows the shared unavailable abort during boarding and off-block", () => {
    expect(assistSource).toContain(
      'assignedRotation && ["CALLED", "IN_FLIGHT"].includes(assignedRotation.status)',
    );
    expect(assistSource).toContain("disabled={!unavailableAllowed}");
    expect(flightLineSource).toContain("ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE");
  });
});
