import {
  calculateForecastTimelines,
  type ForecastRotationStatus,
  type PredictionQuality,
  planNextRotations,
} from "@rundflug/domain";

import type {
  ForecastMetricSummary,
  ManualIncident,
  SimulationAircraft,
  SimulationAircraftState,
  SimulationConfig,
  SimulationEvent,
  SimulationEventType,
  SimulationForecastSnapshot,
  SimulationMetrics,
  SimulationResult,
  SimulationRotation,
  TriangularDistribution,
} from "./model";
import { validateSimulationConfig } from "./model";

const TICK_MS = 30_000;
const MINUTE_MS = 60_000;
const PRODUCT_ID = "SYNTHETIC_ROUND_TRIP";
const RESOURCE_GROUP_ID = "SIMULATION_FLEET";
const EVENT_ID = "LOCAL_SIMULATION";

interface RuntimeRotation extends SimulationRotation {
  status: ForecastRotationStatus | "COMPLETED";
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
}

interface PendingBlock {
  key: string;
  state: Exclude<SimulationAircraftState, "AVAILABLE" | "ACTIVE">;
  durationMinutes: number;
  dayOutage: boolean;
  source: "AUTOMATIC" | "MANUAL" | "PRESET";
}

interface RuntimeAircraft extends SimulationAircraft {
  state: SimulationAircraftState;
  activeRotationId: string | null;
  blockedUntilMs: number | null;
  completedRotations: number;
  operatingMinutes: number;
  nextPauseAtMinutes: number;
  pendingBlocks: PendingBlock[];
}

interface RandomSource {
  next(): number;
}

function mulberry32(seed: number): RandomSource {
  let value = seed >>> 0;
  return {
    next() {
      value = (value + 0x6d2b79f5) | 0;
      let result = Math.imul(value ^ (value >>> 15), 1 | value);
      result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
      return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
}

function hashSeed(seed: number, key: string): number {
  let hash = (2_166_136_261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash || 1;
}

export function sampleTriangular(
  distribution: TriangularDistribution,
  randomValue: number,
): number {
  const { minimum, typical, maximum } = distribution;
  if (maximum === minimum) return minimum;
  const bounded = Math.min(1 - Number.EPSILON, Math.max(0, randomValue));
  const split = (typical - minimum) / (maximum - minimum);
  if (bounded < split) {
    return minimum + Math.sqrt(bounded * (maximum - minimum) * (typical - minimum));
  }
  return maximum - Math.sqrt((1 - bounded) * (maximum - minimum) * (maximum - typical));
}

function deterministicSample(
  seed: number,
  key: string,
  distribution: TriangularDistribution,
): number {
  return sampleTriangular(distribution, mulberry32(hashSeed(seed, key)).next());
}

function deterministicChance(seed: number, key: string): number {
  return mulberry32(hashSeed(seed, key)).next();
}

function addMinutes(value: number, minutes: number): number {
  return value + minutes * MINUTE_MS;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function roundedTick(value: number): number {
  return Math.ceil(value / TICK_MS) * TICK_MS;
}

function createAircraft(count: number): RuntimeAircraft[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `aircraft-${index + 1}`,
    registration: `D-SIM${String(index + 1).padStart(2, "0")}`,
    aircraftType: "Simulation 4S",
    capacity: 4,
    state: "AVAILABLE",
    activeRotationId: null,
    blockedUntilMs: null,
    completedRotations: 0,
    operatingMinutes: 0,
    nextPauseAtMinutes: 0,
    pendingBlocks: [],
  }));
}

function createDemand(config: SimulationConfig): RuntimeRotation[] {
  if (config.demandPersonsPerHour === 0) return [];
  const startMs = Date.parse(config.startAt);
  const endMs = Date.parse(config.endAt);
  const groupRatePerHour = config.demandPersonsPerHour / 4;
  const random = mulberry32(hashSeed(config.seed, "demand"));
  const rotations: RuntimeRotation[] = [];
  let arrivalMs = startMs;
  while (arrivalMs <= endMs) {
    const draw = Math.max(Number.EPSILON, random.next());
    arrivalMs += (-Math.log(draw) / groupRatePerHour) * 60 * MINUTE_MS;
    if (arrivalMs > endMs) break;
    const sequence = rotations.length + 1;
    const id = `rotation-${String(sequence).padStart(3, "0")}`;
    rotations.push({
      id,
      communicationNumber: sequence,
      passengerCount: 4,
      createdAt: iso(roundedTick(arrivalMs)),
      aircraftId: null,
      calledAt: null,
      departedAt: null,
      landedAt: null,
      completedAt: null,
      boardingMinutes: null,
      flightMinutes: null,
      deboardingMinutes: null,
      bufferMinutes: null,
      status: "DRAFT",
      predictedDepartureAt: null,
      predictedLandingAt: null,
      predictedCompletionAt: null,
    });
  }
  return rotations;
}

function presetIncidents(config: SimulationConfig): ManualIncident[] {
  const at = iso(addMinutes(Date.parse(config.startAt), 120));
  if (config.preset === "AIRCRAFT_FAILURE") {
    return [
      {
        id: "preset-aircraft-failure",
        type: "TECHNICAL_DEFECT",
        at,
        aircraftId: "aircraft-2",
        durationMinutes: 0,
        dayOutage: true,
      },
    ];
  }
  if (config.preset === "OPERATION_INTERRUPTION") {
    return [
      {
        id: "preset-event-interruption",
        type: "EVENT_INTERRUPTION",
        at,
        aircraftId: null,
        durationMinutes: 30,
        dayOutage: false,
      },
    ];
  }
  return [];
}

function eventTypeForBlock(state: PendingBlock["state"]): SimulationEventType {
  if (state === "REFUELING") return "REFUELING_STARTED";
  if (state === "PLANNED_PAUSE") return "PLANNED_PAUSE_STARTED";
  if (state === "UNPLANNED_PAUSE") return "UNPLANNED_PAUSE_STARTED";
  if (state === "DAY_OUT") return "AIRCRAFT_DAY_OUT";
  return "TECHNICAL_DEFECT_REPORTED";
}

function incidentToBlock(incident: ManualIncident, source: PendingBlock["source"]): PendingBlock {
  const state: PendingBlock["state"] =
    incident.type === "REFUELING"
      ? "REFUELING"
      : incident.type === "UNPLANNED_PAUSE"
        ? "UNPLANNED_PAUSE"
        : incident.dayOutage
          ? "DAY_OUT"
          : "TECHNICAL_DEFECT";
  return {
    key: incident.id,
    state,
    durationMinutes: incident.durationMinutes,
    dayOutage: incident.dayOutage,
    source,
  };
}

function publicRotation(rotation: RuntimeRotation): SimulationRotation {
  const {
    status: _status,
    predictedDepartureAt: _predictedDepartureAt,
    predictedLandingAt: _predictedLandingAt,
    predictedCompletionAt: _predictedCompletionAt,
    ...result
  } = rotation;
  return result;
}

function metricSummary(errors: readonly number[]): ForecastMetricSummary {
  if (errors.length === 0) {
    return {
      samples: 0,
      maeMinutes: null,
      medianAbsoluteErrorMinutes: null,
      p90AbsoluteErrorMinutes: null,
      biasMinutes: null,
    };
  }
  const absolute = errors.map(Math.abs).sort((left, right) => left - right);
  return {
    samples: errors.length,
    maeMinutes: rounded(absolute.reduce((sum, value) => sum + value, 0) / absolute.length),
    medianAbsoluteErrorMinutes: rounded(quantile(absolute, 0.5)),
    p90AbsoluteErrorMinutes: rounded(quantile(absolute, 0.9)),
    biasMinutes: rounded(errors.reduce((sum, value) => sum + value, 0) / errors.length),
  };
}

function quantile(sortedValues: readonly number[], probability: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  const left = sortedValues[lower] ?? sortedValues[0] ?? 0;
  const right = sortedValues[lower + 1] ?? left;
  return left + fraction * (right - left);
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function snapshotError(
  snapshot: SimulationForecastSnapshot,
  actualAt: string,
  field:
    | "predictedBoardingAt"
    | "predictedDepartureAt"
    | "predictedLandingAt"
    | "predictedCompletionAt",
): number {
  return (Date.parse(snapshot[field]) - Date.parse(actualAt)) / MINUTE_MS;
}

function latestSnapshotBefore(
  snapshots: readonly SimulationForecastSnapshot[],
  actualAt: string,
  status: ForecastRotationStatus,
  notAfterMs = Date.parse(actualAt) - 1,
): SimulationForecastSnapshot | undefined {
  return snapshots
    .filter(
      (snapshot) =>
        snapshot.status === status &&
        Date.parse(snapshot.capturedAt) < Date.parse(actualAt) &&
        Date.parse(snapshot.capturedAt) <= notAfterMs,
    )
    .at(-1);
}

export function calculateSimulationMetrics(input: {
  rotations: readonly SimulationRotation[];
  snapshots: readonly SimulationForecastSnapshot[];
  events: readonly SimulationEvent[];
}): SimulationMetrics {
  const snapshotsByRotation = new Map<string, SimulationForecastSnapshot[]>();
  for (const snapshot of input.snapshots) {
    const values = snapshotsByRotation.get(snapshot.rotationId) ?? [];
    values.push(snapshot);
    snapshotsByRotation.set(snapshot.rotationId, values);
  }
  const boardingErrors: number[] = [];
  const departureErrors: number[] = [];
  const landingErrors: number[] = [];
  const completionErrors: number[] = [];
  const horizonErrors: Record<"15" | "30" | "60", number[]> = { "15": [], "30": [], "60": [] };
  const boardingWindowWidths: number[] = [];
  let boardingWindowsHit = 0;
  let boardingWindowSamples = 0;

  for (const rotation of input.rotations) {
    const snapshots = snapshotsByRotation.get(rotation.id) ?? [];
    if (rotation.calledAt) {
      const boarding = latestSnapshotBefore(snapshots, rotation.calledAt, "DRAFT");
      if (boarding) {
        boardingErrors.push(snapshotError(boarding, rotation.calledAt, "predictedBoardingAt"));
        const captured = Date.parse(boarding.capturedAt);
        const actual = Date.parse(rotation.calledAt);
        const lower = addMinutes(captured, boarding.lowerMinutes);
        const upper = addMinutes(captured, boarding.upperMinutes);
        boardingWindowSamples += 1;
        boardingWindowWidths.push(boarding.upperMinutes - boarding.lowerMinutes);
        if (actual >= lower && actual <= upper) boardingWindowsHit += 1;
      }
      for (const horizon of [15, 30, 60] as const) {
        const cutoff = addMinutes(Date.parse(rotation.calledAt), -horizon);
        const snapshot = latestSnapshotBefore(snapshots, rotation.calledAt, "DRAFT", cutoff);
        if (snapshot) {
          horizonErrors[String(horizon) as "15" | "30" | "60"].push(
            snapshotError(snapshot, rotation.calledAt, "predictedBoardingAt"),
          );
        }
      }
    }
    if (rotation.departedAt) {
      const departure = latestSnapshotBefore(snapshots, rotation.departedAt, "CALLED");
      if (departure) {
        departureErrors.push(snapshotError(departure, rotation.departedAt, "predictedDepartureAt"));
      }
    }
    if (rotation.landedAt) {
      const landing = latestSnapshotBefore(snapshots, rotation.landedAt, "IN_FLIGHT");
      if (landing) {
        landingErrors.push(snapshotError(landing, rotation.landedAt, "predictedLandingAt"));
      }
    }
    if (rotation.completedAt) {
      const completion = latestSnapshotBefore(snapshots, rotation.completedAt, "LANDED");
      if (completion) {
        completionErrors.push(
          snapshotError(completion, rotation.completedAt, "predictedCompletionAt"),
        );
      }
    }
  }

  const qualities: Record<PredictionQuality, number> = { STABLE: 0, CHANGING: 0, UNCERTAIN: 0 };
  let uncertainCountdownViolations = 0;
  for (const snapshot of input.snapshots) {
    qualities[snapshot.quality] += 1;
    if (snapshot.quality === "UNCERTAIN" && snapshot.countdownDisplayed) {
      uncertainCountdownViolations += 1;
    }
  }
  const reactionSeconds = input.events.map(
    (event) => (Date.parse(event.forecastRecalculatedAt) - Date.parse(event.occurredAt)) / 1_000,
  );
  const width =
    boardingWindowWidths.length === 0
      ? null
      : rounded(
          boardingWindowWidths.reduce((sum, value) => sum + value, 0) / boardingWindowWidths.length,
        );
  return {
    boarding: {
      ...metricSummary(boardingErrors),
      windowCoveragePercent:
        boardingWindowSamples === 0
          ? null
          : rounded((boardingWindowsHit / boardingWindowSamples) * 100),
      averageWindowWidthMinutes: width,
    },
    departure: metricSummary(departureErrors),
    landing: metricSummary(landingErrors),
    completion: metricSummary(completionErrors),
    horizons: {
      "15": metricSummary(horizonErrors["15"]),
      "30": metricSummary(horizonErrors["30"]),
      "60": metricSummary(horizonErrors["60"]),
    },
    qualities,
    uncertainCountdownViolations,
    maximumEventReactionSeconds: reactionSeconds.length === 0 ? 0 : Math.max(...reactionSeconds),
  };
}

export function runSimulation(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[] = [],
): SimulationResult {
  const validationErrors = validateSimulationConfig(config);
  if (validationErrors.length > 0) throw new Error(validationErrors.join(" "));
  const startMs = Date.parse(config.startAt);
  const endMs = Date.parse(config.endAt);
  const aircraft = createAircraft(config.aircraftCount);
  for (const entry of aircraft) {
    entry.nextPauseAtMinutes = config.incidents.plannedPause.everyOperatingMinutes;
  }
  const rotations = createDemand(config);
  const events: SimulationEvent[] = [];
  const snapshots: SimulationForecastSnapshot[] = [];
  const allIncidents = [
    ...presetIncidents(config),
    ...manualIncidents.map((entry) => ({ ...entry })),
  ].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id),
  );
  const processedIncidentIds = new Set<string>();
  const activeInterruptions = allIncidents.filter((entry) => entry.type === "EVENT_INTERRUPTION");
  const recordedGlobalBoundaries = new Set<string>();
  let eventSequence = 0;

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

  for (let nowMs = startMs; nowMs <= endMs; nowMs += TICK_MS) {
    for (const interruption of activeInterruptions) {
      const incidentStart = roundedTick(Date.parse(interruption.at));
      const incidentEnd = roundedTick(
        addMinutes(Date.parse(interruption.at), interruption.durationMinutes),
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
    const operationalInterrupted = activeInterruptions.some((entry) => {
      const from = roundedTick(Date.parse(entry.at));
      const until = roundedTick(addMinutes(Date.parse(entry.at), entry.durationMinutes));
      return nowMs >= from && nowMs < until;
    });

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
        recordEvent(
          "ROTATION_LANDED",
          landedMs,
          entry.id,
          rotation.id,
          "On-Block bestätigt.",
          nowMs,
        );
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
          config.incidents.refueling.enabled &&
          entry.completedRotations % config.incidents.refueling.everyRotations === 0
        ) {
          entry.pendingBlocks.push({
            key: `${rotation.id}:refueling`,
            state: "REFUELING",
            durationMinutes: deterministicSample(
              config.seed,
              `${rotation.id}:refueling-duration`,
              config.incidents.refueling.duration,
            ),
            dayOutage: false,
            source: "AUTOMATIC",
          });
        }
        if (
          config.incidents.plannedPause.enabled &&
          entry.operatingMinutes >= entry.nextPauseAtMinutes
        ) {
          entry.pendingBlocks.push({
            key: `${rotation.id}:planned-pause`,
            state: "PLANNED_PAUSE",
            durationMinutes: deterministicSample(
              config.seed,
              `${rotation.id}:planned-pause-duration`,
              config.incidents.plannedPause.duration,
            ),
            dayOutage: false,
            source: "AUTOMATIC",
          });
          entry.nextPauseAtMinutes += config.incidents.plannedPause.everyOperatingMinutes;
        }
        const unplannedProbability =
          1 -
          Math.exp(-config.incidents.unplannedPause.ratePerOperatingHour * (operatingMinutes / 60));
        if (
          config.incidents.unplannedPause.enabled &&
          deterministicChance(config.seed, `${rotation.id}:unplanned-pause-chance`) <
            unplannedProbability
        ) {
          entry.pendingBlocks.push({
            key: `${rotation.id}:unplanned-pause`,
            state: "UNPLANNED_PAUSE",
            durationMinutes: deterministicSample(
              config.seed,
              `${rotation.id}:unplanned-pause-duration`,
              config.incidents.unplannedPause.duration,
            ),
            dayOutage: false,
            source: "AUTOMATIC",
          });
        }
        const defectProbability =
          1 -
          Math.exp(
            -config.incidents.technicalDefect.ratePerOperatingHour * (operatingMinutes / 60),
          );
        if (
          config.incidents.technicalDefect.enabled &&
          deterministicChance(config.seed, `${rotation.id}:defect-chance`) < defectProbability
        ) {
          const dayOutage =
            deterministicChance(config.seed, `${rotation.id}:day-outage-chance`) <
            config.incidents.technicalDefect.dayOutageProbability;
          entry.pendingBlocks.push({
            key: `${rotation.id}:technical-defect`,
            state: dayOutage ? "DAY_OUT" : "TECHNICAL_DEFECT",
            durationMinutes: deterministicSample(
              config.seed,
              `${rotation.id}:technical-defect-duration`,
              config.incidents.technicalDefect.duration,
            ),
            dayOutage,
            source: "AUTOMATIC",
          });
        }
      }
    }

    for (const entry of aircraft) {
      if (entry.state === "AVAILABLE" && entry.activeRotationId === null) {
        const block = entry.pendingBlocks.shift();
        if (block) startBlock(entry, block, nowMs);
      }
    }

    if (!operationalInterrupted) {
      const waiting = rotations.filter(
        (rotation) => rotation.status === "DRAFT" && Date.parse(rotation.createdAt) <= nowMs,
      );
      const plan = planNextRotations({
        groups: waiting.map((rotation, index) => ({
          id: rotation.id,
          size: rotation.passengerCount,
          queueSequence: index + 1,
          productId: PRODUCT_ID,
          standby: false,
        })),
        aircraft: aircraft.map((entry) => ({
          id: entry.id,
          capacity: entry.capacity,
          compatibleProductIds: [PRODUCT_ID],
          available: entry.state === "AVAILABLE" && entry.activeRotationId === null,
        })),
        standbyPriority: false,
      });
      for (const assignment of plan.assignments) {
        const rotationId = assignment.groupIds[0];
        if (!rotationId) continue;
        const rotation = rotations.find((candidate) => candidate.id === rotationId);
        const entry = aircraft.find((candidate) => candidate.id === assignment.aircraftId);
        if (!rotation || !entry || rotation.status !== "DRAFT" || entry.state !== "AVAILABLE")
          continue;
        rotation.status = "CALLED";
        rotation.aircraftId = entry.id;
        rotation.calledAt = iso(nowMs);
        rotation.boardingMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:boarding`,
          config.phases.boarding,
        );
        rotation.flightMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:flight`,
          config.phases.flight,
        );
        rotation.deboardingMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:deboarding`,
          config.phases.deboarding,
        );
        rotation.bufferMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:buffer`,
          config.phases.buffer,
        );
        entry.state = "ACTIVE";
        entry.activeRotationId = rotation.id;
        recordEvent("ROTATION_CALLED", nowMs, entry.id, rotation.id, "Aufruf bestätigt.");
      }
    }

    const open = rotations.filter(
      (rotation) => rotation.status !== "COMPLETED" && Date.parse(rotation.createdAt) <= nowMs,
    );
    const durationSamples = rotations
      .filter((rotation) => rotation.completedAt && rotation.calledAt)
      .map((rotation) => ({
        minutes:
          (Date.parse(rotation.completedAt ?? "") - Date.parse(rotation.calledAt ?? "")) /
          MINUTE_MS,
        completedAt: rotation.completedAt ?? config.startAt,
        eventId: EVENT_ID,
        productCode: PRODUCT_ID,
        aircraftType: rotation.aircraftId
          ? (aircraft.find((entry) => entry.id === rotation.aircraftId)?.aircraftType ?? null)
          : null,
      }));
    const draftSequence = new Map(
      open
        .filter((rotation) => rotation.status === "DRAFT")
        .map((rotation, index) => [rotation.id, index + 1]),
    );
    const activeCapacity = aircraft.filter(
      (entry) => entry.state === "AVAILABLE" || entry.state === "ACTIVE",
    ).length;
    const projections = calculateForecastTimelines({
      event: {
        eventId: EVENT_ID,
        now: iso(nowMs),
        operationalInterrupted,
        emergencyMode: false,
        plannedBoardingMinutes: config.phases.boarding.typical,
        plannedDeboardingMinutes: config.phases.deboarding.typical,
        plannedBufferMinutes: config.phases.buffer.typical,
      },
      rotations: open.map((rotation) => ({
        id: rotation.id,
        status: rotation.status as ForecastRotationStatus,
        createdAt: rotation.createdAt,
        calledAt: rotation.calledAt,
        departedAt: rotation.departedAt,
        landedAt: rotation.landedAt,
        resourceGroupId: RESOURCE_GROUP_ID,
        resourceGroupStatus: operationalInterrupted ? "INTERRUPTED" : "ACTIVE",
        queueSequence: rotation.status === "DRAFT" ? (draftSequence.get(rotation.id) ?? 1) : 1,
        referenceDurationMinutes: config.phases.flight.typical,
        productCode: PRODUCT_ID,
        aircraftType: rotation.aircraftId
          ? (aircraft.find((entry) => entry.id === rotation.aircraftId)?.aircraftType ?? null)
          : null,
        predictedDepartureAt: rotation.predictedDepartureAt,
        predictedLandingAt: rotation.predictedLandingAt,
        predictedCompletionAt: rotation.predictedCompletionAt,
      })),
      durationSamples,
      capacities: [{ resourceGroupId: RESOURCE_GROUP_ID, activeAircraft: activeCapacity }],
    });
    for (const projection of projections) {
      const rotation = rotations.find((candidate) => candidate.id === projection.rotationId);
      if (!rotation || rotation.status === "COMPLETED") continue;
      rotation.predictedDepartureAt = projection.predictedDepartureAt;
      rotation.predictedLandingAt = projection.predictedLandingAt;
      rotation.predictedCompletionAt = projection.predictedCompletionAt;
      snapshots.push({
        rotationId: rotation.id,
        capturedAt: iso(nowMs),
        status: rotation.status,
        quality: projection.predictionQuality,
        lowerMinutes: projection.predictionLowerMinutes,
        upperMinutes: projection.predictionUpperMinutes,
        plannedBoardingAt: projection.plannedBoardingAt,
        predictedBoardingAt: projection.predictedBoardingAt,
        predictedDepartureAt: projection.predictedDepartureAt,
        predictedLandingAt: projection.predictedLandingAt,
        predictedCompletionAt: projection.predictedCompletionAt,
        sampleSize: projection.sampleSize,
        dataAgeMinutes: projection.dataAgeMinutes,
        activeCapacity: projection.activeCapacity,
        countdownDisplayed: projection.predictionQuality !== "UNCERTAIN",
      });
    }
  }

  events.sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id),
  );
  const publicRotations = rotations.map(publicRotation);
  return {
    config: structuredClone(config),
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
    metrics: calculateSimulationMetrics({ rotations: publicRotations, snapshots, events }),
  };
}
