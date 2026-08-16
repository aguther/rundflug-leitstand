import { compareTechnicalStrings, type DispatchDecisionDetails } from "@rundflug/domain";

export type DispatchRecommendationSelectionSource = "CURRENT_PLAN_BATCH" | "CANONICAL_REPLAN";

export type DispatchRecommendationFallbackReason =
  | "NO_CURRENT_PLAN"
  | "CURRENT_PLAN_BATCH_RESERVED"
  | "CURRENT_PLAN_BATCH_INCOMPLETE"
  | "CURRENT_PLAN_BATCH_INCOMPATIBLE";

export interface StoredDispatchBatchCandidateRow {
  rotationId: string;
  groupIds: readonly string[];
  productId: string;
  gateId: string;
  ticketCount: number;
  attendanceStatus: "WAITING" | "PRESENT" | "MISSING" | "CLARIFICATION";
  calledToGate: boolean;
  firstEligibleSegment: boolean;
  reservedByActiveLease: boolean;
  planRevision: string | null;
  batchId: string | null;
  dispatchOrder: number | null;
  dispatchWave: number | null;
  plannedGroupIds: readonly string[];
  plannedOccupiedSeats: number | null;
  decisionReasons: readonly string[];
  decisionDetails?: DispatchDecisionDetails | null;
  predictionUpdatedAt: string | null;
}

export interface ReusableDispatchBatch {
  planRevision: string;
  batchId: string;
  dispatchOrder: number;
  memberRotationIds: string[];
  groupIds: string[];
  occupiedSeats: number;
  decisionReasons: string[];
  decisionDetails: DispatchDecisionDetails | null;
}

export interface ReusableDispatchBatchSelection {
  batch: ReusableDispatchBatch | null;
  fallbackReason: DispatchRecommendationFallbackReason | null;
}

function stableStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareTechnicalStrings);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function selectReusableDispatchBatch(input: {
  aircraftPassengerSeats: number;
  rows: readonly StoredDispatchBatchCandidateRow[];
}): ReusableDispatchBatchSelection {
  const plannedRows = input.rows.filter(
    (row) => row.planRevision && row.batchId && row.dispatchOrder !== null,
  );
  const latest = [...plannedRows].sort(
    (left, right) =>
      (right.predictionUpdatedAt ?? "").localeCompare(left.predictionUpdatedAt ?? "") ||
      (left.planRevision ?? "").localeCompare(right.planRevision ?? ""),
  )[0];
  if (!latest?.planRevision) return { batch: null, fallbackReason: "NO_CURRENT_PLAN" };

  const currentRows = plannedRows.filter((row) => row.planRevision === latest.planRevision);
  const batchIds = stableStrings(currentRows.flatMap((row) => (row.batchId ? [row.batchId] : [])));
  const batches = batchIds
    .map((batchId) => currentRows.filter((row) => row.batchId === batchId))
    .filter((rows) => rows.length > 0)
    .sort(
      (left, right) =>
        (left[0]?.dispatchOrder ?? Number.MAX_SAFE_INTEGER) -
          (right[0]?.dispatchOrder ?? Number.MAX_SAFE_INTEGER) ||
        (left[0]?.dispatchWave ?? Number.MAX_SAFE_INTEGER) -
          (right[0]?.dispatchWave ?? Number.MAX_SAFE_INTEGER) ||
        (left[0]?.batchId ?? "").localeCompare(right[0]?.batchId ?? ""),
    );

  let fallbackReason: DispatchRecommendationFallbackReason = "CURRENT_PLAN_BATCH_INCOMPATIBLE";
  for (const rows of batches) {
    if (rows.some((row) => row.reservedByActiveLease)) {
      fallbackReason = "CURRENT_PLAN_BATCH_RESERVED";
      continue;
    }
    if (
      rows.some(
        (row) =>
          !row.firstEligibleSegment ||
          !row.calledToGate ||
          row.attendanceStatus === "MISSING" ||
          row.attendanceStatus === "CLARIFICATION",
      )
    ) {
      fallbackReason = "CURRENT_PLAN_BATCH_INCOMPLETE";
      continue;
    }
    const plannedGroupIds = stableStrings(rows[0]?.plannedGroupIds ?? []);
    const liveGroupIds = stableStrings(rows.flatMap((row) => row.groupIds));
    const occupiedSeats = rows.reduce((sum, row) => sum + row.ticketCount, 0);
    const productIds = new Set(rows.map((row) => row.productId));
    const gateIds = new Set(rows.map((row) => row.gateId));
    const plannedSeatCounts = new Set(rows.map((row) => row.plannedOccupiedSeats));
    if (plannedGroupIds.length === 0 || !sameStrings(plannedGroupIds, liveGroupIds)) {
      fallbackReason = "CURRENT_PLAN_BATCH_INCOMPLETE";
      continue;
    }
    if (
      occupiedSeats > input.aircraftPassengerSeats ||
      productIds.size !== 1 ||
      gateIds.size !== 1 ||
      plannedSeatCounts.size !== 1 ||
      !plannedSeatCounts.has(occupiedSeats)
    ) {
      fallbackReason = "CURRENT_PLAN_BATCH_INCOMPATIBLE";
      continue;
    }
    const first = rows[0];
    if (!first?.planRevision || !first.batchId || first.dispatchOrder === null) continue;
    return {
      batch: {
        planRevision: first.planRevision,
        batchId: first.batchId,
        dispatchOrder: first.dispatchOrder,
        memberRotationIds: stableStrings(rows.map((row) => row.rotationId)),
        groupIds: [...(first.plannedGroupIds ?? [])],
        occupiedSeats,
        decisionReasons: stableStrings(rows.flatMap((row) => row.decisionReasons)),
        decisionDetails: first.decisionDetails ?? null,
      },
      fallbackReason: null,
    };
  }
  return { batch: null, fallbackReason };
}
