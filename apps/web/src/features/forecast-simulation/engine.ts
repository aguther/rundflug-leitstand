import {
  calculateForecastTimelines,
  createDispatchPlan,
  type DispatchPlan,
  deriveAdaptivePrecallLeadMinutes,
  derivePublicForecastProjection,
  type ForecastRotationStatus,
  type ForecastUncertaintyReason,
  normalizePrecallObservation,
  type PredictionQuality,
  selectAutomaticPrecalls,
} from "@rundflug/domain";
import { recordConfirmedOvertakes } from "./confirmed-overtakes";
import type {
  ForecastMetricSummary,
  ManualIncident,
  SimulationAircraft,
  SimulationAircraftState,
  SimulationConfig,
  SimulationDispatchDiagnostics,
  SimulationEvent,
  SimulationEventType,
  SimulationForecastSnapshot,
  SimulationMetrics,
  SimulationResult,
  SimulationRotation,
  TriangularDistribution,
} from "./model";
import { SIMULATION_DISPATCH_PLANNING_LIMITS, validateSimulationConfig } from "./model";
import { runOperationalSimulation } from "./operational-engine";

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

function dispatchPublicStatus(rotation: SimulationRotation) {
  if (rotation.precallStatus === "GO_TO_GATE" || rotation.precalledAt) {
    return "COME_TO_FLIGHT_LINE" as const;
  }
  return rotation.precallStatus === "PREPARE" ? ("PREPARE" as const) : ("WAITING" as const);
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
      precallStatus: "WAITING" as const,
      productId: PRODUCT_ID,
      productName: "Rundflug Simulation",
      productCode: PRODUCT_ID,
      resourceGroupId: RESOURCE_GROUP_ID,
      gateLabel: "Simulation Gate",
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
        (snapshot.status !== "DRAFT" || snapshot.forecastState !== "UNAVAILABLE") &&
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
  dispatchDiagnostics?: SimulationDispatchDiagnostics;
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
    NO_FORECAST_CAPACITY: 0,
    NO_FITTING_AIRCRAFT: 0,
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
    const draftSnapshots = snapshots.filter(
      (snapshot) => snapshot.status === "DRAFT" && snapshot.forecastState !== "UNAVAILABLE",
    );
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
  const passengerWaitSamples = completedRotations
    .flatMap((rotation) => {
      if (!rotation.calledAt) return [];
      const waitMinutes = Math.max(
        0,
        (Date.parse(rotation.calledAt) - Date.parse(rotation.createdAt)) / MINUTE_MS,
      );
      return Array.from({ length: Math.max(1, rotation.passengerCount) }, () => waitMinutes);
    })
    .sort((left, right) => left - right);
  const averagePassengerWaitMinutes =
    passengerWaitSamples.length === 0
      ? null
      : rounded(
          passengerWaitSamples.reduce((sum, value) => sum + value, 0) / passengerWaitSamples.length,
        );
  const seatUtilizationSamples = completedRotations.flatMap((rotation) =>
    rotation.dispatchCapacity && rotation.dispatchCapacity > 0
      ? [(rotation.passengerCount / rotation.dispatchCapacity) * 100]
      : [],
  );
  const productWaits = new Map<string, number[]>();
  const servedPassengersByProduct = new Map<string, number>();
  for (const rotation of completedRotations) {
    if (!rotation.calledAt) continue;
    const waits = productWaits.get(rotation.productId ?? "DEFAULT") ?? [];
    const waitMinutes =
      (Date.parse(rotation.calledAt) - Date.parse(rotation.createdAt)) / MINUTE_MS;
    waits.push(...Array.from({ length: Math.max(1, rotation.passengerCount) }, () => waitMinutes));
    productWaits.set(rotation.productId ?? "DEFAULT", waits);
    servedPassengersByProduct.set(
      rotation.productId ?? "DEFAULT",
      (servedPassengersByProduct.get(rotation.productId ?? "DEFAULT") ?? 0) +
        rotation.passengerCount,
    );
  }
  const productServiceDeficits = [...productWaits.values()].flatMap((waits) =>
    averagePassengerWaitMinutes === null
      ? []
      : [
          Math.max(
            0,
            waits.reduce((sum, value) => sum + value, 0) / waits.length -
              averagePassengerWaitMinutes,
          ),
        ],
  );
  const overtakes = completedRotations.reduce(
    (sum, rotation) => sum + (rotation.dispatchOvertakeCount ?? 0),
    0,
  );
  const dispatchedGroups = completedRotations.reduce(
    (sum, rotation) => sum + (rotation.dispatchGroupCount ?? 1),
    0,
  );
  const offeredSeats = completedRotations.reduce(
    (sum, rotation) => sum + (rotation.dispatchCapacity ?? rotation.passengerCount),
    0,
  );
  const occupiedSeats = completedRotations.reduce(
    (sum, rotation) => sum + rotation.passengerCount,
    0,
  );
  const operatingWindowHours =
    Number.isFinite(operationsStartMs) && Number.isFinite(operationsEndMs)
      ? Math.max(0, operationsEndMs - operationsStartMs) / (60 * MINUTE_MS)
      : 0;
  const aircraftOperatingHours = occupiedAircraftMinutes / 60;
  const waitMinutesByProduct = Object.fromEntries(
    [...productWaits.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([productId, waits]) => [
        productId,
        rounded(waits.reduce((sum, value) => sum + value, 0) / waits.length),
      ]),
  );
  const serviceSharePercentByProduct = Object.fromEntries(
    [...servedPassengersByProduct.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([productId, passengers]) => [
        productId,
        occupiedSeats === 0 ? 0 : rounded((passengers / occupiedSeats) * 100),
      ]),
  );
  const maximumProductServiceDeficitMinutes =
    productServiceDeficits.length === 0 ? null : rounded(Math.max(...productServiceDeficits));
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
      averageSeatUtilizationPercent:
        seatUtilizationSamples.length === 0
          ? null
          : rounded(
              seatUtilizationSamples.reduce((sum, value) => sum + value, 0) /
                seatUtilizationSamples.length,
            ),
      averagePassengerWaitMinutes,
      p90PassengerWaitMinutes:
        passengerWaitSamples.length === 0 ? null : rounded(quantile(passengerWaitSamples, 0.9)),
      maximumPassengerWaitMinutes:
        passengerWaitSamples.length === 0 ? null : rounded(passengerWaitSamples.at(-1) ?? 0),
      overtakes,
      overtakeRatePercent:
        dispatchedGroups === 0 ? null : rounded((overtakes / dispatchedGroups) * 100),
      maximumProductServiceDeficitMinutes: maximumProductServiceDeficitMinutes,
    },
    dispatch: {
      passengersPerHour:
        operatingWindowHours > 0 ? rounded(occupiedSeats / operatingWindowHours) : null,
      passengersPerAircraftHour:
        aircraftOperatingHours > 0 ? rounded(occupiedSeats / aircraftOperatingHours) : null,
      offeredSeats,
      occupiedSeats,
      averageSeatUtilizationPercent:
        offeredSeats > 0 ? rounded((occupiedSeats / offeredSeats) * 100) : null,
      p50PassengerWaitMinutes:
        passengerWaitSamples.length === 0 ? null : rounded(quantile(passengerWaitSamples, 0.5)),
      p90PassengerWaitMinutes:
        passengerWaitSamples.length === 0 ? null : rounded(quantile(passengerWaitSamples, 0.9)),
      maximumPassengerWaitMinutes:
        passengerWaitSamples.length === 0 ? null : rounded(passengerWaitSamples.at(-1) ?? 0),
      waitMinutesByProduct,
      projectedOvertakes: overtakes,
      maximumOvertakesPerGroup: completedRotations.reduce(
        (maximum, rotation) => Math.max(maximum, rotation.dispatchMaximumOvertakeCount ?? 0),
        0,
      ),
      serviceSharePercentByProduct,
      maximumProductServiceDeficitMinutes,
      unnecessaryPlanChanges: input.dispatchDiagnostics?.unnecessaryPlanChanges ?? 0,
      prepareDemotions: input.dispatchDiagnostics?.prepareDemotions ?? 0,
      goToGateReplans: input.dispatchDiagnostics?.goToGateReplans ?? 0,
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

  const calculateCurrentProjections = (
    nowMs: number,
    resourceGroupStatus: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED",
  ) => {
    const operationalInterrupted = resourceGroupStatus === "INTERRUPTED";
    const forecastResourceGroupStatus =
      resourceGroupStatus === "PAUSED" && nowMs < operationsStartMs
        ? "ACTIVE"
        : resourceGroupStatus;
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
      forecastResourceGroupStatus === "ACTIVE"
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
            aircraftId: entry.id,
            passengerSeats: entry.capacity,
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
        resourceGroupStatus: forecastResourceGroupStatus,
        queueSequence: rotation.status === "DRAFT" ? (draftSequence.get(rotation.id) ?? 1) : 1,
        dispatchGroupIds: [rotation.id],
        productId: PRODUCT_ID,
        gateId: "SIMULATION_GATE",
        soldAt: rotation.createdAt,
        attendanceStatus: "WAITING" as const,
        standby: false,
        publicStatus: dispatchPublicStatus(rotation),
        confirmedOvertakeCount: rotation.dispatchConfirmedOvertakeCount ?? 0,
        passengerCount: rotation.passengerCount,
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
      previousDispatchPlan,
      dispatchPlanningLimits: SIMULATION_DISPATCH_PLANNING_LIMITS,
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
    const waitingRotations = rotations
      .filter((rotation) => rotation.status === "DRAFT" && Date.parse(rotation.createdAt) <= nowMs)
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    const waitingQueueSequence = new Map(
      waitingRotations.map((rotation, index) => [rotation.id, index + 1] as const),
    );
    if (waitingRotations.length > 0) {
      const observedGateWaitMinutes = rotations.flatMap((rotation) =>
        rotation.precalledAt && rotation.calledAt
          ? [
              normalizePrecallObservation({
                observedGoToGateToBoardingMinutes:
                  (Date.parse(rotation.calledAt) - Date.parse(rotation.precalledAt)) / MINUTE_MS,
                gateTravelLeadMinutesUsed: rotation.precallGateTravelLeadMinutes ?? 0,
              }),
            ]
          : [],
      );
      const adaptiveLeadMinutes = deriveAdaptivePrecallLeadMinutes({
        observedGateWaitMinutes,
        tuning: config.forecastTuning.precall,
      });
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
              forecastCapacityStatus: projection.capacityStatus,
              predictionQuality: projection.predictionQuality,
              predictedBoardingMinutes:
                projection.predictionLowerMinutes === null
                  ? Number.POSITIVE_INFINITY
                  : Math.ceil(projection.predictionLowerMinutes),
              adaptiveLeadMinutes,
              prepareLeadMinutes: config.adminParameters.plannedBoardingMinutes,
              gateTravelLeadMinutes: 0,
              dispatchPlanFresh: projection.dispatchPlanRevision !== null,
              inNearDispatchBatch: projection.dispatchWave !== null && projection.dispatchWave <= 2,
              waitingForProductFairness:
                projection.dispatchUnplannedReason === "WAITING_FOR_PRODUCT_FAIRNESS",
              waitingForFittingLane:
                projection.dispatchUnplannedReason === "WAITING_FOR_FITTING_LANE",
              commitmentLocked: projection.dispatchUnplannedReason === "COMMITMENT_LOCKED",
              dispatchOrder: projection.dispatchOrder,
              queueSequence: waitingQueueSequence.get(rotation.id) ?? 1,
            },
          ];
        }),
      );
      for (const decision of decisions) {
        const rotation = rotationById.get(decision.id);
        const projection = projectionByRotationId.get(decision.id);
        if (!rotation) continue;
        rotation.precallStatus = decision.status;
        if (!decision.eligible || !projection?.predictedBoardingAt) continue;
        rotation.precalledAt = iso(nowMs);
        rotation.precallTrigger = "AUTOMATIC_PRECALL";
        rotation.precallPredictionQuality = projection.predictionQuality;
        rotation.precallPredictedBoardingAt = projection.predictedBoardingAt;
        rotation.precallAdaptiveLeadMinutes = adaptiveLeadMinutes;
        rotation.precallGateTravelLeadMinutes = 0;
        rotation.precallEffectiveLeadMinutes = adaptiveLeadMinutes;
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
      const waiting = rotations
        .filter(
          (rotation) => rotation.status === "DRAFT" && Date.parse(rotation.createdAt) <= nowMs,
        )
        .sort(
          (left, right) =>
            Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.id.localeCompare(right.id),
        );
      const plan = createDispatchPlan({
        now: iso(nowMs),
        groups: waiting.map((rotation, index) => ({
          id: rotation.id,
          groupIds: [rotation.id],
          size: rotation.passengerCount,
          queueSequence: index + 1,
          productId: PRODUCT_ID,
          resourceGroupId: RESOURCE_GROUP_ID,
          gateId: "SIMULATION_GATE",
          soldAt: rotation.createdAt,
          attendanceStatus: "WAITING" as const,
          standby: false,
          publicStatus: dispatchPublicStatus(rotation),
          confirmedOvertakeCount: rotation.dispatchConfirmedOvertakeCount ?? 0,
        })),
        lanes: aircraft.flatMap((entry) =>
          entry.state === "AVAILABLE" && entry.activeRotationId === null
            ? [
                {
                  id: entry.id,
                  aircraftId: entry.id,
                  pilotId: null,
                  resourceGroupId: RESOURCE_GROUP_ID,
                  passengerSeats: entry.capacity,
                  availableLowerAt: iso(nowMs),
                  availableExpectedAt: iso(nowMs),
                  availableUpperAt: iso(nowMs),
                  productDurations: [
                    {
                      productId: PRODUCT_ID,
                      lowerMinutes:
                        config.realityModel.phases.boarding.minimum +
                        config.realityModel.phases.flight.minimum +
                        config.realityModel.phases.deboarding.minimum +
                        config.realityModel.phases.buffer.minimum,
                      expectedMinutes:
                        config.realityModel.phases.boarding.typical +
                        config.realityModel.phases.flight.typical +
                        config.realityModel.phases.deboarding.typical +
                        config.realityModel.phases.buffer.typical,
                      upperMinutes:
                        config.realityModel.phases.boarding.maximum +
                        config.realityModel.phases.flight.maximum +
                        config.realityModel.phases.deboarding.maximum +
                        config.realityModel.phases.buffer.maximum,
                    },
                  ],
                },
              ]
            : [],
        ),
        previousPlan: previousDispatchPlan,
        limits: SIMULATION_DISPATCH_PLANNING_LIMITS,
      });
      for (const decision of plan.groupDecisions) {
        const batch = plan.batches.find((entry) => entry.id === decision.batchId);
        const rotation = rotations.find((entry) => entry.id === decision.memberId);
        if (!batch || !rotation) continue;
        const signature = batch.laneId;
        const previous = previousDispatchAssignments.get(decision.memberId);
        const previousLaneStillPlanned =
          previous !== undefined &&
          plan.batches.some((entry) => entry.laneId === previous.signature);
        if (previous && previous.signature !== signature && previousLaneStillPlanned) {
          dispatchDiagnostics.unnecessaryPlanChanges += 1;
          if (rotation.precallStatus === "GO_TO_GATE") {
            dispatchDiagnostics.goToGateReplans += 1;
          }
        }
        if (previous?.commitment === "PREPARE" && batch.commitmentLevel === "WAITING") {
          dispatchDiagnostics.prepareDemotions += 1;
        }
        previousDispatchAssignments.set(decision.memberId, {
          signature,
          commitment: batch.commitmentLevel,
        });
      }
      previousDispatchPlan = plan;
      for (const assignment of plan.batches.filter((batch) => batch.wave === 1)) {
        const assignedRotations = assignment.memberIds.flatMap((rotationId) => {
          const rotation = rotations.find((candidate) => candidate.id === rotationId);
          return rotation ? [rotation] : [];
        });
        const rotation = assignedRotations[0];
        const entry = aircraft.find((candidate) => candidate.id === assignment.assumedAircraftId);
        if (!rotation || !entry || rotation.status !== "DRAFT" || entry.state !== "AVAILABLE")
          continue;
        recordConfirmedOvertakes({
          rotations,
          selectedRotationIds: assignment.memberIds,
          resourceGroupId: RESOURCE_GROUP_ID,
        });
        rotation.passengerCount = assignedRotations.reduce(
          (sum, member) => sum + member.passengerCount,
          0,
        );
        rotation.createdAt = assignedRotations.reduce(
          (earliest, member) =>
            Date.parse(member.createdAt) < Date.parse(earliest) ? member.createdAt : earliest,
          rotation.createdAt,
        );
        rotation.dispatchBatchId = assignment.id;
        rotation.dispatchOrder = assignment.dispatchOrder;
        rotation.dispatchGroupCount = assignedRotations.length;
        rotation.dispatchCapacity = entry.capacity;
        rotation.dispatchOvertakeCount = plan.groupDecisions
          .filter((decision) => assignment.memberIds.includes(decision.memberId))
          .reduce((sum, decision) => sum + decision.projectedOvertakeCount, 0);
        rotation.dispatchMaximumOvertakeCount = Math.max(
          0,
          ...plan.groupDecisions
            .filter((decision) => assignment.memberIds.includes(decision.memberId))
            .map((decision) => decision.projectedOvertakeCount),
        );
        for (const merged of assignedRotations.slice(1)) {
          const index = rotations.findIndex((candidate) => candidate.id === merged.id);
          if (index >= 0) rotations.splice(index, 1);
        }
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
        recordEvent(
          "ROTATION_CALLED",
          nowMs,
          entry.id,
          rotation.id,
          `Dispatch-Batch mit ${assignedRotations.length} vollständigen Gruppen und ${assignment.occupiedSeats}/${entry.capacity} Plätzen bestätigt.`,
        );
      }
    }

    const projections = calculateCurrentProjections(nowMs, resourceGroupStatus);
    for (const projection of projections) {
      const rotation = rotations.find((candidate) => candidate.id === projection.rotationId);
      if (!rotation || rotation.status === "COMPLETED") continue;
      rotation.predictedDepartureAt = projection.predictedDepartureAt;
      rotation.predictedLandingAt = projection.predictedLandingAt;
      rotation.predictedCompletionAt = projection.predictedCompletionAt;
      const forecastResourceGroupStatus =
        resourceGroupStatus === "PAUSED" && nowMs < operationsStartMs
          ? "ACTIVE"
          : resourceGroupStatus;
      const publicForecast = derivePublicForecastProjection({
        rotationStatus: rotation.status,
        predictionQuality: projection.predictionQuality,
        predictedBoardingAt: projection.predictedBoardingAt,
        predictedCompletionAt: projection.predictedCompletionAt,
        operationsEndAt: config.schedule.operationsEndAt,
        dispatchBatchId: projection.dispatchBatchId,
        dispatchUnplannedReason: projection.dispatchUnplannedReason,
        emergencyMode: false,
        operationalInterrupted: projection.uncertaintyReasons.includes("OPERATION_INTERRUPTED"),
        resourceGroupStatus: forecastResourceGroupStatus,
      });
      snapshots.push({
        rotationId: rotation.id,
        capturedAt: iso(nowMs),
        status: rotation.status,
        quality: projection.predictionQuality,
        lowerMinutes: projection.predictionLowerMinutes ?? 0,
        upperMinutes: projection.predictionUpperMinutes ?? 0,
        plannedBoardingAt: projection.plannedBoardingAt,
        predictedBoardingAt: projection.predictedBoardingAt ?? projection.plannedBoardingAt,
        predictedDepartureAt: projection.predictedDepartureAt ?? projection.plannedDepartureAt,
        predictedLandingAt: projection.predictedLandingAt ?? projection.plannedLandingAt,
        predictedCompletionAt: projection.predictedCompletionAt ?? projection.plannedCompletionAt,
        sampleSize: projection.sampleSize,
        dataAgeMinutes: projection.dataAgeMinutes,
        activeCapacity: projection.activeCapacity,
        uncertaintyReasons: projection.uncertaintyReasons,
        ...publicForecast,
        dispatchBatchId: projection.dispatchBatchId,
        dispatchUnplannedReason: projection.dispatchUnplannedReason,
        countdownDisplayed:
          projection.predictionQuality !== "UNCERTAIN" &&
          (publicForecast.forecastState === "DISPATCH_WINDOW" ||
            publicForecast.forecastState === "LONG_RANGE_WINDOW"),
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
      dispatchDiagnostics,
    }),
  };
}
