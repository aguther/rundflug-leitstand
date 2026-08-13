import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../../main.tsx", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../../FeatureRouter.tsx", import.meta.url), "utf8");
const eventScopedSource = readFileSync(
  new URL("../auth/EventScopedApplication.tsx", import.meta.url),
  "utf8",
);
const adminSource = readFileSync(new URL("../../admin-view.tsx", import.meta.url), "utf8");
const eventParametersSource = readFileSync(
  new URL("../admin/event-parameters/EventParametersWorkspace.tsx", import.meta.url),
  "utf8",
);
const eventParametersFormSource = readFileSync(
  new URL("../admin/event-parameters/useEventParametersForm.ts", import.meta.url),
  "utf8",
);
const adminParameterSource = `${adminSource}\n${eventParametersSource}\n${eventParametersFormSource}`;
const viewSource = readFileSync(new URL("./ForecastSimulationView.tsx", import.meta.url), "utf8");
const comparisonSource = readFileSync(
  new URL("./useSimulationComparison.ts", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(new URL("./ScenarioEditor.tsx", import.meta.url), "utf8");
const planEditorSource = readFileSync(
  new URL("./SimulationPlanEditor.tsx", import.meta.url),
  "utf8",
);
const planImportSource = readFileSync(
  new URL("./simulation-plan-import.ts", import.meta.url),
  "utf8",
);
const foundationDialogSource = readFileSync(
  new URL("./SimulationFoundationDialog.tsx", import.meta.url),
  "utf8",
);
const timelineSource = readFileSync(new URL("./ForecastTimeline.tsx", import.meta.url), "utf8");
const recurringRulesSource = readFileSync(
  new URL("./SimulationRecurringRulesEditor.tsx", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("./SimulationHistoryDialog.tsx", import.meta.url),
  "utf8",
);
const fidsPopoutSource = readFileSync(
  new URL("./SimulationFidsPopout.tsx", import.meta.url),
  "utf8",
);
const fidsProjectionSource = readFileSync(new URL("./simulation-fids.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("./forecast-simulation.css", import.meta.url), "utf8");
const viteConfigSource = readFileSync(new URL("../../../vite.config.ts", import.meta.url), "utf8");
const webPackage = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

describe("local and hosted forecast simulation surface", () => {
  it("keeps local mode standalone while routing hosted use through ADMIN authentication", () => {
    expect(appSource).toContain('import.meta.env.MODE === "simulator"');
    expect(appSource).toContain('window.location.pathname === "/simulation"');
    expect(appSource.indexOf('import.meta.env.MODE === "simulator"')).toBeLessThan(
      appSource.indexOf("<AuthProvider>"),
    );
    expect(mainSource).toContain('import.meta.env.MODE !== "simulator"');
    expect(webPackage.scripts.simulator).toContain("--mode simulator");
    expect(webPackage.scripts.simulator).toContain("--host 127.0.0.1");
    expect(routerSource).toContain(
      'import("./features/forecast-simulation/ForecastSimulationView")',
    );
    expect(routerSource).toContain('path === "/simulation"');
    expect(eventScopedSource).toContain("mayOpenEventRoute");
    expect(viteConfigSource).not.toContain("disabled.tsx");
    expect(viteConfigSource).toContain("plugins: simulator ? [react()]");
    expect(viteConfigSource).toContain('find: "virtual:pwa-register"');
    expect(viteConfigSource).toContain("pwa-register-disabled.ts");
    expect(viteConfigSource).toContain("proxy: simulator");
    expect(viteConfigSource).toContain("globIgnores");
    expect(viteConfigSource).toContain("ForecastSimulationView-*.js");
    expect(viteConfigSource).toContain("ForecastSimulationView-*.css");
    expect(viteConfigSource).toContain("comparison-worker-*.js");
    expect(viewSource).toContain('href="/admin?area=evaluation"');
    expect(viewSource).toContain('import.meta.env.MODE !== "simulator"');
  });

  it("contains no browser network or persistence call in the simulator feature", () => {
    const allSources = `${viewSource}\n${editorSource}\n${planEditorSource}\n${planImportSource}\n${foundationDialogSource}\n${recurringRulesSource}\n${historySource}\n${fidsPopoutSource}\n${fidsProjectionSource}`;
    expect(allSources).not.toMatch(/\bfetch\s*\(/);
    expect(allSources).not.toMatch(/\bWebSocket\b/);
    expect(allSources).not.toMatch(
      /localStorage|sessionStorage|indexedDB|caches\.|serviceWorker|BroadcastChannel|\/api\/|\bD1\b|DurableObject|\bKV\b|\bR2\b/,
    );
  });

  it("opens one local live FIDS pop-out and keeps production settings out of it", () => {
    expect(viewSource).toContain("FIDS öffnen");
    expect(viewSource).toContain("<Monitor");
    expect(viewSource).toContain("fidsPopoutRef.current?.open()");
    expect(fidsPopoutSource).toContain("window.open(POPUP_PATH, POPUP_NAME, POPUP_FEATURES)");
    expect(fidsPopoutSource).toContain('popup.addEventListener("load", connect, { once: true })');
    expect(fidsPopoutSource).toContain("current.focus()");
    expect(fidsPopoutSource).toContain("createPortal(");
    expect(fidsPopoutSource).toContain("<FidsDisplay");
    expect(fidsPopoutSource).toContain("createSimulationFidsDataSource");
    expect(fidsPopoutSource).toContain("createFidsLocationAdapter");
    expect(fidsPopoutSource).toContain("POPUP_STYLE_PATHS");
    expect(fidsPopoutSource).toContain('from "../fids/fids-v12.css?url"');
    expect(fidsPopoutSource).toContain("appendPresentationStylesheet(target, fidsStylesheetUrl)");
    expect(fidsPopoutSource.indexOf("copyPresentationHead(target)")).toBeLessThan(
      fidsPopoutSource.indexOf("appendPresentationStylesheet(target, fidsStylesheetUrl)"),
    );
    expect(fidsPopoutSource).toContain("source.dataset.viteDevId");
    expect(fidsPopoutSource).toContain('source.href.includes("/assets/ForecastSimulationView-")');
    expect(fidsPopoutSource).toContain('target.title = "Simuliertes FIDS · Rundflug-Leitstand"');
    expect(fidsPopoutSource).toContain('simulationBanner="Nur Simulation – keine Betriebsdaten"');
    expect(fidsPopoutSource).toContain("visibleRows: 20");
    expect(fidsPopoutSource).toContain('layout: "DOUBLE"');
    expect(fidsPopoutSource).toContain("simulationDepartedVisibilityMs(speed)");
    expect(viewSource).toContain("speed={speed}");
    expect(fidsPopoutSource).toContain("Das FIDS-Fenster wurde blockiert");
    expect(fidsPopoutSource).not.toContain("FidsSettingsDialog");
    expect(fidsPopoutSource).not.toContain("onOpenSettings");
  });

  it("exposes playback, incident injection, calibration, export and every configurable distribution", () => {
    for (const label of [
      "Virtuelle Zeit",
      "CSV importieren",
      "Ergebnis exportieren",
      "Flugzeugausfall",
      "Betrieb unterbrechen",
      "Boarding",
      "Start",
      "Landung",
      "Abschluss",
      "Lauf auswerten",
      "Simulationsgrundlage laden",
      "Variante exportieren",
      "Duplizieren",
    ]) {
      expect(viewSource).toContain(label);
    }
    expect(foundationDialogSource).toContain("Als neue Variante laden");
    for (const label of [
      "Boarding",
      "Flug",
      "Deboarding",
      "Puffer",
      "Tanken",
      "Geplante Pause",
      "Ungeplante Pause",
      "Technischer Defekt",
      "Tagesausfall",
      "Automatischer Voraufruf",
    ]) {
      expect(editorSource).toContain(label);
    }
    expect(viewSource).toContain(
      "createSimulationExport(result, manualIncidents, comparison.result)",
    );
    expect(viewSource).toContain("SIMULATION_DEMAND_PROFILE_LABELS");
    expect(viewSource).not.toContain('id="sim-demand"');
    for (const label of [
      "Tageszeiten",
      "Verkauf",
      "Flugbetrieb",
      "Nachfrageprofil",
      "Flugbetrieb startet",
      "Zeitfenster hinzufügen",
      "Erwartungswert",
    ]) {
      expect(editorSource).toContain(label);
    }
    expect(editorSource).toContain("Admin-Planwert");
    expect(editorSource).toContain("Prognose-Labor");
    expect(viewSource).toContain("Baseline und Kandidat vergleichen");
    expect(comparisonSource).toContain("comparison-worker.ts");
    expect(comparisonSource).toContain("const worker = createComparisonWorker()");
    expect(comparisonSource).toContain(
      "const worker = workerRef.current ?? createComparisonWorker()",
    );
    expect(viewSource).toContain("SimulationHistoryDialog");
    expect(historySource).toContain("Alle Prognose-Snapshots");
    expect(historySource).toContain("GO TO GATE erfasst");
    expect(historySource).toContain("systemseitig · noch ohne Flugzeugbindung");
    expect(historySource).toContain("Prognosen vor Boarding gehören zur Fluggruppe");
    expect(historySource).toContain("Realisierte Umläufe");
    expect(historySource).toContain("Sperren und Rückkehrereignisse");
    expect(historySource).toContain("Gruppe öffnen");
    expect(historySource).toContain("Werte mit Maus anzeigen");
    expect(historySource).toContain("Snapshot {formatTime(activeSnapshot.capturedAt)}");
    expect(viewSource).toContain("Boarding-Prognose");
    expect(viewSource).toContain(".sort((left, right) => left.at - right.at)");
    expect(viewSource).toContain("Aktueller Prognose-Snapshot");
    expect(viewSource).toContain("Unterdrückungsgründe");
    expect(viewSource).toContain("Rohwerte nicht als operative Zeit freigegeben");
    expect(stylesSource).toContain(".sim-raw-forecast");
    expect(stylesSource).toContain(".sim-chart-tooltip");
    expect(stylesSource).toContain(".sim-interruption-bar");
    expect(planEditorSource).toContain("Geplante Unterbrechungen und Flugshows");
    expect(planEditorSource).not.toContain("Wiederkehrende Regeln");
    expect(recurringRulesSource).toContain("Zielbezogene Regeln");
    expect(recurringRulesSource).toContain("Bestätigter Fortschritt");
    expect(recurringRulesSource).toContain(
      "Eine zielbezogene Regel ersetzt für dieses Ziel den entsprechenden Standard.",
    );
    expect(editorSource).toContain("<h4>Wiederkehrend</h4>");
    expect(editorSource).toContain("<h4>Zufällig</h4>");
    expect(planEditorSource).toContain("Nach simuliertem Umlauf");
    expect(planImportSource).toContain("rundflug-master-data-template");
    expect(planImportSource).toContain("rundflug-simulation-scenario");
    expect(planImportSource).toContain("MAX_SIMULATION_PLAN_FILE_BYTES");
    expect(viewSource).not.toContain('id="sim-preset"');
    expect(viewSource).not.toContain("Szenario-Vorlagen");
    expect(foundationDialogSource).toContain('role="tablist"');
    expect(foundationDialogSource).toContain("Vorlage als JSON herunterladen");
    expect(foundationDialogSource).toContain("preview.config.operationalModel");
    expect(viewSource).toContain("createSimulationScenarioTemplate(selectedVariant.name, config)");
    expect(viewSource).toContain("simulationScenarioTemplateFileName(template.name)");
    expect(stylesSource).toMatch(
      /\.sim-variant-actions \.sim-variant-export\s*\{[^}]*grid-column:\s*1 \/ -1;/s,
    );
    expect(stylesSource).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.sim-plan-import-preview \.sim-scenario-import-summary\s*\{[^}]*grid-template-columns:\s*1fr;/s,
    );
  });

  it("keeps the viewport fixed and only the aircraft lanes vertically scrollable", () => {
    expect(stylesSource).toContain(".sim-layout");
    expect(stylesSource).toContain("overflow-x: auto");
    expect(stylesSource).toMatch(
      /\.sim-workspace\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto auto;[^}]*overflow-y:\s*hidden;/s,
    );
    expect(stylesSource).toMatch(
      /\.sim-timeline-panel\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto auto;[^}]*overflow:\s*hidden;/s,
    );
    expect(stylesSource).toMatch(
      /\.sim-timeline-lanes\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-gutter:\s*stable;/s,
    );
    expect(stylesSource).toMatch(
      /\.sim-injector\s*\{[^}]*align-items:\s*flex-end;[^}]*justify-content:\s*flex-end;/s,
    );
    expect(stylesSource).toMatch(/\.sim-export-row\s*\{[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*8px;/s);
    expect(timelineSource).toContain('aria-label="Tagesplan und Flugzeuge"');
    expect(timelineSource).toContain('<section\n        aria-label="Tagesplan und Flugzeuge"');
    expect(timelineSource).toContain("onKeyDown={scrollTimelineWithKeyboard}");
    expect(timelineSource).toContain("tabIndex={0}");
    expect(stylesSource).toContain(".forecast-simulator .ds-sidepanel");
    expect(stylesSource).toContain("width: min(760px, 100%)");
    expect(stylesSource).not.toContain(".ds-sidepanel:has(");
  });

  it("removes deprecated precall controls while preserving their legacy payload values", () => {
    for (const label of [
      'label="Voraufruf (Min.)"',
      'label="Maximale Gate-Wartezeit (Min.)"',
      'label="Minimale Prognosequalität"',
      'label="Gate-Sperrzeit (Min.)"',
    ]) {
      expect(adminParameterSource).not.toContain(label);
    }
    for (const legacyValue of [
      "precallLeadMinutes,",
      "maximumGateWaitMinutes,",
      "precallMinimumQuality,",
      "precallGateCooldownMinutes,",
    ]) {
      expect(adminParameterSource).toContain(legacyValue);
    }
    expect(adminParameterSource).toContain("Gruppen automatisch zum Gate voraufrufen");
  });
});
