export type PrecallQuality = "STABLE" | "CHANGING" | "UNCERTAIN";

export interface AutomaticPrecallInput {
  enabled: boolean;
  eventActive: boolean;
  operationsAvailable: boolean;
  resourceGroupActive: boolean;
  resourceGroupEnabled: boolean;
  firstWaitingGroup: boolean;
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

export function deriveAdaptivePrecallLeadMinutes(input: {
  observedGateWaitMinutes: readonly number[];
  desiredGateWaitMinutes?: number;
  baselineLeadMinutes?: number;
}): number {
  const desired = input.desiredGateWaitMinutes ?? 8;
  const baseline = input.baselineLeadMinutes ?? 12;
  const samples = input.observedGateWaitMinutes
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 60)
    .slice(-8);
  samples.sort((left, right) => left - right);
  if (samples.length === 0) return baseline;
  const middle = Math.floor(samples.length / 2);
  const observedMedian =
    samples.length % 2 === 1
      ? (samples[middle] ?? desired)
      : ((samples[middle - 1] ?? desired) + (samples[middle] ?? desired)) / 2;
  const corrected = baseline + (desired - observedMedian) * 0.5;
  return Math.round(Math.min(18, Math.max(6, corrected)));
}

export function decideAutomaticPrecall(input: AutomaticPrecallInput): AutomaticPrecallDecision {
  if (!input.enabled || !input.resourceGroupEnabled) return { eligible: false, reason: "DISABLED" };
  if (!input.eventActive || !input.operationsAvailable || !input.resourceGroupActive) {
    return { eligible: false, reason: "OPERATIONS_BLOCKED" };
  }
  if (!input.firstWaitingGroup) return { eligible: false, reason: "NOT_QUEUE_FRONT" };
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
