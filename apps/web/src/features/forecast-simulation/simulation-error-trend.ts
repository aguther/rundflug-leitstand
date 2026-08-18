import type { SimulationForecastSnapshot, SimulationRotation } from "./model";
import { findFirstAvailableDraftForecastSnapshot } from "./simulation-snapshot";

const MINUTE_MS = 60_000;

export type BoardingErrorTrendBasis = "INITIAL" | "LATEST";

export interface BoardingErrorTrendPoint {
  at: number;
  capturedAt: number;
  predictedBoardingAt: number;
  communicationNumber: number;
  error: number;
}

function findLatestDraftSnapshotBeforeBoarding(
  snapshots: readonly SimulationForecastSnapshot[],
  rotationId: SimulationRotation["id"],
  calledAt: string,
): SimulationForecastSnapshot | undefined {
  return snapshots.findLast(
    (snapshot) =>
      snapshot.rotationId === rotationId &&
      snapshot.status === "DRAFT" &&
      Date.parse(snapshot.capturedAt) < Date.parse(calledAt),
  );
}

export function buildBoardingErrorTrendPoints(
  rotations: readonly SimulationRotation[],
  snapshots: readonly SimulationForecastSnapshot[],
  basis: BoardingErrorTrendBasis,
): BoardingErrorTrendPoint[] {
  return rotations
    .flatMap((rotation) => {
      if (!rotation.calledAt) return [];
      const snapshot =
        basis === "INITIAL"
          ? findFirstAvailableDraftForecastSnapshot(snapshots, rotation.id, rotation.calledAt)
          : findLatestDraftSnapshotBeforeBoarding(snapshots, rotation.id, rotation.calledAt);
      if (!snapshot) return [];

      const actualBoardingAt = Date.parse(rotation.calledAt);
      const capturedAt = Date.parse(snapshot.capturedAt);
      const predictedBoardingAt = Date.parse(snapshot.predictedBoardingAt);
      if (![actualBoardingAt, capturedAt, predictedBoardingAt].every(Number.isFinite)) return [];

      return [
        {
          at: actualBoardingAt,
          capturedAt,
          predictedBoardingAt,
          communicationNumber: rotation.communicationNumber,
          error: (predictedBoardingAt - actualBoardingAt) / MINUTE_MS,
        },
      ];
    })
    .sort((left, right) => left.at - right.at);
}
