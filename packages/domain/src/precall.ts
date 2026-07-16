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
  minimumQuality: Exclude<PrecallQuality, "UNCERTAIN">;
  predictedUpperMinutes: number;
  leadMinutes: number;
  maximumGateWaitMinutes: number;
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
    | "PREDICTION_UNCERTAIN"
    | "TOO_EARLY"
    | "GATE_WAIT_TOO_LONG"
    | "GATE_COOLDOWN";
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
  if (
    input.predictionQuality === "UNCERTAIN" ||
    (input.minimumQuality === "STABLE" && input.predictionQuality !== "STABLE")
  ) {
    return { eligible: false, reason: "PREDICTION_UNCERTAIN" };
  }
  if (input.predictedUpperMinutes > input.leadMinutes) {
    return { eligible: false, reason: "TOO_EARLY" };
  }
  if (input.predictedUpperMinutes > input.maximumGateWaitMinutes) {
    return { eligible: false, reason: "GATE_WAIT_TOO_LONG" };
  }
  if (
    input.minutesSinceLastGatePrecall !== null &&
    input.minutesSinceLastGatePrecall < input.gateCooldownMinutes
  ) {
    return { eligible: false, reason: "GATE_COOLDOWN" };
  }
  return { eligible: true, reason: "ELIGIBLE" };
}
