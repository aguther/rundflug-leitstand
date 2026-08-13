import type { RuntimeAircraft, RuntimeRotation } from "./legacy-simulation-scenario";
import { addSimulationMinutes } from "./simulation-primitives";

export function expectedAircraftAvailability(
  aircraft: RuntimeAircraft,
  activeRotation: RuntimeRotation | null,
  nowMs: number,
  referenceTotalMinutes: number,
): number {
  if (typeof aircraft.blockedUntilMs === "number") return aircraft.blockedUntilMs;
  if (activeRotation?.predictedCompletionAt) {
    return Date.parse(activeRotation.predictedCompletionAt);
  }
  if (aircraft.state === "ACTIVE") return addSimulationMinutes(nowMs, referenceTotalMinutes);
  return nowMs;
}
