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
  groupSize: number;
  largestEligibleAircraftSeats: number;
  predictionQuality: PrecallQuality;
  predictedBoardingMinutes: number;
  adaptiveLeadMinutes: number;
  minutesSinceLastGatePrecall: number | null;
  gateCooldownMinutes: number;
}

export interface AutomaticPrecallDecision {
  eligible: boolean;
  reason:
    | "ELIGIBLE"
    | "DISABLED"
    | "OPERATIONS_BLOCKED"
    | "NOT_QUEUE_FRONT"
    | "ALREADY_PRECALLED"
    | "NO_FITTING_AIRCRAFT"
    | "TOO_EARLY"
    | "GATE_COOLDOWN";
}

export interface AutomaticPrecallQueueEntry extends AutomaticPrecallInput {
  id: string;
  resourceGroupId: string;
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

export function decideAutomaticPrecall(input: AutomaticPrecallInput): AutomaticPrecallDecision {
  if (!input.enabled || !input.resourceGroupEnabled) return { eligible: false, reason: "DISABLED" };
  if (!input.eventActive || !input.operationsAvailable || !input.resourceGroupActive) {
    return { eligible: false, reason: "OPERATIONS_BLOCKED" };
  }
  if (input.alreadyPrecalled) return { eligible: false, reason: "ALREADY_PRECALLED" };
  if (input.groupSize < 1 || input.groupSize > input.largestEligibleAircraftSeats) {
    return { eligible: false, reason: "NO_FITTING_AIRCRAFT" };
  }
  if (input.predictedBoardingMinutes > input.adaptiveLeadMinutes) {
    return { eligible: false, reason: "TOO_EARLY" };
  }
  if (
    input.minutesSinceLastGatePrecall !== null &&
    input.minutesSinceLastGatePrecall < input.gateCooldownMinutes
  ) {
    return { eligible: false, reason: "GATE_COOLDOWN" };
  }
  return { eligible: true, reason: "ELIGIBLE" };
}

/**
 * Evaluates queue entries in their caller-provided stable order. A resource group's first
 * ineligible, not-yet-precalled entry closes that queue prefix for the current forecast run.
 * Already-precalled entries keep their place without blocking eligible followers.
 */
export function selectAutomaticPrecalls(
  entries: readonly AutomaticPrecallQueueEntry[],
): AutomaticPrecallQueueDecision[] {
  const blockedResourceGroups = new Set<string>();
  return entries.map((entry) => {
    if (blockedResourceGroups.has(entry.resourceGroupId)) {
      return {
        id: entry.id,
        resourceGroupId: entry.resourceGroupId,
        eligible: false,
        reason: "NOT_QUEUE_FRONT",
      };
    }
    const decision = decideAutomaticPrecall(entry);
    if (!decision.eligible && decision.reason !== "ALREADY_PRECALLED") {
      blockedResourceGroups.add(entry.resourceGroupId);
    }
    return {
      id: entry.id,
      resourceGroupId: entry.resourceGroupId,
      ...decision,
    };
  });
}
