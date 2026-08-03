import type { OperationBoard } from "@rundflug/contracts";

export interface DispatchRecommendationSelection {
  planRevision: string;
  batchId: string;
  dispatchOrder: number;
  groupIds: string[];
  occupiedSeats: number;
  availableSeats: number;
  decisionReasons: string[];
}

export function dispatchRecommendationForAircraft(
  board: OperationBoard,
  aircraftId: string | undefined,
): DispatchRecommendationSelection | null {
  if (!aircraftId) return null;
  const rotation = board.rotations
    .filter(
      (entry) =>
        entry.status === "DRAFT" &&
        entry.timeline.forecastAssumedAircraftId === aircraftId &&
        entry.dispatchPlan?.batchId,
    )
    .sort(
      (left, right) =>
        (left.dispatchPlan?.dispatchOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.dispatchPlan?.dispatchOrder ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id),
    )[0];
  const plan = rotation?.dispatchPlan;
  if (!plan?.batchId || !plan.dispatchOrder || plan.occupiedSeats === null) return null;
  return {
    planRevision: plan.revision,
    batchId: plan.batchId,
    dispatchOrder: plan.dispatchOrder,
    groupIds: [...plan.groupIds],
    occupiedSeats: plan.occupiedSeats,
    availableSeats: plan.availableSeats ?? 0,
    decisionReasons: [...plan.decisionReasons],
  };
}

export function dispatchRecommendationSelectionForAircraft(
  board: OperationBoard,
  aircraftId: string | undefined,
): {
  recommendation: DispatchRecommendationSelection | null;
  groupIds: string[];
} {
  const recommendation = dispatchRecommendationForAircraft(board, aircraftId);
  return {
    recommendation,
    groupIds: recommendation ? [...recommendation.groupIds] : [],
  };
}
