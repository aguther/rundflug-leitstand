import {
  DEFAULT_FORECAST_TUNING_PROFILE,
  type DurationEstimate,
  type ForecastTuningProfile,
  type PredictionQuality,
} from "./forecast-types";

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export const MINIMUM_PLAUSIBLE_DURATION_RATIO = 0.5;

export function selectRobustDurationSamples(
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
