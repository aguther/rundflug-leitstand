import type { ForecastTimelineProjection, ForecastTimelinesInput } from "./forecast-types";
import { calculateUnifiedForecastTimelineResult } from "./forecast-unified-projection";

export const calculateForecastTimelineResult = calculateUnifiedForecastTimelineResult;

export function calculateForecastTimelines(
  input: ForecastTimelinesInput,
): ForecastTimelineProjection[] {
  return calculateUnifiedForecastTimelineResult(input).projections;
}
