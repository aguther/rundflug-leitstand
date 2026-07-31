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
    expect(displaySource).toContain("<BrandMark theme={logoTheme} />");
    expect(displaySource).toContain('preferences.theme === "SYSTEM"');
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
      /\.standard-fids \.standard-mark > \.brand-mark\.fallback-mark \{[\s\S]*?color: var\(--brand-ink\);/,
    );
  });

  it("keeps the production wrapper while exposing a controlled presentation for simulation", () => {
    expect(displaySource).toContain("export function FidsBoardPresentation");
    expect(displaySource).toContain("connectionLabel");
    expect(displaySource).toContain("connectionTone");
    expect(displaySource).toContain("simulationBanner");
    expect(displaySource).toContain("footerNote");
    expect(displaySource).toContain("showFooter = true");
    expect(displaySource).toContain('data-fids-footer={showFooter ? "visible" : "hidden"}');
    expect(stylesSource).toContain(
      '.standard-fids[data-fids-mode="simulation"][data-fids-footer="hidden"]',
    );
    expect(displaySource).toContain("filterDeparted = true");
    expect(displaySource).toContain("<FidsSettingsDialog");
    expect(displaySource).toContain("onOpenSettings={() => setSettingsOpen(true)}");
  });

  it("applies the exact row limit and row-major double-column distribution", () => {
    expect(displaySource).toContain(".slice(0, visibleRows)");
    expect(displaySource).toContain("index % 2 === 0");
    expect(displaySource).toContain("index % 2 === 1");
    expect(stylesSource).toContain("@media (min-width: 1280px)");
    expect(stylesSource).toContain('data-fids-layout="double"');
    expect(stylesSource).toContain("repeat(var(--fids-single-rows)");
    expect(stylesSource).toContain("repeat(var(--fids-double-rows)");
    expect(stylesSource).toContain(
      '.standard-fids[data-fids-mode="simulation"][data-fids-layout="double"]',
    );
    expect(stylesSource).toContain("minmax(0, 1.25fr)");
    expect(stylesSource).toContain("white-space: nowrap");
  });

  it("omits the redundant clock suffix from FIDS time windows", () => {
    expect(displaySource).toContain("includeClockSuffix: false");
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

  it("uses the approved unframed status symbols and keeps passive information neutral", () => {
    expect(displaySource).toContain("CircleArrowRight");
    expect(displaySource).toContain("TicketsPlane");
    expect(displaySource).toContain("PlaneTakeoff");
    expect(displaySource).toContain('return { label: "WARTEN", tone: "standby", icon: Clock3 }');
    expect(displaySource).toContain('<Users aria-hidden="true" />');
    expect(displaySource).toContain('<Icon aria-hidden="true" className="fids-status-icon" />');
    expect(displaySource).toContain('data-recall-active={group.activeRecall ? "true" : "false"}');
    expect(displaySource).toContain("<span>NACHRUF</span>");
    expect(stylesSource).toContain("@keyframes fids-primary-status-swap");
    expect(stylesSource).toContain("@keyframes fids-recall-status-swap");
    expect(stylesSource).not.toContain("step-end");
    expect(stylesSource).toContain("--fids-status-font-size: 1.04em");
    expect(stylesSource).not.toMatch(/\.fids-status-icon \{[^}]*border:/);
    expect(stylesSource).toMatch(/\.tone-standby \{\s*color: var\(--fids-text\);/);
    expect(stylesSource).toMatch(
      /\.standard-fids \.fids-footer-copy > i \{[\s\S]*?background: var\(--fids-muted\);/,
    );
  });

  it("keeps recall outlines complete in single and double column positions", () => {
    expect(stylesSource).toMatch(
      /\.fids-row\[data-recall-active="true"\] \{\s*box-shadow: inset 0 0 0 /,
    );
    expect(stylesSource).not.toMatch(/\.fids-row\[data-recall-active="true"\][^{]*:last-child/);
    expect(stylesSource).toContain("border-bottom: 0");
    expect(stylesSource).toContain(".fids-row:last-child");
    expect(stylesSource).toContain("@media (min-width: 1280px)");
    expect(stylesSource).toContain('data-fids-layout="double"');
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
