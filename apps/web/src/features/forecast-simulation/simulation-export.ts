import type { BatchComparisonResult } from "./comparison";
import type { ManualIncident, SimulationResult } from "./model";

export const SIMULATION_EXPORT_SCHEMA = "rundflug-forecast-simulation/v6" as const;

export function createSimulationExport(
  result: SimulationResult,
  manualIncidents: readonly ManualIncident[],
  comparison: BatchComparisonResult | null,
) {
  return {
    schema: SIMULATION_EXPORT_SCHEMA,
    scenario: result.config,
    seed: result.config.seed,
    schedule: result.config.schedule,
    runWindow: result.runWindow,
    adminParameters: result.config.adminParameters,
    realityModel: result.config.realityModel,
    forecastTuning: result.config.forecastTuning,
    manualIncidents,
    syntheticEventLedger: result.events,
    forecastSnapshots: result.snapshots,
    aircraft: result.aircraft,
    rotations: result.rotations,
    metrics: result.metrics,
    batchComparison: comparison,
  };
}
