import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import routerSource from "./FeatureRouter.tsx?raw";
import assistSource from "./flight-line-assist.tsx?raw";
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

  it("keeps the aircraft primary and exposes short operational actions", () => {
    expect(assistSource).toContain("Flugzeug übernehmen");
    expect(assistSource).toContain("Übernehmen");
    expect(assistSource).toContain("Buchungsgruppen auswählen & kombinieren");
    expect(assistSource).toContain("Tanken");
    expect(assistSource).toContain("Pause");
    expect(assistSource).toContain("Nicht verfügbar");
    expect(assistSource).toContain("Flugzeug freigeben");
    expect(assistSource).toContain("LifecycleFlow");
    expect(assistSource).toContain('action?.command === "COMPLETE_TURNAROUND"');
    expect(assistSource).toContain("Zustand nach Abschluss");
    expect(assistSource).toContain("AircraftPickerMeta");
    expect(assistSource).toContain("assist-v15-operational-state");
    expect(assistStyles).toContain(".assist-v15-picker-meta");
    expect(assistStyles).toContain("display: grid");
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

  it("gates operational context behind the device claim and clears it on release", () => {
    expect(assistSource).toContain("const activeAircraft = claimedAircraft");
    expect(assistSource).toContain("const listedAircraft = availableAircraft");
    expect(assistSource).toContain("Betreutes und weitere verfügbare Flugzeuge");
    expect(assistStyles).not.toContain("has-claim .assist-v15-picker");
    expect(assistSource).toContain("{claimedAircraft ? (");
    expect(flightLineSource).toContain("setSelectedAircraftId(null)");
    expect(flightLineSource).toContain("setSelectedQueueGroupIds([])");
  });

  it("uses stable grids and inline phone actions without overlay positioning", () => {
    expect(assistStyles).toContain("grid-template-columns: 36px minmax(0, 1fr)");
    expect(assistStyles).toContain("height: 150px");
    expect(assistStyles).toContain("grid-column: 1 / -1");
    expect(assistStyles).not.toContain("position: absolute");
    expect(assistStyles).not.toContain("minmax(620px");
  });
});
