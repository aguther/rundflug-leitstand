export type PredictionQuality = "STABLE" | "CHANGING" | "UNCERTAIN";

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
  | "PLANNED_CONSTRAINT_OVERDUE"
  | "UNPLANNED_RESOURCE_RETURN"
  | "STALE_PREDICTION";

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
  resourceGroupStatus: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
  queueSequence: number;
  referenceDurationMinutes: number;
  productCode: string;
  aircraftType: string | null;
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
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
}

export interface ForecastAvailabilityConstraintInput {
  id: string;
  earliestStartAt: string;
  latestStartAt: string;
  minimumDurationMinutes: number;
  typicalDurationMinutes: number;
  maximumDurationMinutes: number;
  overdue?: boolean;
}

export interface ForecastAvailabilityLaneInput {
  laneId: string;
  availableLowerAt: string;
  availableExpectedAt: string;
  availableUpperAt: string;
  constraints?: readonly ForecastAvailabilityConstraintInput[];
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
  predictedBoardingAt: string;
  predictedDepartureAt: string;
  predictedLandingAt: string;
  predictedCompletionAt: string;
  predictionQuality: PredictionQuality;
  predictionLowerMinutes: number;
  predictionUpperMinutes: number;
  dataBasisScope: ForecastDataBasisScope;
  sampleSize: number;
  dataAgeMinutes: number;
  activeCapacity: number;
  referenceDurationMinutes: number;
  uncertaintyReasons: ForecastUncertaintyReason[];
}

export interface ForecastTimelinesInput {
  event: ForecastTimelineEventInput;
  rotations: readonly ForecastTimelineRotationInput[];
  durationSamples: readonly ForecastTimelineDurationSample[];
  capacities: readonly ForecastTimelineCapacityInput[];
  tuning?: ForecastTuningProfile;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function selectRobustDurationSamples(
  samples: readonly number[],
  referenceMinutes: number,
  tuning: ForecastTuningProfile,
): number[] {
  const plausible = samples.filter(
    (duration) =>
      Number.isFinite(duration) &&
      duration > 0 &&
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
}

export interface QueueAvailabilityLane {
  laneId: string;
  lowerMinutes: number;
  expectedMinutes: number;
  upperMinutes: number;
  varianceMinutesSquared: number;
  constraints: QueueAvailabilityConstraint[];
}

export function createQueueAvailability(input: {
  activeAircraft: number;
  busyAircraftMinutes: readonly number[];
  lanes?: readonly Omit<QueueAvailabilityLane, "varianceMinutesSquared">[];
}): QueueAvailabilityState {
  if (input.lanes && input.lanes.length > 0) {
    const lanes = input.lanes.map((lane) => ({
      ...lane,
      lowerMinutes: Math.max(0, lane.lowerMinutes),
      expectedMinutes: Math.max(0, lane.expectedMinutes),
      upperMinutes: Math.max(0, lane.upperMinutes),
      varianceMinutesSquared: intervalVariance(
        lane.lowerMinutes,
        lane.expectedMinutes,
        lane.upperMinutes,
      ),
      constraints: [...lane.constraints],
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
      lowerMinutes: minutes,
      expectedMinutes: minutes,
      upperMinutes: minutes,
      varianceMinutesSquared: 0,
      constraints: [],
    })),
  );
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

function applyAvailabilityConstraints(
  lane: QueueAvailabilityLane,
  duration: DurationEstimate,
): QueueAvailabilityLane {
  let lower = lane.lowerMinutes;
  let expected = lane.expectedMinutes;
  let upper = lane.upperMinutes;
  for (const constraint of lane.constraints) {
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
  return {
    ...lane,
    lowerMinutes: lower,
    expectedMinutes: expected,
    upperMinutes: upper,
    varianceMinutesSquared: Math.max(
      lane.varianceMinutesSquared,
      intervalVariance(lower, expected, upper),
    ),
  };
}

export function reserveNextQueueWindow(
  availability: QueueAvailabilityState,
  duration: DurationEstimate,
): {
  window: { lowerMinutes: number; upperMinutes: number; quality: PredictionQuality };
  availability: QueueAvailabilityState;
} {
  if (availability.lanes.length === 0) {
    return {
      window: { lowerMinutes: 0, upperMinutes: 0, quality: "UNCERTAIN" },
      availability,
    };
  }
  const adjustedLanes = availability.lanes.map((lane) =>
    applyAvailabilityConstraints(lane, duration),
  );
  const selected = [...adjustedLanes].sort(
    (left, right) =>
      left.expectedMinutes - right.expectedMinutes ||
      left.lowerMinutes - right.lowerMinutes ||
      left.laneId.localeCompare(right.laneId),
  )[0];
  if (!selected) {
    return {
      window: { lowerMinutes: 0, upperMinutes: 0, quality: "UNCERTAIN" },
      availability,
    };
  }
  const durationVariance = intervalVariance(
    duration.lowerMinutes,
    duration.expectedMinutes,
    duration.upperMinutes,
  );
  const nextExpected = selected.expectedMinutes + duration.expectedMinutes;
  const nextVariance = selected.varianceMinutesSquared + durationVariance;
  const nextInterval = intervalFromVariance(nextExpected, nextVariance);
  const nextLanes = adjustedLanes.map((lane) =>
    lane.laneId === selected.laneId
      ? {
          ...lane,
          lowerMinutes: nextInterval.lower,
          expectedMinutes: nextExpected,
          upperMinutes: nextInterval.upper,
          varianceMinutesSquared: nextVariance,
        }
      : lane,
  );
  const minimumWindowMargin =
    duration.quality === "UNCERTAIN" ? 0 : duration.quality === "STABLE" ? 3 : 5;
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
      quality: duration.quality,
    },
    availability: availabilityFromLanes(nextLanes),
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

/**
 * Projects every open rotation from normalized state. The caller owns storage, transport and time;
 * this function deliberately has no Cloudflare, database or browser dependency.
 */
export function calculateForecastTimelines(
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
    const fallback =
      input.event.plannedBoardingMinutes +
      rotation.referenceDurationMinutes +
      input.event.plannedDeboardingMinutes +
      input.event.plannedBufferMinutes;
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
    };
  };
  const operationStartMinutes = input.event.plannedOperationsStartAt
    ? offsetMinutes(input.event.plannedOperationsStartAt)
    : 0;
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
        })),
        ...Array.from({ length: idleCount }, (_, index) => ({
          laneId: `idle-${index + 1}`,
          lowerMinutes: operationStartMinutes,
          expectedMinutes: operationStartMinutes,
          upperMinutes: operationStartMinutes,
          constraints: sharedConstraints,
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
    const boarding = input.event.plannedBoardingMinutes;
    const deboarding = input.event.plannedDeboardingMinutes;
    const buffer = input.event.plannedBufferMinutes;
    const referenceTotal = boarding + rotation.referenceDurationMinutes + deboarding + buffer;
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
    const dataBasisScope: ForecastDataBasisScope =
      selectedHistory.length === 0
        ? "REFERENCE_ONLY"
        : aircraftHistory.length > 0
          ? "AIRCRAFT_PRODUCT_HISTORY"
          : "PRODUCT_HISTORY";
    const actualDurations = [...selectedHistory].reverse().map((sample) => sample.minutes);
    const lastActualAt = selectedHistory[0]?.completedAt;
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
    const effectiveEstimate = { ...estimate, quality: predictionQuality };
    let window = forecastQueueWindows({
      queueSequence: rotation.queueSequence,
      activeAircraft: forecastCapacity,
      duration: effectiveEstimate,
    });
    if (rotation.status === "DRAFT") {
      const availability =
        queueAvailability.get(rotation.resourceGroupId) ??
        createQueueAvailability({ activeAircraft: forecastCapacity, busyAircraftMinutes: [] });
      const reservation = reserveNextQueueWindow(availability, effectiveEstimate);
      window = reservation.window;
      queueAvailability.set(rotation.resourceGroupId, reservation.availability);
    }
    const planOffset =
      Math.floor(Math.max(0, rotation.queueSequence - 1) / Math.max(1, forecastCapacity)) *
      referenceTotal;
    const plannedBoardingAt = addMinutes(rotation.createdAt, planOffset);
    const plannedDepartureAt = addMinutes(plannedBoardingAt, boarding);
    const plannedLandingAt = addMinutes(plannedDepartureAt, rotation.referenceDurationMinutes);
    const plannedCompletionAt = addMinutes(plannedLandingAt, deboarding + buffer);
    let predictedBoardingAt = addMinutes(now, (window.lowerMinutes + window.upperMinutes) / 2);
    if (rotation.calledAt) predictedBoardingAt = rotation.calledAt;
    let predictedDepartureAt = addMinutes(predictedBoardingAt, boarding);
    if (rotation.departedAt) predictedDepartureAt = rotation.departedAt;
    const expectedFlightMinutes = Math.max(
      rotation.referenceDurationMinutes,
      estimate.expectedMinutes - boarding - deboarding - buffer,
    );
    let predictedLandingAt = addMinutes(predictedDepartureAt, expectedFlightMinutes);
    if (rotation.landedAt) predictedLandingAt = rotation.landedAt;
    let predictedCompletionAt = addMinutes(predictedLandingAt, deboarding + buffer);
    if (rotation.status !== "DRAFT") {
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
      predictionQuality,
      predictionLowerMinutes: window.lowerMinutes,
      predictionUpperMinutes: window.upperMinutes,
      dataBasisScope,
      sampleSize: selectedHistory.length,
      dataAgeMinutes,
      activeCapacity,
      referenceDurationMinutes: referenceTotal,
      uncertaintyReasons,
    };
  });
}
