import type { ManualIncident, SimulationConfig } from "./model";
import { completeOperationalRotation } from "./operational-simulation-completion";
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
  deterministicSample,
  toSimulationIso as iso,
  roundSimulationTick as roundedTick,
} from "./simulation-primitives";

type OperationalLifecycleInput = {
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
};

export function advanceOperationalSimulationLifecycle(input: OperationalLifecycleInput): void {
  processManualIncidents(input);
  completeEndedPlans(input);
  advanceOperationalRotations(input);
  releaseBlockedAircraft(input);
  startReadyOperationalPlans(input);
  startPendingOperationalBlocks(input);
}

function processManualIncidents(input: OperationalLifecycleInput): void {
  for (const incident of input.manualIncidents) processManualIncident(incident, input);
}

function processManualIncident(incident: ManualIncident, input: OperationalLifecycleInput): void {
  recordInterruptionBoundaries(incident, input);
  queueManualAircraftBlock(incident, input);
}

function recordInterruptionBoundaries(
  incident: ManualIncident,
  input: OperationalLifecycleInput,
): void {
  if (incident.type !== "EVENT_INTERRUPTION") return;
  const { nowMs, recordedIncidentBoundaries, recordEvent } = input;
  const startsAt = roundedTick(Date.parse(incident.at));
  const startKey = `${incident.id}:start`;
  if (nowMs >= startsAt && !recordedIncidentBoundaries.has(startKey)) {
    recordedIncidentBoundaries.add(startKey);
    recordEvent("EVENT_INTERRUPTED", nowMs, {
      details: "Simulierte globale Betriebsunterbrechung bestätigt.",
    });
  }
  const endsAt = roundedTick(addMinutes(Date.parse(incident.at), incident.durationMinutes));
  const endKey = `${incident.id}:end`;
  if (nowMs >= endsAt && !recordedIncidentBoundaries.has(endKey)) {
    recordedIncidentBoundaries.add(endKey);
    recordEvent("EVENT_RESUMED", nowMs, {
      details: "Simulierte Wiederaufnahme des Betriebs bestätigt.",
    });
  }
}

function queueManualAircraftBlock(
  incident: ManualIncident,
  input: OperationalLifecycleInput,
): void {
  const { nowMs, aircraft, processedIncidentIds, startBlock } = input;
  const startsAt = roundedTick(Date.parse(incident.at));
  if (
    incident.type === "EVENT_INTERRUPTION" ||
    nowMs < startsAt ||
    processedIncidentIds.has(incident.id)
  ) {
    return;
  }
  processedIncidentIds.add(incident.id);
  const entry = aircraft.find((candidate) => candidate.id === incident.aircraftId);
  if (!entry) return;
  const block: OperationalBlock = {
    key: incident.id,
    state: manualIncidentBlockState(incident),
    durationMinutes: incident.durationMinutes,
    dayOutage: incident.dayOutage,
    source: "MANUAL",
  };
  if (entry.activeRotationId === null && entry.state === "AVAILABLE") {
    startBlock(entry, block, nowMs);
    return;
  }
  entry.pendingBlocks.push(block);
}

function manualIncidentBlockState(incident: ManualIncident): OperationalBlock["state"] {
  if (incident.type === "REFUELING") return "REFUELING";
  if (incident.type === "UNPLANNED_PAUSE") return "UNPLANNED_PAUSE";
  return incident.dayOutage ? "DAY_OUT" : "TECHNICAL_DEFECT";
}

function completeEndedPlans(input: OperationalLifecycleInput): void {
  for (const plan of input.plans) completeEndedPlan(plan, input);
}

function completeEndedPlan(plan: OperationalPlan, input: OperationalLifecycleInput): void {
  const { nowMs, recurringRules, recordEvent } = input;
  if (
    plan.actualStartMs === null ||
    plan.actualEndMs === null ||
    nowMs < plan.actualEndMs ||
    plan.completed
  ) {
    return;
  }
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

function advanceOperationalRotations(input: OperationalLifecycleInput): void {
  const { config, nowMs, aircraft, pilots, rotations, plans, recurringRules, recordEvent } = input;

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
      completeOperationalRotation({
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
}

function releaseBlockedAircraft(input: OperationalLifecycleInput): void {
  const { nowMs, aircraft, recordEvent } = input;

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
}

function startReadyOperationalPlans(input: OperationalLifecycleInput): void {
  for (const plan of input.plans) startOperationalPlanWhenReady(plan, input);
}

function startOperationalPlanWhenReady(
  plan: OperationalPlan,
  input: OperationalLifecycleInput,
): void {
  if (plan.actualStartMs !== null || plan.completed) return;
  if (!isOperationalPlanReady(plan, input)) return;
  if (!isOperationalPlanTargetIdle(plan, input.aircraft, input.pilots)) return;
  scheduleOperationalPlanDuration(plan, input.config, input.nowMs);
  applyOperationalPlanSlowdown(plan, input);
  input.recordEvent("PLANNED_OPERATION_STARTED", input.nowMs, {
    aircraftId: plan.scopeType === "AIRCRAFT" ? plan.scopeId : null,
    pilotId: plan.scopeType === "PILOT" ? plan.scopeId : null,
    plannedOperationId: plan.key,
    details: plan.publicNote ? `${plan.kind} · ${plan.publicNote}` : plan.kind,
  });
}

function isOperationalPlanReady(plan: OperationalPlan, input: OperationalLifecycleInput): boolean {
  if (plan.startMode === "TIME_WINDOW") {
    return plan.candidateStartMs !== null && input.nowMs >= plan.candidateStartMs;
  }
  if (plan.startMode !== "AFTER_CURRENT_ROTATION" || !plan.afterRotationId) return false;
  return input.rotations.some(
    (rotation) => rotation.id === plan.afterRotationId && rotation.status === "COMPLETED",
  );
}

function scheduleOperationalPlanDuration(
  plan: OperationalPlan,
  config: SimulationConfig,
  nowMs: number,
): void {
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
}

function applyOperationalPlanSlowdown(
  plan: OperationalPlan,
  input: OperationalLifecycleInput,
): void {
  if ((plan.effectMode ?? "BLOCKING") !== "SLOWDOWN") return;
  for (const rotation of input.rotations) {
    if (
      ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status) &&
      input.planAppliesToRotation(plan, rotation)
    ) {
      input.applySlowdownToRemainingPhases(
        rotation,
        input.activeSlowdownPercent(rotation, input.nowMs),
      );
    }
  }
}

function isOperationalPlanTargetIdle(
  plan: OperationalPlan,
  aircraft: readonly OperationalAircraft[],
  pilots: readonly OperationalPilot[],
): boolean {
  if ((plan.effectMode ?? "BLOCKING") === "SLOWDOWN") return true;
  if (plan.scopeType === "AIRCRAFT") {
    return aircraft.some(
      (entry) =>
        entry.id === plan.scopeId && entry.activeRotationId === null && entry.state === "AVAILABLE",
    );
  }
  if (plan.scopeType === "PILOT") {
    return pilots.some((pilot) => pilot.id === plan.scopeId && pilot.activeRotationId === null);
  }
  return true;
}

function startPendingOperationalBlocks(input: OperationalLifecycleInput): void {
  const { nowMs, aircraft, startBlock } = input;

  for (const entry of aircraft) {
    if (entry.state === "AVAILABLE" && entry.activeRotationId === null) {
      const block = entry.pendingBlocks.shift();
      if (block) startBlock(entry, block, nowMs);
    }
  }
}
