import type { RuntimeAircraft, RuntimeRotation } from "./legacy-simulation-scenario";
import type { SimulationConfig } from "./model";
import { deterministicChance, deterministicSample } from "./simulation-primitives";

export function queueAutomaticBlocks(
  config: SimulationConfig,
  entry: RuntimeAircraft,
  rotation: RuntimeRotation,
  operatingMinutes: number,
): void {
  if (
    config.realityModel.incidents.refueling.enabled &&
    entry.completedRotations % config.realityModel.incidents.refueling.everyRotations === 0
  ) {
    entry.pendingBlocks.push({
      key: `${rotation.id}:refueling`,
      state: "REFUELING",
      durationMinutes: deterministicSample(
        config.seed,
        `${rotation.id}:refueling-duration`,
        config.realityModel.incidents.refueling.duration,
      ),
      dayOutage: false,
      source: "AUTOMATIC",
    });
  }
  if (
    config.realityModel.incidents.plannedPause.enabled &&
    entry.operatingMinutes >= entry.nextPauseAtMinutes
  ) {
    entry.pendingBlocks.push({
      key: `${rotation.id}:planned-pause`,
      state: "PLANNED_PAUSE",
      durationMinutes: deterministicSample(
        config.seed,
        `${rotation.id}:planned-pause-duration`,
        config.realityModel.incidents.plannedPause.duration,
      ),
      dayOutage: false,
      source: "AUTOMATIC",
    });
    entry.nextPauseAtMinutes += config.realityModel.incidents.plannedPause.everyOperatingMinutes;
  }
  const unplannedProbability =
    1 -
    Math.exp(
      -config.realityModel.incidents.unplannedPause.ratePerOperatingHour * (operatingMinutes / 60),
    );
  if (
    config.realityModel.incidents.unplannedPause.enabled &&
    deterministicChance(config.seed, `${rotation.id}:unplanned-pause-chance`) < unplannedProbability
  ) {
    entry.pendingBlocks.push({
      key: `${rotation.id}:unplanned-pause`,
      state: "UNPLANNED_PAUSE",
      durationMinutes: deterministicSample(
        config.seed,
        `${rotation.id}:unplanned-pause-duration`,
        config.realityModel.incidents.unplannedPause.duration,
      ),
      dayOutage: false,
      source: "AUTOMATIC",
    });
  }
  const defectProbability =
    1 -
    Math.exp(
      -config.realityModel.incidents.technicalDefect.ratePerOperatingHour * (operatingMinutes / 60),
    );
  if (
    config.realityModel.incidents.technicalDefect.enabled &&
    deterministicChance(config.seed, `${rotation.id}:defect-chance`) < defectProbability
  ) {
    const dayOutage =
      deterministicChance(config.seed, `${rotation.id}:day-outage-chance`) <
      config.realityModel.incidents.technicalDefect.dayOutageProbability;
    entry.pendingBlocks.push({
      key: `${rotation.id}:technical-defect`,
      state: dayOutage ? "DAY_OUT" : "TECHNICAL_DEFECT",
      durationMinutes: deterministicSample(
        config.seed,
        `${rotation.id}:technical-defect-duration`,
        config.realityModel.incidents.technicalDefect.duration,
      ),
      dayOutage,
      source: "AUTOMATIC",
    });
  }
}
