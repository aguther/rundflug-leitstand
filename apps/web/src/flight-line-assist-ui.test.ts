import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import assistSource from "./flight-line-assist.tsx?raw";

describe("Flight Line Assist", () => {
  it("is directly addressable as a separate tablet and phone surface", () => {
    expect(appSource).toContain('window.location.pathname === "/flight-line/assist"');
    expect(appSource).toContain('path === "/flight-line/assist"');
    expect(appSource).toContain("<FlightLineAssist");
    expect(assistSource).toContain('className="flight-assist"');
  });

  it("keeps the aircraft primary and exposes short operational actions", () => {
    expect(assistSource).toContain("Jetzt betreuen");
    expect(assistSource).toContain("Übernehmen");
    expect(assistSource).toContain("Nächste Aktion wählen");
    expect(assistSource).toContain("Tanken");
    expect(assistSource).toContain("Pause");
    expect(assistSource).toContain("Nicht verfügbar");
    expect(assistSource).toContain("Betreuung abschließen");
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
