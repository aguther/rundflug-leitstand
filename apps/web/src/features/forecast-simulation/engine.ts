import {
  calculateForecastTimelines,
  deriveAdaptivePrecallLeadMinutes,
  type ForecastRotationStatus,
  type ForecastUncertaintyReason,
  type PredictionQuality,
  planNextRotations,
  selectAutomaticPrecalls,
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

function createAircraft(config: SimulationConfig): RuntimeAircraft[] {
  return Array.from({ length: config.adminParameters.aircraftCount }, (_, index) => ({
    id: `aircraft-${index + 1}`,
    registration: `D-SIM${String(index + 1).padStart(2, "0")}`,
    aircraftType: config.adminParameters.aircraftType,
    capacity: config.adminParameters.passengerSeats,
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
  const salesStartMs = Date.parse(config.schedule.salesStartAt);
  const groupSize = config.adminParameters.passengerSeats;
  const arrivalTimes: number[] = [];
  const windows = [...config.realityModel.demand.windows].sort(
    (left, right) =>
      left.startOffsetMinutes - right.startOffsetMinutes ||
      left.endOffsetMinutes - right.endOffsetMinutes,
  );
  for (const [index, window] of windows.entries()) {
    if (window.personsPerHour === 0) continue;
    const windowStartMs = addMinutes(salesStartMs, window.startOffsetMinutes);
    const windowEndMs = addMinutes(salesStartMs, window.endOffsetMinutes);
    const groupRatePerHour = window.personsPerHour / groupSize;
    const random = mulberry32(
      hashSeed(
        config.seed,
        `demand:${index}:${window.startOffsetMinutes}:${window.endOffsetMinutes}`,
      ),
    );
    let arrivalMs = windowStartMs;
    while (arrivalMs < windowEndMs) {
      const draw = Math.max(Number.EPSILON, random.next());
      arrivalMs += (-Math.log(draw) / groupRatePerHour) * 60 * MINUTE_MS;
      if (arrivalMs >= windowEndMs) break;
      arrivalTimes.push(roundedTick(arrivalMs));
    }
  }
  arrivalTimes.sort((left, right) => left - right);
  return arrivalTimes.map((arrivalMs, index) => {
    const sequence = index + 1;
    const id = `rotation-${String(sequence).padStart(3, "0")}`;
    return {
      id,
      communicationNumber: sequence,
      passengerCount: groupSize,
      createdAt: iso(roundedTick(arrivalMs)),
      precalledAt: null,
      precallTrigger: null,
      precallPredictionQuality: null,
      precallPredictedBoardingAt: null,
      precallAdaptiveLeadMinutes: null,
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
    };
  });
}

function presetIncidents(config: SimulationConfig): ManualIncident[] {
  const atMs = addMinutes(Date.parse(config.schedule.operationsStartAt), 120);
  if (atMs >= Date.parse(config.schedule.operationsEndAt)) return [];
  const at = iso(atMs);
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
  operationsStartAt?: string;
  operationsEndAt?: string;
  aircraftCount?: number;
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
  const uncertaintyReasons: Record<ForecastUncertaintyReason, number> = {
    OPERATION_INTERRUPTED: 0,
    EMERGENCY_MODE: 0,
    RESOURCE_GROUP_INACTIVE: 0,
    NO_ACTIVE_CAPACITY: 0,
    PLANNED_CONSTRAINT_OVERDUE: 0,
    UNPLANNED_RESOURCE_RETURN: 0,
    STALE_PREDICTION: 0,
  };
  let uncertainCountdownViolations = 0;
  for (const snapshot of input.snapshots) {
    qualities[snapshot.quality] += 1;
    for (const reason of snapshot.uncertaintyReasons) uncertaintyReasons[reason] += 1;
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
  const calledRotations = input.rotations.filter((rotation) => rotation.calledAt);
  const precalledRotations = calledRotations.filter(
    (rotation) => rotation.precalledAt && rotation.calledAt,
  );
  const gateWaitMinutes = precalledRotations
    .map(
      (rotation) =>
        (Date.parse(rotation.calledAt ?? "") - Date.parse(rotation.precalledAt ?? "")) / MINUTE_MS,
    )
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const forecastChanges: number[] = [];
  for (const snapshots of snapshotsByRotation.values()) {
    const draftSnapshots = snapshots.filter((snapshot) => snapshot.status === "DRAFT");
    for (let index = 1; index < draftSnapshots.length; index += 1) {
      const previous = draftSnapshots[index - 1];
      const current = draftSnapshots[index];
      if (!previous || !current) continue;
      forecastChanges.push(
        Math.abs(
          (Date.parse(current.predictedBoardingAt) - Date.parse(previous.predictedBoardingAt)) /
            MINUTE_MS,
        ),
      );
    }
  }
  const completedRotations = input.rotations.filter((rotation) => rotation.completedAt);
  const operationsEndMs = input.operationsEndAt ? Date.parse(input.operationsEndAt) : Number.NaN;
  const latestCompletionMs = Math.max(
    0,
    ...completedRotations.map((rotation) => Date.parse(rotation.completedAt ?? "")),
  );
  const operationsStartMs = input.operationsStartAt
    ? Date.parse(input.operationsStartAt)
    : Number.NaN;
  const totalAvailableAircraftMinutes =
    Number.isFinite(operationsStartMs) &&
    Number.isFinite(operationsEndMs) &&
    (input.aircraftCount ?? 0) > 0
      ? ((operationsEndMs - operationsStartMs) / MINUTE_MS) * (input.aircraftCount ?? 0)
      : 0;
  const occupiedAircraftMinutes = completedRotations.reduce(
    (sum, rotation) =>
      sum +
      (rotation.calledAt && rotation.completedAt
        ? (Date.parse(rotation.completedAt) - Date.parse(rotation.calledAt)) / MINUTE_MS
        : 0),
    0,
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
    uncertaintyReasons,
    precall: {
      eligibleGroups: calledRotations.length,
      precalledGroups: precalledRotations.length,
      coveragePercent:
        calledRotations.length === 0
          ? null
          : rounded((precalledRotations.length / calledRotations.length) * 100),
      medianGateWaitMinutes:
        gateWaitMinutes.length === 0 ? null : rounded(quantile(gateWaitMinutes, 0.5)),
      p90GateWaitMinutes:
        gateWaitMinutes.length === 0 ? null : rounded(quantile(gateWaitMinutes, 0.9)),
      sameTickCount: gateWaitMinutes.filter((value) => value === 0).length,
      uncertainPrecallCount: precalledRotations.filter(
        (rotation) => rotation.precallPredictionQuality === "UNCERTAIN",
      ).length,
    },
    stability: {
      changes: forecastChanges.length,
      averageAbsoluteChangeMinutes:
        forecastChanges.length === 0
          ? null
          : rounded(
              forecastChanges.reduce((sum, value) => sum + value, 0) / forecastChanges.length,
            ),
      maximumJumpMinutes: rounded(Math.max(0, ...forecastChanges)),
      jumpsOver15Minutes: forecastChanges.filter((value) => value > 15).length,
      jumpsOver30Minutes: forecastChanges.filter((value) => value > 30).length,
      maximumWindowWidthMinutes: Math.max(
        0,
        ...input.snapshots.map((snapshot) => snapshot.upperMinutes - snapshot.lowerMinutes),
      ),
    },
    operations: {
      completedRotations: completedRotations.length,
      overtimeMinutes:
        Number.isFinite(operationsEndMs) && latestCompletionMs > operationsEndMs
          ? rounded((latestCompletionMs - operationsEndMs) / MINUTE_MS)
          : 0,
      aircraftUtilizationPercent:
        totalAvailableAircraftMinutes > 0
          ? rounded((occupiedAircraftMinutes / totalAvailableAircraftMinutes) * 100)
          : null,
    },
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

  const calculateCurrentProjections = (
    nowMs: number,
    resourceGroupStatus: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED",
  ) => {
    const operationalInterrupted = resourceGroupStatus === "INTERRUPTED";
    const open = rotations.filter(
      (rotation) => rotation.status !== "COMPLETED" && Date.parse(rotation.createdAt) <= nowMs,
    );
    const durationSamples = rotations
      .filter((rotation) => rotation.completedAt && rotation.calledAt)
      .map((rotation) => ({
        minutes:
          (Date.parse(rotation.completedAt ?? "") - Date.parse(rotation.calledAt ?? "")) /
          MINUTE_MS,
        completedAt: rotation.completedAt ?? config.schedule.operationsStartAt,
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
    const activeCapacity =
      resourceGroupStatus === "ACTIVE"
        ? Math.min(
            config.adminParameters.activePilotCount,
            aircraft.filter((entry) => entry.state === "AVAILABLE" || entry.state === "ACTIVE")
              .length,
          )
        : 0;
    const activeInterruptionEndMs = activeInterruptions.reduce<number | null>(
      (latest, interruption) => {
        const startsAt = Date.parse(interruption.at);
        const endsAt = addMinutes(startsAt, interruption.durationMinutes);
        if (nowMs < startsAt || nowMs >= endsAt) return latest;
        return latest === null ? endsAt : Math.max(latest, endsAt);
      },
      null,
    );
    const referenceTotalMinutes =
      config.adminParameters.plannedBoardingMinutes +
      config.adminParameters.productReferenceDurationMinutes +
      config.adminParameters.plannedDeboardingMinutes +
      config.adminParameters.plannedBufferMinutes;
    const availabilityLanes = aircraft
      .flatMap((entry) => {
        if (entry.state === "DAY_OUT") return [];
        const activeRotation = entry.activeRotationId
          ? rotations.find((rotation) => rotation.id === entry.activeRotationId)
          : null;
        const resourceExpectedAt =
          entry.blockedUntilMs ??
          (activeRotation?.predictedCompletionAt
            ? Date.parse(activeRotation.predictedCompletionAt)
            : entry.state === "ACTIVE"
              ? addMinutes(nowMs, referenceTotalMinutes)
              : nowMs);
        const expectedAt = Math.max(nowMs, resourceExpectedAt, activeInterruptionEndMs ?? 0);
        const futureUncertainty = expectedAt > nowMs ? 5 * MINUTE_MS : 0;
        const constraints = [];
        const remainingUntilPlannedPause = entry.nextPauseAtMinutes - entry.operatingMinutes;
        if (
          config.realityModel.incidents.plannedPause.enabled &&
          entry.state !== "PLANNED_PAUSE" &&
          remainingUntilPlannedPause <= referenceTotalMinutes
        ) {
          constraints.push({
            id: `${entry.id}:next-planned-pause`,
            earliestStartAt: iso(expectedAt),
            latestStartAt: iso(addMinutes(expectedAt, 5)),
            minimumDurationMinutes: config.realityModel.incidents.plannedPause.duration.minimum,
            typicalDurationMinutes: config.realityModel.incidents.plannedPause.duration.typical,
            maximumDurationMinutes: config.realityModel.incidents.plannedPause.duration.maximum,
          });
        }
        if (
          config.realityModel.incidents.refueling.enabled &&
          entry.state !== "REFUELING" &&
          (entry.completedRotations + 1) %
            config.realityModel.incidents.refueling.everyRotations ===
            0
        ) {
          constraints.push({
            id: `${entry.id}:next-refueling`,
            earliestStartAt: iso(expectedAt),
            latestStartAt: iso(addMinutes(expectedAt, 5)),
            minimumDurationMinutes: config.realityModel.incidents.refueling.duration.minimum,
            typicalDurationMinutes: config.realityModel.incidents.refueling.duration.typical,
            maximumDurationMinutes: config.realityModel.incidents.refueling.duration.maximum,
          });
        }
        return [
          {
            laneId: entry.id,
            availableLowerAt: iso(Math.max(nowMs, expectedAt - futureUncertainty)),
            availableExpectedAt: iso(expectedAt),
            availableUpperAt: iso(expectedAt + futureUncertainty),
            constraints,
          },
        ];
      })
      .sort(
        (left, right) =>
          Date.parse(left.availableExpectedAt) - Date.parse(right.availableExpectedAt) ||
          left.laneId.localeCompare(right.laneId),
      )
      .slice(0, config.adminParameters.activePilotCount);
    return calculateForecastTimelines({
      event: {
        eventId: EVENT_ID,
        now: iso(nowMs),
        plannedOperationsStartAt:
          config.forecastTuning.availabilityModel === "TIME_DEPENDENT"
            ? config.schedule.operationsStartAt
            : null,
        operationalInterrupted,
        emergencyMode: false,
        plannedBoardingMinutes: config.adminParameters.plannedBoardingMinutes,
        plannedDeboardingMinutes: config.adminParameters.plannedDeboardingMinutes,
        plannedBufferMinutes: config.adminParameters.plannedBufferMinutes,
      },
      rotations: open.map((rotation) => ({
        id: rotation.id,
        status: rotation.status as ForecastRotationStatus,
        createdAt: rotation.createdAt,
        calledAt: rotation.calledAt,
        departedAt: rotation.departedAt,
        landedAt: rotation.landedAt,
        resourceGroupId: RESOURCE_GROUP_ID,
        resourceGroupStatus,
        queueSequence: rotation.status === "DRAFT" ? (draftSequence.get(rotation.id) ?? 1) : 1,
        referenceDurationMinutes: config.adminParameters.productReferenceDurationMinutes,
        productCode: PRODUCT_ID,
        aircraftType: rotation.aircraftId
          ? (aircraft.find((entry) => entry.id === rotation.aircraftId)?.aircraftType ?? null)
          : null,
        predictedDepartureAt: rotation.predictedDepartureAt,
        predictedLandingAt: rotation.predictedLandingAt,
        predictedCompletionAt: rotation.predictedCompletionAt,
      })),
      durationSamples,
      capacities: [
        {
          resourceGroupId: RESOURCE_GROUP_ID,
          activeAircraft: activeCapacity,
          ...(config.forecastTuning.availabilityModel === "TIME_DEPENDENT"
            ? { availabilityLanes }
            : {}),
        },
      ],
      tuning: config.forecastTuning.forecast,
    });
  };

  for (let nowMs = runStartMs; ; nowMs += TICK_MS) {
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
    const resourceGroupStatus =
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

    const precallProjections = calculateCurrentProjections(nowMs, resourceGroupStatus);
    const waitingRotations = rotations.filter(
      (rotation) => rotation.status === "DRAFT" && Date.parse(rotation.createdAt) <= nowMs,
    );
    if (waitingRotations.length > 0) {
      const observedGateWaitMinutes = rotations.flatMap((rotation) =>
        rotation.precalledAt && rotation.calledAt
          ? [(Date.parse(rotation.calledAt) - Date.parse(rotation.precalledAt)) / MINUTE_MS]
          : [],
      );
      const adaptiveLeadMinutes = deriveAdaptivePrecallLeadMinutes({
        observedGateWaitMinutes,
        tuning: config.forecastTuning.precall,
      });
      const latestPrecallAt = rotations.reduce<number | null>((latest, rotation) => {
        if (!rotation.precalledAt) return latest;
        const value = Date.parse(rotation.precalledAt);
        return latest === null ? value : Math.max(latest, value);
      }, null);
      const largestEligibleAircraftSeats = operationsAvailable
        ? aircraft
            .filter((entry) => entry.state === "AVAILABLE" || entry.state === "ACTIVE")
            .reduce((maximum, entry) => Math.max(maximum, entry.capacity), 0)
        : 0;
      const projectionByRotationId = new Map(
        precallProjections.map((projection) => [projection.rotationId, projection]),
      );
      const rotationById = new Map(waitingRotations.map((rotation) => [rotation.id, rotation]));
      const decisions = selectAutomaticPrecalls(
        waitingRotations.flatMap((rotation) => {
          const projection = projectionByRotationId.get(rotation.id);
          if (!projection) return [];
          return [
            {
              id: rotation.id,
              resourceGroupId: RESOURCE_GROUP_ID,
              enabled: config.adminParameters.eventAutomaticPrecallEnabled,
              eventActive: operationsOpen,
              operationsAvailable,
              resourceGroupActive: operationsAvailable,
              resourceGroupEnabled: config.adminParameters.resourceGroupAutomaticPrecallEnabled,
              alreadyPrecalled: rotation.precalledAt !== null,
              groupSize: rotation.passengerCount,
              largestEligibleAircraftSeats,
              predictionQuality: projection.predictionQuality,
              predictedBoardingMinutes: Math.round(
                (projection.predictionLowerMinutes + projection.predictionUpperMinutes) / 2,
              ),
              adaptiveLeadMinutes,
              minutesSinceLastGatePrecall:
                latestPrecallAt === null
                  ? null
                  : Math.max(0, (nowMs - latestPrecallAt) / MINUTE_MS),
              gateCooldownMinutes: config.forecastTuning.precall.gateCooldownMinutes,
            },
          ];
        }),
      );
      for (const decision of decisions) {
        if (!decision.eligible) continue;
        const rotation = rotationById.get(decision.id);
        const projection = projectionByRotationId.get(decision.id);
        if (!rotation || !projection) continue;
        rotation.precalledAt = iso(nowMs);
        rotation.precallTrigger = "AUTOMATIC_PRECALL";
        rotation.precallPredictionQuality = projection.predictionQuality;
        rotation.precallPredictedBoardingAt = projection.predictedBoardingAt;
        rotation.precallAdaptiveLeadMinutes = adaptiveLeadMinutes;
        recordEvent(
          "FLIGHT_GROUP_PRECALLED",
          nowMs,
          null,
          rotation.id,
          `Automatischer GO TO GATE · Prognose ${projection.predictedBoardingAt} · Qualität ${projection.predictionQuality} · Vorlauf ${adaptiveLeadMinutes} Minuten · noch ohne Flugzeugbindung.`,
        );
      }
    }

    if (operationsAvailable) {
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
          config.realityModel.phases.boarding,
        );
        rotation.flightMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:flight`,
          config.realityModel.phases.flight,
        );
        rotation.deboardingMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:deboarding`,
          config.realityModel.phases.deboarding,
        );
        rotation.bufferMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:buffer`,
          config.realityModel.phases.buffer,
        );
        entry.state = "ACTIVE";
        entry.activeRotationId = rotation.id;
        recordEvent("ROTATION_CALLED", nowMs, entry.id, rotation.id, "Aufruf bestätigt.");
      }
    }

    const projections = calculateCurrentProjections(nowMs, resourceGroupStatus);
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
        uncertaintyReasons: projection.uncertaintyReasons,
        countdownDisplayed: projection.predictionQuality !== "UNCERTAIN",
      });
    }
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
    }),
  };
}
