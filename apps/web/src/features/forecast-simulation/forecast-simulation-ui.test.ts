import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../../main.tsx", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("./ForecastSimulationView.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("./ScenarioEditor.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("./forecast-simulation.css", import.meta.url), "utf8");
const viteConfigSource = readFileSync(new URL("../../../vite.config.ts", import.meta.url), "utf8");
const webPackage = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

describe("local-only forecast simulation surface", () => {
  it("gates the lazy simulation route behind Vite simulator mode before authentication", () => {
    expect(appSource).toContain('import.meta.env.MODE === "simulator"');
    expect(appSource).toContain('window.location.pathname === "/simulation"');
    expect(appSource.indexOf('import.meta.env.MODE === "simulator"')).toBeLessThan(
      appSource.indexOf("<AuthProvider>"),
    );
    expect(mainSource).toContain('import.meta.env.MODE !== "simulator"');
    expect(webPackage.scripts.simulator).toContain("--mode simulator");
    expect(webPackage.scripts.simulator).toContain("--host 127.0.0.1");
    expect(viteConfigSource).toContain("disabled.tsx");
    expect(viteConfigSource).toContain("plugins: simulator ? [react()]");
    expect(viteConfigSource).toContain("proxy: simulator");
  });

  it("contains no browser network or persistence call in the simulator feature", () => {
    const allSources = `${viewSource}\n${editorSource}`;
    expect(allSources).not.toMatch(/\bfetch\s*\(/);
    expect(allSources).not.toMatch(/\bWebSocket\b/);
    expect(allSources).not.toMatch(/localStorage|sessionStorage|\/api\//);
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
    ]) {
      expect(editorSource).toContain(label);
    }
  });

  it("keeps narrow layouts inside an internal scroll container", () => {
    expect(stylesSource).toContain(".sim-layout");
    expect(stylesSource).toContain("overflow-x: auto");
    expect(stylesSource).toContain(".sim-workspace");
    expect(stylesSource).toContain("overflow: auto");
  });
});
