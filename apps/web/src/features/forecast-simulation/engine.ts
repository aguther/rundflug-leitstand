import type { ManualIncident, SimulationConfig, SimulationResult } from "./model";
import { validateSimulationConfig } from "./model";
import { runOperationalSimulation } from "./operational-engine";
import { calculateSimulationMetrics } from "./simulation-metrics";
import {
  syntheticPresetIncidents,
  withSyntheticOperationalModel,
} from "./synthetic-operational-model";

export { calculateSimulationMetrics } from "./simulation-metrics";
export { sampleTriangular } from "./simulation-primitives";

export function runSimulation(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[] = [],
): SimulationResult {
  const validationErrors = validateSimulationConfig(config);
  if (validationErrors.length > 0) throw new Error(validationErrors.join(" "));
  const operationalConfig = withSyntheticOperationalModel(config);
  const incidents = [
    ...syntheticPresetIncidents(config),
    ...manualIncidents.map((entry) => ({ ...entry })),
  ];
  const result = runOperationalSimulation(operationalConfig, incidents, calculateSimulationMetrics);
  return { ...result, config: structuredClone(config) };
}
