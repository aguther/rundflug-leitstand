import { type DispatchPlan, derivePublicForecastProjection } from "@rundflug/domain";
import { calculateLegacySimulationProjections } from "./legacy-simulation-forecast";
import type { LegacyResourceGroupStatus } from "./legacy-simulation-lifecycle";
import type { RuntimeAircraft, RuntimeRotation } from "./legacy-simulation-scenario";
import type { ManualIncident, SimulationConfig, SimulationForecastSnapshot } from "./model";
import { toSimulationIso as iso } from "./simulation-primitives";

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
  for (const projection of projections) {
    const rotation = rotations.find((candidate) => candidate.id === projection.rotationId);
    if (!rotation || rotation.status === "COMPLETED") continue;
    rotation.predictedDepartureAt = projection.predictedDepartureAt;
    rotation.predictedLandingAt = projection.predictedLandingAt;
    rotation.predictedCompletionAt = projection.predictedCompletionAt;
    const forecastResourceGroupStatus =
      resourceGroupStatus === "PAUSED" && nowMs < operationsStartMs
        ? "ACTIVE"
        : resourceGroupStatus;
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
