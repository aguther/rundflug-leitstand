import { calculateForecastTimelineResult } from "@rundflug/domain";
import {
  applyActiveForecastProjections,
  type ForecastTimelineData,
  projectForecastTimelineInput,
} from "./forecast-timeline-projector";

export function calculateConvergedForecastTimeline(loaded: ForecastTimelineData, eventId: string) {
  let projected = projectForecastTimelineInput(loaded, eventId);
  const calculationStartedAtMs = performance.now();
  let calculationResult = calculateForecastTimelineResult(projected.forecastInput);
  const convergedData = applyActiveForecastProjections(loaded, calculationResult.projections);
  if (convergedData) {
    projected = projectForecastTimelineInput(convergedData, eventId, projected.now);
    calculationResult = calculateForecastTimelineResult(projected.forecastInput);
  }
  return {
    ...projected,
    calculationResult,
    calculationDurationMs: Math.max(0, performance.now() - calculationStartedAtMs),
  };
}
