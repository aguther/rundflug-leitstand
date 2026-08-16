import { calculateForecastTimelineResult } from "@rundflug/domain";
import {
  type ForecastTimelineData,
  projectForecastTimelineInput,
} from "./forecast-timeline-projector";

export function calculateForecastTimelineOnce(loaded: ForecastTimelineData, eventId: string) {
  const projected = projectForecastTimelineInput(loaded, eventId);
  const calculationStartedAtMs = performance.now();
  const calculationResult = calculateForecastTimelineResult(projected.forecastInput);
  return {
    ...projected,
    calculationResult,
    calculationDurationMs: Math.max(0, performance.now() - calculationStartedAtMs),
  };
}
