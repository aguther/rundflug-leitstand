import {
  deriveAdaptivePrecallLeadMinutes,
  normalizePrecallObservation,
  selectAutomaticPrecalls,
} from "@rundflug/domain";
import type { SimulationConfig } from "./model";
import { calculateOperationalSimulationProjections } from "./operational-simulation-forecast";
import type {
  OperationalAircraft,
  OperationalPilot,
  OperationalPlan,
  OperationalRecurringRule,
  OperationalRotation,
  OperationalSimulationEventRecorder,
} from "./operational-simulation-scenario";
import { toSimulationIso as iso, SIMULATION_MINUTE_MS as MINUTE_MS } from "./simulation-primitives";

export function evaluateOperationalSimulationPrecalls(input: {
  config: SimulationConfig;
  nowMs: number;
  operationsStartMs: number;
  operationsEndMs: number;
  rotations: OperationalRotation[];
  aircraft: readonly OperationalAircraft[];
  pilots: readonly OperationalPilot[];
  plans: readonly OperationalPlan[];
  recurringRules: readonly OperationalRecurringRule[];
  planIsActive: (plan: OperationalPlan, nowMs: number) => boolean;
  activePlanFor: (
    scopeType: OperationalPlan["scopeType"],
    scopeId: string,
    nowMs: number,
  ) => boolean;
  planAppliesToRotation: (plan: OperationalPlan, rotation: OperationalRotation) => boolean;
  operationsGloballyAvailable: (nowMs: number) => boolean;
  groupAvailable: (groupId: string, nowMs: number) => boolean;
  recordEvent: OperationalSimulationEventRecorder;
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
    planIsActive,
    activePlanFor,
    planAppliesToRotation,
    operationsGloballyAvailable,
    groupAvailable,
    recordEvent,
  } = input;
  const model = config.operationalModel;
  if (!model) return;

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
  const projectionByRotation = new Map(projections.map((entry) => [entry.rotationId, entry]));
  const waiting = rotations.filter(
    (rotation) => rotation.status === "DRAFT" && Date.parse(rotation.createdAt) <= nowMs,
  );
  if (waiting.length === 0) return;

  const waitingQueueSequences = new Map<string, number>();
  for (const group of model.resourceGroups) {
    waiting
      .filter((rotation) => rotation.resourceGroupId === group.id)
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .forEach((rotation, index) => {
        waitingQueueSequences.set(rotation.id, index + 1);
      });
  }
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
  const decisions = selectAutomaticPrecalls(
    waiting.flatMap((rotation) => {
      const projection = projectionByRotation.get(rotation.id);
      const group = model.resourceGroups.find((entry) => entry.id === rotation.resourceGroupId);
      const product = model.products.find((entry) => entry.id === rotation.productId);
      const gateTravelLeadMinutes =
        model.gates.find((entry) => entry.id === product?.gateId)?.travelLeadMinutes ?? 0;
      if (!projection || !group) return [];
      return [
        {
          id: rotation.id,
          resourceGroupId: group.id,
          enabled: config.adminParameters.eventAutomaticPrecallEnabled,
          eventActive: nowMs >= operationsStartMs && nowMs < operationsEndMs,
          operationsAvailable: groupAvailable(group.id, nowMs),
          resourceGroupActive: groupAvailable(group.id, nowMs),
          resourceGroupEnabled: group.automaticPrecallEnabled,
          alreadyPrecalled: rotation.precalledAt !== null,
          forecastCapacityStatus: projection.capacityStatus,
          predictionQuality: projection.predictionQuality,
          predictedBoardingMinutes:
            projection.predictionLowerMinutes === null
              ? Number.POSITIVE_INFINITY
              : Math.ceil(projection.predictionLowerMinutes),
          adaptiveLeadMinutes,
          prepareLeadMinutes: config.adminParameters.plannedBoardingMinutes,
          gateTravelLeadMinutes,
          dispatchPlanFresh: projection.dispatchPlanRevision !== null,
          inNearDispatchBatch: projection.dispatchWave !== null && projection.dispatchWave <= 2,
          waitingForProductFairness:
            projection.dispatchUnplannedReason === "WAITING_FOR_PRODUCT_FAIRNESS",
          waitingForFittingLane: projection.dispatchUnplannedReason === "WAITING_FOR_FITTING_LANE",
          commitmentLocked: projection.dispatchUnplannedReason === "COMMITMENT_LOCKED",
          dispatchOrder: projection.dispatchOrder,
          queueSequence: waitingQueueSequences.get(rotation.id) ?? 1,
        },
      ];
    }),
  );
  for (const decision of decisions) {
    const rotation = rotations.find((entry) => entry.id === decision.id);
    const projection = projectionByRotation.get(decision.id);
    if (!rotation) continue;
    rotation.precallStatus = decision.status;
    if (!decision.eligible || !projection?.predictedBoardingAt) continue;
    rotation.precalledAt = iso(nowMs);
    rotation.precallTrigger = "AUTOMATIC_PRECALL";
    rotation.precallPredictionQuality = projection.predictionQuality;
    rotation.precallPredictedBoardingAt = projection.predictedBoardingAt;
    rotation.precallAdaptiveLeadMinutes = adaptiveLeadMinutes;
    const gateTravelLeadMinutes =
      model.gates.find(
        (entry) =>
          entry.id === model.products.find((product) => product.id === rotation.productId)?.gateId,
      )?.travelLeadMinutes ?? 0;
    rotation.precallGateTravelLeadMinutes = gateTravelLeadMinutes;
    rotation.precallEffectiveLeadMinutes = adaptiveLeadMinutes + gateTravelLeadMinutes;
    recordEvent("FLIGHT_GROUP_PRECALLED", nowMs, {
      rotationId: rotation.id,
      details: `Automatischer GO TO GATE · ${rotation.gateLabel ?? "Gate"} · Prognose ${projection.predictedBoardingAt}.`,
    });
  }
}
