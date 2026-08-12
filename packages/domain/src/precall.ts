export type PrecallQuality = "STABLE" | "CHANGING" | "UNCERTAIN";

export interface PrecallTuningProfile {
  desiredGateWaitMinutes: number;
  baselineLeadMinutes: number;
  minimumLeadMinutes: number;
  maximumLeadMinutes: number;
  correctionFactor: number;
  observationSampleLimit: number;
  gateCooldownMinutes: number;
}

export const DEFAULT_PRECALL_TUNING_PROFILE: Readonly<PrecallTuningProfile> = Object.freeze({
  desiredGateWaitMinutes: 8,
  baselineLeadMinutes: 12,
  minimumLeadMinutes: 6,
  maximumLeadMinutes: 18,
  correctionFactor: 0.5,
  observationSampleLimit: 8,
  gateCooldownMinutes: 2,
});

export interface AutomaticPrecallInput {
  enabled: boolean;
  eventActive: boolean;
  operationsAvailable: boolean;
  resourceGroupActive: boolean;
  resourceGroupEnabled: boolean;
  alreadyPrecalled: boolean;
  forecastCapacityStatus: "AVAILABLE" | "NO_FORECAST_CAPACITY" | "NO_FITTING_AIRCRAFT";
  predictionQuality: PrecallQuality;
  predictedBoardingMinutes: number;
  adaptiveLeadMinutes: number;
  prepareLeadMinutes?: number;
  gateTravelLeadMinutes?: number;
  dispatchPlanFresh?: boolean;
  inNearDispatchBatch?: boolean;
  gateCapacityCovered?: boolean;
  waitingForProductFairness?: boolean;
  waitingForFittingLane?: boolean;
  commitmentLocked?: boolean;
}

export interface AutomaticPrecallDecision {
  eligible: boolean;
  status: "WAITING" | "PREPARE" | "GO_TO_GATE";
  reason:
    | "ELIGIBLE"
    | "DISABLED"
    | "OPERATIONS_BLOCKED"
    | "NOT_QUEUE_FRONT"
    | "ALREADY_PRECALLED"
    | "NO_FORECAST_CAPACITY"
    | "NO_FITTING_AIRCRAFT"
    | "NOT_IN_NEAR_DISPATCH_BATCH"
    | "GATE_CAPACITY_COVERED"
    | "WAITING_FOR_PRODUCT_FAIRNESS"
    | "WAITING_FOR_FITTING_LANE"
    | "COMMITMENT_LOCKED"
    | "DISPATCH_PLAN_STALE"
    | "TOO_EARLY";
}

export interface AutomaticPrecallQueueEntry extends AutomaticPrecallInput {
  id: string;
  resourceGroupId: string;
  dispatchOrder?: number | null;
  queueSequence?: number;
}

export interface AutomaticPrecallQueueDecision extends AutomaticPrecallDecision {
  id: string;
  resourceGroupId: string;
}

export function deriveAdaptivePrecallLeadMinutes(input: {
  observedGateWaitMinutes: readonly number[];
  desiredGateWaitMinutes?: number;
  baselineLeadMinutes?: number;
  tuning?: PrecallTuningProfile;
}): number {
  const tuning = input.tuning ?? DEFAULT_PRECALL_TUNING_PROFILE;
  const desired = input.desiredGateWaitMinutes ?? tuning.desiredGateWaitMinutes;
  const baseline = input.baselineLeadMinutes ?? tuning.baselineLeadMinutes;
  const samples = input.observedGateWaitMinutes
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 60)
    .slice(-tuning.observationSampleLimit);
  samples.sort((left, right) => left - right);
  if (samples.length === 0) return baseline;
  const middle = Math.floor(samples.length / 2);
  const observedMedian =
    samples.length % 2 === 1
      ? (samples[middle] ?? desired)
      : ((samples[middle - 1] ?? desired) + (samples[middle] ?? desired)) / 2;
  const corrected = baseline + (desired - observedMedian) * tuning.correctionFactor;
  return Math.round(
    Math.min(tuning.maximumLeadMinutes, Math.max(tuning.minimumLeadMinutes, corrected)),
  );
}

export function normalizePrecallObservation(input: {
  observedGoToGateToBoardingMinutes: number;
  gateTravelLeadMinutesUsed: number;
}): number {
  if (
    !Number.isFinite(input.observedGoToGateToBoardingMinutes) ||
    !Number.isFinite(input.gateTravelLeadMinutesUsed)
  ) {
    throw new TypeError("Precall observation is invalid.");
  }
  return Math.max(
    0,
    input.observedGoToGateToBoardingMinutes - Math.max(0, input.gateTravelLeadMinutesUsed),
  );
}

export function decideAutomaticPrecall(input: AutomaticPrecallInput): AutomaticPrecallDecision {
  if (!input.enabled || !input.resourceGroupEnabled) {
    return { eligible: false, status: "WAITING", reason: "DISABLED" };
  }
  if (!input.eventActive || !input.operationsAvailable || !input.resourceGroupActive) {
    return { eligible: false, status: "WAITING", reason: "OPERATIONS_BLOCKED" };
  }
  if (input.dispatchPlanFresh === false) {
    return { eligible: false, status: "WAITING", reason: "DISPATCH_PLAN_STALE" };
  }
  if (input.alreadyPrecalled) {
    return { eligible: false, status: "GO_TO_GATE", reason: "ALREADY_PRECALLED" };
  }
  if (input.forecastCapacityStatus === "NO_FORECAST_CAPACITY") {
    return { eligible: false, status: "WAITING", reason: "NO_FORECAST_CAPACITY" };
  }
  if (input.forecastCapacityStatus === "NO_FITTING_AIRCRAFT") {
    return { eligible: false, status: "WAITING", reason: "NO_FITTING_AIRCRAFT" };
  }
  if (input.waitingForFittingLane) {
    return { eligible: false, status: "WAITING", reason: "WAITING_FOR_FITTING_LANE" };
  }
  if (input.waitingForProductFairness) {
    return { eligible: false, status: "WAITING", reason: "WAITING_FOR_PRODUCT_FAIRNESS" };
  }
  if (input.commitmentLocked) {
    return { eligible: false, status: "PREPARE", reason: "COMMITMENT_LOCKED" };
  }
  if (input.inNearDispatchBatch === false) {
    return { eligible: false, status: "WAITING", reason: "NOT_IN_NEAR_DISPATCH_BATCH" };
  }
  if (input.gateCapacityCovered) {
    return { eligible: false, status: "WAITING", reason: "GATE_CAPACITY_COVERED" };
  }
  const gateTravelLeadMinutes = Math.max(0, input.gateTravelLeadMinutes ?? 0);
  const effectiveGoToGateLead = input.adaptiveLeadMinutes + gateTravelLeadMinutes;
  if (input.predictedBoardingMinutes <= effectiveGoToGateLead) {
    return { eligible: true, status: "GO_TO_GATE", reason: "ELIGIBLE" };
  }
  const effectivePrepareLead =
    (input.prepareLeadMinutes ?? input.adaptiveLeadMinutes) + gateTravelLeadMinutes;
  if (input.predictedBoardingMinutes <= effectivePrepareLead) {
    return { eligible: false, status: "PREPARE", reason: "TOO_EARLY" };
  }
  return { eligible: false, status: "WAITING", reason: "TOO_EARLY" };
}

/**
 * Evaluates entries in deterministic dispatch order. An entry that is not selected for an early
 * batch does not block later queue entries which the dispatch plan needs for a complete batch.
 */
export function selectAutomaticPrecalls(
  entries: readonly AutomaticPrecallQueueEntry[],
): AutomaticPrecallQueueDecision[] {
  return entries
    .map((entry, inputOrder) => ({ entry, inputOrder }))
    .sort(
      (left, right) =>
        (left.entry.dispatchOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.entry.dispatchOrder ?? Number.MAX_SAFE_INTEGER) ||
        (left.entry.queueSequence ?? Number.MAX_SAFE_INTEGER) -
          (right.entry.queueSequence ?? Number.MAX_SAFE_INTEGER) ||
        left.inputOrder - right.inputOrder ||
        left.entry.id.localeCompare(right.entry.id),
    )
    .map(({ entry }) => ({
      id: entry.id,
      resourceGroupId: entry.resourceGroupId,
      ...decideAutomaticPrecall(entry),
    }));
}
