import type { DurationEstimate, ForecastCapacityStatus, PredictionQuality } from "./forecast-types";

export interface QueueAvailabilityState {
  lowerMinutes: number[];
  expectedMinutes: number[];
  upperMinutes: number[];
  lanes: QueueAvailabilityLane[];
}

export interface QueueAvailabilityConstraint {
  id: string;
  earliestStartMinutes: number;
  expectedStartMinutes: number;
  latestStartMinutes: number;
  minimumDurationMinutes: number;
  typicalDurationMinutes: number;
  maximumDurationMinutes: number;
  effectMode: "BLOCKING" | "SLOWDOWN";
  durationMultiplierPercent: number | null;
  active: boolean;
}

export interface QueueAvailabilityLane {
  laneId: string;
  aircraftId?: string;
  passengerSeats: number;
  lowerMinutes: number;
  expectedMinutes: number;
  upperMinutes: number;
  varianceMinutesSquared: number;
  constraints: QueueAvailabilityConstraint[];
  recurringConstraints: QueueRecurringConstraint[];
}

export interface QueueRecurringConstraint {
  id: string;
  triggerMetric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
  intervalValue: number;
  lowerProgress: number;
  expectedProgress: number;
  upperProgress: number;
  minimumDurationMinutes: number;
  typicalDurationMinutes: number;
  maximumDurationMinutes: number;
  active: boolean;
}

export function createQueueAvailability(input: {
  activeAircraft: number;
  busyAircraftMinutes: readonly number[];
  lanes?: readonly (Omit<
    QueueAvailabilityLane,
    "varianceMinutesSquared" | "recurringConstraints" | "passengerSeats"
  > & {
    passengerSeats?: number;
    recurringConstraints?: readonly QueueRecurringConstraint[];
  })[];
}): QueueAvailabilityState {
  if (input.lanes && input.lanes.length > 0) {
    const lanes = input.lanes.map((lane) => ({
      ...lane,
      passengerSeats: Math.max(1, Math.floor(lane.passengerSeats ?? Number.MAX_SAFE_INTEGER)),
      lowerMinutes: Math.max(0, lane.lowerMinutes),
      expectedMinutes: Math.max(0, lane.expectedMinutes),
      upperMinutes: Math.max(0, lane.upperMinutes),
      varianceMinutesSquared: intervalVariance(
        lane.lowerMinutes,
        lane.expectedMinutes,
        lane.upperMinutes,
      ),
      constraints: [...lane.constraints],
      recurringConstraints: [...(lane.recurringConstraints ?? [])],
    }));
    return availabilityFromLanes(lanes);
  }
  const capacity = Math.max(0, Math.floor(input.activeAircraft));
  const busy = input.busyAircraftMinutes
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, capacity);
  const idle = Array.from({ length: Math.max(0, capacity - busy.length) }, () => 0);
  const slots = [...busy, ...idle];
  slots.sort((left, right) => left - right);
  return availabilityFromLanes(
    slots.map((minutes, index) => ({
      laneId: `capacity-${index + 1}`,
      passengerSeats: Number.MAX_SAFE_INTEGER,
      lowerMinutes: minutes,
      expectedMinutes: minutes,
      upperMinutes: minutes,
      varianceMinutesSquared: 0,
      constraints: [],
      recurringConstraints: [],
    })),
  );
}

function applyDueRecurringConstraints(
  lane: QueueAvailabilityLane,
  operationsEndMinutes: number | null,
): QueueAvailabilityLane {
  if (operationsEndMinutes !== null && lane.expectedMinutes >= operationsEndMinutes) {
    return lane;
  }
  const due = lane.recurringConstraints.filter(
    (constraint) =>
      constraint.active &&
      (constraint.lowerProgress >= constraint.intervalValue ||
        constraint.expectedProgress >= constraint.intervalValue ||
        constraint.upperProgress >= constraint.intervalValue),
  );
  if (due.length === 0) return lane;

  const lowerDuration = Math.max(
    0,
    ...due
      .filter((constraint) => constraint.lowerProgress >= constraint.intervalValue)
      .map((constraint) => constraint.minimumDurationMinutes),
  );
  const expectedDuration = Math.max(
    0,
    ...due
      .filter((constraint) => constraint.expectedProgress >= constraint.intervalValue)
      .map((constraint) => constraint.typicalDurationMinutes),
  );
  const upperDuration = Math.max(
    0,
    ...due
      .filter((constraint) => constraint.upperProgress >= constraint.intervalValue)
      .map((constraint) => constraint.maximumDurationMinutes),
  );
  const lowerMinutes = lane.lowerMinutes + lowerDuration;
  const expectedMinutes = Math.max(lowerMinutes, lane.expectedMinutes + expectedDuration);
  const upperMinutes = Math.max(expectedMinutes, lane.upperMinutes + upperDuration);
  return {
    ...lane,
    lowerMinutes,
    expectedMinutes,
    upperMinutes,
    varianceMinutesSquared: Math.max(
      lane.varianceMinutesSquared,
      intervalVariance(lowerMinutes, expectedMinutes, upperMinutes),
    ),
    recurringConstraints: lane.recurringConstraints.map((constraint) => ({
      ...constraint,
      lowerProgress:
        constraint.lowerProgress >= constraint.intervalValue ? 0 : constraint.lowerProgress,
      expectedProgress:
        constraint.expectedProgress >= constraint.intervalValue ? 0 : constraint.expectedProgress,
      upperProgress:
        constraint.upperProgress >= constraint.intervalValue ? 0 : constraint.upperProgress,
    })),
  };
}

function advanceRecurringProgress(
  lane: QueueAvailabilityLane,
  duration: DurationEstimate,
): QueueAvailabilityLane {
  return {
    ...lane,
    recurringConstraints: lane.recurringConstraints.map((constraint) => {
      if (!constraint.active) return constraint;
      if (constraint.triggerMetric === "COMPLETED_ROTATIONS") {
        return {
          ...constraint,
          lowerProgress: constraint.lowerProgress + 1,
          expectedProgress: constraint.expectedProgress + 1,
          upperProgress: constraint.upperProgress + 1,
        };
      }
      return {
        ...constraint,
        lowerProgress: constraint.lowerProgress + duration.lowerMinutes,
        expectedProgress: constraint.expectedProgress + duration.expectedMinutes,
        upperProgress: constraint.upperProgress + duration.upperMinutes,
      };
    }),
  };
}

const P10_P90_Z = 1.2815515655446004;

function intervalVariance(lower: number, expected: number, upper: number): number {
  const maximumDeviation = Math.max(0, expected - lower, upper - expected);
  return (maximumDeviation / P10_P90_Z) ** 2;
}

function intervalFromVariance(
  expected: number,
  variance: number,
): {
  lower: number;
  upper: number;
} {
  const margin = P10_P90_Z * Math.sqrt(Math.max(0, variance));
  return {
    lower: Math.max(0, expected - margin),
    upper: Math.max(0, expected + margin),
  };
}

function availabilityFromLanes(lanes: QueueAvailabilityLane[]): QueueAvailabilityState {
  const sorted = [...lanes].sort(
    (left, right) =>
      left.expectedMinutes - right.expectedMinutes ||
      left.lowerMinutes - right.lowerMinutes ||
      left.laneId.localeCompare(right.laneId),
  );
  return {
    lowerMinutes: sorted.map((lane) => lane.lowerMinutes),
    expectedMinutes: sorted.map((lane) => lane.expectedMinutes),
    upperMinutes: sorted.map((lane) => lane.upperMinutes),
    lanes: sorted,
  };
}

function shiftPastConstraint(
  start: number,
  duration: number,
  blockStart: number,
  blockEnd: number,
): number {
  return start < blockEnd && start + duration > blockStart ? blockEnd : start;
}

function constraintWindow(
  constraint: QueueAvailabilityConstraint,
  scenario: "lower" | "expected" | "upper",
): { start: number; end: number } {
  let start = constraint.earliestStartMinutes;
  if (scenario === "lower") start = constraint.latestStartMinutes;
  else if (scenario === "expected") start = constraint.expectedStartMinutes;
  if (constraint.active) return { start, end: Number.POSITIVE_INFINITY };
  let duration = constraint.maximumDurationMinutes;
  if (scenario === "lower") duration = constraint.minimumDurationMinutes;
  else if (scenario === "expected") duration = constraint.typicalDurationMinutes;
  return { start, end: start + duration };
}

function overlaps(start: number, duration: number, blockStart: number, blockEnd: number): boolean {
  return start < blockEnd && start + duration > blockStart;
}

export function slowdownMultiplier(
  start: number,
  duration: number,
  constraints: readonly QueueAvailabilityConstraint[],
  scenario: "lower" | "expected" | "upper",
): number {
  let multiplierPercent = 100;
  for (const constraint of constraints) {
    if (constraint.effectMode !== "SLOWDOWN") continue;
    const window = constraintWindow(constraint, scenario);
    if (overlaps(start, duration, window.start, window.end)) {
      multiplierPercent = Math.max(multiplierPercent, constraint.durationMultiplierPercent ?? 100);
    }
  }
  return multiplierPercent;
}

function applyAvailabilityConstraints(
  lane: QueueAvailabilityLane,
  duration: DurationEstimate,
): {
  lane: QueueAvailabilityLane;
  duration: DurationEstimate;
  multiplierPercent: number;
} {
  let lower = lane.lowerMinutes;
  let expected = lane.expectedMinutes;
  let upper = lane.upperMinutes;
  for (const constraint of lane.constraints.filter((entry) => entry.effectMode === "BLOCKING")) {
    lower = shiftPastConstraint(
      lower,
      duration.lowerMinutes,
      constraint.latestStartMinutes,
      constraint.latestStartMinutes + constraint.minimumDurationMinutes,
    );
    expected = shiftPastConstraint(
      expected,
      duration.expectedMinutes,
      constraint.expectedStartMinutes,
      constraint.expectedStartMinutes + constraint.typicalDurationMinutes,
    );
    upper = shiftPastConstraint(
      upper,
      duration.upperMinutes,
      constraint.earliestStartMinutes,
      constraint.earliestStartMinutes + constraint.maximumDurationMinutes,
    );
    expected = Math.max(lower, expected);
    upper = Math.max(expected, upper);
  }
  const lowerMultiplier = slowdownMultiplier(
    lower,
    duration.lowerMinutes,
    lane.constraints,
    "lower",
  );
  const expectedMultiplier = slowdownMultiplier(
    expected,
    duration.expectedMinutes,
    lane.constraints,
    "expected",
  );
  const upperMultiplier = slowdownMultiplier(
    upper,
    duration.upperMinutes,
    lane.constraints,
    "upper",
  );
  return {
    lane: {
      ...lane,
      lowerMinutes: lower,
      expectedMinutes: expected,
      upperMinutes: upper,
      varianceMinutesSquared: Math.max(
        lane.varianceMinutesSquared,
        intervalVariance(lower, expected, upper),
      ),
    },
    duration: {
      ...duration,
      lowerMinutes: (duration.lowerMinutes * lowerMultiplier) / 100,
      expectedMinutes: (duration.expectedMinutes * expectedMultiplier) / 100,
      upperMinutes: (duration.upperMinutes * upperMultiplier) / 100,
      quality:
        expectedMultiplier > 100 && duration.quality === "STABLE" ? "CHANGING" : duration.quality,
    },
    multiplierPercent: expectedMultiplier,
  };
}

export function reserveNextQueueWindow(
  availability: QueueAvailabilityState,
  duration: DurationEstimate,
  operationsEndMinutes: number | null = null,
  minimumPassengerSeats = 1,
  durationByAircraftId?: ReadonlyMap<string, DurationEstimate>,
  preferredLaneId?: string,
  eligibleLaneIds?: ReadonlySet<string>,
): {
  window: {
    lowerMinutes: number;
    upperMinutes: number;
    quality: PredictionQuality;
  } | null;
  availability: QueueAvailabilityState;
  duration: DurationEstimate;
  durationMultiplierPercent: number;
  capacityStatus: ForecastCapacityStatus;
  selectedLaneId: string | null;
  selectedAircraftId: string | null;
} {
  if (availability.lanes.length === 0) {
    return {
      window: null,
      availability,
      duration,
      durationMultiplierPercent: 100,
      capacityStatus: "NO_FORECAST_CAPACITY",
      selectedLaneId: null,
      selectedAircraftId: null,
    };
  }
  const fittingLanes = availability.lanes.filter(
    (lane) =>
      lane.passengerSeats >= minimumPassengerSeats &&
      (preferredLaneId === undefined || lane.laneId === preferredLaneId) &&
      (eligibleLaneIds === undefined || eligibleLaneIds.has(lane.laneId)),
  );
  if (fittingLanes.length === 0) {
    return {
      window: null,
      availability,
      duration,
      durationMultiplierPercent: 100,
      capacityStatus: "NO_FITTING_AIRCRAFT",
      selectedLaneId: null,
      selectedAircraftId: null,
    };
  }
  const adjustedCandidates = fittingLanes.map((lane) =>
    applyAvailabilityConstraints(
      applyDueRecurringConstraints(lane, operationsEndMinutes),
      (lane.aircraftId ? durationByAircraftId?.get(lane.aircraftId) : undefined) ?? duration,
    ),
  );
  const selectedCandidate = [...adjustedCandidates].sort(
    (left, right) =>
      left.lane.expectedMinutes - right.lane.expectedMinutes ||
      left.lane.lowerMinutes - right.lane.lowerMinutes ||
      left.lane.laneId.localeCompare(right.lane.laneId),
  )[0];
  if (!selectedCandidate) {
    return {
      window: null,
      availability,
      duration,
      durationMultiplierPercent: 100,
      capacityStatus: "NO_FORECAST_CAPACITY",
      selectedLaneId: null,
      selectedAircraftId: null,
    };
  }
  const selected = selectedCandidate.lane;
  const effectiveDuration = selectedCandidate.duration;
  const durationVariance = intervalVariance(
    effectiveDuration.lowerMinutes,
    effectiveDuration.expectedMinutes,
    effectiveDuration.upperMinutes,
  );
  const nextExpected = selected.expectedMinutes + effectiveDuration.expectedMinutes;
  const nextVariance = selected.varianceMinutesSquared + durationVariance;
  const nextInterval = intervalFromVariance(nextExpected, nextVariance);
  const adjustedByLaneId = new Map(adjustedCandidates.map(({ lane }) => [lane.laneId, lane]));
  const nextLanes = availability.lanes.map((originalLane) => {
    const lane = adjustedByLaneId.get(originalLane.laneId) ?? originalLane;
    return lane.laneId === selected.laneId
      ? {
          ...lane,
          lowerMinutes: nextInterval.lower,
          expectedMinutes: nextExpected,
          upperMinutes: nextInterval.upper,
          varianceMinutesSquared: nextVariance,
          recurringConstraints: advanceRecurringProgress(lane, effectiveDuration)
            .recurringConstraints,
        }
      : lane;
  });
  let minimumWindowMargin = 5;
  if (effectiveDuration.quality === "UNCERTAIN") minimumWindowMargin = 0;
  else if (effectiveDuration.quality === "STABLE") minimumWindowMargin = 3;
  const windowLower = Math.max(
    0,
    Math.min(selected.lowerMinutes, selected.expectedMinutes - minimumWindowMargin),
  );
  const windowUpper = Math.max(
    selected.upperMinutes,
    selected.expectedMinutes + minimumWindowMargin,
  );
  return {
    window: {
      lowerMinutes: Math.max(0, Math.round(windowLower)),
      upperMinutes: Math.max(0, Math.round(windowUpper)),
      quality: effectiveDuration.quality,
    },
    availability: availabilityFromLanes(nextLanes),
    duration: effectiveDuration,
    durationMultiplierPercent: selectedCandidate.multiplierPercent,
    capacityStatus: "AVAILABLE",
    selectedLaneId: selected.laneId,
    selectedAircraftId: selected.aircraftId ?? null,
  };
}

export function advanceOverduePrediction(input: {
  status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED";
  now: string;
  predictedDepartureAt: string;
  predictedLandingAt: string;
  predictedCompletionAt: string;
}): {
  predictedDepartureAt: string;
  predictedLandingAt: string;
  predictedCompletionAt: string;
  delayedByMissingEvent: boolean;
} {
  const nowMs = Date.parse(input.now);
  let departureMs = Date.parse(input.predictedDepartureAt);
  let landingMs = Date.parse(input.predictedLandingAt);
  let completionMs = Date.parse(input.predictedCompletionAt);
  let delayedByMissingEvent = false;
  const shiftFrom = (milestoneMs: number) => {
    const delayMs = nowMs - milestoneMs;
    if (delayMs <= 0) return 0;
    delayedByMissingEvent = true;
    return delayMs;
  };
  if (input.status === "CALLED") {
    const delayMs = shiftFrom(departureMs);
    departureMs += delayMs;
    landingMs += delayMs;
    completionMs += delayMs;
  } else if (input.status === "IN_FLIGHT") {
    const delayMs = shiftFrom(landingMs);
    landingMs += delayMs;
    completionMs += delayMs;
  } else if (input.status === "LANDED") {
    completionMs += shiftFrom(completionMs);
  }
  return {
    predictedDepartureAt: new Date(departureMs).toISOString(),
    predictedLandingAt: new Date(landingMs).toISOString(),
    predictedCompletionAt: new Date(completionMs).toISOString(),
    delayedByMissingEvent,
  };
}

export function forecastQueueWindows(input: {
  queueSequence: number;
  activeAircraft: number;
  duration: DurationEstimate;
}): { lowerMinutes: number; upperMinutes: number; quality: PredictionQuality } {
  if (input.activeAircraft <= 0 || input.duration.quality === "UNCERTAIN") {
    return { lowerMinutes: 0, upperMinutes: 0, quality: "UNCERTAIN" };
  }
  const cyclesAhead = Math.floor(Math.max(0, input.queueSequence - 1) / input.activeAircraft);
  return {
    lowerMinutes: cyclesAhead * input.duration.lowerMinutes,
    upperMinutes: (cyclesAhead + 1) * input.duration.upperMinutes,
    quality: input.duration.quality,
  };
}
