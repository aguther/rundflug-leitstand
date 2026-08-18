import {
  derivePublicForecastProjection,
  type ForecastRotationStatus,
  type ForecastTimelineProjection,
} from "@rundflug/domain";
import type { SimulationConfig, SimulationForecastSnapshot, SimulationRotation } from "./model";
import { toSimulationIso as iso } from "./simulation-primitives";

type SimulationResourceGroupStatus = "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";

interface MutableForecastRotation {
  id: string;
  status: ForecastRotationStatus | "COMPLETED";
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
}

export function findFirstAvailableDraftForecastSnapshot(
  snapshots: readonly SimulationForecastSnapshot[],
  rotationId: SimulationRotation["id"],
  before?: string,
): SimulationForecastSnapshot | undefined {
  const beforeMs = before ? Date.parse(before) : Number.POSITIVE_INFINITY;
  let firstSnapshot: SimulationForecastSnapshot | undefined;
  for (const snapshot of snapshots) {
    const capturedAtMs = Date.parse(snapshot.capturedAt);
    if (
      snapshot.rotationId !== rotationId ||
      snapshot.status !== "DRAFT" ||
      snapshot.forecastState === "UNAVAILABLE" ||
      !Number.isFinite(capturedAtMs) ||
      capturedAtMs >= beforeMs
    ) {
      continue;
    }
    if (!firstSnapshot || capturedAtMs < Date.parse(firstSnapshot.capturedAt)) {
      firstSnapshot = snapshot;
    }
  }
  return firstSnapshot;
}

export function captureSimulationForecastSnapshots<
  Rotation extends MutableForecastRotation,
>(input: {
  config: SimulationConfig;
  nowMs: number;
  rotations: Rotation[];
  projections: readonly ForecastTimelineProjection[];
  snapshots: SimulationForecastSnapshot[];
  resourceGroupStatusFor: (rotation: Rotation) => SimulationResourceGroupStatus;
}): void {
  const { config, nowMs, rotations, projections, snapshots, resourceGroupStatusFor } = input;
  for (const projection of projections) {
    const rotation = rotations.find((candidate) => candidate.id === projection.rotationId);
    if (!rotation || rotation.status === "COMPLETED") continue;
    rotation.predictedDepartureAt = projection.predictedDepartureAt;
    rotation.predictedLandingAt = projection.predictedLandingAt;
    rotation.predictedCompletionAt = projection.predictedCompletionAt;
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
      resourceGroupStatus: resourceGroupStatusFor(rotation),
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
