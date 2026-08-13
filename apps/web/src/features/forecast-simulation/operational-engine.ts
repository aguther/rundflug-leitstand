import type { DispatchPlan } from "@rundflug/domain";
import type {
  ManualIncident,
  SimulationConfig,
  SimulationDispatchDiagnostics,
  SimulationEvent,
  SimulationEventType,
  SimulationForecastSnapshot,
  SimulationPlannedOperation,
  SimulationResult,
} from "./model";
import { dispatchOperationalSimulationRotations } from "./operational-simulation-dispatch";
import { advanceOperationalSimulationLifecycle } from "./operational-simulation-lifecycle";
import { evaluateOperationalSimulationPrecalls } from "./operational-simulation-precall";
import {
  createOperationalDemand,
  createOperationalPlans,
  eventTypeForBlock,
  type MetricsCalculator,
  type OperationalAircraft,
  type OperationalBlock,
  type OperationalPilot,
  type OperationalPlan,
  type OperationalRecurringRule,
  type OperationalRotation,
  publicRotation,
} from "./operational-simulation-scenario";
import { captureOperationalSimulationSnapshots } from "./operational-simulation-snapshot";
import { simulationBlockDetails } from "./simulation-block-details";
import {
  addSimulationMinutes as addMinutes,
  toSimulationIso as iso,
  roundSimulationTick as roundedTick,
  SIMULATION_TICK_MS as TICK_MS,
} from "./simulation-primitives";

export function runOperationalSimulation(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[],
  calculateMetrics: MetricsCalculator,
): SimulationResult {
  const model = config.operationalModel;
  if (!model) throw new Error("Operative Simulationsdaten fehlen.");
  const operationsStartMs = Date.parse(config.schedule.operationsStartAt);
  const operationsEndMs = Date.parse(config.schedule.operationsEndAt);
  const runStartMs = Math.min(Date.parse(config.schedule.salesStartAt), operationsStartMs);
  let runEndMs: number;
  const rotations = createOperationalDemand(config);
  const missingReferencePlan = config.plannedOperations.find(
    (entry) =>
      entry.startMode === "AFTER_CURRENT_ROTATION" &&
      entry.afterRotationId !== null &&
      !rotations.some((rotation) => rotation.id === entry.afterRotationId),
  );
  if (missingReferencePlan) {
    throw new Error(
      `Planeintrag ${missingReferencePlan.key} verweist auf keinen Umlauf dieses synthetischen Laufs.`,
    );
  }
  const aircraft: OperationalAircraft[] = model.aircraft.map((entry) => ({
    ...structuredClone(entry),
    state: "AVAILABLE",
    activeRotationId: null,
    blockedUntilMs: null,
    completedRotations: 0,
    operatingMinutes: 0,
    pendingBlocks: [],
  }));
  const pilots: OperationalPilot[] = model.pilots.map((entry) => ({
    ...structuredClone(entry),
    activeRotationId: null,
  }));
  const plans = createOperationalPlans(config);
  const recurringRules: OperationalRecurringRule[] = (config.recurringRules ?? []).map((rule) => ({
    ...structuredClone(rule),
    currentProgress: rule.progressValue,
    sequenceNumber: 0,
  }));
  const events: SimulationEvent[] = [];
  const snapshots: SimulationForecastSnapshot[] = [];
  const processedIncidentIds = new Set<string>();
  const recordedIncidentBoundaries = new Set<string>();
  let eventSequence = 0;
  const previousDispatchPlans = new Map<string, DispatchPlan>();
  const dispatchDiagnostics: SimulationDispatchDiagnostics = {
    unnecessaryPlanChanges: 0,
    prepareDemotions: 0,
    goToGateReplans: 0,
  };
  const previousDispatchAssignments = new Map<
    string,
    { signature: string; commitment: "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE" }
  >();

  const recordEvent = (
    type: SimulationEventType,
    occurredAtMs: number,
    options: {
      aircraftId?: string | null;
      pilotId?: string | null;
      plannedOperationId?: string | null;
      rotationId?: string | null;
      details: string;
    },
  ) => {
    eventSequence += 1;
    events.push({
      id: `sim-event-${String(eventSequence).padStart(5, "0")}`,
      type,
      occurredAt: iso(occurredAtMs),
      aircraftId: options.aircraftId ?? null,
      pilotId: options.pilotId ?? null,
      plannedOperationId: options.plannedOperationId ?? null,
      rotationId: options.rotationId ?? null,
      details: options.details,
      forecastRecalculatedAt: iso(occurredAtMs),
    });
  };

  const planIsActive = (plan: OperationalPlan, nowMs: number) =>
    plan.actualStartMs !== null &&
    plan.actualEndMs !== null &&
    nowMs >= plan.actualStartMs &&
    nowMs < plan.actualEndMs;

  const activePlanFor = (
    scopeType: SimulationPlannedOperation["scopeType"],
    scopeId: string,
    nowMs: number,
  ) =>
    plans.some(
      (plan) =>
        (plan.effectMode ?? "BLOCKING") === "BLOCKING" &&
        plan.scopeType === scopeType &&
        plan.scopeId === scopeId &&
        planIsActive(plan, nowMs),
    );

  const planAppliesToRotation = (plan: OperationalPlan, rotation: OperationalRotation) =>
    plan.scopeType === "EVENT" ||
    (plan.scopeType === "RESOURCE_GROUP" && plan.scopeId === rotation.resourceGroupId) ||
    (plan.scopeType === "AIRCRAFT" && plan.scopeId === rotation.aircraftId) ||
    (plan.scopeType === "PILOT" && plan.scopeId === rotation.pilotId);

  const activeSlowdownPercent = (rotation: OperationalRotation, nowMs: number) =>
    plans.reduce(
      (maximum, plan) =>
        (plan.effectMode ?? "BLOCKING") === "SLOWDOWN" &&
        planIsActive(plan, nowMs) &&
        planAppliesToRotation(plan, rotation)
          ? Math.max(maximum, plan.durationMultiplierPercent ?? 150)
          : maximum,
      100,
    );

  const applySlowdownToRemainingPhases = (
    rotation: OperationalRotation,
    targetMultiplierPercent: number,
  ) => {
    if (targetMultiplierPercent <= rotation.slowdownMultiplierPercent) return;
    const ratio = targetMultiplierPercent / rotation.slowdownMultiplierPercent;
    if (rotation.status === "CALLED" && rotation.boardingMinutes !== null) {
      rotation.boardingMinutes *= ratio;
    }
    if (
      (rotation.status === "CALLED" || rotation.status === "IN_FLIGHT") &&
      rotation.flightMinutes !== null
    ) {
      rotation.flightMinutes *= ratio;
    }
    if (
      ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status) &&
      rotation.deboardingMinutes !== null &&
      rotation.bufferMinutes !== null
    ) {
      rotation.deboardingMinutes *= ratio;
      rotation.bufferMinutes *= ratio;
    }
    rotation.slowdownMultiplierPercent = targetMultiplierPercent;
  };

  const globalIncidentActive = (nowMs: number) =>
    manualIncidents.some(
      (entry) =>
        entry.type === "EVENT_INTERRUPTION" &&
        nowMs >= roundedTick(Date.parse(entry.at)) &&
        nowMs < roundedTick(addMinutes(Date.parse(entry.at), entry.durationMinutes)),
    );

  const operationsGloballyAvailable = (nowMs: number) =>
    nowMs >= operationsStartMs &&
    nowMs < operationsEndMs &&
    !globalIncidentActive(nowMs) &&
    !activePlanFor("EVENT", "event", nowMs);

  const groupAvailable = (groupId: string, nowMs: number) =>
    operationsGloballyAvailable(nowMs) && !activePlanFor("RESOURCE_GROUP", groupId, nowMs);

  const pilotAvailable = (pilot: OperationalPilot, nowMs: number) =>
    pilot.active && pilot.activeRotationId === null && !activePlanFor("PILOT", pilot.id, nowMs);

  const aircraftAvailable = (entry: OperationalAircraft, nowMs: number) =>
    entry.state === "AVAILABLE" &&
    entry.activeRotationId === null &&
    !activePlanFor("AIRCRAFT", entry.id, nowMs);

  const startBlock = (entry: OperationalAircraft, block: OperationalBlock, nowMs: number) => {
    entry.state = block.dayOutage ? "DAY_OUT" : block.state;
    entry.blockedUntilMs = block.dayOutage ? null : addMinutes(nowMs, block.durationMinutes);
    recordEvent(eventTypeForBlock(entry.state as OperationalBlock["state"]), nowMs, {
      aircraftId: entry.id,
      details: simulationBlockDetails(block, Math.round(block.durationMinutes)),
    });
  };

  for (let nowMs = runStartMs; ; nowMs += TICK_MS) {
    advanceOperationalSimulationLifecycle({
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
    });

    evaluateOperationalSimulationPrecalls({
      config,
      nowMs,
      operationsStartMs,
      operationsEndMs,
      rotations,
      aircraft,
      pilots,
      plans,
      recurringRules,
      planIsActive,
      activePlanFor,
      planAppliesToRotation,
      operationsGloballyAvailable,
      groupAvailable,
      recordEvent,
    });

    dispatchOperationalSimulationRotations({
      config,
      nowMs,
      rotations,
      aircraft,
      pilots,
      previousDispatchPlans,
      previousDispatchAssignments,
      dispatchDiagnostics,
      groupAvailable,
      pilotAvailable,
      aircraftAvailable,
      activeSlowdownPercent,
      applySlowdownToRemainingPhases,
      recordEvent,
    });

    captureOperationalSimulationSnapshots({
      config,
      nowMs,
      operationsStartMs,
      operationsEndMs,
      rotations,
      aircraft,
      pilots,
      plans,
      recurringRules,
      snapshots,
      planIsActive,
      activePlanFor,
      planAppliesToRotation,
      operationsGloballyAvailable,
      groupAvailable,
    });

    if (nowMs >= operationsEndMs && !aircraft.some((entry) => entry.activeRotationId !== null)) {
      runEndMs = nowMs;
      break;
    }
  }

  events.sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id),
  );
  const publicRotations = rotations.map(publicRotation);
  return {
    config: structuredClone(config),
    runWindow: { startAt: iso(runStartMs), endAt: iso(runEndMs) },
    aircraft: aircraft.map(
      ({
        state: _state,
        activeRotationId: _active,
        blockedUntilMs: _blocked,
        completedRotations: _count,
        operatingMinutes: _minutes,
        pendingBlocks: _pending,
        ...entry
      }) => entry,
    ),
    pilots: pilots.map(({ activeRotationId: _active, ...entry }) => entry),
    plannedOperations: plans.map(
      ({
        candidateStartMs: _candidate,
        actualStartMs: _actualStart,
        actualEndMs: _actualEnd,
        completed: _completed,
        recurringRuleKey: _recurringRule,
        ...plan
      }) => structuredClone(plan),
    ),
    recurringRules: structuredClone(config.recurringRules ?? []),
    rotations: publicRotations,
    events,
    snapshots,
    metrics: calculateMetrics({
      rotations: publicRotations,
      snapshots,
      events,
      operationsStartAt: config.schedule.operationsStartAt,
      operationsEndAt: config.schedule.operationsEndAt,
      aircraftCount: aircraft.length,
      dispatchDiagnostics,
    }),
  };
}
