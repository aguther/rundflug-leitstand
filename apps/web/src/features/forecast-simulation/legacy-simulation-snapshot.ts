import type { DispatchPlan } from "@rundflug/domain";
import { calculateLegacySimulationProjections } from "./legacy-simulation-forecast";
import type { LegacyResourceGroupStatus } from "./legacy-simulation-lifecycle";
import type { RuntimeAircraft, RuntimeRotation } from "./legacy-simulation-scenario";
import type { ManualIncident, SimulationConfig, SimulationForecastSnapshot } from "./model";
import { captureSimulationForecastSnapshots } from "./simulation-snapshot";

export function captureLegacySimulationForecast(input: {
  config: SimulationConfig;
  nowMs: number;
  operationsStartMs: number;
  resourceGroupStatus: LegacyResourceGroupStatus;
  rotations: RuntimeRotation[];
  aircraft: readonly RuntimeAircraft[];
  activeInterruptions: readonly ManualIncident[];
  previousDispatchPlan: DispatchPlan | null;
  snapshots: SimulationForecastSnapshot[];
}): void {
  const {
    config,
    nowMs,
    operationsStartMs,
    resourceGroupStatus,
    rotations,
    aircraft,
    activeInterruptions,
    previousDispatchPlan,
    snapshots,
  } = input;
  const projections = calculateLegacySimulationProjections({
    config,
    nowMs,
    operationsStartMs,
    resourceGroupStatus,
    rotations,
    aircraft,
    activeInterruptions,
    previousDispatchPlan,
  });
  captureSimulationForecastSnapshots({
    config,
    nowMs,
    rotations,
    projections,
    snapshots,
    resourceGroupStatusFor: () =>
      resourceGroupStatus === "PAUSED" && nowMs < operationsStartMs
        ? "ACTIVE"
        : resourceGroupStatus,
  });
}
