import type { ForecastTimelineProjection, ForecastTimelinesInput } from "./forecast-types";
import { calculateUnifiedForecastTimelineResult } from "./forecast-unified-projection";

export { calculateUnifiedForecastTimelineResult as calculateForecastTimelineResult } from "./forecast-unified-projection";

export function calculateForecastTimelines(
  input: ForecastTimelinesInput,
): ForecastTimelineProjection[] {
  return calculateUnifiedForecastTimelineResult(input).projections;
}
