import type { SimulationConfig } from "./model";
import type {
  OperationalAircraft,
  OperationalPilot,
  OperationalPlan,
  OperationalRecurringRule,
  OperationalRotation,
  OperationalSimulationEventRecorder,
} from "./operational-simulation-scenario";
import {
  deterministicChance,
  deterministicSample,
  toSimulationIso as iso,
} from "./simulation-primitives";

export function completeOperationalRotation(input: {
  config: SimulationConfig;
  nowMs: number;
  rotation: OperationalRotation;
  aircraft: OperationalAircraft[];
  pilots: OperationalPilot[];
  plans: OperationalPlan[];
  recurringRules: OperationalRecurringRule[];
  recordEvent: OperationalSimulationEventRecorder;
}): void {
  const { config, nowMs, rotation, aircraft, pilots, plans, recurringRules, recordEvent } = input;
  rotation.status = "COMPLETED";
  rotation.completedAt = iso(nowMs);
  const entry = aircraft.find((candidate) => candidate.id === rotation.aircraftId);
  const pilot = pilots.find((candidate) => candidate.id === rotation.pilotId);
  if (entry) {
    entry.state = "AVAILABLE";
    entry.activeRotationId = null;
    entry.completedRotations += 1;
    const rotationOperatingMinutes =
      (rotation.boardingMinutes ?? 0) +
      (rotation.flightMinutes ?? 0) +
      (rotation.deboardingMinutes ?? 0) +
      (rotation.bufferMinutes ?? 0);
    scheduleRecurringOperations({
      rotation,
      entry,
      pilot,
      plans,
      recurringRules,
      rotationOperatingMinutes,
    });
    scheduleAutomaticBlocks({
      config,
      rotation,
      entry,
      pilot,
      recurringRules,
      rotationOperatingMinutes,
    });
  }
  if (pilot) pilot.activeRotationId = null;
  recordEvent("ROTATION_COMPLETED", nowMs, {
    aircraftId: rotation.aircraftId,
    pilotId: rotation.pilotId ?? null,
    rotationId: rotation.id,
    details: "Turnaround abgeschlossen; Flugzeug und Pilot wieder verfügbar.",
  });
}

function scheduleRecurringOperations(input: {
  rotation: OperationalRotation;
  entry: OperationalAircraft;
  pilot: OperationalPilot | undefined;
  plans: OperationalPlan[];
  recurringRules: OperationalRecurringRule[];
  rotationOperatingMinutes: number;
}): void {
  const { rotation, entry, pilot, plans, recurringRules, rotationOperatingMinutes } = input;
  const dueRules = recurringRules.filter(
    (rule) =>
      (rule.scopeType === "AIRCRAFT" && rule.scopeId === entry.id) ||
      (rule.scopeType === "PILOT" && rule.scopeId === pilot?.id),
  );
  for (const rule of dueRules) {
    rule.currentProgress +=
      rule.triggerMetric === "COMPLETED_ROTATIONS" ? 1 : rotationOperatingMinutes;
    const hasOpenOccurrence = plans.some(
      (plan) => plan.recurringRuleKey === rule.key && !plan.completed,
    );
    if (rule.currentProgress < rule.intervalValue || hasOpenOccurrence) continue;
    rule.sequenceNumber += 1;
    plans.push({
      key: `${rule.key}:occurrence-${rule.sequenceNumber}`,
      scopeType: rule.scopeType,
      scopeId: rule.scopeId,
      kind: rule.kind,
      effectMode: "BLOCKING",
      durationMultiplierPercent: null,
      startMode: "AFTER_CURRENT_ROTATION",
      earliestStartAt: null,
      latestStartAt: null,
      afterRotationId: rotation.id,
      unresolvedAfterCurrentRotation: false,
      minimumDurationMinutes: rule.minimumDurationMinutes,
      typicalDurationMinutes: rule.typicalDurationMinutes,
      maximumDurationMinutes: rule.maximumDurationMinutes,
      publicNote: "",
      candidateStartMs: null,
      actualStartMs: null,
      actualEndMs: null,
      completed: false,
      recurringRuleKey: rule.key,
    });
  }
}

function scheduleAutomaticBlocks(input: {
  config: SimulationConfig;
  rotation: OperationalRotation;
  entry: OperationalAircraft;
  pilot: OperationalPilot | undefined;
  recurringRules: OperationalRecurringRule[];
  rotationOperatingMinutes: number;
}): void {
  const { config, rotation, entry, pilot, recurringRules, rotationOperatingMinutes } = input;
  const importedRefuelingRule = recurringRules.some(
    (rule) =>
      rule.kind === "REFUELING" && rule.scopeType === "AIRCRAFT" && rule.scopeId === entry.id,
  );
  if (
    config.realityModel.incidents.refueling.enabled &&
    !importedRefuelingRule &&
    entry.completedRotations % config.realityModel.incidents.refueling.everyRotations === 0
  ) {
    entry.pendingBlocks.push({
      key: `${rotation.id}:refueling`,
      state: "REFUELING",
      durationMinutes: deterministicSample(
        config.seed,
        `${rotation.id}:refueling`,
        config.realityModel.incidents.refueling.duration,
      ),
      dayOutage: false,
      source: "AUTOMATIC",
    });
  }
  const importedPauseRule = recurringRules.some(
    (rule) =>
      rule.kind === "PAUSE" &&
      ((rule.scopeType === "AIRCRAFT" && rule.scopeId === entry.id) ||
        (rule.scopeType === "PILOT" && rule.scopeId === pilot?.id)),
  );
  if (
    config.realityModel.incidents.plannedPause.enabled &&
    !importedPauseRule &&
    Math.floor(
      entry.operatingMinutes / config.realityModel.incidents.plannedPause.everyOperatingMinutes,
    ) >
      Math.floor(
        (entry.operatingMinutes - rotationOperatingMinutes) /
          config.realityModel.incidents.plannedPause.everyOperatingMinutes,
      )
  ) {
    entry.pendingBlocks.push({
      key: `${rotation.id}:planned-pause`,
      state: "PLANNED_PAUSE",
      durationMinutes: deterministicSample(
        config.seed,
        `${rotation.id}:planned-pause`,
        config.realityModel.incidents.plannedPause.duration,
      ),
      dayOutage: false,
      source: "AUTOMATIC",
    });
  }
  const operatingHours = rotationOperatingMinutes / 60;
  if (
    config.realityModel.incidents.unplannedPause.enabled &&
    deterministicChance(config.seed, `${rotation.id}:unplanned`) <
      1 -
        Math.exp(
          -config.realityModel.incidents.unplannedPause.ratePerOperatingHour * operatingHours,
        )
  ) {
    entry.pendingBlocks.push({
      key: `${rotation.id}:unplanned`,
      state: "UNPLANNED_PAUSE",
      durationMinutes: deterministicSample(
        config.seed,
        `${rotation.id}:unplanned`,
        config.realityModel.incidents.unplannedPause.duration,
      ),
      dayOutage: false,
      source: "AUTOMATIC",
    });
  }
}
