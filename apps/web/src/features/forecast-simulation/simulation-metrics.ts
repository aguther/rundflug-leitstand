import type {
  ForecastRotationStatus,
  ForecastUncertaintyReason,
  PredictionQuality,
} from "@rundflug/domain";
import type {
  ForecastMetricSummary,
  SimulationDispatchDiagnostics,
  SimulationEvent,
  SimulationForecastSnapshot,
  SimulationMetrics,
  SimulationRotation,
} from "./model";
import {
  addSimulationMinutes as addMinutes,
  SIMULATION_MINUTE_MS as MINUTE_MS,
  roundSimulationValue as rounded,
} from "./simulation-primitives";

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
