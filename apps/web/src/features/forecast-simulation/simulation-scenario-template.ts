import type { SimulationScenarioTemplate } from "@rundflug/contracts";

import type { SimulationConfig } from "./model";

export function createSimulationScenarioTemplate(
  name: string,
  config: SimulationConfig,
  exportedAt = new Date().toISOString(),
): SimulationScenarioTemplate {
  return {
    format: "rundflug-simulation-scenario",
    formatVersion: 1,
    exportedAt,
    name,
    config: {
      preset: config.preset,
      seed: config.seed,
      schedule: structuredClone(config.schedule),
      adminParameters: structuredClone(config.adminParameters),
      realityModel: structuredClone(config.realityModel),
      forecastTuning: structuredClone(config.forecastTuning),
    },
  };
}

export function simulationScenarioTemplateFileName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `rundflug-szenario-${slug || "vorlage"}.json`;
}
