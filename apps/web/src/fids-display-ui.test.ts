import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import routerSource from "./FeatureRouter.tsx?raw";
import eventScopedSource from "./features/auth/EventScopedApplication.tsx?raw";
import settingsSource from "./features/fids/FidsSettingsDialog.tsx?raw";
import liveDataSource from "./features/fids/live-fids-data-source.ts?raw";
import controllerSource from "./features/fids/useFidsExperience.ts?raw";
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
    expect(displaySource).toContain("BITTE ZUM GATE");
    expect(displaySource).toContain("ABGEFLOGEN");
    expect(displaySource).toContain("GELANDET");
    expect(displaySource).toContain("ABGESCHLOSSEN");
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

  it("uses one controlled presentation and experience for live and simulation", () => {
    expect(displaySource).toContain("export function FidsBoardPresentation");
    expect(displaySource).toContain("connectionLabel");
    expect(displaySource).toContain("connectionTone");
    expect(displaySource).toContain("simulationBanner");
    expect(displaySource).toContain("useFidsExperience({ dataSource, locationAdapter })");
    expect(displaySource).toContain("dataSource: FidsDataSource");
    expect(displaySource).toContain('data-fids-view={split ? "split" : "fixed"}');
    expect(displaySource).toContain("JETZT RELEVANT");
    expect(displaySource).toContain("WEITERE FLÜGE");
    expect(displaySource).toContain("<FidsSettingsDialog");
    expect(displaySource).toContain("onOpenSettings={() => fids.setSettingsOpen(true)}");
  });

  it("trusts server paging and keeps row-major double-column distribution", () => {
    expect(displaySource).not.toContain(".slice(0, visibleRows)");
    expect(displaySource).toContain("key={group.rowId}");
    expect(displaySource).toContain("index % 2 === 0");
    expect(displaySource).toContain("index % 2 === 1");
    expect(stylesSource).toContain("@media (min-width: 1280px)");
    expect(stylesSource).toContain('data-fids-layout="double"');
    expect(stylesSource).toContain("--fids-section-single-tracks");
    expect(stylesSource).toContain("--fids-section-double-tracks");
    expect(stylesSource).toContain("--fids-shared-row-height");
    expect(stylesSource).toContain(
      '.standard-fids[data-fids-mode="simulation"][data-fids-layout="double"]',
    );
    expect(stylesSource).toContain("minmax(0, 1.25fr)");
    expect(stylesSource).toContain("white-space: nowrap");
  });

  it("uses compact non-wrapping FIDS time windows and concise fallback copy", () => {
    expect(displaySource).toContain('variant: "compact"');
    expect(displaySource).toContain('.replace(" – ", "–")');
    expect(displaySource).not.toContain("maximumWidthMinutes");
    expect(displaySource).toContain("Heute nicht mehr");
    expect(displaySource).toContain("Rückkehr offen");
    expect(displaySource).toContain("Statusklärung");
    expect(displaySource).toContain("Aktualisierung");
    expect(displaySource).toContain("Keine passende Kapazität");
    expect(stylesSource).toMatch(/\.fids-window \{[\s\S]*?white-space: nowrap;/);
    expect(stylesSource).toMatch(/\.fids-window \{[\s\S]*?font-variant-numeric: tabular-nums;/);
  });

  it("keeps the settings dialog open until a confirmed save and exposes only approved choices", () => {
    const saveHandler = settingsSource.slice(
      settingsSource.indexOf("const save = async"),
      settingsSource.indexOf("const logout = async"),
    );
    expect(saveHandler.indexOf("await onSave(draft)")).toBeLessThan(
      saveHandler.indexOf("onClose();"),
    );
    for (const copy of [
      "Anzeigeplätze gesamt",
      "Oben reservierte Plätze",
      "Seitenwechsel unten",
      "Feste Seite",
      "Geteilte Ansicht",
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
    expect(liveDataSource).toContain("expectedVersion");
    expect(settingsSource).toContain("editablePreferences(preferences)");
    expect(settingsSource).not.toContain("useState<EditableFidsPreferences>(preferences)");
    expect(settingsSource).toContain("setError(null)");
    expect(settingsSource).toContain("fids-settings-scroll");
    expect(settingsSource).toContain("Abgeflogene Gruppen bleiben");
    expect(settingsSource).toContain("Administration → Veranstaltungsparameter");
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
    const refreshFlow = controllerSource.slice(
      controllerSource.indexOf("const refresh = useCallback"),
      controllerSource.indexOf("refreshRef.current = refresh"),
    );
    expect(refreshFlow).toContain("setBoard(nextBoard)");
    expect(refreshFlow).toContain("setError(");
    expect(refreshFlow).not.toContain("setBoard(null)");
    expect(liveDataSource).toContain("new WebSocket(");
    expect(liveDataSource).toContain("target.setInterval(refresh, 15_000)");
    expect(fidsViewSource).not.toMatch(/localStorage|gateId|\bgate\b/);
  });
});
