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
  const {
    nowMs,
    manualIncidents,
    aircraft,
    processedIncidentIds,
    recordedIncidentBoundaries,
    recordEvent,
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
          state: manualIncidentBlockState(incident),
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
}

function manualIncidentBlockState(incident: ManualIncident): OperationalBlock["state"] {
  if (incident.type === "REFUELING") return "REFUELING";
  if (incident.type === "UNPLANNED_PAUSE") return "UNPLANNED_PAUSE";
  return incident.dayOutage ? "DAY_OUT" : "TECHNICAL_DEFECT";
}

function completeEndedPlans(input: OperationalLifecycleInput): void {
  const { nowMs, plans, recurringRules, recordEvent } = input;

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
  const {
    config,
    nowMs,
    aircraft,
    pilots,
    rotations,
    plans,
    recordEvent,
    planAppliesToRotation,
    activeSlowdownPercent,
    applySlowdownToRemainingPhases,
  } = input;

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
    if (!isOperationalPlanTargetIdle(plan, aircraft, pilots)) continue;
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
      details: plan.publicNote ? `${plan.kind} · ${plan.publicNote}` : plan.kind,
    });
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
