import type { DispatchUnplannedReason } from "./dispatch-plan";
import type { ForecastState, PredictionQuality } from "./forecast";
import type { NonCanceledRotationState } from "./rotation-state";

export type PublicForecastReason =
  | "RETURN_TIME_UNKNOWN"
  | "NO_MATCHING_CAPACITY"
  | "STATUS_CLARIFICATION"
  | "OPERATIONS_INTERRUPTED"
  | "EMERGENCY_MODE"
  | "RESOURCE_GROUP_UNAVAILABLE";

export interface PublicForecastProjection {
  forecastState: ForecastState;
  forecastReason: PublicForecastReason | null;
}

type PublicForecastInput = Parameters<typeof derivePublicForecastProjection>[0];

function operationalUnavailabilityReason(input: PublicForecastInput): PublicForecastReason | null {
  if (input.emergencyMode) return "EMERGENCY_MODE";
  if (input.operationalInterrupted) return "OPERATIONS_INTERRUPTED";
  if (input.resourceGroupStatus === "INTERRUPTED" || input.resourceGroupStatus === "ENDED") {
    return "RESOURCE_GROUP_UNAVAILABLE";
  }
  return null;
}

function forecastWindowState(input: PublicForecastInput): ForecastState | null {
  if (!input.predictedBoardingAt || input.predictionQuality === "UNCERTAIN") return null;
  const completionMs = input.predictedCompletionAt
    ? Date.parse(input.predictedCompletionAt)
    : Number.NaN;
  const operationsEndMs = input.operationsEndAt ? Date.parse(input.operationsEndAt) : Number.NaN;
  if (
    Number.isFinite(completionMs) &&
    Number.isFinite(operationsEndMs) &&
    completionMs > operationsEndMs
  ) {
    return "AFTER_OPERATIONS_END";
  }
  return input.dispatchBatchId ? "DISPATCH_WINDOW" : "LONG_RANGE_WINDOW";
}

function unplannedForecastReason(input: PublicForecastInput): PublicForecastReason | null {
  if (input.dispatchUnplannedReason === "UNKNOWN_RESOURCE_RETURN") return "RETURN_TIME_UNKNOWN";
  if (
    input.dispatchUnplannedReason === "WAITING_FOR_FITTING_LANE" ||
    input.dispatchUnplannedReason === "NO_FORECAST_CAPACITY"
  ) {
    return input.resourceGroupStatus === "PAUSED" ? "RETURN_TIME_UNKNOWN" : "NO_MATCHING_CAPACITY";
  }
  if (
    input.dispatchUnplannedReason === "ATTENDANCE_MISSING" ||
    input.dispatchUnplannedReason === "ATTENDANCE_CLARIFICATION"
  ) {
    return "STATUS_CLARIFICATION";
  }
  return null;
}

export function derivePublicForecastProjection(input: {
  rotationStatus: NonCanceledRotationState;
  predictionQuality: PredictionQuality;
  predictedBoardingAt: string | null;
  predictedCompletionAt: string | null;
  operationsEndAt: string | null;
  dispatchBatchId: string | null;
  dispatchUnplannedReason: DispatchUnplannedReason | null;
  emergencyMode: boolean;
  operationalInterrupted: boolean;
  resourceGroupStatus: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
}): PublicForecastProjection {
  if (input.rotationStatus !== "DRAFT") {
    return { forecastState: "UNAVAILABLE", forecastReason: null };
  }
  const unavailableReason = operationalUnavailabilityReason(input);
  if (unavailableReason) return { forecastState: "UNAVAILABLE", forecastReason: unavailableReason };
  const windowState = forecastWindowState(input);
  if (windowState) return { forecastState: windowState, forecastReason: null };
  return { forecastState: "UNAVAILABLE", forecastReason: unplannedForecastReason(input) };
}
