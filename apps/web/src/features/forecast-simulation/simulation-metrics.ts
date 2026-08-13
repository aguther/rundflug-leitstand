import type {
  SimulationDispatchDiagnostics,
  SimulationEvent,
  SimulationForecastSnapshot,
  SimulationMetrics,
  SimulationRotation,
} from "./model";
import {
  calculateForecastAccuracyMetrics,
  calculateForecastQualityMetrics,
  calculateOperationalMetrics,
  calculatePrecallMetrics,
  calculateStabilityMetrics,
} from "./simulation-metric-sections";

export function calculateSimulationMetrics(input: {
  rotations: readonly SimulationRotation[];
  snapshots: readonly SimulationForecastSnapshot[];
  events: readonly SimulationEvent[];
  operationsStartAt?: string;
  operationsEndAt?: string;
  aircraftCount?: number;
  dispatchDiagnostics?: SimulationDispatchDiagnostics;
}): SimulationMetrics {
  const accuracy = calculateForecastAccuracyMetrics(input.rotations, input.snapshots);
  const quality = calculateForecastQualityMetrics(input.snapshots);
  const operational = calculateOperationalMetrics(input);
  const reactionSeconds = input.events.map(
    (event) => (Date.parse(event.forecastRecalculatedAt) - Date.parse(event.occurredAt)) / 1_000,
  );

  return {
    ...accuracy,
    ...quality,
    precall: calculatePrecallMetrics(input.rotations),
    stability: calculateStabilityMetrics(input.snapshots),
    ...operational,
    maximumEventReactionSeconds: reactionSeconds.length === 0 ? 0 : Math.max(...reactionSeconds),
  };
}
