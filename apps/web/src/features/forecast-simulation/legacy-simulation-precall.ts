import {
  type DispatchPlan,
  deriveAdaptivePrecallLeadMinutes,
  normalizePrecallObservation,
  selectAutomaticPrecalls,
} from "@rundflug/domain";
import { calculateLegacySimulationProjections } from "./legacy-simulation-forecast";
import type {
  LegacyResourceGroupStatus,
  LegacySimulationEventRecorder,
} from "./legacy-simulation-lifecycle";
import {
  RESOURCE_GROUP_ID,
  type RuntimeAircraft,
  type RuntimeRotation,
} from "./legacy-simulation-scenario";
import type { ManualIncident, SimulationConfig } from "./model";
import { toSimulationIso as iso, SIMULATION_MINUTE_MS as MINUTE_MS } from "./simulation-primitives";

export function evaluateLegacySimulationPrecalls(input: {
  config: SimulationConfig;
  nowMs: number;
  operationsStartMs: number;
  resourceGroupStatus: LegacyResourceGroupStatus;
  rotations: RuntimeRotation[];
  aircraft: readonly RuntimeAircraft[];
  activeInterruptions: readonly ManualIncident[];
  previousDispatchPlan: DispatchPlan | null;
  operationsOpen: boolean;
  operationsAvailable: boolean;
  recordEvent: LegacySimulationEventRecorder;
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
    operationsOpen,
    operationsAvailable,
    recordEvent,
  } = input;
  const precallProjections = calculateLegacySimulationProjections({
    config,
    nowMs,
    operationsStartMs,
    resourceGroupStatus,
    rotations,
    aircraft,
    activeInterruptions,
    previousDispatchPlan,
  });
  const waitingRotations = rotations
    .filter((rotation) => rotation.status === "DRAFT" && Date.parse(rotation.createdAt) <= nowMs)
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id),
    );
  const waitingQueueSequence = new Map(
    waitingRotations.map((rotation, index) => [rotation.id, index + 1] as const),
  );
  if (waitingRotations.length > 0) {
    const observedGateWaitMinutes = rotations.flatMap((rotation) =>
      rotation.precalledAt && rotation.calledAt
        ? [
            normalizePrecallObservation({
              observedGoToGateToBoardingMinutes:
                (Date.parse(rotation.calledAt) - Date.parse(rotation.precalledAt)) / MINUTE_MS,
              gateTravelLeadMinutesUsed: rotation.precallGateTravelLeadMinutes ?? 0,
            }),
          ]
        : [],
    );
    const adaptiveLeadMinutes = deriveAdaptivePrecallLeadMinutes({
      observedGateWaitMinutes,
      tuning: config.forecastTuning.precall,
    });
    const projectionByRotationId = new Map(
      precallProjections.map((projection) => [projection.rotationId, projection]),
    );
    const rotationById = new Map(waitingRotations.map((rotation) => [rotation.id, rotation]));
    const decisions = selectAutomaticPrecalls(
      waitingRotations.flatMap((rotation) => {
        const projection = projectionByRotationId.get(rotation.id);
        if (!projection) return [];
        return [
          {
            id: rotation.id,
            resourceGroupId: RESOURCE_GROUP_ID,
            enabled: config.adminParameters.eventAutomaticPrecallEnabled,
            eventActive: operationsOpen,
            operationsAvailable,
            resourceGroupActive: operationsAvailable,
            resourceGroupEnabled: config.adminParameters.resourceGroupAutomaticPrecallEnabled,
            alreadyPrecalled: rotation.precalledAt !== null,
            forecastCapacityStatus: projection.capacityStatus,
            predictionQuality: projection.predictionQuality,
            predictedBoardingMinutes:
              projection.predictionLowerMinutes === null
                ? Number.POSITIVE_INFINITY
                : Math.ceil(projection.predictionLowerMinutes),
            adaptiveLeadMinutes,
            prepareLeadMinutes: config.adminParameters.plannedBoardingMinutes,
            gateTravelLeadMinutes: 0,
            dispatchPlanFresh: projection.dispatchPlanRevision !== null,
            inNearDispatchBatch: projection.dispatchWave !== null && projection.dispatchWave <= 2,
            waitingForProductFairness:
              projection.dispatchUnplannedReason === "WAITING_FOR_PRODUCT_FAIRNESS",
            waitingForFittingLane:
              projection.dispatchUnplannedReason === "WAITING_FOR_FITTING_LANE",
            commitmentLocked: projection.dispatchUnplannedReason === "COMMITMENT_LOCKED",
            dispatchOrder: projection.dispatchOrder,
            queueSequence: waitingQueueSequence.get(rotation.id) ?? 1,
          },
        ];
      }),
    );
    for (const decision of decisions) {
      const rotation = rotationById.get(decision.id);
      const projection = projectionByRotationId.get(decision.id);
      if (!rotation) continue;
      rotation.precallStatus = decision.status;
      if (!decision.eligible || !projection?.predictedBoardingAt) continue;
      rotation.precalledAt = iso(nowMs);
      rotation.precallTrigger = "AUTOMATIC_PRECALL";
      rotation.precallPredictionQuality = projection.predictionQuality;
      rotation.precallPredictedBoardingAt = projection.predictedBoardingAt;
      rotation.precallAdaptiveLeadMinutes = adaptiveLeadMinutes;
      rotation.precallGateTravelLeadMinutes = 0;
      rotation.precallEffectiveLeadMinutes = adaptiveLeadMinutes;
      recordEvent(
        "FLIGHT_GROUP_PRECALLED",
        nowMs,
        null,
        rotation.id,
        `Automatischer GO TO GATE · Prognose ${projection.predictedBoardingAt} · Qualität ${projection.predictionQuality} · Vorlauf ${adaptiveLeadMinutes} Minuten · noch ohne Flugzeugbindung.`,
      );
    }
  }
}
