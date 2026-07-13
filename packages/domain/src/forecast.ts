export type PredictionQuality = "STABLE" | "CHANGING" | "UNCERTAIN";

export interface DurationEstimate {
  expectedMinutes: number;
  lowerMinutes: number;
  upperMinutes: number;
  quality: PredictionQuality;
  sampleCount: number;
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
  dataAgeMinutes: number;
  interrupted: boolean;
  activeCapacity: number;
}): DurationEstimate {
  const validSamples = input.actualDurationsMinutes
    .filter(
      (duration) =>
        Number.isFinite(duration) && duration > 0 && duration <= input.referenceMinutes * 3,
    )
    .slice(-12);
  if (
    input.interrupted ||
    input.activeCapacity === 0 ||
    (validSamples.length > 0 && input.dataAgeMinutes > 5)
  ) {
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
