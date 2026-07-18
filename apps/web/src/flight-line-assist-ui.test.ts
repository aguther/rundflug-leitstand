import { describe, expect, it } from "vitest";
import routerSource from "./FeatureRouter.tsx?raw";
import assistSource from "./flight-line-assist.tsx?raw";
import flightLineSource from "./flight-line-view.tsx?raw";
import sharedSource from "./operation-workspace.tsx?raw";

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
    expect(assistSource).toContain("StateFlow");
    expect(assistSource).toContain("LifecycleFlow");
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
});
