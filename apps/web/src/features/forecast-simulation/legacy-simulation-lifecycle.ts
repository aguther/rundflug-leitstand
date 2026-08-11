import {
  incidentToBlock,
  type PendingBlock,
  type RuntimeAircraft,
  type RuntimeRotation,
} from "./legacy-simulation-scenario";
import type { ManualIncident, SimulationConfig, SimulationEventType } from "./model";
import {
  addSimulationMinutes as addMinutes,
  deterministicChance,
  deterministicSample,
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
  for (const interruption of activeInterruptions) {
    const incidentStart = roundedTick(Date.parse(interruption.at));
    const incidentEnd = Math.min(
      operationsEndMs,
      roundedTick(addMinutes(Date.parse(interruption.at), interruption.durationMinutes)),
    );
    const startKey = `${interruption.id}:start`;
    const endKey = `${interruption.id}:end`;
    if (nowMs >= incidentStart && !recordedGlobalBoundaries.has(startKey)) {
      recordedGlobalBoundaries.add(startKey);
      processedIncidentIds.add(interruption.id);
      recordEvent(
        "EVENT_INTERRUPTED",
        nowMs,
        null,
        null,
        "Simulierte globale Betriebsunterbrechung bestätigt.",
      );
    }
    if (nowMs >= incidentEnd && !recordedGlobalBoundaries.has(endKey)) {
      recordedGlobalBoundaries.add(endKey);
      recordEvent(
        "EVENT_RESUMED",
        nowMs,
        null,
        null,
        "Simulierte Wiederaufnahme des Betriebs bestätigt.",
      );
    }
  }
  const operationsOpen = nowMs >= operationsStartMs && nowMs < operationsEndMs;
  const operationalInterrupted =
    operationsOpen &&
    activeInterruptions.some((entry) => {
      const from = roundedTick(Date.parse(entry.at));
      const until = roundedTick(addMinutes(Date.parse(entry.at), entry.durationMinutes));
      return nowMs >= from && nowMs < until;
    });
  const resourceGroupStatus: LegacyResourceGroupStatus =
    nowMs < operationsStartMs
      ? "PAUSED"
      : nowMs >= operationsEndMs
        ? "ENDED"
        : operationalInterrupted
          ? "INTERRUPTED"
          : "ACTIVE";
  const operationsAvailable = resourceGroupStatus === "ACTIVE";

  for (const entry of aircraft) {
    if (entry.blockedUntilMs !== null && nowMs >= entry.blockedUntilMs) {
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

  for (const incident of allIncidents) {
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
    if (rotation.status === "LANDED" && nowMs >= completedMs) {
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
        entry.nextPauseAtMinutes +=
          config.realityModel.incidents.plannedPause.everyOperatingMinutes;
      }
      const unplannedProbability =
        1 -
        Math.exp(
          -config.realityModel.incidents.unplannedPause.ratePerOperatingHour *
            (operatingMinutes / 60),
        );
      if (
        config.realityModel.incidents.unplannedPause.enabled &&
        deterministicChance(config.seed, `${rotation.id}:unplanned-pause-chance`) <
          unplannedProbability
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
          -config.realityModel.incidents.technicalDefect.ratePerOperatingHour *
            (operatingMinutes / 60),
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
  }

  for (const entry of aircraft) {
    if (operationsAvailable && entry.state === "AVAILABLE" && entry.activeRotationId === null) {
      const block = entry.pendingBlocks.shift();
      if (block) startBlock(entry, block, nowMs);
    }
  }
  return { operationsOpen, resourceGroupStatus, operationsAvailable };
}
