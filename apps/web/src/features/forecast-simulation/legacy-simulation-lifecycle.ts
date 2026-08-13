import { queueAutomaticBlocks } from "./legacy-simulation-automatic-blocks";
import {
  incidentToBlock,
  type PendingBlock,
  type RuntimeAircraft,
  type RuntimeRotation,
} from "./legacy-simulation-scenario";
import type { ManualIncident, SimulationConfig, SimulationEventType } from "./model";
import {
  addSimulationMinutes as addMinutes,
  toSimulationIso as iso,
  SIMULATION_MINUTE_MS as MINUTE_MS,
  roundSimulationTick as roundedTick,
} from "./simulation-primitives";

export type LegacySimulationEventRecorder = (
  type: SimulationEventType,
  occurredAtMs: number,
  aircraftId: string | null,
  rotationId: string | null,
  details: string,
  forecastRecalculatedAtMs?: number,
) => void;

export type LegacyResourceGroupStatus = "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";

function resourceGroupStatusAt(
  nowMs: number,
  operationsStartMs: number,
  operationsEndMs: number,
  interrupted: boolean,
): LegacyResourceGroupStatus {
  if (nowMs < operationsStartMs) return "PAUSED";
  if (nowMs >= operationsEndMs) return "ENDED";
  return interrupted ? "INTERRUPTED" : "ACTIVE";
}

function recordInterruptionBoundaries(
  interruptions: readonly ManualIncident[],
  nowMs: number,
  operationsEndMs: number,
  processedIncidentIds: Set<string>,
  recordedBoundaries: Set<string>,
  recordEvent: LegacySimulationEventRecorder,
): void {
  for (const interruption of interruptions) {
    const incidentStart = roundedTick(Date.parse(interruption.at));
    const incidentEnd = Math.min(
      operationsEndMs,
      roundedTick(addMinutes(Date.parse(interruption.at), interruption.durationMinutes)),
    );
    const startKey = `${interruption.id}:start`;
    const endKey = `${interruption.id}:end`;
    if (nowMs >= incidentStart && !recordedBoundaries.has(startKey)) {
      recordedBoundaries.add(startKey);
      processedIncidentIds.add(interruption.id);
      recordEvent(
        "EVENT_INTERRUPTED",
        nowMs,
        null,
        null,
        "Simulierte globale Betriebsunterbrechung bestätigt.",
      );
    }
    if (nowMs >= incidentEnd && !recordedBoundaries.has(endKey)) {
      recordedBoundaries.add(endKey);
      recordEvent(
        "EVENT_RESUMED",
        nowMs,
        null,
        null,
        "Simulierte Wiederaufnahme des Betriebs bestätigt.",
      );
    }
  }
}

function advanceRotations(
  config: SimulationConfig,
  nowMs: number,
  aircraft: RuntimeAircraft[],
  rotations: RuntimeRotation[],
  recordEvent: LegacySimulationEventRecorder,
): void {
  for (const entry of aircraft) {
    const rotation = rotations.find((candidate) => candidate.id === entry.activeRotationId);
    if (!rotation?.calledAt) continue;
    const calledMs = Date.parse(rotation.calledAt);
    const departedMs = addMinutes(calledMs, rotation.boardingMinutes ?? 0);
    const landedMs = addMinutes(departedMs, rotation.flightMinutes ?? 0);
    const completedMs = addMinutes(
      landedMs,
      (rotation.deboardingMinutes ?? 0) + (rotation.bufferMinutes ?? 0),
    );
    if (rotation.status === "CALLED" && nowMs >= departedMs) {
      rotation.status = "IN_FLIGHT";
      rotation.departedAt = iso(departedMs);
      recordEvent(
        "ROTATION_DEPARTED",
        departedMs,
        entry.id,
        rotation.id,
        "Off-Block bestätigt.",
        nowMs,
      );
    }
    if (rotation.status === "IN_FLIGHT" && nowMs >= landedMs) {
      rotation.status = "LANDED";
      rotation.landedAt = iso(landedMs);
      recordEvent("ROTATION_LANDED", landedMs, entry.id, rotation.id, "On-Block bestätigt.", nowMs);
    }
    if (rotation.status !== "LANDED" || nowMs < completedMs) continue;
    rotation.status = "COMPLETED";
    rotation.completedAt = iso(completedMs);
    entry.activeRotationId = null;
    entry.state = "AVAILABLE";
    entry.completedRotations += 1;
    const operatingMinutes = (completedMs - calledMs) / MINUTE_MS;
    entry.operatingMinutes += operatingMinutes;
    recordEvent(
      "ROTATION_COMPLETED",
      completedMs,
      entry.id,
      rotation.id,
      "Turnaround und Verfügbarkeit bestätigt.",
      nowMs,
    );
    queueAutomaticBlocks(config, entry, rotation, operatingMinutes);
  }
}

function activeInterruptionAt(interruptions: readonly ManualIncident[], nowMs: number): boolean {
  return interruptions.some((entry) => {
    const from = roundedTick(Date.parse(entry.at));
    const until = roundedTick(addMinutes(Date.parse(entry.at), entry.durationMinutes));
    return nowMs >= from && nowMs < until;
  });
}

function confirmAircraftReturns(
  aircraft: RuntimeAircraft[],
  nowMs: number,
  recordEvent: LegacySimulationEventRecorder,
): void {
  for (const entry of aircraft) {
    if (entry.blockedUntilMs === null || nowMs < entry.blockedUntilMs) continue;
    entry.blockedUntilMs = null;
    entry.state = "AVAILABLE";
    recordEvent(
      "AIRCRAFT_RETURN_CONFIRMED",
      nowMs,
      entry.id,
      null,
      "Bestätigte simulierte Rückkehr; die temporäre Sperre endet erst mit diesem Ereignis.",
    );
  }
}

function queueDueIncidents(
  incidents: readonly ManualIncident[],
  aircraft: RuntimeAircraft[],
  processedIncidentIds: Set<string>,
  nowMs: number,
): void {
  for (const incident of incidents) {
    if (
      incident.type === "EVENT_INTERRUPTION" ||
      processedIncidentIds.has(incident.id) ||
      nowMs < roundedTick(Date.parse(incident.at))
    ) {
      continue;
    }
    processedIncidentIds.add(incident.id);
    const entry = aircraft.find((candidate) => candidate.id === incident.aircraftId);
    if (!entry || entry.state === "DAY_OUT") continue;
    entry.pendingBlocks.push(
      incidentToBlock(incident, incident.id.startsWith("preset-") ? "PRESET" : "MANUAL"),
    );
  }
}

function startPendingBlocks(
  aircraft: RuntimeAircraft[],
  nowMs: number,
  startBlock: (entry: RuntimeAircraft, block: PendingBlock, nowMs: number) => void,
): void {
  for (const entry of aircraft) {
    if (entry.state !== "AVAILABLE" || entry.activeRotationId !== null) continue;
    const block = entry.pendingBlocks.shift();
    if (block) startBlock(entry, block, nowMs);
  }
}

export function advanceLegacySimulationLifecycle(input: {
  config: SimulationConfig;
  nowMs: number;
  operationsStartMs: number;
  operationsEndMs: number;
  aircraft: RuntimeAircraft[];
  rotations: RuntimeRotation[];
  allIncidents: readonly ManualIncident[];
  activeInterruptions: readonly ManualIncident[];
  processedIncidentIds: Set<string>;
  recordedGlobalBoundaries: Set<string>;
  recordEvent: LegacySimulationEventRecorder;
  startBlock: (entry: RuntimeAircraft, block: PendingBlock, nowMs: number) => void;
}): {
  operationsOpen: boolean;
  resourceGroupStatus: LegacyResourceGroupStatus;
  operationsAvailable: boolean;
} {
  const {
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
  } = input;
  recordInterruptionBoundaries(
    activeInterruptions,
    nowMs,
    operationsEndMs,
    processedIncidentIds,
    recordedGlobalBoundaries,
    recordEvent,
  );
  const operationsOpen = nowMs >= operationsStartMs && nowMs < operationsEndMs;
  const operationalInterrupted = operationsOpen && activeInterruptionAt(activeInterruptions, nowMs);
  const resourceGroupStatus = resourceGroupStatusAt(
    nowMs,
    operationsStartMs,
    operationsEndMs,
    operationalInterrupted,
  );
  const operationsAvailable = resourceGroupStatus === "ACTIVE";

  confirmAircraftReturns(aircraft, nowMs, recordEvent);
  queueDueIncidents(allIncidents, aircraft, processedIncidentIds, nowMs);
  advanceRotations(config, nowMs, aircraft, rotations, recordEvent);
  if (operationsAvailable) startPendingBlocks(aircraft, nowMs, startBlock);
  return { operationsOpen, resourceGroupStatus, operationsAvailable };
}
