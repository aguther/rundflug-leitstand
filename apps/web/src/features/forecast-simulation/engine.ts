import type { DispatchPlan } from "@rundflug/domain";
import { dispatchLegacySimulationRotations } from "./legacy-simulation-dispatch";
import { advanceLegacySimulationLifecycle } from "./legacy-simulation-lifecycle";
import { evaluateLegacySimulationPrecalls } from "./legacy-simulation-precall";
import {
  createAircraft,
  createDemand,
  eventTypeForBlock,
  type PendingBlock,
  presetIncidents,
  publicRotation,
  type RuntimeAircraft,
} from "./legacy-simulation-scenario";
import { captureLegacySimulationForecast } from "./legacy-simulation-snapshot";
import type {
  ManualIncident,
  SimulationConfig,
  SimulationDispatchDiagnostics,
  SimulationEvent,
  SimulationEventType,
  SimulationForecastSnapshot,
  SimulationResult,
} from "./model";
import { validateSimulationConfig } from "./model";
import { runOperationalSimulation } from "./operational-engine";
import { calculateSimulationMetrics } from "./simulation-metrics";
import {
  addSimulationMinutes as addMinutes,
  toSimulationIso as iso,
  roundSimulationValue as rounded,
  SIMULATION_TICK_MS as TICK_MS,
} from "./simulation-primitives";

export { calculateSimulationMetrics } from "./simulation-metrics";
export { sampleTriangular } from "./simulation-primitives";

export function runSimulation(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[] = [],
): SimulationResult {
  const validationErrors = validateSimulationConfig(config);
  if (validationErrors.length > 0) throw new Error(validationErrors.join(" "));
  if (config.operationalModel) {
    return runOperationalSimulation(config, manualIncidents, calculateSimulationMetrics);
  }
  const operationsStartMs = Date.parse(config.schedule.operationsStartAt);
  const operationsEndMs = Date.parse(config.schedule.operationsEndAt);
  const runStartMs = Math.min(Date.parse(config.schedule.salesStartAt), operationsStartMs);
  let runEndMs = operationsEndMs;
  const aircraft = createAircraft(config);
  for (const entry of aircraft) {
    entry.nextPauseAtMinutes = config.realityModel.incidents.plannedPause.everyOperatingMinutes;
  }
  const rotations = createDemand(config);
  const events: SimulationEvent[] = [];
  const snapshots: SimulationForecastSnapshot[] = [];
  const allIncidents = [
    ...presetIncidents(config),
    ...manualIncidents.map((entry) => ({ ...entry })),
  ]
    .filter((entry) => {
      const at = Date.parse(entry.at);
      return at >= operationsStartMs && at < operationsEndMs;
    })
    .sort(
      (left, right) =>
        Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id),
    );
  const processedIncidentIds = new Set<string>();
  const activeInterruptions = allIncidents.filter((entry) => entry.type === "EVENT_INTERRUPTION");
  const recordedGlobalBoundaries = new Set<string>();
  let eventSequence = 0;
  let previousDispatchPlan: DispatchPlan | null = null;
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
    aircraftId: string | null,
    rotationId: string | null,
    details: string,
    forecastRecalculatedAtMs = occurredAtMs,
  ) => {
    eventSequence += 1;
    events.push({
      id: `sim-event-${String(eventSequence).padStart(5, "0")}`,
      type,
      occurredAt: iso(occurredAtMs),
      aircraftId,
      rotationId,
      details,
      forecastRecalculatedAt: iso(forecastRecalculatedAtMs),
    });
  };

  const startBlock = (entry: RuntimeAircraft, block: PendingBlock, nowMs: number) => {
    entry.state = block.dayOutage ? "DAY_OUT" : block.state;
    entry.blockedUntilMs = block.dayOutage ? null : addMinutes(nowMs, block.durationMinutes);
    recordEvent(
      eventTypeForBlock(entry.state as PendingBlock["state"]),
      nowMs,
      entry.id,
      null,
      block.dayOutage
        ? "Simulierter Tagesausfall an zulässiger organisatorischer Grenze bestätigt."
        : `${block.source === "AUTOMATIC" ? "Automatisch erzeugte" : "Manuell injizierte"} Sperre für ${rounded(block.durationMinutes)} Minuten.`,
    );
  };

  for (let nowMs = runStartMs; ; nowMs += TICK_MS) {
    const { operationsOpen, resourceGroupStatus, operationsAvailable } =
      advanceLegacySimulationLifecycle({
        config,
        nowMs,
        operationsStartMs,
        operationsEndMs,
        aircraft,
        rotations,
        allIncidents,
        activeInterruptions,
        processedIncidentIds,
        recordedGlobalBoundaries,
        recordEvent,
        startBlock,
      });

    evaluateLegacySimulationPrecalls({
      config,
      nowMs,
      operationsStartMs,
      resourceGroupStatus,
      rotations,
      aircraft,
      activeInterruptions,
      previousDispatchPlan,
      operationsOpen,
      operationsAvailable,
      recordEvent,
    });

    previousDispatchPlan = dispatchLegacySimulationRotations({
      config,
      nowMs,
      operationsAvailable,
      rotations,
      aircraft,
      previousDispatchPlan,
      previousDispatchAssignments,
      dispatchDiagnostics,
      recordEvent,
    });

    captureLegacySimulationForecast({
      config,
      nowMs,
      operationsStartMs,
      resourceGroupStatus,
      rotations,
      aircraft,
      activeInterruptions,
      previousDispatchPlan,
      snapshots,
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
    runWindow: {
      startAt: iso(runStartMs),
      endAt: iso(runEndMs),
    },
    aircraft: aircraft.map(
      ({
        state: _state,
        activeRotationId: _active,
        blockedUntilMs: _blocked,
        completedRotations: _count,
        operatingMinutes: _minutes,
        nextPauseAtMinutes: _next,
        pendingBlocks: _pending,
        ...entry
      }) => entry,
    ),
    rotations: publicRotations,
    events,
    snapshots,
    metrics: calculateSimulationMetrics({
      rotations: publicRotations,
      snapshots,
      events,
      operationsStartAt: config.schedule.operationsStartAt,
      operationsEndAt: config.schedule.operationsEndAt,
      aircraftCount: config.adminParameters.aircraftCount,
      dispatchDiagnostics,
    }),
  };
}
