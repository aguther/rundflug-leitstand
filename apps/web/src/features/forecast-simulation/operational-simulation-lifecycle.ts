import type { ManualIncident, SimulationConfig } from "./model";
import type {
  OperationalAircraft,
  OperationalBlock,
  OperationalPilot,
  OperationalPlan,
  OperationalRecurringRule,
  OperationalRotation,
  OperationalSimulationEventRecorder,
} from "./operational-simulation-scenario";
import {
  addSimulationMinutes as addMinutes,
  deterministicChance,
  deterministicSample,
  toSimulationIso as iso,
  roundSimulationTick as roundedTick,
} from "./simulation-primitives";

export function advanceOperationalSimulationLifecycle(input: {
  config: SimulationConfig;
  nowMs: number;
  manualIncidents: readonly ManualIncident[];
  aircraft: OperationalAircraft[];
  pilots: OperationalPilot[];
  rotations: OperationalRotation[];
  plans: OperationalPlan[];
  recurringRules: OperationalRecurringRule[];
  processedIncidentIds: Set<string>;
  recordedIncidentBoundaries: Set<string>;
  recordEvent: OperationalSimulationEventRecorder;
  planAppliesToRotation: (plan: OperationalPlan, rotation: OperationalRotation) => boolean;
  activeSlowdownPercent: (rotation: OperationalRotation, nowMs: number) => number;
  applySlowdownToRemainingPhases: (
    rotation: OperationalRotation,
    targetMultiplierPercent: number,
  ) => void;
  startBlock: (aircraft: OperationalAircraft, block: OperationalBlock, nowMs: number) => void;
}): void {
  const {
    config,
    nowMs,
    manualIncidents,
    aircraft,
    pilots,
    rotations,
    plans,
    recurringRules,
    processedIncidentIds,
    recordedIncidentBoundaries,
    recordEvent,
    planAppliesToRotation,
    activeSlowdownPercent,
    applySlowdownToRemainingPhases,
    startBlock,
  } = input;

  for (const incident of manualIncidents) {
    const startsAt = roundedTick(Date.parse(incident.at));
    if (
      incident.type === "EVENT_INTERRUPTION" &&
      nowMs >= startsAt &&
      !recordedIncidentBoundaries.has(`${incident.id}:start`)
    ) {
      recordedIncidentBoundaries.add(`${incident.id}:start`);
      recordEvent("EVENT_INTERRUPTED", nowMs, {
        details: "Simulierte globale Betriebsunterbrechung bestätigt.",
      });
    }
    const endsAt = roundedTick(addMinutes(Date.parse(incident.at), incident.durationMinutes));
    if (
      incident.type === "EVENT_INTERRUPTION" &&
      nowMs >= endsAt &&
      !recordedIncidentBoundaries.has(`${incident.id}:end`)
    ) {
      recordedIncidentBoundaries.add(`${incident.id}:end`);
      recordEvent("EVENT_RESUMED", nowMs, {
        details: "Simulierte Wiederaufnahme des Betriebs bestätigt.",
      });
    }
    if (
      incident.type !== "EVENT_INTERRUPTION" &&
      nowMs >= startsAt &&
      !processedIncidentIds.has(incident.id)
    ) {
      const entry = aircraft.find((candidate) => candidate.id === incident.aircraftId);
      processedIncidentIds.add(incident.id);
      if (entry) {
        const block: OperationalBlock = {
          key: incident.id,
          state:
            incident.type === "REFUELING"
              ? "REFUELING"
              : incident.type === "UNPLANNED_PAUSE"
                ? "UNPLANNED_PAUSE"
                : incident.dayOutage
                  ? "DAY_OUT"
                  : "TECHNICAL_DEFECT",
          durationMinutes: incident.durationMinutes,
          dayOutage: incident.dayOutage,
          source: "MANUAL",
        };
        if (entry.activeRotationId === null && entry.state === "AVAILABLE") {
          startBlock(entry, block, nowMs);
        } else {
          entry.pendingBlocks.push(block);
        }
      }
    }
  }

  for (const plan of plans) {
    if (
      plan.actualStartMs !== null &&
      plan.actualEndMs !== null &&
      nowMs >= plan.actualEndMs &&
      !plan.completed
    ) {
      plan.completed = true;
      if (plan.recurringRuleKey) {
        const rule = recurringRules.find((entry) => entry.key === plan.recurringRuleKey);
        if (rule) rule.currentProgress = 0;
      }
      recordEvent("PLANNED_OPERATION_ENDED", nowMs, {
        aircraftId: plan.scopeType === "AIRCRAFT" ? plan.scopeId : null,
        pilotId: plan.scopeType === "PILOT" ? plan.scopeId : null,
        plannedOperationId: plan.key,
        details: `Geplanter Eintrag ${plan.kind} beendet.`,
      });
    }
  }

  for (const rotation of rotations) {
    if (
      rotation.status === "CALLED" &&
      rotation.calledAt &&
      rotation.boardingMinutes !== null &&
      nowMs >= roundedTick(addMinutes(Date.parse(rotation.calledAt), rotation.boardingMinutes))
    ) {
      rotation.status = "IN_FLIGHT";
      rotation.departedAt = iso(nowMs);
      recordEvent("ROTATION_DEPARTED", nowMs, {
        aircraftId: rotation.aircraftId,
        pilotId: rotation.pilotId ?? null,
        rotationId: rotation.id,
        details: "Start bestätigt.",
      });
    }
    if (
      rotation.status === "IN_FLIGHT" &&
      rotation.departedAt &&
      rotation.flightMinutes !== null &&
      nowMs >= roundedTick(addMinutes(Date.parse(rotation.departedAt), rotation.flightMinutes))
    ) {
      rotation.status = "LANDED";
      rotation.landedAt = iso(nowMs);
      recordEvent("ROTATION_LANDED", nowMs, {
        aircraftId: rotation.aircraftId,
        pilotId: rotation.pilotId ?? null,
        rotationId: rotation.id,
        details: "Landung bestätigt; Ressource bleibt bis zum Abschluss gebunden.",
      });
    }
    if (
      rotation.status === "LANDED" &&
      rotation.landedAt &&
      rotation.deboardingMinutes !== null &&
      rotation.bufferMinutes !== null &&
      nowMs >=
        roundedTick(
          addMinutes(
            Date.parse(rotation.landedAt),
            rotation.deboardingMinutes + rotation.bufferMinutes,
          ),
        )
    ) {
      completeRotation({
        config,
        nowMs,
        rotation,
        aircraft,
        pilots,
        plans,
        recurringRules,
        recordEvent,
      });
    }
  }

  for (const entry of aircraft) {
    if (
      entry.blockedUntilMs !== null &&
      nowMs >= entry.blockedUntilMs &&
      entry.state !== "AVAILABLE"
    ) {
      entry.state = "AVAILABLE";
      entry.blockedUntilMs = null;
      recordEvent("AIRCRAFT_RETURN_CONFIRMED", nowMs, {
        aircraftId: entry.id,
        details: "Rückkehr in die Verfügbarkeit bestätigt.",
      });
    }
  }

  for (const plan of plans) {
    if (plan.actualStartMs !== null || plan.completed) continue;
    const afterRotationReady =
      plan.startMode === "AFTER_CURRENT_ROTATION" &&
      plan.afterRotationId &&
      rotations.some(
        (rotation) => rotation.id === plan.afterRotationId && rotation.status === "COMPLETED",
      );
    const timeReady =
      plan.startMode === "TIME_WINDOW" &&
      plan.candidateStartMs !== null &&
      nowMs >= plan.candidateStartMs;
    if (!afterRotationReady && !timeReady) continue;
    const targetIdle =
      (plan.effectMode ?? "BLOCKING") === "SLOWDOWN"
        ? true
        : plan.scopeType === "AIRCRAFT"
          ? aircraft.some(
              (entry) =>
                entry.id === plan.scopeId &&
                entry.activeRotationId === null &&
                entry.state === "AVAILABLE",
            )
          : plan.scopeType === "PILOT"
            ? pilots.some((pilot) => pilot.id === plan.scopeId && pilot.activeRotationId === null)
            : true;
    if (!targetIdle) continue;
    plan.actualStartMs = nowMs;
    plan.actualEndMs = roundedTick(
      addMinutes(
        nowMs,
        deterministicSample(config.seed, `${plan.key}:duration`, {
          minimum: plan.minimumDurationMinutes,
          typical: plan.typicalDurationMinutes,
          maximum: plan.maximumDurationMinutes,
        }),
      ),
    );
    if ((plan.effectMode ?? "BLOCKING") === "SLOWDOWN") {
      for (const rotation of rotations) {
        if (
          ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status) &&
          planAppliesToRotation(plan, rotation)
        ) {
          applySlowdownToRemainingPhases(rotation, activeSlowdownPercent(rotation, nowMs));
        }
      }
    }
    recordEvent("PLANNED_OPERATION_STARTED", nowMs, {
      aircraftId: plan.scopeType === "AIRCRAFT" ? plan.scopeId : null,
      pilotId: plan.scopeType === "PILOT" ? plan.scopeId : null,
      plannedOperationId: plan.key,
      details: `${plan.kind}${plan.publicNote ? ` · ${plan.publicNote}` : ""}`,
    });
  }

  for (const entry of aircraft) {
    if (entry.state === "AVAILABLE" && entry.activeRotationId === null) {
      const block = entry.pendingBlocks.shift();
      if (block) startBlock(entry, block, nowMs);
    }
  }
}

function completeRotation(input: {
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
    entry.operatingMinutes += rotationOperatingMinutes;
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
