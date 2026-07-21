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
    expect(assistSource).toContain("Buchungsgruppen auswählen & kombinieren");
    expect(assistSource).toContain("Tanken");
    expect(assistSource).toContain("Pause");
    expect(assistSource).toContain("Nicht verfügbar");
    expect(assistSource).toContain("Flugzeug freigeben");
    expect(assistSource).toContain("FlightProgress");
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
    expect(assistSource).toContain("Anwesend");
    expect(assistSource).toContain("Nicht da");
    expect(assistSource).toContain("Nachrufen");
    expect(assistSource).toContain("Zurückstellen");
    expect(assistSource).toContain("Anwesenheit aufheben");
  });

  it("shows only anonymous operational identifiers and counts", () => {
    expect(assistSource).toContain("communicationLabel");
    expect(assistSource).toContain("ticketCount");
    expect(assistSource).not.toMatch(/guestName|phoneNumber|payment/i);
  });

  it("renews and releases the anonymous server claim", () => {
    expect(assistSource).toContain("board.assistClaims");
    expect(assistSource).toContain("25_000");
    expect(assistSource).toContain("await onClaim(entry.id)");
    expect(assistSource).toContain("await onRelease(claimedAircraftId)");
  });

  it("renders exclusive selection and work modes and clears state on release or claim loss", () => {
    expect(assistSource).toContain("if (!activeAircraft)");
    expect(assistSource).toContain("is-selection-mode");
    expect(assistSource).toContain("is-work-mode");
    expect(assistSource).toContain("serverClaimSeen");
    expect(assistSource).toContain("Die Flugzeugübernahme ist abgelaufen oder wurde aufgehoben");
    expect(assistSource).toContain("onClaimUnavailable");
    expect(assistSource).not.toContain("assist-v15-workspace");
    expect(flightLineSource).toContain("setSelectedAircraftId(null)");
    expect(flightLineSource).toContain("setSelectedQueueGroupIds([])");
    expect(flightLineSource).toContain("claimedAssistAircraftId");
  });

  it("uses stable grids and inline phone actions without overlay positioning", () => {
    expect(assistStyles).toContain("grid-template-columns: 40px minmax(0, 1fr)");
    expect(assistStyles).toContain("min-height: 150px");
    expect(assistStyles).toContain("grid-column: 1 / -1");
    expect(assistStyles).not.toContain("position: absolute");
    expect(assistStyles).not.toContain("minmax(620px");
  });
});
