import {
  FORECAST_FRESHNESS_MAX_AGE_MINUTES,
  type ForecastFreshnessAssessment,
  type PredictionQuality,
} from "./forecast-types";

export function assessForecastFreshness(input: {
  predictionQuality: PredictionQuality | null;
  predictionUpdatedAt: string | null;
  now: string;
  maximumAgeMinutes?: number;
}): ForecastFreshnessAssessment {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("Forecast freshness time is invalid.");
  const maximumAgeMinutes = input.maximumAgeMinutes ?? FORECAST_FRESHNESS_MAX_AGE_MINUTES;
  if (!Number.isFinite(maximumAgeMinutes) || maximumAgeMinutes < 0) {
    throw new Error("Forecast freshness maximum age is invalid.");
  }
  const updatedAtMs = input.predictionUpdatedAt
    ? Date.parse(input.predictionUpdatedAt)
    : Number.NaN;
  if (input.predictionQuality === null || !Number.isFinite(updatedAtMs)) {
    return {
      quality: "UNCERTAIN",
      reason: "STALE_PREDICTION",
      ageMinutes: null,
    };
  }
  const ageMinutes = Math.max(0, (nowMs - updatedAtMs) / 60_000);
  if (ageMinutes > maximumAgeMinutes) {
    return { quality: "UNCERTAIN", reason: "STALE_PREDICTION", ageMinutes };
  }
  return { quality: input.predictionQuality, reason: null, ageMinutes };
}

export function operationsEndAssessment(
  predictedCompletionAt: string | null,
  plannedOperationsEndAt: string | null | undefined,
): { extendsBeyondOperationsEnd: boolean; overtimeMinutes: number } {
  const completionMs = predictedCompletionAt ? Date.parse(predictedCompletionAt) : Number.NaN;
  const operationsEndMs = plannedOperationsEndAt ? Date.parse(plannedOperationsEndAt) : Number.NaN;
  if (!Number.isFinite(completionMs) || !Number.isFinite(operationsEndMs)) {
    return { extendsBeyondOperationsEnd: false, overtimeMinutes: 0 };
  }
  const overtimeMinutes = Math.max(0, Math.ceil((completionMs - operationsEndMs) / 60_000));
  return {
    extendsBeyondOperationsEnd: overtimeMinutes > 0,
    overtimeMinutes,
  };
}
