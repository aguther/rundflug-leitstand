import {
  type SimulationScenarioTemplateV2,
  simulationScenarioVersionTwoTemplateSchema,
} from "@rundflug/contracts";

import type { SimulationConfig } from "./model";

export function createSimulationScenarioTemplate(
  name: string,
  config: SimulationConfig,
  exportedAt = new Date().toISOString(),
): SimulationScenarioTemplateV2 {
  const normalizedName = name.trim().slice(0, 80) || "Unbenannte Variante";
  const template = {
    format: "rundflug-simulation-scenario",
    formatVersion: 2,
    exportedAt,
    name: normalizedName,
    config: {
      preset: config.preset,
      seed: config.seed,
      schedule: structuredClone(config.schedule),
      adminParameters: structuredClone(config.adminParameters),
      realityModel: structuredClone(config.realityModel),
      forecastTuning: structuredClone(config.forecastTuning),
      ...(config.operationalModel
        ? { operationalModel: structuredClone(config.operationalModel) }
        : {}),
      ...(config.demandByProduct
        ? { demandByProduct: structuredClone(config.demandByProduct) }
        : {}),
      plannedOperations: structuredClone(config.plannedOperations),
      recurringRules: structuredClone(config.recurringRules ?? []),
    },
  };
  return simulationScenarioVersionTwoTemplateSchema.parse(template);
}

export function simulationScenarioTemplateFileName(name: string): string {
  const normalizedName = name.trim() || "Unbenannte Variante";
  const slug = normalizedName
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `rundflug-szenario-${slug || "unbenannte-variante"}.json`;
}
