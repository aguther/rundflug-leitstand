import { derivePublicForecastProjection } from "@rundflug/domain";
import type { SimulationConfig, SimulationForecastSnapshot } from "./model";
import { calculateOperationalSimulationProjections } from "./operational-simulation-forecast";
import type {
  OperationalAircraft,
  OperationalPilot,
  OperationalPlan,
  OperationalRecurringRule,
  OperationalRotation,
} from "./operational-simulation-scenario";
import { toSimulationIso as iso } from "./simulation-primitives";

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
  for (const projection of projections) {
    const rotation = rotations.find((entry) => entry.id === projection.rotationId);
    if (!rotation || rotation.status === "COMPLETED") continue;
    rotation.predictedDepartureAt = projection.predictedDepartureAt;
    rotation.predictedLandingAt = projection.predictedLandingAt;
    rotation.predictedCompletionAt = projection.predictedCompletionAt;
    const forecastResourceGroupStatus =
      nowMs < operationsStartMs || groupAvailable(rotation.resourceGroupId ?? "", nowMs)
        ? "ACTIVE"
        : "PAUSED";
    const publicForecast = derivePublicForecastProjection({
      rotationStatus: rotation.status,
      predictionQuality: projection.predictionQuality,
      predictedBoardingAt: projection.predictedBoardingAt,
      predictedCompletionAt: projection.predictedCompletionAt,
      operationsEndAt: config.schedule.operationsEndAt,
      dispatchBatchId: projection.dispatchBatchId,
      dispatchUnplannedReason: projection.dispatchUnplannedReason,
      emergencyMode: false,
      operationalInterrupted: projection.uncertaintyReasons.includes("OPERATION_INTERRUPTED"),
      resourceGroupStatus: forecastResourceGroupStatus,
    });
    snapshots.push({
      rotationId: rotation.id,
      capturedAt: iso(nowMs),
      status: rotation.status,
      quality: projection.predictionQuality,
      lowerMinutes: projection.predictionLowerMinutes ?? 0,
      upperMinutes: projection.predictionUpperMinutes ?? 0,
      plannedBoardingAt: projection.plannedBoardingAt,
      predictedBoardingAt: projection.predictedBoardingAt ?? projection.plannedBoardingAt,
      predictedDepartureAt: projection.predictedDepartureAt ?? projection.plannedDepartureAt,
      predictedLandingAt: projection.predictedLandingAt ?? projection.plannedLandingAt,
      predictedCompletionAt: projection.predictedCompletionAt ?? projection.plannedCompletionAt,
      sampleSize: projection.sampleSize,
      dataAgeMinutes: projection.dataAgeMinutes,
      activeCapacity: projection.activeCapacity,
      uncertaintyReasons: projection.uncertaintyReasons,
      ...publicForecast,
      dispatchBatchId: projection.dispatchBatchId,
      dispatchUnplannedReason: projection.dispatchUnplannedReason,
      countdownDisplayed:
        projection.predictionQuality !== "UNCERTAIN" &&
        (publicForecast.forecastState === "DISPATCH_WINDOW" ||
          publicForecast.forecastState === "LONG_RANGE_WINDOW"),
    });
  }
}
