import type { AutomaticPrecallQueueDecision, ForecastCalculationResult } from "@rundflug/domain";

type ForecastProjection = ForecastCalculationResult["projections"][number];

const LEGACY_PRECALL_REASONS = new Set([
  "ELIGIBLE",
  "DISABLED",
  "OPERATIONS_BLOCKED",
  "NOT_QUEUE_FRONT",
  "ALREADY_PRECALLED",
  "NO_FORECAST_CAPACITY",
  "NO_FITTING_AIRCRAFT",
  "TOO_EARLY",
]);

export function isForecastSnapshotEligible(projection: ForecastProjection): boolean {
  return (
    projection.capacityStatus === "AVAILABLE" &&
    projection.predictionLowerMinutes !== null &&
    projection.predictionUpperMinutes !== null
  );
}

export function mapForecastPrecallReasons(reason: AutomaticPrecallQueueDecision["reason"]): {
  legacyReason: string;
  dispatchReason: string | null;
} {
  if (LEGACY_PRECALL_REASONS.has(reason)) {
    return { legacyReason: reason, dispatchReason: null };
  }
  return { legacyReason: "TOO_EARLY", dispatchReason: reason };
}
