import { describe, expect, it } from "vitest";
import { estimateDuration, selectRobustDurationSamples } from "./forecast-sampling";
import { DEFAULT_FORECAST_TUNING_PROFILE } from "./forecast-types";

describe("forecast sampling mutation boundaries", () => {
  it("accepts inclusive plausibility boundaries and rejects invalid values", () => {
    expect(
      selectRobustDurationSamples(
        [Number.NaN, Number.NEGATIVE_INFINITY, 9.99, 10, 20, 35, 35.01],
        20,
        { ...DEFAULT_FORECAST_TUNING_PROFILE, stableMinimumSamples: 10 },
      ),
    ).toEqual([10, 20, 35]);
  });

  it("retains only the newest configured samples before robust filtering is required", () => {
    expect(
      selectRobustDurationSamples([10, 11, 12, 13], 20, {
        ...DEFAULT_FORECAST_TUNING_PROFILE,
        stableMinimumSamples: 5,
        maximumSamples: 2,
      }),
    ).toEqual([12, 13]);
  });

  it("uses odd and even medians plus the larger MAD tolerance", () => {
    const tuning = {
      ...DEFAULT_FORECAST_TUNING_PROFILE,
      stableMinimumSamples: 3,
      maximumSamples: 10,
      referenceOutlierMultiplier: 10,
      minimumMadToleranceRatio: 0.1,
      madMultiplier: 2,
    };
    expect(selectRobustDurationSamples([10, 20, 30], 20, tuning)).toEqual([10, 20, 30]);
    expect(selectRobustDurationSamples([10, 20, 30, 100], 20, tuning)).toEqual([10, 20, 30]);
    expect(
      selectRobustDurationSamples([18, 20, 22, 24, 26], 20, {
        ...tuning,
        minimumMadToleranceRatio: 0.01,
        madMultiplier: 1,
      }),
    ).toEqual([20, 22, 24]);
  });

  it("returns complete uncertain estimates for interruptions and zero capacity", () => {
    for (const input of [
      { interrupted: true, activeCapacity: 2 },
      { interrupted: false, activeCapacity: 0 },
    ]) {
      expect(
        estimateDuration({
          referenceMinutes: 4,
          actualDurationsMinutes: [4, 5],
          ...input,
          tuning: { ...DEFAULT_FORECAST_TUNING_PROFILE, changingMarginMinutes: 7 },
        }),
      ).toEqual({
        expectedMinutes: 4,
        lowerMinutes: 0,
        upperMinutes: 11,
        quality: "UNCERTAIN",
        sampleCount: 2,
      });
    }
  });

  it("returns the full changing cold-start interval", () => {
    expect(
      estimateDuration({
        referenceMinutes: 4,
        actualDurationsMinutes: [],
        interrupted: false,
        activeCapacity: 1,
        tuning: { ...DEFAULT_FORECAST_TUNING_PROFILE, changingMarginMinutes: 7 },
      }),
    ).toEqual({
      expectedMinutes: 4,
      lowerMinutes: 0,
      upperMinutes: 11,
      quality: "CHANGING",
      sampleCount: 0,
    });
  });

  it("applies every weight and uses inclusive stable quality thresholds", () => {
    const tuning = {
      ...DEFAULT_FORECAST_TUNING_PROFILE,
      referenceWeight: 2,
      firstSampleWeight: 1,
      recencyWeightIncrement: 2,
      stableMinimumSamples: 2,
      stableMaximumMeanDeviationMinutes: 5,
      stableMarginMinutes: 3,
      changingMarginMinutes: 9,
      maximumSamples: 10,
    };
    expect(
      estimateDuration({
        referenceMinutes: 20,
        actualDurationsMinutes: [15, 25],
        interrupted: false,
        activeCapacity: 1,
        tuning,
      }),
    ).toEqual({
      expectedMinutes: 22,
      lowerMinutes: 19,
      upperMinutes: 25,
      quality: "STABLE",
      sampleCount: 2,
    });

    expect(
      estimateDuration({
        referenceMinutes: 20,
        actualDurationsMinutes: [10],
        interrupted: false,
        activeCapacity: 1,
        tuning: { ...tuning, stableMinimumSamples: 2 },
      }),
    ).toMatchObject({ quality: "CHANGING", lowerMinutes: 8, upperMinutes: 26 });
  });
});
