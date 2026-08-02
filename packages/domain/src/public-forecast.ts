import type { DispatchUnplannedReason } from "./dispatch-plan";
import type { ForecastState, PredictionQuality } from "./forecast";

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

export function derivePublicForecastProjection(input: {
  rotationStatus: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
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
  if (input.emergencyMode) {
    return { forecastState: "UNAVAILABLE", forecastReason: "EMERGENCY_MODE" };
  }
  if (input.operationalInterrupted) {
    return { forecastState: "UNAVAILABLE", forecastReason: "OPERATIONS_INTERRUPTED" };
  }
  if (input.resourceGroupStatus === "INTERRUPTED" || input.resourceGroupStatus === "ENDED") {
    return { forecastState: "UNAVAILABLE", forecastReason: "RESOURCE_GROUP_UNAVAILABLE" };
  }
  if (input.predictedBoardingAt && input.predictionQuality !== "UNCERTAIN") {
    const completionMs = input.predictedCompletionAt
      ? Date.parse(input.predictedCompletionAt)
      : Number.NaN;
    const operationsEndMs = input.operationsEndAt ? Date.parse(input.operationsEndAt) : Number.NaN;
    if (
      Number.isFinite(completionMs) &&
      Number.isFinite(operationsEndMs) &&
      completionMs > operationsEndMs
    ) {
      return { forecastState: "AFTER_OPERATIONS_END", forecastReason: null };
    }
    return {
      forecastState: input.dispatchBatchId ? "DISPATCH_WINDOW" : "LONG_RANGE_WINDOW",
      forecastReason: null,
    };
  }
  if (input.dispatchUnplannedReason === "UNKNOWN_RESOURCE_RETURN") {
    return { forecastState: "UNAVAILABLE", forecastReason: "RETURN_TIME_UNKNOWN" };
  }
  if (
    input.dispatchUnplannedReason === "WAITING_FOR_FITTING_LANE" ||
    input.dispatchUnplannedReason === "NO_FORECAST_CAPACITY"
  ) {
    return {
      forecastState: "UNAVAILABLE",
      forecastReason:
        input.resourceGroupStatus === "PAUSED" ? "RETURN_TIME_UNKNOWN" : "NO_MATCHING_CAPACITY",
    };
  }
  if (
    input.dispatchUnplannedReason === "ATTENDANCE_MISSING" ||
    input.dispatchUnplannedReason === "ATTENDANCE_CLARIFICATION"
  ) {
    return { forecastState: "UNAVAILABLE", forecastReason: "STATUS_CLARIFICATION" };
  }
  return { forecastState: "UNAVAILABLE", forecastReason: null };
}
