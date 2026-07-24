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
const viewSource = readFileSync(new URL("./ForecastSimulationView.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("./ScenarioEditor.tsx", import.meta.url), "utf8");
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
    const allSources = `${viewSource}\n${editorSource}\n${historySource}\n${fidsPopoutSource}\n${fidsProjectionSource}`;
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
    expect(fidsPopoutSource).toContain('window.open("", POPUP_NAME, POPUP_FEATURES)');
    expect(fidsPopoutSource).toContain("current.focus()");
    expect(fidsPopoutSource).toContain("createPortal(");
    expect(fidsPopoutSource).toContain("<FidsBoardPresentation");
    expect(fidsPopoutSource).toContain("POPUP_STYLE_PATHS");
    expect(fidsPopoutSource).toContain("/features/fids/fids-v12.css");
    expect(fidsPopoutSource).toContain('source.getAttribute("data-vite-dev-id")');
    expect(fidsPopoutSource).toContain('source.href.includes("/assets/ForecastSimulationView-")');
    expect(fidsPopoutSource).toContain('target.title = "Simuliertes FIDS · Rundflug-Leitstand"');
    expect(fidsPopoutSource).toContain('connectionLabel="LIVE-SIMULATION"');
    expect(fidsPopoutSource).toContain('simulationBanner="Nur Simulation – keine Betriebsdaten"');
    expect(fidsPopoutSource).toContain('footerNote="Virtuelle Zeit"');
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
    ]) {
      expect(viewSource).toContain(label);
    }
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
    expect(viewSource).toContain('schema: "rundflug-forecast-simulation/v4"');
    expect(editorSource).toContain("Admin-Planwert");
    expect(editorSource).toContain("Prognose-Labor");
    expect(viewSource).toContain("Baseline und Kandidat vergleichen");
    expect(viewSource).toContain("comparison-worker.ts");
    expect(viewSource).toContain("const worker = createComparisonWorker()");
    expect(viewSource).toContain(
      "const worker = comparisonWorkerRef.current ?? createComparisonWorker()",
    );
    expect(viewSource).toContain("SimulationHistoryDialog");
    expect(historySource).toContain("Alle Prognose-Snapshots");
    expect(historySource).toContain("GO TO GATE erfasst");
    expect(historySource).toContain("systemseitig · noch ohne Flugzeugbindung");
    expect(historySource).toContain("Prognosen vor Boarding gehören zur Fluggruppe");
    expect(historySource).toContain("Realisierte Umläufe");
    expect(historySource).toContain("Sperren und Rückkehrereignisse");
    expect(historySource).toContain("Gruppe öffnen");
    expect(viewSource).toContain("Aktueller Prognose-Snapshot");
    expect(viewSource).toContain("Unterdrückungsgründe");
    expect(viewSource).toContain("Rohwerte nicht als operative Zeit freigegeben");
    expect(stylesSource).toContain(".sim-raw-forecast");
  });

  it("keeps narrow layouts inside an internal scroll container", () => {
    expect(stylesSource).toContain(".sim-layout");
    expect(stylesSource).toContain("overflow-x: auto");
    expect(stylesSource).toContain(".sim-workspace");
    expect(stylesSource).toContain("overflow: auto");
  });

  it("removes deprecated precall controls while preserving their legacy payload values", () => {
    for (const label of [
      'label="Voraufruf (Min.)"',
      'label="Maximale Gate-Wartezeit (Min.)"',
      'label="Minimale Prognosequalität"',
      'label="Gate-Sperrzeit (Min.)"',
    ]) {
      expect(adminSource).not.toContain(label);
    }
    for (const legacyValue of [
      "precallLeadMinutes,",
      "maximumGateWaitMinutes,",
      "precallMinimumQuality,",
      "precallGateCooldownMinutes,",
    ]) {
      expect(adminSource).toContain(legacyValue);
    }
    expect(adminSource).toContain("Gruppen automatisch zum Gate voraufrufen");
  });
});
