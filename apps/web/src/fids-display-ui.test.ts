import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import routerSource from "./FeatureRouter.tsx?raw";
import eventScopedSource from "./features/auth/EventScopedApplication.tsx?raw";
import settingsSource from "./features/fids/FidsSettingsDialog.tsx?raw";
import displaySource from "./fids-display.tsx?raw";
import fidsViewSource from "./fids-view.tsx?raw";

const stylesSource = readFileSync(new URL("./features/fids/fids-v12.css", import.meta.url), "utf8");

describe("FIDS V1.7.3 UI", () => {
  it("protects the FIDS application and normalizes obsolete terminal links", () => {
    expect(
      appSource.slice(
        appSource.indexOf("function isPublicRoute"),
        appSource.indexOf("function AuthenticatedApplication"),
      ),
    ).not.toContain("/fids");
    expect(routerSource).toContain('path === "/fids"');
    expect(routerSource).not.toContain('path === "/fids/terminal"');
    expect(eventScopedSource).toContain('window.location.pathname === "/fids/terminal"');
    expect(eventScopedSource).toContain('normalized.pathname = "/fids"');
    expect(eventScopedSource).toContain('normalized.searchParams.delete("style")');
  });

  it("uses the event name, unframed full-size mark and only the standard German board", () => {
    expect(displaySource).toContain("board?.eventName");
    expect(displaySource).toContain("<BrandMark />");
    expect(displaySource).toContain(
      "formatBookingGroupLabel(group.productCode, group.communicationNumber)",
    );
    expect(displaySource).toContain("GO TO GATE");
    expect(displaySource).toContain("Bitte QR-Ticket bereithalten");
    expect(displaySource).not.toMatch(/terminalStatus|DEPARTURES|ThemeToggle/);
    expect(displaySource).not.toContain("formatFlightGroupLabel");
    expect(stylesSource).toContain(".standard-mark > .brand-mark");
    expect(stylesSource).toMatch(
      /\.standard-mark > \.brand-mark \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/,
    );
    expect(stylesSource).toMatch(
      /\.standard-mark \{[\s\S]*?overflow: visible;[\s\S]*?border: 0;[\s\S]*?border-radius: 0;/,
    );
    expect(stylesSource).toMatch(
      /\.standard-fids \.standard-mark > \.brand-mark\.plane-mark \{[\s\S]*?color: var\(--fids-ui-accent\);[\s\S]*?stroke-width: 1\.35;/,
    );
  });

  it("applies the exact row limit and row-major double-column distribution", () => {
    expect(displaySource).toContain(".slice(0, visibleRows)");
    expect(displaySource).toContain("index % 2 === 0");
    expect(displaySource).toContain("index % 2 === 1");
    expect(stylesSource).toContain("@media (min-width: 1280px)");
    expect(stylesSource).toContain('data-fids-layout="double"');
    expect(stylesSource).toContain("repeat(var(--fids-single-rows)");
    expect(stylesSource).toContain("repeat(var(--fids-double-rows)");
  });

  it("keeps the settings dialog open until a confirmed save and exposes only approved choices", () => {
    const saveHandler = settingsSource.slice(
      settingsSource.indexOf("const save = async"),
      settingsSource.indexOf("return ("),
    );
    expect(saveHandler.indexOf("await onSave(draft)")).toBeLessThan(
      saveHandler.indexOf("onClose();"),
    );
    for (const copy of [
      "Angezeigte Zeilen",
      "Eine Spalte",
      "Zwei Spalten",
      "System",
      "Hell",
      "Dunkel",
      "Abmelden",
      "Abbrechen",
      "Speichern",
    ]) {
      expect(settingsSource).toContain(copy);
    }
    expect(fidsViewSource).toContain("expectedVersion: preferences.version");
    expect(settingsSource).toContain("editablePreferences(preferences)");
    expect(settingsSource).toContain("visibleRows: preferences.visibleRows");
    expect(settingsSource).not.toContain("useState<EditableFidsPreferences>(preferences)");
    expect(settingsSource).toContain("if (open) setError(null)");
  });

  it("binds the shell to 100dvh without document or table scrolling", () => {
    expect(stylesSource).toContain("height: 100dvh");
    expect(stylesSource).toContain("overflow: hidden");
    expect(stylesSource).toContain("width: 44px");
    expect(stylesSource).toContain("height: 44px");
  });

  it("keeps table symbols at text height and uses the application accent for controls", () => {
    expect(stylesSource).toMatch(
      /\.fids-group-cell > svg \{[\s\S]*?width: 1em;[\s\S]*?height: 1em;/,
    );
    expect(stylesSource).toMatch(/\.fids-status-icon \{[\s\S]*?width: 1em;[\s\S]*?height: 1em;/);
    expect(stylesSource).toContain("--fids-ui-accent: #2f8af5");
    expect(stylesSource).toMatch(
      /\.standard-fids \.fids-settings-actions \.ds-button--primary \{[\s\S]*?background: var\(--fids-ui-accent\);/,
    );
  });

  it("renders no personal, private-ticket or session data", () => {
    expect(displaySource).not.toMatch(
      /guestName|phoneNumber|publicCode|ticketLabels|sessionId|operatorAccountId/i,
    );
  });

  it("keeps the last confirmed board during reconnect and polling failures", () => {
    const refreshFlow = fidsViewSource.slice(
      fidsViewSource.indexOf("const refresh = () =>"),
      fidsViewSource.indexOf("const connect = () =>"),
    );
    expect(refreshFlow).toContain("setBoard(nextBoard)");
    expect(refreshFlow).toContain("setError(");
    expect(refreshFlow).not.toContain("setBoard(null)");
    expect(fidsViewSource).toContain("new WebSocket(");
    expect(fidsViewSource).toContain("window.setInterval(refresh, 15_000)");
  });
});
