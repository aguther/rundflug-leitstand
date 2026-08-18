import type {
  ForecastMetricSummary,
  SimulationDispatchDiagnostics,
  SimulationForecastSnapshot,
  SimulationMetrics,
  SimulationRotation,
} from "./model";
import {
  addSimulationMinutes as addMinutes,
  SIMULATION_MINUTE_MS as MINUTE_MS,
  roundSimulationValue as rounded,
} from "./simulation-primitives";
import { findFirstAvailableDraftForecastSnapshot } from "./simulation-snapshot";

type AccuracyMetrics = Pick<
  SimulationMetrics,
  "boarding" | "initialBoarding" | "departure" | "landing" | "completion" | "horizons"
>;
type QualityMetrics = Pick<
  SimulationMetrics,
  "qualities" | "uncertaintyReasons" | "uncertainCountdownViolations"
>;
type OperationalMetrics = Pick<SimulationMetrics, "operations" | "dispatch">;
type AccuracyAccumulator = {
  boardingErrors: number[];
  initialBoardingErrors: number[];
  departureErrors: number[];
  landingErrors: number[];
  completionErrors: number[];
  horizonErrors: Record<"15" | "30" | "60", number[]>;
  boardingWindowWidths: number[];
  boardingWindowsHit: number;
  boardingWindowSamples: number;
};

export function calculateForecastAccuracyMetrics(
  rotations: readonly SimulationRotation[],
  snapshots: readonly SimulationForecastSnapshot[],
): AccuracyMetrics {
  const snapshotsByRotation = groupSnapshotsByRotation(snapshots);
  const metrics: AccuracyAccumulator = {
    boardingErrors: [],
    initialBoardingErrors: [],
    departureErrors: [],
    landingErrors: [],
    completionErrors: [],
    horizonErrors: { "15": [], "30": [], "60": [] },
    boardingWindowWidths: [],
    boardingWindowsHit: 0,
    boardingWindowSamples: 0,
  };
  for (const rotation of rotations) {
    const rotationSnapshots = snapshotsByRotation.get(rotation.id) ?? [];
    collectBoardingAccuracy(rotation, rotationSnapshots, metrics);
    collectRotationPhaseAccuracy(rotation, rotationSnapshots, metrics);
  }
  const averageWindowWidth = average(metrics.boardingWindowWidths);
  return {
    boarding: {
      ...metricSummary(metrics.boardingErrors),
      windowCoveragePercent:
        metrics.boardingWindowSamples === 0
          ? null
          : rounded((metrics.boardingWindowsHit / metrics.boardingWindowSamples) * 100),
      averageWindowWidthMinutes: averageWindowWidth === null ? null : rounded(averageWindowWidth),
    },
    initialBoarding: metricSummary(metrics.initialBoardingErrors),
    departure: metricSummary(metrics.departureErrors),
    landing: metricSummary(metrics.landingErrors),
    completion: metricSummary(metrics.completionErrors),
    horizons: {
      "15": metricSummary(metrics.horizonErrors["15"]),
      "30": metricSummary(metrics.horizonErrors["30"]),
      "60": metricSummary(metrics.horizonErrors["60"]),
    },
  };
}

function groupSnapshotsByRotation(
  snapshots: readonly SimulationForecastSnapshot[],
): Map<string, SimulationForecastSnapshot[]> {
  const grouped = new Map<string, SimulationForecastSnapshot[]>();
  for (const snapshot of snapshots) {
    const values = grouped.get(snapshot.rotationId) ?? [];
    values.push(snapshot);
    grouped.set(snapshot.rotationId, values);
  }
  return grouped;
}

function collectBoardingAccuracy(
  rotation: SimulationRotation,
  snapshots: readonly SimulationForecastSnapshot[],
  metrics: AccuracyAccumulator,
): void {
  if (!rotation.calledAt) return;
  const initialBoarding = findFirstAvailableDraftForecastSnapshot(
    snapshots,
    rotation.id,
    rotation.calledAt,
  );
  if (initialBoarding) {
    metrics.initialBoardingErrors.push(
      snapshotError(initialBoarding, rotation.calledAt, "predictedBoardingAt"),
    );
  }
  const boarding = latestSnapshotBefore(snapshots, rotation.calledAt, "DRAFT");
  if (boarding) {
    metrics.boardingErrors.push(snapshotError(boarding, rotation.calledAt, "predictedBoardingAt"));
    metrics.boardingWindowSamples += 1;
    metrics.boardingWindowWidths.push(boarding.upperMinutes - boarding.lowerMinutes);
    const actual = Date.parse(rotation.calledAt);
    const captured = Date.parse(boarding.capturedAt);
    if (
      actual >= addMinutes(captured, boarding.lowerMinutes) &&
      actual <= addMinutes(captured, boarding.upperMinutes)
    ) {
      metrics.boardingWindowsHit += 1;
    }
  }
  for (const horizon of [15, 30, 60] as const) {
    const cutoff = addMinutes(Date.parse(rotation.calledAt), -horizon);
    const snapshot = latestSnapshotBefore(snapshots, rotation.calledAt, "DRAFT", cutoff);
    if (snapshot) {
      metrics.horizonErrors[String(horizon) as "15" | "30" | "60"].push(
        snapshotError(snapshot, rotation.calledAt, "predictedBoardingAt"),
      );
    }
  }
}

function collectRotationPhaseAccuracy(
  rotation: SimulationRotation,
  snapshots: readonly SimulationForecastSnapshot[],
  metrics: AccuracyAccumulator,
): void {
  collectPhaseError(
    snapshots,
    rotation.departedAt,
    "CALLED",
    "predictedDepartureAt",
    metrics.departureErrors,
  );
  collectPhaseError(
    snapshots,
    rotation.landedAt,
    "IN_FLIGHT",
    "predictedLandingAt",
    metrics.landingErrors,
  );
  collectPhaseError(
    snapshots,
    rotation.completedAt,
    "LANDED",
    "predictedCompletionAt",
    metrics.completionErrors,
  );
}

function collectPhaseError(
  snapshots: readonly SimulationForecastSnapshot[],
  actualAt: string | null | undefined,
  status: SimulationForecastSnapshot["status"],
  field: "predictedDepartureAt" | "predictedLandingAt" | "predictedCompletionAt",
  errors: number[],
): void {
  if (!actualAt) return;
  const snapshot = latestSnapshotBefore(snapshots, actualAt, status);
  if (snapshot) errors.push(snapshotError(snapshot, actualAt, field));
}

export function calculateForecastQualityMetrics(
  snapshots: readonly SimulationForecastSnapshot[],
): QualityMetrics {
  const qualities: SimulationMetrics["qualities"] = { STABLE: 0, CHANGING: 0, UNCERTAIN: 0 };
  const uncertaintyReasons: SimulationMetrics["uncertaintyReasons"] = {
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
  for (const snapshot of snapshots) {
    qualities[snapshot.quality] += 1;
    for (const reason of snapshot.uncertaintyReasons) uncertaintyReasons[reason] += 1;
    if (snapshot.quality === "UNCERTAIN" && snapshot.countdownDisplayed) {
      uncertainCountdownViolations += 1;
    }
  }
  return { qualities, uncertaintyReasons, uncertainCountdownViolations };
}

export function calculatePrecallMetrics(
  rotations: readonly SimulationRotation[],
): SimulationMetrics["precall"] {
  const calledRotations = rotations.filter((rotation) => rotation.calledAt);
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
  return {
    eligibleGroups: calledRotations.length,
    precalledGroups: precalledRotations.length,
    coveragePercent:
      calledRotations.length === 0
        ? null
        : rounded((precalledRotations.length / calledRotations.length) * 100),
    medianGateWaitMinutes: quantileOrNull(gateWaitMinutes, 0.5),
    p90GateWaitMinutes: quantileOrNull(gateWaitMinutes, 0.9),
    sameTickCount: gateWaitMinutes.filter((value) => value === 0).length,
    uncertainPrecallCount: precalledRotations.filter(
      (rotation) => rotation.precallPredictionQuality === "UNCERTAIN",
    ).length,
  };
}

export function calculateStabilityMetrics(
  snapshots: readonly SimulationForecastSnapshot[],
): SimulationMetrics["stability"] {
  const changes: number[] = [];
  for (const rotationSnapshots of groupSnapshotsByRotation(snapshots).values()) {
    const draftSnapshots = rotationSnapshots.filter(
      (snapshot) => snapshot.status === "DRAFT" && snapshot.forecastState !== "UNAVAILABLE",
    );
    for (let index = 1; index < draftSnapshots.length; index += 1) {
      const previous = draftSnapshots[index - 1];
      const current = draftSnapshots[index];
      if (!previous || !current) continue;
      changes.push(
        Math.abs(
          (Date.parse(current.predictedBoardingAt) - Date.parse(previous.predictedBoardingAt)) /
            MINUTE_MS,
        ),
      );
    }
  }
  const averageChange = average(changes);
  return {
    changes: changes.length,
    averageAbsoluteChangeMinutes: averageChange === null ? null : rounded(averageChange),
    maximumJumpMinutes: rounded(Math.max(0, ...changes)),
    jumpsOver15Minutes: changes.filter((value) => value > 15).length,
    jumpsOver30Minutes: changes.filter((value) => value > 30).length,
    maximumWindowWidthMinutes: Math.max(
      0,
      ...snapshots.map((snapshot) => snapshot.upperMinutes - snapshot.lowerMinutes),
    ),
  };
}

export function calculateOperationalMetrics(input: {
  rotations: readonly SimulationRotation[];
  operationsStartAt?: string;
  operationsEndAt?: string;
  aircraftCount?: number;
  dispatchDiagnostics?: SimulationDispatchDiagnostics;
}): OperationalMetrics {
  const completedRotations = input.rotations.filter((rotation) => rotation.completedAt);
  const operationsStartMs = input.operationsStartAt
    ? Date.parse(input.operationsStartAt)
    : Number.NaN;
  const operationsEndMs = input.operationsEndAt ? Date.parse(input.operationsEndAt) : Number.NaN;
  const occupiedAircraftMinutes = calculateOccupiedAircraftMinutes(completedRotations);
  const passengerWaitSamples = calculatePassengerWaitSamples(completedRotations);
  const averagePassengerWaitMinutes = roundedAverage(passengerWaitSamples);
  const { waitMinutesByProduct, serviceSharePercentByProduct, maximumDeficitMinutes } =
    calculateProductServiceMetrics(completedRotations, averagePassengerWaitMinutes);
  const occupiedSeats = sumPassengers(completedRotations);
  const offeredSeats = completedRotations.reduce(
    (sum, rotation) => sum + (rotation.dispatchCapacity ?? rotation.passengerCount),
    0,
  );
  const overtakes = completedRotations.reduce(
    (sum, rotation) => sum + (rotation.dispatchOvertakeCount ?? 0),
    0,
  );
  const dispatchedGroups = completedRotations.reduce(
    (sum, rotation) => sum + (rotation.dispatchGroupCount ?? 1),
    0,
  );
  return {
    operations: buildOperationsMetrics({
      completedRotations,
      operationsStartMs,
      operationsEndMs,
      aircraftCount: input.aircraftCount ?? 0,
      occupiedAircraftMinutes,
      passengerWaitSamples,
      averagePassengerWaitMinutes,
      overtakes,
      dispatchedGroups,
      maximumDeficitMinutes,
    }),
    dispatch: buildDispatchMetrics({
      completedRotations,
      operationsStartMs,
      operationsEndMs,
      occupiedAircraftMinutes,
      passengerWaitSamples,
      offeredSeats,
      occupiedSeats,
      overtakes,
      waitMinutesByProduct,
      serviceSharePercentByProduct,
      maximumDeficitMinutes,
      diagnostics: input.dispatchDiagnostics,
    }),
  };
}

function calculateOccupiedAircraftMinutes(rotations: readonly SimulationRotation[]): number {
  return rotations.reduce((sum, rotation) => {
    if (!rotation.calledAt || !rotation.completedAt) return sum;
    return sum + (Date.parse(rotation.completedAt) - Date.parse(rotation.calledAt)) / MINUTE_MS;
  }, 0);
}

function calculatePassengerWaitSamples(rotations: readonly SimulationRotation[]): number[] {
  return rotations
    .flatMap((rotation) => {
      if (!rotation.calledAt) return [];
      const waitMinutes = Math.max(
        0,
        (Date.parse(rotation.calledAt) - Date.parse(rotation.createdAt)) / MINUTE_MS,
      );
      return Array.from({ length: Math.max(1, rotation.passengerCount) }, () => waitMinutes);
    })
    .sort((left, right) => left - right);
}

function calculateProductServiceMetrics(
  rotations: readonly SimulationRotation[],
  averagePassengerWaitMinutes: number | null,
): {
  waitMinutesByProduct: Record<string, number>;
  serviceSharePercentByProduct: Record<string, number>;
  maximumDeficitMinutes: number | null;
} {
  const productWaits = new Map<string, number[]>();
  const servedPassengers = new Map<string, number>();
  for (const rotation of rotations)
    collectProductRotation(rotation, productWaits, servedPassengers);
  const occupiedSeats = sumPassengers(rotations);
  const waitMinutesByProduct = Object.fromEntries(
    [...productWaits.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([productId, waits]) => [productId, rounded(average(waits) ?? 0)]),
  );
  const serviceSharePercentByProduct = Object.fromEntries(
    [...servedPassengers.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([productId, passengers]) => [
        productId,
        occupiedSeats === 0 ? 0 : rounded((passengers / occupiedSeats) * 100),
      ]),
  );
  const deficits = [...productWaits.values()].map((waits) =>
    Math.max(0, (average(waits) ?? 0) - (averagePassengerWaitMinutes ?? 0)),
  );
  return {
    waitMinutesByProduct,
    serviceSharePercentByProduct,
    maximumDeficitMinutes: deficits.length === 0 ? null : rounded(Math.max(...deficits)),
  };
}

function collectProductRotation(
  rotation: SimulationRotation,
  productWaits: Map<string, number[]>,
  servedPassengers: Map<string, number>,
): void {
  if (!rotation.calledAt) return;
  const productId = rotation.productId ?? "DEFAULT";
  const waits = productWaits.get(productId) ?? [];
  const waitMinutes = (Date.parse(rotation.calledAt) - Date.parse(rotation.createdAt)) / MINUTE_MS;
  waits.push(...Array.from({ length: Math.max(1, rotation.passengerCount) }, () => waitMinutes));
  productWaits.set(productId, waits);
  servedPassengers.set(productId, (servedPassengers.get(productId) ?? 0) + rotation.passengerCount);
}

type OperationsInput = {
  completedRotations: readonly SimulationRotation[];
  operationsStartMs: number;
  operationsEndMs: number;
  aircraftCount: number;
  occupiedAircraftMinutes: number;
  passengerWaitSamples: readonly number[];
  averagePassengerWaitMinutes: number | null;
  overtakes: number;
  dispatchedGroups: number;
  maximumDeficitMinutes: number | null;
};

function buildOperationsMetrics(input: OperationsInput): SimulationMetrics["operations"] {
  const totalAvailableAircraftMinutes =
    Number.isFinite(input.operationsStartMs) &&
    Number.isFinite(input.operationsEndMs) &&
    input.aircraftCount > 0
      ? ((input.operationsEndMs - input.operationsStartMs) / MINUTE_MS) * input.aircraftCount
      : 0;
  const seatUtilization = input.completedRotations.flatMap((rotation) =>
    rotation.dispatchCapacity && rotation.dispatchCapacity > 0
      ? [(rotation.passengerCount / rotation.dispatchCapacity) * 100]
      : [],
  );
  const latestCompletionMs = Math.max(
    0,
    ...input.completedRotations.map((rotation) => Date.parse(rotation.completedAt ?? "")),
  );
  return {
    completedRotations: input.completedRotations.length,
    overtimeMinutes:
      Number.isFinite(input.operationsEndMs) && latestCompletionMs > input.operationsEndMs
        ? rounded((latestCompletionMs - input.operationsEndMs) / MINUTE_MS)
        : 0,
    aircraftUtilizationPercent:
      totalAvailableAircraftMinutes > 0
        ? rounded((input.occupiedAircraftMinutes / totalAvailableAircraftMinutes) * 100)
        : null,
    averageSeatUtilizationPercent: roundedAverage(seatUtilization),
    averagePassengerWaitMinutes: input.averagePassengerWaitMinutes,
    p90PassengerWaitMinutes: quantileOrNull(input.passengerWaitSamples, 0.9),
    maximumPassengerWaitMinutes: lastOrNull(input.passengerWaitSamples),
    overtakes: input.overtakes,
    overtakeRatePercent:
      input.dispatchedGroups === 0
        ? null
        : rounded((input.overtakes / input.dispatchedGroups) * 100),
    maximumProductServiceDeficitMinutes: input.maximumDeficitMinutes,
  };
}

type DispatchInput = {
  completedRotations: readonly SimulationRotation[];
  operationsStartMs: number;
  operationsEndMs: number;
  occupiedAircraftMinutes: number;
  passengerWaitSamples: readonly number[];
  offeredSeats: number;
  occupiedSeats: number;
  overtakes: number;
  waitMinutesByProduct: Record<string, number>;
  serviceSharePercentByProduct: Record<string, number>;
  maximumDeficitMinutes: number | null;
  diagnostics: SimulationDispatchDiagnostics | undefined;
};

function buildDispatchMetrics(input: DispatchInput): SimulationMetrics["dispatch"] {
  const operatingWindowHours =
    Number.isFinite(input.operationsStartMs) && Number.isFinite(input.operationsEndMs)
      ? Math.max(0, input.operationsEndMs - input.operationsStartMs) / (60 * MINUTE_MS)
      : 0;
  const aircraftOperatingHours = input.occupiedAircraftMinutes / 60;
  return {
    passengersPerHour:
      operatingWindowHours > 0 ? rounded(input.occupiedSeats / operatingWindowHours) : null,
    passengersPerAircraftHour:
      aircraftOperatingHours > 0 ? rounded(input.occupiedSeats / aircraftOperatingHours) : null,
    offeredSeats: input.offeredSeats,
    occupiedSeats: input.occupiedSeats,
    averageSeatUtilizationPercent:
      input.offeredSeats > 0 ? rounded((input.occupiedSeats / input.offeredSeats) * 100) : null,
    p50PassengerWaitMinutes: quantileOrNull(input.passengerWaitSamples, 0.5),
    p90PassengerWaitMinutes: quantileOrNull(input.passengerWaitSamples, 0.9),
    maximumPassengerWaitMinutes: lastOrNull(input.passengerWaitSamples),
    waitMinutesByProduct: input.waitMinutesByProduct,
    projectedOvertakes: input.overtakes,
    maximumOvertakesPerGroup: input.completedRotations.reduce(
      (maximum, rotation) => Math.max(maximum, rotation.dispatchMaximumOvertakeCount ?? 0),
      0,
    ),
    serviceSharePercentByProduct: input.serviceSharePercentByProduct,
    maximumProductServiceDeficitMinutes: input.maximumDeficitMinutes,
    unnecessaryPlanChanges: input.diagnostics?.unnecessaryPlanChanges ?? 0,
    prepareDemotions: input.diagnostics?.prepareDemotions ?? 0,
    goToGateReplans: input.diagnostics?.goToGateReplans ?? 0,
  };
}

function sumPassengers(rotations: readonly SimulationRotation[]): number {
  return rotations.reduce((sum, rotation) => sum + rotation.passengerCount, 0);
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
    maeMinutes: rounded(average(absolute) ?? 0),
    medianAbsoluteErrorMinutes: rounded(quantile(absolute, 0.5)),
    p90AbsoluteErrorMinutes: rounded(quantile(absolute, 0.9)),
    biasMinutes: rounded(average(errors) ?? 0),
  };
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundedAverage(values: readonly number[]): number | null {
  const value = average(values);
  return value === null ? null : rounded(value);
}

function quantileOrNull(values: readonly number[], probability: number): number | null {
  return values.length === 0 ? null : rounded(quantile(values, probability));
}

function lastOrNull(values: readonly number[]): number | null {
  return values.length === 0 ? null : rounded(values.at(-1) ?? 0);
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
  status: SimulationForecastSnapshot["status"],
  notAfterMs = Date.parse(actualAt) - 1,
): SimulationForecastSnapshot | undefined {
  return snapshots.findLast(
    (snapshot) =>
      snapshot.status === status &&
      (snapshot.status !== "DRAFT" || snapshot.forecastState !== "UNAVAILABLE") &&
      Date.parse(snapshot.capturedAt) < Date.parse(actualAt) &&
      Date.parse(snapshot.capturedAt) <= notAfterMs,
  );
}
