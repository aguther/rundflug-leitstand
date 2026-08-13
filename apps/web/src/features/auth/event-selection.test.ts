import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import headerSource from "../../app/AppHeader.tsx?raw";
import navigationSource from "../../app/navigation.ts?raw";
import appSource from "./EventScopedApplication.tsx?raw";
import selectionSource from "./EventSelectionPage.tsx?raw";

const loginStyles = readFileSync(new URL("./login.css", import.meta.url), "utf8");

describe("explicit event selection and display binding", () => {
  it("validates persisted context against the authenticated event catalog", () => {
    expect(appSource).toContain("loadSelectableEvents");
    expect(appSource).toContain("events?.find((entry) => entry.eventId === requestedEventId)");
    expect(appSource).toContain("<EventSelectionPage");
    expect(selectionSource).toContain("Veranstaltung auswählen");
    expect(selectionSource).toContain("Veranstaltung öffnen");
  });

  it("keeps the current event visible and makes switching explicit", () => {
    expect(headerSource).toContain("activeEventLabel");
    expect(headerSource).toContain('title="Veranstaltung wechseln"');
    expect(headerSource.match(/onClick=\{switchActiveEvent\}/g)).toHaveLength(2);
  });

  it("normalizes a validated deep link outside the render phase", () => {
    expect(appSource).toContain("eventSelectionLocation(window.location.href)");
    expect(appSource).toContain("setActivatedEventId(selectedEventId)");
    expect(appSource).toContain("activatedEventId !== selectedEvent.eventId");
  });

  it("does not require administrators to pair a public display", () => {
    expect(navigationSource).toContain('href: "/fids"');
  });

  it("redirects the standard address to the explicit home for the signed-in role", () => {
    expect(appSource).toContain('window.location.pathname === "/"');
    expect(appSource).toContain("window.location.replace(homeForRole(session.account.role))");
  });

  it("keeps long event labels inside the responsive selection panel", () => {
    expect(loginStyles).toContain(".access-page-panel {");
    expect(loginStyles).toContain(".event-selection-page .access-page-panel {");
    expect(loginStyles).toContain("width: min(42rem, calc(100% - 32px));");
    expect(loginStyles).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(loginStyles).toContain(".event-selection-page .access-page-submit {");
    expect(loginStyles).toContain("text-overflow: ellipsis;");
  });
});
