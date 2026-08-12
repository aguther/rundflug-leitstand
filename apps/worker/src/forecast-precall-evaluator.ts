import {
  type AutomaticPrecallQueueEntry,
  type ForecastCalculationResult,
  selectAutomaticPrecalls,
} from "@rundflug/domain";
import type { ForecastTimelineLoader } from "./forecast-timeline-loader";

type ForecastTimelineData = Awaited<ReturnType<ForecastTimelineLoader["load"]>>;
type RotationRow = ForecastTimelineData["rotationRows"]["results"][number];
type ForecastProjection = ForecastCalculationResult["projections"][number];

export interface AutomaticPrecallCandidate {
  flightGroupId: string;
  rotationId: string;
  resourceGroupId: string;
  expectedVersion: number;
  gateId: string | null;
  predictionUpperMinutes: number;
  predictionQuality: "STABLE" | "CHANGING" | "UNCERTAIN";
  adaptiveLeadMinutes: number;
  gateTravelLeadMinutes: number;
  effectiveLeadMinutes: number;
  boardingWindowLowerAt: string | null;
  boardingWindowUpperAt: string | null;
  dispatchPlanRevision: string | null;
  dispatchBatchId: string | null;
}

export interface PersistableAutomaticPrecallCandidate extends AutomaticPrecallCandidate {
  dispatchPlanRevision: string;
  dispatchBatchId: string;
}

export function evaluateAutomaticPrecalls(input: {
  event: ForecastTimelineData["event"];
  rotations: readonly RotationRow[];
  projections: readonly ForecastProjection[];
  adaptiveLeadMinutes: number;
  now: Date;
}) {
  const projectionByRotationId = new Map(
    input.projections.map((projection) => [projection.rotationId, projection]),
  );
  const queueEntries: AutomaticPrecallQueueEntry[] = [];
  const candidateByRotationId = new Map<string, AutomaticPrecallCandidate>();

  for (const rotation of input.rotations) {
    const projection = projectionByRotationId.get(rotation.id);
    if (!projection) throw new Error(`Forecast projection missing for rotation ${rotation.id}.`);
    if (rotation.status !== "DRAFT") continue;
    queueEntries.push({
      id: rotation.id,
      resourceGroupId: rotation.resource_group_id,
      enabled: input.event.automatic_precall_enabled === 1,
      eventActive: input.event.status === "ACTIVE",
      operationsAvailable:
        input.event.operational_interrupted === 0 && input.event.emergency_mode === 0,
      resourceGroupActive: rotation.resource_group_status === "ACTIVE",
      resourceGroupEnabled: rotation.resource_group_precall_enabled === 1,
      alreadyPrecalled: rotation.precalled_at !== null,
      forecastCapacityStatus: projection.capacityStatus,
      predictionQuality: projection.predictionQuality,
      predictedBoardingMinutes:
        projection.predictionLowerMinutes === null
          ? Number.MAX_SAFE_INTEGER
          : Math.ceil(projection.predictionLowerMinutes),
      adaptiveLeadMinutes: input.adaptiveLeadMinutes,
      prepareLeadMinutes: input.event.notification_lead_minutes,
      gateTravelLeadMinutes: rotation.gate_travel_lead_minutes,
      dispatchPlanFresh: projection.dispatchPlanRevision !== null,
      inNearDispatchBatch: projection.dispatchWave !== null && projection.dispatchWave <= 2,
      gateCapacityCovered: false,
      waitingForProductFairness:
        projection.dispatchUnplannedReason === "WAITING_FOR_PRODUCT_FAIRNESS",
      waitingForFittingLane: projection.dispatchUnplannedReason === "WAITING_FOR_FITTING_LANE",
      commitmentLocked: projection.dispatchUnplannedReason === "COMMITMENT_LOCKED",
      dispatchOrder: projection.dispatchOrder,
      queueSequence: rotation.queue_sequence,
    });
    candidateByRotationId.set(rotation.id, {
      flightGroupId: rotation.flight_group_id,
      rotationId: rotation.id,
      resourceGroupId: rotation.resource_group_id,
      expectedVersion: rotation.flight_group_version,
      gateId: rotation.gate_id,
      predictionUpperMinutes: projection.predictionUpperMinutes ?? 0,
      predictionQuality: projection.predictionQuality,
      adaptiveLeadMinutes: input.adaptiveLeadMinutes,
      gateTravelLeadMinutes: rotation.gate_travel_lead_minutes,
      effectiveLeadMinutes: input.adaptiveLeadMinutes + rotation.gate_travel_lead_minutes,
      boardingWindowLowerAt:
        projection.predictionLowerMinutes === null
          ? null
          : new Date(
              input.now.getTime() + projection.predictionLowerMinutes * 60_000,
            ).toISOString(),
      boardingWindowUpperAt:
        projection.predictionUpperMinutes === null
          ? null
          : new Date(
              input.now.getTime() + projection.predictionUpperMinutes * 60_000,
            ).toISOString(),
      dispatchPlanRevision: projection.dispatchPlanRevision,
      dispatchBatchId: projection.dispatchBatchId,
    });
  }

  const decisions = selectAutomaticPrecalls(queueEntries);
  const candidates: PersistableAutomaticPrecallCandidate[] = decisions.flatMap((decision) => {
    if (!decision.eligible) return [];
    const candidate = candidateByRotationId.get(decision.id);
    if (!candidate) throw new Error(`Precall candidate missing for rotation ${decision.id}.`);
    if (!candidate.dispatchPlanRevision || !candidate.dispatchBatchId) return [];
    return [
      {
        ...candidate,
        dispatchPlanRevision: candidate.dispatchPlanRevision,
        dispatchBatchId: candidate.dispatchBatchId,
      },
    ];
  });

  return {
    projectionByRotationId,
    queueEntries,
    candidateByRotationId,
    decisions,
    candidates,
  };
}
