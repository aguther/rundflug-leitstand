import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import header from "../../app/AppHeader.tsx?raw";
import installMetadata from "../../app/install-metadata.ts?raw";
import brand from "../../design-system/BrandMark.tsx?raw";
import groupStatus from "../../group-status-view.tsx?raw";
import ticketStatus from "../../ticket-status-view.tsx?raw";
import content from "./PublicStatusContent.tsx?raw";
import pushHook from "./use-public-push.ts?raw";
import manifestHook from "./use-public-status-manifest.ts?raw";

const styles = readFileSync(new URL("./public-status-v18.css", import.meta.url), "utf8");

describe("mobiler öffentlicher Status V1.8", () => {
  it("zeigt Veranstaltungslogo und -titel unverlinkt im öffentlichen Header", () => {
    expect(header).toContain("publicEvent?.eventName");
    expect(header).toContain("internalOperationalView || publicView");
    expect(header).toContain('<div className="app-brand">');
    expect(header).toContain("<ThemeToggle binary />");
    expect(brand).toContain("eventId: explicitEventId");
    expect(styles).toContain("width: 56px");
    expect(styles).toContain("border: 0");
  });

  it("verwendet denselben kompakten Statusblock für Ticket und Gruppe", () => {
    expect(ticketStatus).toContain("<PublicStatusPart");
    expect(ticketStatus).toContain("part={status}");
    expect(ticketStatus).toContain("pauseReason={status.operationalNotice}");
    expect(groupStatus).toContain("<PublicStatusPart");
    expect(content).toContain("PUBLIC_STATUS_PRESENTATIONS[part.status]");
    expect(content).toContain("Teilflug {partNumber} von {partCount}");
    expect(content).toContain("{passengerCount} Person");
    expect(ticketStatus).not.toContain("<code>");
    expect(content).not.toContain("Position in der Warteschlange");
  });

  it("hält Status, Gate und Zeitfenster einzeilig in gleich breiten Feldern", () => {
    expect(content).toContain("function AutoFitText");
    expect(content).toContain("<AutoFitText>{presentation.label}</AutoFitText>");
    expect(content).toContain("<AutoFitText>{gateLabel}</AutoFitText>");
    expect(content).toContain("<AutoFitText>{windowLabel}</AutoFitText>");
    expect(content).toContain("requiredWidth > availableWidth");
    expect(styles).toMatch(/\.public-fit-text \{[\s\S]*?white-space: nowrap;/);
    expect(styles).toMatch(
      /\.public-status-details \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(styles).toMatch(/\.public-status-details dt \{[\s\S]*?white-space: nowrap;/);
    expect(styles).toMatch(/\.public-status-details dd \{[\s\S]*?white-space: nowrap;/);
  });

  it("bindet das exakte dynamische Manifest und führt iPhone-Browsernutzer", () => {
    expect(installMetadata).toContain(["/api/public/pwa-manifest/", "{target}/"].join("$"));
    expect(installMetadata).toContain("/icons/ticket-icon-180.png");
    expect(manifestHook).toContain("bookingGroupLabel");
    expect(pushHook).toContain(
      "Auf dem iPhone: Zum Home-Bildschirm hinzufügen, dann Benachrichtigungen aktivieren.",
    );
    expect(pushHook).toContain("(display-mode: standalone)");
  });

  it("öffnet den kleinen Datenschutzhinweis als schließbaren Dialog", () => {
    expect(content).toContain('className="public-privacy-link"');
    expect(content).toMatch(/className="public-privacy-link"[\s\S]*Datenschutz[\s\S]*<\/button>/);
    expect(content).toContain("<ModalDialog");
    expect(content).toContain('closeLabel="Datenschutz schließen"');
    expect(content).toContain("keine Namen, Telefonnummern");
    expect(content).not.toContain('href="/datenschutz"');
    expect(content).not.toContain("Datenschutz &amp; Privatsphäre");
  });

  it("verwendet flache Hell-/Dunkel-Paletten, Safe Areas und Touchziele", () => {
    for (const token of ["#0b111b", "#121c2a", "#172435", "#f5f7fa", "#5ea3ff", "#39d98a"]) {
      expect(styles).toContain(token);
    }
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).toContain("width: 44px");
    expect(styles).toContain("min-height: 44px");
    expect(styles).not.toContain("linear-gradient");
  });
});
