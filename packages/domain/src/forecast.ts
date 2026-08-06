import {
  createDispatchPlan,
  type DispatchCommitmentLevel,
  type DispatchDecisionReason,
  type DispatchLockedBatchInput,
  type DispatchPlan,
  type DispatchPlanInput,
  type DispatchPlanningLimits,
  type DispatchUnplannedReason,
  orderDispatchGroupsForProjection,
} from "./dispatch-plan";
import { deriveReferenceRotationBreakdown } from "./reference-rotation";

export type PredictionQuality = "STABLE" | "CHANGING" | "UNCERTAIN";
export type ForecastState =
  | "DISPATCH_WINDOW"
  | "LONG_RANGE_WINDOW"
  | "AFTER_OPERATIONS_END"
  | "UNAVAILABLE";

export const FORECAST_FRESHNESS_MAX_AGE_MINUTES = 5;

export interface ForecastTuningProfile {
  maximumSamples: number;
  referenceWeight: number;
  firstSampleWeight: number;
  recencyWeightIncrement: number;
  referenceOutlierMultiplier: number;
  madMultiplier: number;
  minimumMadToleranceRatio: number;
  stableMinimumSamples: number;
  stableMaximumMeanDeviationMinutes: number;
  stableMarginMinutes: number;
  changingMarginMinutes: number;
}

export const DEFAULT_FORECAST_TUNING_PROFILE: Readonly<ForecastTuningProfile> = Object.freeze({
  maximumSamples: 12,
  referenceWeight: 1,
  firstSampleWeight: 2,
  recencyWeightIncrement: 1,
  referenceOutlierMultiplier: 1.75,
  madMultiplier: 3,
  minimumMadToleranceRatio: 0.5,
  stableMinimumSamples: 5,
  stableMaximumMeanDeviationMinutes: 5,
  stableMarginMinutes: 5,
  changingMarginMinutes: 10,
});

export type ForecastUncertaintyReason =
  | "OPERATION_INTERRUPTED"
  | "EMERGENCY_MODE"
  | "RESOURCE_GROUP_INACTIVE"
  | "NO_ACTIVE_CAPACITY"
  | "NO_FORECAST_CAPACITY"
  | "NO_FITTING_AIRCRAFT"
  | "PLANNED_CONSTRAINT_OVERDUE"
  | "UNPLANNED_RESOURCE_RETURN"
  | "STALE_PREDICTION";

export type ForecastCapacityStatus = "AVAILABLE" | "NO_FORECAST_CAPACITY" | "NO_FITTING_AIRCRAFT";

export interface ForecastFreshnessAssessment {
  quality: PredictionQuality;
  reason: Extract<ForecastUncertaintyReason, "STALE_PREDICTION"> | null;
  ageMinutes: number | null;
}

export interface DurationEstimate {
  expectedMinutes: number;
  lowerMinutes: number;
  upperMinutes: number;
  quality: PredictionQuality;
  sampleCount: number;
}

export type ForecastRotationStatus = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED";

export interface ForecastTimelineEventInput {
  eventId: string;
  now: string;
  plannedOperationsStartAt?: string | null;
  plannedOperationsEndAt?: string | null;
  operationalInterrupted: boolean;
  emergencyMode: boolean;
  plannedBoardingMinutes: number;
  plannedDeboardingMinutes: number;
  plannedBufferMinutes: number;
}

export interface ForecastTimelineRotationInput {
  id: string;
  status: ForecastRotationStatus;
  createdAt: string;
  calledAt: string | null;
  departedAt: string | null;
  landedAt: string | null;
  resourceGroupId: string;
  aircraftId?: string | null;
  pilotId?: string | null;
  resourceGroupStatus: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
  queueSequence: number;
  dispatchGroupIds?: readonly string[];
  dispatchPredecessorMemberIds?: readonly string[];
  productId?: string;
  gateId?: string;
  soldAt?: string;
  attendanceStatus?: "WAITING" | "PRESENT" | "MISSING" | "CLARIFICATION";
  standby?: boolean;
  publicStatus?: DispatchCommitmentLevel;
  confirmedOvertakeCount?: number;
  productServiceDeficit?: number;
  passengerCount?: number;
  referenceDurationMinutes: number;
  productCode: string;
  aircraftType: string | null;
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
  turnaroundProfiles?: readonly ForecastTurnaroundProfileInput[];
  confirmedTurnaroundProfile?: Omit<ForecastTurnaroundProfileInput, "aircraftId"> | null;
  constraints?: readonly ForecastAvailabilityConstraintInput[];
}

export interface ForecastTurnaroundProfileInput {
  aircraftId: string;
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  boardingSource: string;
  deboardingSource: string;
  bufferSource: string;
}

export interface ForecastTimelineDurationSample {
  minutes: number;
  completedAt: string;
  eventId: string;
  productCode: string;
  aircraftType: string | null;
}

export interface ForecastTimelineCapacityInput {
  resourceGroupId: string;
  activeAircraft: number;
  availabilityLanes?: readonly ForecastAvailabilityLaneInput[];
  sharedConstraints?: readonly ForecastAvailabilityConstraintInput[];
  unavailableReason?: Extract<DispatchUnplannedReason, "UNKNOWN_RESOURCE_RETURN"> | null;
}

export interface ForecastAvailabilityConstraintInput {
  id: string;
  earliestStartAt: string;
  latestStartAt: string;
  minimumDurationMinutes: number;
  typicalDurationMinutes: number;
  maximumDurationMinutes: number;
  effectMode?: "BLOCKING" | "SLOWDOWN";
  durationMultiplierPercent?: number | null;
  active?: boolean;
  overdue?: boolean;
}

export interface ForecastAvailabilityLaneInput {
  laneId: string;
  aircraftId: string;
  pilotId?: string | null;
  passengerSeats?: number;
  availableLowerAt: string;
  availableExpectedAt: string;
  availableUpperAt: string;
  constraints?: readonly ForecastAvailabilityConstraintInput[];
  recurringConstraints?: readonly ForecastRecurringConstraintInput[];
}

export interface ForecastRecurringConstraintInput {
  id: string;
  triggerMetric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
  intervalValue: number;
  progressValue: number;
  minimumDurationMinutes: number;
  typicalDurationMinutes: number;
  maximumDurationMinutes: number;
  active?: boolean;
}

export type ForecastDataBasisScope =
  | "REFERENCE_ONLY"
  | "AIRCRAFT_PRODUCT_HISTORY"
  | "PRODUCT_HISTORY";

export interface ForecastTimelineProjection {
  rotationId: string;
  plannedBoardingAt: string;
  plannedDepartureAt: string;
  plannedLandingAt: string;
  plannedCompletionAt: string;
  predictedBoardingAt: string | null;
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
  forecastState: ForecastState;
  extendsBeyondOperationsEnd: boolean;
  overtimeMinutes: number;
  predictionQuality: PredictionQuality;
  predictionLowerMinutes: number | null;
  predictionUpperMinutes: number | null;
  capacityStatus: ForecastCapacityStatus;
  dataBasisScope: ForecastDataBasisScope;
  sampleSize: number;
  dataAgeMinutes: number;
  activeCapacity: number;
  referenceDurationMinutes: number;
  assumedAircraftId: string | null;
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  boardingSource: string;
  deboardingSource: string;
  bufferSource: string;
  uncertaintyReasons: ForecastUncertaintyReason[];
  dispatchPlanId: string | null;
  dispatchPlanRevision: string | null;
  dispatchBatchId: string | null;
  dispatchOrder: number | null;
  dispatchWave: number | null;
  dispatchLaneId: string | null;
  dispatchGroupIds: string[];
  dispatchOccupiedSeats: number | null;
  dispatchAvailableSeats: number | null;
  dispatchCommitmentLevel: DispatchCommitmentLevel | null;
  dispatchDecisionReasons: DispatchDecisionReason[];
  dispatchProjectedOvertakeCount: number;
  dispatchUnplannedReason: DispatchUnplannedReason | null;
}

export interface ForecastTimelinesInput {
  event: ForecastTimelineEventInput;
  rotations: readonly ForecastTimelineRotationInput[];
  durationSamples: readonly ForecastTimelineDurationSample[];
  capacities: readonly ForecastTimelineCapacityInput[];
  tuning?: ForecastTuningProfile;
  previousDispatchPlan?: DispatchPlan | null;
  lockedDispatchBatches?: readonly DispatchLockedBatchInput[];
  dispatchPlanningLimits?: Partial<DispatchPlanningLimits>;
}

export interface ForecastCalculationDiagnostics {
  dispatchInput: DispatchPlanInput;
  dispatchPlan: DispatchPlan;
}

export interface ForecastCalculationResult {
  projections: ForecastTimelineProjection[];
  diagnostics: ForecastCalculationDiagnostics;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export const MINIMUM_PLAUSIBLE_DURATION_RATIO = 0.5;

function selectRobustDurationSamples(
  samples: readonly number[],
  referenceMinutes: number,
  tuning: ForecastTuningProfile,
): number[] {
  const plausible = samples.filter(
    (duration) =>
      Number.isFinite(duration) &&
      duration >= referenceMinutes * MINIMUM_PLAUSIBLE_DURATION_RATIO &&
      duration <= referenceMinutes * tuning.referenceOutlierMultiplier,
  );
  if (plausible.length < tuning.stableMinimumSamples) {
    return plausible.slice(-tuning.maximumSamples);
  }
  const center = median(plausible);
  const absoluteDeviations = plausible.map((duration) => Math.abs(duration - center));
  const medianAbsoluteDeviation = median(absoluteDeviations);
  const tolerance = Math.max(
    referenceMinutes * tuning.minimumMadToleranceRatio,
    medianAbsoluteDeviation * tuning.madMultiplier,
  );
  return plausible
    .filter((duration) => Math.abs(duration - center) <= tolerance)
    .slice(-tuning.maximumSamples);
}

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
  const start =
    scenario === "lower"
      ? constraint.latestStartMinutes
      : scenario === "expected"
        ? constraint.expectedStartMinutes
        : constraint.earliestStartMinutes;
  if (constraint.active) return { start, end: Number.POSITIVE_INFINITY };
  const duration =
    scenario === "lower"
      ? constraint.minimumDurationMinutes
      : scenario === "expected"
        ? constraint.typicalDurationMinutes
        : constraint.maximumDurationMinutes;
  return { start, end: start + duration };
}

function overlaps(start: number, duration: number, blockStart: number, blockEnd: number): boolean {
  return start < blockEnd && start + duration > blockStart;
}

function slowdownMultiplier(
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
): { lane: QueueAvailabilityLane; duration: DurationEstimate; multiplierPercent: number } {
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
  window: { lowerMinutes: number; upperMinutes: number; quality: PredictionQuality } | null;
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
  const minimumWindowMargin =
    effectiveDuration.quality === "UNCERTAIN" ? 0 : effectiveDuration.quality === "STABLE" ? 3 : 5;
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

export function estimateDuration(input: {
  referenceMinutes: number;
  actualDurationsMinutes: readonly number[];
  interrupted: boolean;
  activeCapacity: number;
  tuning?: ForecastTuningProfile;
}): DurationEstimate {
  const tuning = input.tuning ?? DEFAULT_FORECAST_TUNING_PROFILE;
  const validSamples = selectRobustDurationSamples(
    input.actualDurationsMinutes,
    input.referenceMinutes,
    tuning,
  );
  if (input.interrupted || input.activeCapacity === 0) {
    return {
      expectedMinutes: Math.round(input.referenceMinutes),
      lowerMinutes: Math.max(0, Math.round(input.referenceMinutes - tuning.changingMarginMinutes)),
      upperMinutes: Math.round(input.referenceMinutes + tuning.changingMarginMinutes),
      quality: "UNCERTAIN",
      sampleCount: validSamples.length,
    };
  }
  if (validSamples.length === 0) {
    return {
      expectedMinutes: Math.round(input.referenceMinutes),
      lowerMinutes: Math.max(0, Math.round(input.referenceMinutes - tuning.changingMarginMinutes)),
      upperMinutes: Math.round(input.referenceMinutes + tuning.changingMarginMinutes),
      quality: "CHANGING",
      sampleCount: 0,
    };
  }

  let weightedSum = input.referenceMinutes * tuning.referenceWeight;
  let weightSum = tuning.referenceWeight;
  for (const [index, duration] of validSamples.entries()) {
    const weight = tuning.firstSampleWeight + index * tuning.recencyWeightIncrement;
    weightedSum += duration * weight;
    weightSum += weight;
  }
  const expectedMinutes = Math.round(weightedSum / weightSum);
  const meanDeviation =
    validSamples.reduce((sum, duration) => sum + Math.abs(duration - expectedMinutes), 0) /
    validSamples.length;
  const quality: PredictionQuality =
    validSamples.length >= tuning.stableMinimumSamples &&
    meanDeviation <= tuning.stableMaximumMeanDeviationMinutes
      ? "STABLE"
      : "CHANGING";
  const margin = quality === "STABLE" ? tuning.stableMarginMinutes : tuning.changingMarginMinutes;
  return {
    expectedMinutes,
    lowerMinutes: Math.max(0, expectedMinutes - margin),
    upperMinutes: expectedMinutes + margin,
    quality,
    sampleCount: validSamples.length,
  };
}

export function assessForecastFreshness(input: {
  predictionQuality: PredictionQuality | null;
  predictionUpdatedAt: string | null;
  now: string;
  maximumAgeMinutes?: number;
}): ForecastFreshnessAssessment {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("Forecast freshness time is invalid.");
  const maximumAgeMinutes = input.maximumAgeMinutes ?? FORECAST_FRESHNESS_MAX_AGE_MINUTES;
  if (!Number.isFinite(maximumAgeMinutes) || maximumAgeMinutes < 0) {
    throw new Error("Forecast freshness maximum age is invalid.");
  }
  const updatedAtMs = input.predictionUpdatedAt
    ? Date.parse(input.predictionUpdatedAt)
    : Number.NaN;
  if (input.predictionQuality === null || !Number.isFinite(updatedAtMs)) {
    return { quality: "UNCERTAIN", reason: "STALE_PREDICTION", ageMinutes: null };
  }
  const ageMinutes = Math.max(0, (nowMs - updatedAtMs) / 60_000);
  if (ageMinutes > maximumAgeMinutes) {
    return { quality: "UNCERTAIN", reason: "STALE_PREDICTION", ageMinutes };
  }
  return { quality: input.predictionQuality, reason: null, ageMinutes };
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

function addMinutes(value: string | Date, minutes: number): string {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
}

function operationsEndAssessment(
  predictedCompletionAt: string | null,
  plannedOperationsEndAt: string | null | undefined,
): { extendsBeyondOperationsEnd: boolean; overtimeMinutes: number } {
  const completionMs = predictedCompletionAt ? Date.parse(predictedCompletionAt) : Number.NaN;
  const operationsEndMs = plannedOperationsEndAt ? Date.parse(plannedOperationsEndAt) : Number.NaN;
  if (!Number.isFinite(completionMs) || !Number.isFinite(operationsEndMs)) {
    return { extendsBeyondOperationsEnd: false, overtimeMinutes: 0 };
  }
  const overtimeMinutes = Math.max(0, Math.ceil((completionMs - operationsEndMs) / 60_000));
  return {
    extendsBeyondOperationsEnd: overtimeMinutes > 0,
    overtimeMinutes,
  };
}

/**
 * Projects every open rotation from normalized state. The caller owns storage, transport and time;
 * this function deliberately has no Cloudflare, database or browser dependency.
 */
function calculateLegacyForecastTimelines(
  input: ForecastTimelinesInput,
): ForecastTimelineProjection[] {
  const now = new Date(input.event.now);
  if (!Number.isFinite(now.getTime())) throw new Error("Forecast time is invalid.");
  const tuning = input.tuning ?? DEFAULT_FORECAST_TUNING_PROFILE;
  const capacities = new Map(
    input.capacities.map((entry) => [
      entry.resourceGroupId,
      {
        ...entry,
        activeAircraft: Math.max(0, Math.floor(entry.activeAircraft)),
      },
    ]),
  );
  const busyAircraftMinutes = new Map<string, number[]>();
  for (const rotation of input.rotations) {
    if (rotation.status === "DRAFT") continue;
    let predictedCompletion = rotation.predictedCompletionAt
      ? Date.parse(rotation.predictedCompletionAt)
      : Number.NaN;
    if (
      rotation.predictedDepartureAt &&
      rotation.predictedLandingAt &&
      rotation.predictedCompletionAt
    ) {
      predictedCompletion = Date.parse(
        advanceOverduePrediction({
          status: rotation.status,
          now: input.event.now,
          predictedDepartureAt: rotation.predictedDepartureAt,
          predictedLandingAt: rotation.predictedLandingAt,
          predictedCompletionAt: rotation.predictedCompletionAt,
        }).predictedCompletionAt,
      );
    }
    const fallback = deriveReferenceRotationBreakdown({
      boardingMinutes: input.event.plannedBoardingMinutes,
      offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
      deboardingMinutes: input.event.plannedDeboardingMinutes,
      bufferMinutes: input.event.plannedBufferMinutes,
    }).totalMinutes;
    const remaining = Number.isFinite(predictedCompletion)
      ? Math.max(0, (predictedCompletion - now.getTime()) / 60_000)
      : fallback;
    const values = busyAircraftMinutes.get(rotation.resourceGroupId) ?? [];
    values.push(remaining);
    busyAircraftMinutes.set(rotation.resourceGroupId, values);
  }
  const offsetMinutes = (value: string): number =>
    Math.max(0, (Date.parse(value) - now.getTime()) / 60_000);
  const constraintToQueueConstraint = (
    constraint: ForecastAvailabilityConstraintInput,
  ): QueueAvailabilityConstraint => {
    const earliest = offsetMinutes(constraint.earliestStartAt);
    const latest = Math.max(earliest, offsetMinutes(constraint.latestStartAt));
    return {
      id: constraint.id,
      earliestStartMinutes: earliest,
      expectedStartMinutes: (earliest + latest) / 2,
      latestStartMinutes: latest,
      minimumDurationMinutes: constraint.minimumDurationMinutes,
      typicalDurationMinutes: constraint.typicalDurationMinutes,
      maximumDurationMinutes: constraint.maximumDurationMinutes,
      effectMode: constraint.effectMode ?? "BLOCKING",
      durationMultiplierPercent: constraint.durationMultiplierPercent ?? null,
      active: constraint.active ?? false,
    };
  };
  const operationStartMinutes = input.event.plannedOperationsStartAt
    ? offsetMinutes(input.event.plannedOperationsStartAt)
    : 0;
  const operationEndMinutes = input.event.plannedOperationsEndAt
    ? offsetMinutes(input.event.plannedOperationsEndAt)
    : null;
  const queueAvailability = new Map(
    [...capacities.entries()].map(([resourceGroupId, capacity]) => {
      const sharedConstraints = (capacity.sharedConstraints ?? []).map(constraintToQueueConstraint);
      const lanes = capacity.availabilityLanes?.map((lane) => {
        const lower = Math.max(operationStartMinutes, offsetMinutes(lane.availableLowerAt));
        const expected = Math.max(operationStartMinutes, offsetMinutes(lane.availableExpectedAt));
        const upper = Math.max(
          expected,
          operationStartMinutes,
          offsetMinutes(lane.availableUpperAt),
        );
        return {
          laneId: lane.laneId,
          aircraftId: lane.aircraftId,
          ...(lane.passengerSeats === undefined ? {} : { passengerSeats: lane.passengerSeats }),
          lowerMinutes: Math.min(lower, expected),
          expectedMinutes: expected,
          upperMinutes: upper,
          constraints: [
            ...sharedConstraints,
            ...(lane.constraints ?? []).map(constraintToQueueConstraint),
          ].sort(
            (left, right) =>
              left.earliestStartMinutes - right.earliestStartMinutes ||
              left.id.localeCompare(right.id),
          ),
          recurringConstraints: (lane.recurringConstraints ?? []).map((constraint) => ({
            id: constraint.id,
            triggerMetric: constraint.triggerMetric,
            intervalValue: constraint.intervalValue,
            lowerProgress: constraint.progressValue,
            expectedProgress: constraint.progressValue,
            upperProgress: constraint.progressValue,
            minimumDurationMinutes: constraint.minimumDurationMinutes,
            typicalDurationMinutes: constraint.typicalDurationMinutes,
            maximumDurationMinutes: constraint.maximumDurationMinutes,
            active: constraint.active ?? true,
          })),
        };
      });
      if (lanes && lanes.length > 0) {
        return [
          resourceGroupId,
          createQueueAvailability({
            activeAircraft: lanes.length,
            busyAircraftMinutes: [],
            lanes,
          }),
        ] as const;
      }
      const busy = busyAircraftMinutes.get(resourceGroupId) ?? [];
      const idleCount = Math.max(0, capacity.activeAircraft - busy.length);
      const fallbackBusy = busy.slice(0, capacity.activeAircraft);
      const fallbackLanes = [
        ...fallbackBusy.map((minutes, index) => ({
          laneId: `busy-${index + 1}`,
          lowerMinutes: minutes,
          expectedMinutes: minutes,
          upperMinutes: minutes,
          constraints: sharedConstraints,
          recurringConstraints: [],
        })),
        ...Array.from({ length: idleCount }, (_, index) => ({
          laneId: `idle-${index + 1}`,
          lowerMinutes: operationStartMinutes,
          expectedMinutes: operationStartMinutes,
          upperMinutes: operationStartMinutes,
          constraints: sharedConstraints,
          recurringConstraints: [],
        })),
      ];
      return [
        resourceGroupId,
        createQueueAvailability({
          activeAircraft: capacity.activeAircraft,
          busyAircraftMinutes: fallbackBusy,
          lanes: fallbackLanes,
        }),
      ] as const;
    }),
  );
  const newestSamples = [...input.durationSamples].sort(
    (left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt),
  );

  return input.rotations.map((rotation) => {
    const confirmedProfile = rotation.confirmedTurnaroundProfile;
    let boarding = confirmedProfile?.boardingMinutes ?? input.event.plannedBoardingMinutes;
    let deboarding = confirmedProfile?.deboardingMinutes ?? input.event.plannedDeboardingMinutes;
    let buffer = confirmedProfile?.bufferMinutes ?? input.event.plannedBufferMinutes;
    let boardingSource = confirmedProfile?.boardingSource ?? `EVENT:${input.event.eventId}`;
    let deboardingSource = confirmedProfile?.deboardingSource ?? `EVENT:${input.event.eventId}`;
    let bufferSource = confirmedProfile?.bufferSource ?? `EVENT:${input.event.eventId}`;
    let assumedAircraftId = rotation.status === "DRAFT" ? null : (rotation.aircraftId ?? null);
    let referenceTotal = deriveReferenceRotationBreakdown({
      boardingMinutes: boarding,
      offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
      deboardingMinutes: deboarding,
      bufferMinutes: buffer,
    }).totalMinutes;
    const capacity = capacities.get(rotation.resourceGroupId);
    const activeCapacity = capacity?.activeAircraft ?? 0;
    const forecastCapacity = queueAvailability.get(rotation.resourceGroupId)?.lanes.length ?? 0;
    const allProductHistory = newestSamples.filter(
      (sample) => sample.productCode === rotation.productCode,
    );
    const currentDayProductHistory = allProductHistory.filter(
      (sample) => sample.eventId === input.event.eventId,
    );
    const productHistory =
      currentDayProductHistory.length > 0 ? currentDayProductHistory : allProductHistory;
    const aircraftHistory = rotation.aircraftType
      ? productHistory.filter((sample) => sample.aircraftType === rotation.aircraftType)
      : [];
    const selectedHistory = (aircraftHistory.length > 0 ? aircraftHistory : productHistory).slice(
      0,
      tuning.maximumSamples,
    );
    const actualDurations = [...selectedHistory].reverse().map((sample) => sample.minutes);
    const acceptedDurationValues = new Set(
      selectRobustDurationSamples(actualDurations, referenceTotal, tuning),
    );
    const acceptedHistory = selectedHistory.filter((sample) =>
      acceptedDurationValues.has(sample.minutes),
    );
    const dataBasisScope: ForecastDataBasisScope =
      acceptedHistory.length === 0
        ? "REFERENCE_ONLY"
        : aircraftHistory.length > 0
          ? "AIRCRAFT_PRODUCT_HISTORY"
          : "PRODUCT_HISTORY";
    const lastActualAt = acceptedHistory[0]?.completedAt;
    const dataAgeMinutes = lastActualAt
      ? Math.max(0, (now.getTime() - Date.parse(lastActualAt)) / 60_000)
      : 0;
    const uncertaintyReasons: ForecastUncertaintyReason[] = [];
    if (input.event.operationalInterrupted) uncertaintyReasons.push("OPERATION_INTERRUPTED");
    if (input.event.emergencyMode) uncertaintyReasons.push("EMERGENCY_MODE");
    if (rotation.resourceGroupStatus !== "ACTIVE") {
      uncertaintyReasons.push("RESOURCE_GROUP_INACTIVE");
    }
    if (forecastCapacity === 0) uncertaintyReasons.push("NO_ACTIVE_CAPACITY");
    const hasOverdueConstraint = [
      ...(capacity?.sharedConstraints ?? []),
      ...(capacity?.availabilityLanes ?? []).flatMap((lane) => lane.constraints ?? []),
    ].some((constraint) => constraint.overdue);
    if (hasOverdueConstraint) {
      uncertaintyReasons.push("PLANNED_CONSTRAINT_OVERDUE");
    }
    const estimate = estimateDuration({
      referenceMinutes: referenceTotal,
      actualDurationsMinutes: actualDurations,
      interrupted: input.event.emergencyMode || input.event.operationalInterrupted,
      activeCapacity: forecastCapacity,
      tuning,
    });
    const predictionQuality =
      hasOverdueConstraint && estimate.quality === "STABLE" ? "CHANGING" : estimate.quality;
    let effectiveEstimate = { ...estimate, quality: predictionQuality };
    let capacityStatus: ForecastCapacityStatus = "AVAILABLE";
    let window: {
      lowerMinutes: number;
      upperMinutes: number;
      quality: PredictionQuality;
    } | null = forecastQueueWindows({
      queueSequence: rotation.queueSequence,
      activeAircraft: forecastCapacity,
      duration: effectiveEstimate,
    });
    if (rotation.status === "DRAFT") {
      const availability =
        queueAvailability.get(rotation.resourceGroupId) ??
        createQueueAvailability({ activeAircraft: forecastCapacity, busyAircraftMinutes: [] });
      const reservation = reserveNextQueueWindow(
        availability,
        effectiveEstimate,
        operationEndMinutes,
        rotation.passengerCount ?? 1,
        new Map(
          (rotation.turnaroundProfiles ?? []).map((profile) => [
            profile.aircraftId,
            estimateDuration({
              referenceMinutes: deriveReferenceRotationBreakdown({
                boardingMinutes: profile.boardingMinutes,
                offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
                deboardingMinutes: profile.deboardingMinutes,
                bufferMinutes: profile.bufferMinutes,
              }).totalMinutes,
              actualDurationsMinutes: actualDurations,
              interrupted: input.event.emergencyMode || input.event.operationalInterrupted,
              activeCapacity: forecastCapacity,
              tuning,
            }),
          ]),
        ),
      );
      window = reservation.window;
      capacityStatus = reservation.capacityStatus;
      effectiveEstimate = reservation.duration;
      assumedAircraftId = reservation.selectedAircraftId;
      const selectedProfile = rotation.turnaroundProfiles?.find(
        (profile) => profile.aircraftId === reservation.selectedAircraftId,
      );
      if (selectedProfile) {
        boarding = selectedProfile.boardingMinutes;
        deboarding = selectedProfile.deboardingMinutes;
        buffer = selectedProfile.bufferMinutes;
        boardingSource = selectedProfile.boardingSource;
        deboardingSource = selectedProfile.deboardingSource;
        bufferSource = selectedProfile.bufferSource;
        referenceTotal = deriveReferenceRotationBreakdown({
          boardingMinutes: boarding,
          offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
          deboardingMinutes: deboarding,
          bufferMinutes: buffer,
        }).totalMinutes;
      }
      queueAvailability.set(rotation.resourceGroupId, reservation.availability);
      if (capacityStatus !== "AVAILABLE") {
        uncertaintyReasons.push(capacityStatus);
        effectiveEstimate = { ...effectiveEstimate, quality: "UNCERTAIN" };
      }
    } else if (rotation.constraints && rotation.constraints.length > 0) {
      const converted = rotation.constraints.map(constraintToQueueConstraint);
      const lowerMultiplier = slowdownMultiplier(
        0,
        effectiveEstimate.lowerMinutes,
        converted,
        "lower",
      );
      const expectedMultiplier = slowdownMultiplier(
        0,
        effectiveEstimate.expectedMinutes,
        converted,
        "expected",
      );
      const upperMultiplier = slowdownMultiplier(
        0,
        effectiveEstimate.upperMinutes,
        converted,
        "upper",
      );
      effectiveEstimate = {
        ...effectiveEstimate,
        lowerMinutes: (effectiveEstimate.lowerMinutes * lowerMultiplier) / 100,
        expectedMinutes: (effectiveEstimate.expectedMinutes * expectedMultiplier) / 100,
        upperMinutes: (effectiveEstimate.upperMinutes * upperMultiplier) / 100,
        quality:
          expectedMultiplier > 100 && effectiveEstimate.quality === "STABLE"
            ? "CHANGING"
            : effectiveEstimate.quality,
      };
    }
    const planOffset =
      Math.floor(Math.max(0, rotation.queueSequence - 1) / Math.max(1, forecastCapacity)) *
      referenceTotal;
    const plannedBoardingAt = addMinutes(rotation.createdAt, planOffset);
    const plannedDepartureAt = addMinutes(plannedBoardingAt, boarding);
    const plannedLandingAt = addMinutes(plannedDepartureAt, rotation.referenceDurationMinutes);
    const plannedCompletionAt = addMinutes(plannedLandingAt, deboarding + buffer);
    const phaseMultiplier =
      estimate.expectedMinutes > 0
        ? Math.max(1, effectiveEstimate.expectedMinutes / estimate.expectedMinutes)
        : 1;
    let predictedBoardingAt = window
      ? addMinutes(now, (window.lowerMinutes + window.upperMinutes) / 2)
      : null;
    if (rotation.calledAt) predictedBoardingAt = rotation.calledAt;
    let predictedDepartureAt = predictedBoardingAt
      ? addMinutes(predictedBoardingAt, boarding * phaseMultiplier)
      : null;
    if (rotation.departedAt) predictedDepartureAt = rotation.departedAt;
    const expectedFlightMinutes =
      Math.max(
        rotation.referenceDurationMinutes,
        estimate.expectedMinutes - boarding - deboarding - buffer,
      ) * phaseMultiplier;
    let predictedLandingAt = predictedDepartureAt
      ? addMinutes(predictedDepartureAt, expectedFlightMinutes)
      : null;
    if (rotation.landedAt) predictedLandingAt = rotation.landedAt;
    let predictedCompletionAt = predictedLandingAt
      ? addMinutes(predictedLandingAt, (deboarding + buffer) * phaseMultiplier)
      : null;
    if (
      rotation.status !== "DRAFT" &&
      predictedDepartureAt &&
      predictedLandingAt &&
      predictedCompletionAt
    ) {
      const advanced = advanceOverduePrediction({
        status: rotation.status,
        now: input.event.now,
        predictedDepartureAt,
        predictedLandingAt,
        predictedCompletionAt,
      });
      predictedDepartureAt = advanced.predictedDepartureAt;
      predictedLandingAt = advanced.predictedLandingAt;
      predictedCompletionAt = advanced.predictedCompletionAt;
    }
    const operationsEnd = operationsEndAssessment(
      predictedCompletionAt,
      input.event.plannedOperationsEndAt,
    );
    return {
      rotationId: rotation.id,
      plannedBoardingAt,
      plannedDepartureAt,
      plannedLandingAt,
      plannedCompletionAt,
      predictedBoardingAt,
      predictedDepartureAt,
      predictedLandingAt,
      predictedCompletionAt,
      forecastState: "UNAVAILABLE" as const,
      ...operationsEnd,
      predictionQuality: effectiveEstimate.quality,
      predictionLowerMinutes: window?.lowerMinutes ?? null,
      predictionUpperMinutes: window?.upperMinutes ?? null,
      capacityStatus,
      dataBasisScope,
      sampleSize: estimate.sampleCount,
      dataAgeMinutes,
      activeCapacity,
      referenceDurationMinutes: referenceTotal,
      assumedAircraftId,
      boardingMinutes: boarding,
      deboardingMinutes: deboarding,
      bufferMinutes: buffer,
      boardingSource,
      deboardingSource,
      bufferSource,
      uncertaintyReasons,
      dispatchPlanId: null,
      dispatchPlanRevision: null,
      dispatchBatchId: null,
      dispatchOrder: null,
      dispatchWave: null,
      dispatchLaneId: null,
      dispatchGroupIds: [],
      dispatchOccupiedSeats: null,
      dispatchAvailableSeats: null,
      dispatchCommitmentLevel: null,
      dispatchDecisionReasons: [],
      dispatchProjectedOvertakeCount: 0,
      dispatchUnplannedReason: null,
    };
  });
}

interface DispatchReplayReservation {
  window: { lowerMinutes: number; upperMinutes: number; quality: PredictionQuality };
  capacityStatus: ForecastCapacityStatus;
  selectedAircraftId: string | null;
  duration: DurationEstimate;
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  boardingSource: string;
  deboardingSource: string;
  bufferSource: string;
}

interface LongRangeReplayReservation extends DispatchReplayReservation {
  selectedLaneId: string;
  memberIds: string[];
  groupIds: string[];
  occupiedSeats: number;
  availableSeats: number;
}

/**
 * Builds a shared multi-lane dispatch plan and overlays its batch windows on the established
 * milestone forecast. A batch advances its forecast lane exactly once, regardless of how many
 * complete booking groups it contains.
 */
export function calculateForecastTimelineResult(
  input: ForecastTimelinesInput,
): ForecastCalculationResult {
  const legacy = calculateLegacyForecastTimelines(input);
  const now = new Date(input.event.now);
  if (!Number.isFinite(now.getTime())) throw new Error("Forecast time is invalid.");
  const tuning = input.tuning ?? DEFAULT_FORECAST_TUNING_PROFILE;
  const rotationsById = new Map(input.rotations.map((rotation) => [rotation.id, rotation]));
  const newestSamples = [...input.durationSamples].sort(
    (left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt),
  );
  const offsetMinutes = (value: string): number =>
    Math.max(0, (Date.parse(value) - now.getTime()) / 60_000);
  const operationStartMinutes = input.event.plannedOperationsStartAt
    ? offsetMinutes(input.event.plannedOperationsStartAt)
    : 0;
  const operationEndMinutes = input.event.plannedOperationsEndAt
    ? offsetMinutes(input.event.plannedOperationsEndAt)
    : null;
  const constraintToQueueConstraint = (
    constraint: ForecastAvailabilityConstraintInput,
  ): QueueAvailabilityConstraint => {
    const earliest = offsetMinutes(constraint.earliestStartAt);
    const latest = Math.max(earliest, offsetMinutes(constraint.latestStartAt));
    return {
      id: constraint.id,
      earliestStartMinutes: earliest,
      expectedStartMinutes: (earliest + latest) / 2,
      latestStartMinutes: latest,
      minimumDurationMinutes: constraint.minimumDurationMinutes,
      typicalDurationMinutes: constraint.typicalDurationMinutes,
      maximumDurationMinutes: constraint.maximumDurationMinutes,
      effectMode: constraint.effectMode ?? "BLOCKING",
      durationMultiplierPercent: constraint.durationMultiplierPercent ?? null,
      active: constraint.active ?? false,
    };
  };
  const busyMinutesByResourceGroup = new Map<string, number[]>();
  for (const projection of legacy) {
    const rotation = rotationsById.get(projection.rotationId);
    if (!rotation || rotation.status === "DRAFT") continue;
    const completionMs = projection.predictedCompletionAt
      ? Date.parse(projection.predictedCompletionAt)
      : Number.NaN;
    const remaining = Number.isFinite(completionMs)
      ? Math.max(0, (completionMs - now.getTime()) / 60_000)
      : projection.referenceDurationMinutes;
    const values = busyMinutesByResourceGroup.get(rotation.resourceGroupId) ?? [];
    values.push(remaining);
    busyMinutesByResourceGroup.set(rotation.resourceGroupId, values);
  }
  const availabilityByResourceGroup = new Map<string, QueueAvailabilityState>();
  const pilotIdByLaneId = new Map<string, string | null>();
  for (const capacity of input.capacities) {
    const sharedConstraints = (capacity.sharedConstraints ?? []).map(constraintToQueueConstraint);
    const explicitLanes = capacity.availabilityLanes?.map((lane) => {
      pilotIdByLaneId.set(lane.laneId, lane.pilotId ?? null);
      const lower = Math.max(operationStartMinutes, offsetMinutes(lane.availableLowerAt));
      const expected = Math.max(operationStartMinutes, offsetMinutes(lane.availableExpectedAt));
      const upper = Math.max(expected, operationStartMinutes, offsetMinutes(lane.availableUpperAt));
      return {
        laneId: lane.laneId,
        aircraftId: lane.aircraftId,
        ...(lane.passengerSeats === undefined ? {} : { passengerSeats: lane.passengerSeats }),
        lowerMinutes: Math.min(lower, expected),
        expectedMinutes: expected,
        upperMinutes: upper,
        constraints: [
          ...sharedConstraints,
          ...(lane.constraints ?? []).map(constraintToQueueConstraint),
        ].sort(
          (left, right) =>
            left.earliestStartMinutes - right.earliestStartMinutes ||
            left.id.localeCompare(right.id),
        ),
        recurringConstraints: (lane.recurringConstraints ?? []).map((constraint) => ({
          id: constraint.id,
          triggerMetric: constraint.triggerMetric,
          intervalValue: constraint.intervalValue,
          lowerProgress: constraint.progressValue,
          expectedProgress: constraint.progressValue,
          upperProgress: constraint.progressValue,
          minimumDurationMinutes: constraint.minimumDurationMinutes,
          typicalDurationMinutes: constraint.typicalDurationMinutes,
          maximumDurationMinutes: constraint.maximumDurationMinutes,
          active: constraint.active ?? true,
        })),
      };
    });
    if (explicitLanes && explicitLanes.length > 0) {
      availabilityByResourceGroup.set(
        capacity.resourceGroupId,
        createQueueAvailability({
          activeAircraft: explicitLanes.length,
          busyAircraftMinutes: [],
          lanes: explicitLanes,
        }),
      );
      continue;
    }
    const activeAircraft = Math.max(0, Math.floor(capacity.activeAircraft));
    const busy = (busyMinutesByResourceGroup.get(capacity.resourceGroupId) ?? []).slice(
      0,
      activeAircraft,
    );
    const fallbackLanes = [
      ...busy.map((minutes, index) => ({
        laneId: `busy-${capacity.resourceGroupId}-${index + 1}`,
        aircraftId: `forecast-capacity-${capacity.resourceGroupId}-${index + 1}`,
        passengerSeats: Number.MAX_SAFE_INTEGER,
        lowerMinutes: minutes,
        expectedMinutes: minutes,
        upperMinutes: minutes,
        constraints: sharedConstraints,
        recurringConstraints: [],
      })),
      ...Array.from({ length: Math.max(0, activeAircraft - busy.length) }, (_, index) => ({
        laneId: `idle-${capacity.resourceGroupId}-${index + 1}`,
        aircraftId: `forecast-capacity-${capacity.resourceGroupId}-${busy.length + index + 1}`,
        passengerSeats: Number.MAX_SAFE_INTEGER,
        lowerMinutes: operationStartMinutes,
        expectedMinutes: operationStartMinutes,
        upperMinutes: operationStartMinutes,
        constraints: sharedConstraints,
        recurringConstraints: [],
      })),
    ];
    availabilityByResourceGroup.set(
      capacity.resourceGroupId,
      createQueueAvailability({
        activeAircraft,
        busyAircraftMinutes: busy,
        lanes: fallbackLanes,
      }),
    );
  }

  const turnaroundProfile = (
    rotation: ForecastTimelineRotationInput,
    aircraftId: string | null,
  ): {
    boardingMinutes: number;
    deboardingMinutes: number;
    bufferMinutes: number;
    boardingSource: string;
    deboardingSource: string;
    bufferSource: string;
  } => {
    const selected = rotation.turnaroundProfiles?.find(
      (profile) => profile.aircraftId === aircraftId,
    );
    if (selected) return selected;
    if (rotation.confirmedTurnaroundProfile) return rotation.confirmedTurnaroundProfile;
    return {
      boardingMinutes: input.event.plannedBoardingMinutes,
      deboardingMinutes: input.event.plannedDeboardingMinutes,
      bufferMinutes: input.event.plannedBufferMinutes,
      boardingSource: `EVENT:${input.event.eventId}`,
      deboardingSource: `EVENT:${input.event.eventId}`,
      bufferSource: `EVENT:${input.event.eventId}`,
    };
  };
  const durationEstimate = (
    rotation: ForecastTimelineRotationInput,
    aircraftId: string | null,
    activeCapacity: number,
  ): DurationEstimate => {
    const profile = turnaroundProfile(rotation, aircraftId);
    const referenceMinutes = deriveReferenceRotationBreakdown({
      boardingMinutes: profile.boardingMinutes,
      offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
      deboardingMinutes: profile.deboardingMinutes,
      bufferMinutes: profile.bufferMinutes,
    }).totalMinutes;
    const allProductHistory = newestSamples.filter(
      (sample) => sample.productCode === rotation.productCode,
    );
    const currentDayHistory = allProductHistory.filter(
      (sample) => sample.eventId === input.event.eventId,
    );
    const selectedHistory = (currentDayHistory.length > 0 ? currentDayHistory : allProductHistory)
      .slice(0, tuning.maximumSamples)
      .reverse()
      .map((sample) => sample.minutes);
    return estimateDuration({
      referenceMinutes,
      actualDurationsMinutes: selectedHistory,
      interrupted: input.event.operationalInterrupted || input.event.emergencyMode,
      activeCapacity,
      tuning,
    });
  };
  const dispatchGroups = input.rotations.flatMap((rotation) => {
    if (rotation.status !== "DRAFT") return [];
    return [
      {
        id: rotation.id,
        groupIds: [...(rotation.dispatchGroupIds ?? [rotation.id])],
        predecessorMemberIds: [...(rotation.dispatchPredecessorMemberIds ?? [])],
        size: Math.max(1, Math.floor(rotation.passengerCount ?? 1)),
        productId: rotation.productId ?? rotation.productCode,
        resourceGroupId: rotation.resourceGroupId,
        gateId: rotation.gateId ?? rotation.resourceGroupId,
        queueSequence: rotation.queueSequence,
        soldAt: rotation.soldAt ?? rotation.createdAt,
        attendanceStatus: rotation.attendanceStatus ?? "WAITING",
        standby: rotation.standby ?? false,
        publicStatus: rotation.publicStatus ?? "WAITING",
        confirmedOvertakeCount: rotation.confirmedOvertakeCount ?? 0,
        productServiceDeficit: rotation.productServiceDeficit ?? 0,
      },
    ];
  });
  const dispatchLanes = [...availabilityByResourceGroup.entries()].flatMap(
    ([resourceGroupId, availability]) => {
      const products = [
        ...new Set(
          dispatchGroups
            .filter((group) => group.resourceGroupId === resourceGroupId)
            .map((group) => group.productId),
        ),
      ].sort();
      return availability.lanes.map((lane) => ({
        id: lane.laneId,
        aircraftId: lane.aircraftId ?? lane.laneId,
        pilotId: pilotIdByLaneId.get(lane.laneId) ?? null,
        resourceGroupId,
        passengerSeats: lane.passengerSeats,
        availableLowerAt: addMinutes(now, lane.lowerMinutes),
        availableExpectedAt: addMinutes(now, lane.expectedMinutes),
        availableUpperAt: addMinutes(now, lane.upperMinutes),
        productDurations: products.flatMap((productId) => {
          const group = dispatchGroups.find(
            (candidate) =>
              candidate.resourceGroupId === resourceGroupId && candidate.productId === productId,
          );
          const rotation = group ? rotationsById.get(group.id) : undefined;
          if (!rotation) return [];
          const estimate = durationEstimate(
            rotation,
            lane.aircraftId ?? null,
            availability.lanes.length,
          );
          return [
            {
              productId,
              lowerMinutes: estimate.lowerMinutes,
              expectedMinutes: estimate.expectedMinutes,
              upperMinutes: estimate.upperMinutes,
            },
          ];
        }),
      }));
    },
  );
  const dispatchInput: DispatchPlanInput = {
    now: input.event.now,
    groups: dispatchGroups,
    lanes: dispatchLanes,
    ...(input.previousDispatchPlan === undefined
      ? {}
      : { previousPlan: input.previousDispatchPlan }),
    ...(input.lockedDispatchBatches === undefined
      ? {}
      : { lockedBatches: input.lockedDispatchBatches }),
    ...(input.dispatchPlanningLimits === undefined ? {} : { limits: input.dispatchPlanningLimits }),
  };
  const dispatchPlan = createDispatchPlan(dispatchInput);
  const reservationByBatchId = new Map<string, DispatchReplayReservation>();
  for (const batch of dispatchPlan.batches) {
    const member = rotationsById.get(batch.memberIds[0] ?? "");
    const availability = availabilityByResourceGroup.get(batch.resourceGroupId);
    if (!member || !availability) continue;
    const estimatesByAircraftId = new Map(
      availability.lanes.flatMap((lane) =>
        lane.aircraftId
          ? [
              [
                lane.aircraftId,
                durationEstimate(member, lane.aircraftId, availability.lanes.length),
              ] as const,
            ]
          : [],
      ),
    );
    const estimate = durationEstimate(member, batch.assumedAircraftId, availability.lanes.length);
    const reservation = reserveNextQueueWindow(
      availability,
      estimate,
      operationEndMinutes,
      batch.occupiedSeats,
      estimatesByAircraftId,
      batch.laneId,
    );
    availabilityByResourceGroup.set(batch.resourceGroupId, reservation.availability);
    if (!reservation.window) continue;
    const profile = turnaroundProfile(member, reservation.selectedAircraftId);
    reservationByBatchId.set(batch.id, {
      window: reservation.window,
      capacityStatus: reservation.capacityStatus,
      selectedAircraftId: reservation.selectedAircraftId,
      duration: reservation.duration,
      ...profile,
    });
  }
  const dispatchLaneById = new Map(dispatchLanes.map((lane) => [lane.id, lane]));
  const nearMemberIds = new Set(dispatchPlan.batches.flatMap((batch) => batch.memberIds));
  const longRangeReservationByMemberId = new Map<string, LongRangeReplayReservation>();
  const resourceGroupIdsForTail = [
    ...new Set(dispatchGroups.map((group) => group.resourceGroupId)),
  ].sort();
  for (const resourceGroupId of resourceGroupIdsForTail) {
    let remaining = orderDispatchGroupsForProjection({
      now: input.event.now,
      groups: dispatchGroups.filter(
        (group) =>
          group.resourceGroupId === resourceGroupId &&
          !nearMemberIds.has(group.id) &&
          group.attendanceStatus !== "MISSING" &&
          group.attendanceStatus !== "CLARIFICATION",
      ),
      ...(input.dispatchPlanningLimits === undefined
        ? {}
        : { limits: input.dispatchPlanningLimits }),
    });
    while (remaining.length > 0) {
      const availability = availabilityByResourceGroup.get(resourceGroupId);
      if (!availability || availability.lanes.length === 0) break;
      const anchorGroup = remaining.find((group) =>
        availability.lanes.some((lane) => {
          const dispatchLane = dispatchLaneById.get(lane.laneId);
          if (!dispatchLane) return false;
          return (
            group.size <= lane.passengerSeats &&
            dispatchLane.productDurations.some((duration) => duration.productId === group.productId)
          );
        }),
      );
      if (!anchorGroup) break;
      const member = rotationsById.get(anchorGroup.id);
      if (!member) throw new Error(`Forecast rotation ${anchorGroup.id} disappeared.`);
      const estimatesByAircraftId = new Map(
        availability.lanes.flatMap((lane) =>
          lane.aircraftId
            ? [
                [
                  lane.aircraftId,
                  durationEstimate(member, lane.aircraftId, availability.lanes.length),
                ] as const,
              ]
            : [],
        ),
      );
      const estimate = durationEstimate(member, null, availability.lanes.length);
      const eligibleLaneIds = new Set(
        availability.lanes
          .filter((lane) => {
            const dispatchLane = dispatchLaneById.get(lane.laneId);
            return (
              dispatchLane !== undefined &&
              anchorGroup.size <= lane.passengerSeats &&
              dispatchLane.productDurations.some(
                (duration) => duration.productId === anchorGroup.productId,
              )
            );
          })
          .map((lane) => lane.laneId),
      );
      const laneSelection = reserveNextQueueWindow(
        availability,
        estimate,
        null,
        anchorGroup.size,
        estimatesByAircraftId,
        undefined,
        eligibleLaneIds,
      );
      const selectedLane = availability.lanes.find(
        (lane) => lane.laneId === laneSelection.selectedLaneId,
      );
      if (!selectedLane) break;
      const memberIds = [anchorGroup.id];
      let occupiedSeats = anchorGroup.size;
      for (const group of remaining) {
        if (
          group.id === anchorGroup.id ||
          group.productId !== anchorGroup.productId ||
          group.gateId !== anchorGroup.gateId ||
          occupiedSeats + group.size > selectedLane.passengerSeats
        ) {
          continue;
        }
        memberIds.push(group.id);
        occupiedSeats += group.size;
      }
      const reservation = reserveNextQueueWindow(
        availability,
        estimate,
        null,
        occupiedSeats,
        estimatesByAircraftId,
        selectedLane.laneId,
      );
      if (!reservation.window || !reservation.selectedLaneId) break;
      availabilityByResourceGroup.set(resourceGroupId, reservation.availability);
      const profile = turnaroundProfile(member, reservation.selectedAircraftId);
      const memberIdSet = new Set(memberIds);
      const replay: LongRangeReplayReservation = {
        window: {
          ...reservation.window,
          quality: reservation.window.quality === "UNCERTAIN" ? "UNCERTAIN" : "CHANGING",
        },
        capacityStatus: reservation.capacityStatus,
        selectedAircraftId: reservation.selectedAircraftId,
        selectedLaneId: reservation.selectedLaneId,
        duration: reservation.duration,
        ...profile,
        memberIds,
        groupIds: remaining
          .filter((group) => memberIdSet.has(group.id))
          .flatMap((group) => group.groupIds),
        occupiedSeats,
        availableSeats: selectedLane.passengerSeats - occupiedSeats,
      };
      for (const memberId of memberIds) longRangeReservationByMemberId.set(memberId, replay);
      remaining = remaining.filter((group) => !memberIdSet.has(group.id));
    }
  }
  const batchByMemberId = new Map(
    dispatchPlan.batches.flatMap((batch) =>
      batch.memberIds.map((memberId) => [memberId, batch] as const),
    ),
  );
  const decisionByMemberId = new Map(
    dispatchPlan.groupDecisions.map((decision) => [decision.memberId, decision]),
  );
  const unplannedByMemberId = new Map(
    dispatchPlan.unplannedGroups.map((entry) => [entry.memberId, entry.reason]),
  );
  const projections = legacy.map((projection) => {
    const rotation = rotationsById.get(projection.rotationId);
    if (rotation?.status !== "DRAFT") {
      const operationsEnd = operationsEndAssessment(
        projection.predictedCompletionAt,
        input.event.plannedOperationsEndAt,
      );
      return {
        ...projection,
        forecastState: "UNAVAILABLE" as const,
        ...operationsEnd,
        dispatchPlanId: null,
        dispatchPlanRevision: null,
        dispatchBatchId: null,
        dispatchOrder: null,
        dispatchWave: null,
        dispatchLaneId: null,
        dispatchGroupIds: [],
        dispatchOccupiedSeats: null,
        dispatchAvailableSeats: null,
        dispatchCommitmentLevel: null,
        dispatchDecisionReasons: [],
        dispatchProjectedOvertakeCount: 0,
        dispatchUnplannedReason: null,
      };
    }
    const batch = batchByMemberId.get(rotation.id);
    const decision = decisionByMemberId.get(rotation.id);
    const unplannedReason = unplannedByMemberId.get(rotation.id) ?? null;
    const dispatchReplay = batch ? reservationByBatchId.get(batch.id) : undefined;
    const longRangeReplay = longRangeReservationByMemberId.get(rotation.id);
    const replay = dispatchReplay ?? longRangeReplay;
    if (!replay) {
      const capacityUnavailableReason = input.capacities.find(
        (capacity) => capacity.resourceGroupId === rotation.resourceGroupId,
      )?.unavailableReason;
      const effectiveUnplannedReason =
        unplannedReason === "NO_FORECAST_CAPACITY" && capacityUnavailableReason
          ? capacityUnavailableReason
          : unplannedReason;
      const capacityStatus: ForecastCapacityStatus =
        effectiveUnplannedReason === "NO_FORECAST_CAPACITY" ||
        effectiveUnplannedReason === "UNKNOWN_RESOURCE_RETURN"
          ? "NO_FORECAST_CAPACITY"
          : effectiveUnplannedReason === "WAITING_FOR_FITTING_LANE"
            ? "NO_FITTING_AIRCRAFT"
            : "AVAILABLE";
      const uncertaintyReasons: ForecastUncertaintyReason[] = [
        ...projection.uncertaintyReasons,
      ].filter((reason) => reason !== "NO_FORECAST_CAPACITY" && reason !== "NO_FITTING_AIRCRAFT");
      if (capacityStatus !== "AVAILABLE") uncertaintyReasons.push(capacityStatus);
      return {
        ...projection,
        predictedBoardingAt: null,
        predictedDepartureAt: null,
        predictedLandingAt: null,
        predictedCompletionAt: null,
        forecastState: "UNAVAILABLE" as const,
        extendsBeyondOperationsEnd: false,
        overtimeMinutes: 0,
        predictionLowerMinutes: null,
        predictionUpperMinutes: null,
        predictionQuality:
          capacityStatus === "AVAILABLE" ? projection.predictionQuality : "UNCERTAIN",
        capacityStatus,
        assumedAircraftId: null,
        uncertaintyReasons,
        dispatchPlanId: dispatchPlan.planId,
        dispatchPlanRevision: dispatchPlan.revision,
        dispatchBatchId: null,
        dispatchOrder: null,
        dispatchWave: null,
        dispatchLaneId: null,
        dispatchGroupIds: [],
        dispatchOccupiedSeats: null,
        dispatchAvailableSeats: null,
        dispatchCommitmentLevel: null,
        dispatchDecisionReasons: [],
        dispatchProjectedOvertakeCount: 0,
        dispatchUnplannedReason: effectiveUnplannedReason,
      };
    }
    const midpointMinutes = (replay.window.lowerMinutes + replay.window.upperMinutes) / 2;
    const predictedBoardingAt = addMinutes(now, midpointMinutes);
    const totalDurationMinutes = replay.duration.expectedMinutes;
    const boardingMinutes = Math.min(replay.boardingMinutes, totalDurationMinutes);
    const remainingAfterBoarding = Math.max(0, totalDurationMinutes - boardingMinutes);
    const completionTurnaroundMinutes = Math.min(
      replay.deboardingMinutes + replay.bufferMinutes,
      remainingAfterBoarding,
    );
    const expectedFlightMinutes = remainingAfterBoarding - completionTurnaroundMinutes;
    const predictedDepartureAt = addMinutes(predictedBoardingAt, boardingMinutes);
    const predictedLandingAt = addMinutes(predictedDepartureAt, expectedFlightMinutes);
    const predictedCompletionAt = addMinutes(predictedLandingAt, completionTurnaroundMinutes);
    const operationsEnd = operationsEndAssessment(
      predictedCompletionAt,
      input.event.plannedOperationsEndAt,
    );
    const hardUnavailable =
      input.event.emergencyMode ||
      input.event.operationalInterrupted ||
      rotation.resourceGroupStatus === "INTERRUPTED" ||
      rotation.resourceGroupStatus === "ENDED";
    const forecastState: ForecastState = hardUnavailable
      ? "UNAVAILABLE"
      : operationsEnd.extendsBeyondOperationsEnd
        ? "AFTER_OPERATIONS_END"
        : batch
          ? "DISPATCH_WINDOW"
          : "LONG_RANGE_WINDOW";
    const referenceDurationMinutes = deriveReferenceRotationBreakdown({
      boardingMinutes: replay.boardingMinutes,
      offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
      deboardingMinutes: replay.deboardingMinutes,
      bufferMinutes: replay.bufferMinutes,
    }).totalMinutes;
    return {
      ...projection,
      predictedBoardingAt,
      predictedDepartureAt,
      predictedLandingAt,
      predictedCompletionAt,
      forecastState,
      ...operationsEnd,
      predictionQuality: replay.window.quality,
      predictionLowerMinutes: replay.window.lowerMinutes,
      predictionUpperMinutes: replay.window.upperMinutes,
      capacityStatus: replay.capacityStatus,
      assumedAircraftId:
        replay.selectedAircraftId?.startsWith("forecast-capacity-") === true
          ? null
          : replay.selectedAircraftId,
      referenceDurationMinutes,
      boardingMinutes: replay.boardingMinutes,
      deboardingMinutes: replay.deboardingMinutes,
      bufferMinutes: replay.bufferMinutes,
      boardingSource: replay.boardingSource,
      deboardingSource: replay.deboardingSource,
      bufferSource: replay.bufferSource,
      uncertaintyReasons: projection.uncertaintyReasons.filter(
        (reason) => reason !== "NO_FORECAST_CAPACITY" && reason !== "NO_FITTING_AIRCRAFT",
      ),
      dispatchPlanId: dispatchPlan.planId,
      dispatchPlanRevision: dispatchPlan.revision,
      dispatchBatchId: batch?.id ?? null,
      dispatchOrder: batch?.dispatchOrder ?? null,
      dispatchWave: batch?.wave ?? null,
      dispatchLaneId: batch?.laneId ?? null,
      dispatchGroupIds: batch?.groupIds ?? [],
      dispatchOccupiedSeats: batch?.occupiedSeats ?? null,
      dispatchAvailableSeats: batch?.availableSeats ?? null,
      dispatchCommitmentLevel: batch?.commitmentLevel ?? null,
      dispatchDecisionReasons: batch?.decisionReasons ?? [],
      dispatchProjectedOvertakeCount: decision?.projectedOvertakeCount ?? 0,
      dispatchUnplannedReason: batch ? null : unplannedReason,
    };
  });
  return {
    projections,
    diagnostics: {
      dispatchInput,
      dispatchPlan,
    },
  };
}

export function calculateForecastTimelines(
  input: ForecastTimelinesInput,
): ForecastTimelineProjection[] {
  return calculateForecastTimelineResult(input).projections;
}
