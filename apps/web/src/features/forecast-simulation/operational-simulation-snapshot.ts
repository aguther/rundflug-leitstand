import type { SimulationConfig, SimulationForecastSnapshot } from "./model";
import { calculateOperationalSimulationProjections } from "./operational-simulation-forecast";
import type {
  OperationalAircraft,
  OperationalPilot,
  OperationalPlan,
  OperationalRecurringRule,
  OperationalRotation,
} from "./operational-simulation-scenario";
import { captureSimulationForecastSnapshots } from "./simulation-snapshot";

export function captureOperationalSimulationSnapshots(input: {
  config: SimulationConfig;
  nowMs: number;
  operationsStartMs: number;
  operationsEndMs: number;
  rotations: OperationalRotation[];
  aircraft: readonly OperationalAircraft[];
  pilots: readonly OperationalPilot[];
  plans: readonly OperationalPlan[];
  recurringRules: readonly OperationalRecurringRule[];
  snapshots: SimulationForecastSnapshot[];
  planIsActive: (plan: OperationalPlan, nowMs: number) => boolean;
  activePlanFor: (
    scopeType: OperationalPlan["scopeType"],
    scopeId: string,
    nowMs: number,
  ) => boolean;
  planAppliesToRotation: (plan: OperationalPlan, rotation: OperationalRotation) => boolean;
  operationsGloballyAvailable: (nowMs: number) => boolean;
  groupAvailable: (groupId: string, nowMs: number) => boolean;
}): void {
  const {
    config,
    nowMs,
    operationsStartMs,
    operationsEndMs,
    rotations,
    aircraft,
    pilots,
    plans,
    recurringRules,
    snapshots,
    planIsActive,
    activePlanFor,
    planAppliesToRotation,
    operationsGloballyAvailable,
    groupAvailable,
  } = input;
  const projections = calculateOperationalSimulationProjections({
    config,
    nowMs,
    operationsStartMs,
    operationsEndMs,
    rotations,
    aircraft,
    pilots,
    plans,
    recurringRules,
    planIsActive,
    activePlanFor,
    planAppliesToRotation,
    operationsGloballyAvailable,
    groupAvailable,
  });
  captureSimulationForecastSnapshots({
    config,
    nowMs,
    rotations,
    projections,
    snapshots,
    resourceGroupStatusFor: (rotation) =>
      nowMs < operationsStartMs || groupAvailable(rotation.resourceGroupId ?? "", nowMs)
        ? "ACTIVE"
        : "PAUSED",
  });
}
