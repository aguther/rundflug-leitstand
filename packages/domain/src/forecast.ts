export type PredictionQuality = "STABLE" | "CHANGING" | "UNCERTAIN";

export const FORECAST_FRESHNESS_MAX_AGE_MINUTES = 5;

export type ForecastUncertaintyReason =
  | "OPERATION_INTERRUPTED"
  | "EMERGENCY_MODE"
  | "RESOURCE_GROUP_INACTIVE"
  | "NO_ACTIVE_CAPACITY"
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
): number[] {
  const plausible = samples.filter(
    (duration) => Number.isFinite(duration) && duration > 0 && duration <= referenceMinutes * 1.75,
  );
  if (plausible.length < 5) return plausible.slice(-12);
  const center = median(plausible);
  const absoluteDeviations = plausible.map((duration) => Math.abs(duration - center));
  const medianAbsoluteDeviation = median(absoluteDeviations);
  const tolerance = Math.max(referenceMinutes * 0.5, medianAbsoluteDeviation * 3);
  return plausible.filter((duration) => Math.abs(duration - center) <= tolerance).slice(-12);
}

export interface QueueAvailabilityState {
  lowerMinutes: number[];
  upperMinutes: number[];
}

export function createQueueAvailability(input: {
  activeAircraft: number;
  busyAircraftMinutes: readonly number[];
}): QueueAvailabilityState {
  const capacity = Math.max(0, Math.floor(input.activeAircraft));
  const busy = input.busyAircraftMinutes
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, capacity);
  const idle = Array.from({ length: Math.max(0, capacity - busy.length) }, () => 0);
  const slots = [...busy, ...idle];
  slots.sort((left, right) => left - right);
  return { lowerMinutes: [...slots], upperMinutes: [...slots] };
}

export function reserveNextQueueWindow(
  availability: QueueAvailabilityState,
  duration: DurationEstimate,
): {
  window: { lowerMinutes: number; upperMinutes: number; quality: PredictionQuality };
  availability: QueueAvailabilityState;
} {
  if (availability.lowerMinutes.length === 0 || availability.upperMinutes.length === 0) {
    return {
      window: { lowerMinutes: 0, upperMinutes: 0, quality: "UNCERTAIN" },
      availability,
    };
  }
  const lower = Math.min(...availability.lowerMinutes);
  const upper = Math.min(...availability.upperMinutes);
  const lowerIndex = availability.lowerMinutes.indexOf(lower);
  const upperIndex = availability.upperMinutes.indexOf(upper);
  const nextLower = [...availability.lowerMinutes];
  const nextUpper = [...availability.upperMinutes];
  nextLower[lowerIndex] = lower + duration.lowerMinutes;
  nextUpper[upperIndex] = upper + duration.upperMinutes;
  nextLower.sort((left, right) => left - right);
  nextUpper.sort((left, right) => left - right);
  return {
    window: {
      lowerMinutes: Math.max(0, Math.round(lower)),
      upperMinutes: Math.max(0, Math.round(upper)),
      quality: duration.quality,
    },
    availability: {
      lowerMinutes: nextLower,
      upperMinutes: nextUpper,
    },
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
}): DurationEstimate {
  const validSamples = selectRobustDurationSamples(
    input.actualDurationsMinutes,
    input.referenceMinutes,
  );
  if (input.interrupted || input.activeCapacity === 0) {
    return {
      expectedMinutes: Math.round(input.referenceMinutes),
      lowerMinutes: Math.max(0, Math.round(input.referenceMinutes - 10)),
      upperMinutes: Math.round(input.referenceMinutes + 10),
      quality: "UNCERTAIN",
      sampleCount: validSamples.length,
    };
  }
  if (validSamples.length === 0) {
    return {
      expectedMinutes: Math.round(input.referenceMinutes),
      lowerMinutes: Math.max(0, Math.round(input.referenceMinutes - 10)),
      upperMinutes: Math.round(input.referenceMinutes + 10),
      quality: "CHANGING",
      sampleCount: 0,
    };
  }

  let weightedSum = input.referenceMinutes;
  let weightSum = 1;
  for (const [index, duration] of validSamples.entries()) {
    const weight = index + 2;
    weightedSum += duration * weight;
    weightSum += weight;
  }
  const expectedMinutes = Math.round(weightedSum / weightSum);
  const meanDeviation =
    validSamples.reduce((sum, duration) => sum + Math.abs(duration - expectedMinutes), 0) /
    validSamples.length;
  const quality: PredictionQuality =
    validSamples.length >= 5 && meanDeviation <= 5 ? "STABLE" : "CHANGING";
  const margin = quality === "STABLE" ? 5 : 10;
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
  const capacities = new Map(
    input.capacities.map((entry) => [
      entry.resourceGroupId,
      Math.max(0, Math.floor(entry.activeAircraft)),
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
  const queueAvailability = new Map(
    [...capacities.entries()].map(([resourceGroupId, activeAircraft]) => [
      resourceGroupId,
      createQueueAvailability({
        activeAircraft,
        busyAircraftMinutes: busyAircraftMinutes.get(resourceGroupId) ?? [],
      }),
    ]),
  );
  const newestSamples = [...input.durationSamples].sort(
    (left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt),
  );

  return input.rotations.map((rotation) => {
    const boarding = input.event.plannedBoardingMinutes;
    const deboarding = input.event.plannedDeboardingMinutes;
    const buffer = input.event.plannedBufferMinutes;
    const referenceTotal = boarding + rotation.referenceDurationMinutes + deboarding + buffer;
    const activeCapacity = capacities.get(rotation.resourceGroupId) ?? 0;
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
      12,
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
    if (activeCapacity === 0) uncertaintyReasons.push("NO_ACTIVE_CAPACITY");
    const estimate = estimateDuration({
      referenceMinutes: referenceTotal,
      actualDurationsMinutes: actualDurations,
      interrupted: uncertaintyReasons.some((reason) => reason !== "NO_ACTIVE_CAPACITY"),
      activeCapacity,
    });
    let window = forecastQueueWindows({
      queueSequence: rotation.queueSequence,
      activeAircraft: activeCapacity,
      duration: estimate,
    });
    if (rotation.status === "DRAFT") {
      const availability =
        queueAvailability.get(rotation.resourceGroupId) ??
        createQueueAvailability({ activeAircraft: activeCapacity, busyAircraftMinutes: [] });
      const reservation = reserveNextQueueWindow(availability, estimate);
      window = reservation.window;
      queueAvailability.set(rotation.resourceGroupId, reservation.availability);
    }
    const planOffset =
      Math.floor(Math.max(0, rotation.queueSequence - 1) / Math.max(1, activeCapacity)) *
      referenceTotal;
    const plannedBoardingAt = addMinutes(rotation.createdAt, planOffset);
    const plannedDepartureAt = addMinutes(plannedBoardingAt, boarding);
    const plannedLandingAt = addMinutes(plannedDepartureAt, rotation.referenceDurationMinutes);
    const plannedCompletionAt = addMinutes(plannedLandingAt, deboarding + buffer);
    let predictedBoardingAt = addMinutes(now, window.lowerMinutes);
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
      predictionQuality: estimate.quality,
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
