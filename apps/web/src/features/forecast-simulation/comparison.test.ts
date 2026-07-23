import { describe, expect, it } from "vitest";
import { productionBaselineConfig, runBatchComparison } from "./comparison";
import { simulationConfigForPreset } from "./model";

function comparisonConfig() {
  const config = simulationConfigForPreset("NORMAL");
  config.endAt = "2026-07-22T11:00:00.000Z";
  config.forecastTuning.comparisonRuns = 5;
  return config;
}

describe("local forecast A/B comparison", () => {
  it("returns zero deltas when the candidate equals the production defaults", () => {
    const result = runBatchComparison(comparisonConfig());
    expect(result.runCount).toBe(5);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "departure-mae" }),
        expect.objectContaining({ id: "landing-median" }),
        expect.objectContaining({ id: "completion-bias" }),
        expect.objectContaining({ id: "suppression-capacity" }),
        expect.objectContaining({ id: "suppression-stale-prediction" }),
      ]),
    );
    expect(result.rows.every((row) => row.delta === 0 || row.delta === null)).toBe(true);
  });

  it("uses deterministic consecutive seeds and reports progress", () => {
    const progress: Array<[number, number]> = [];
    const first = runBatchComparison(comparisonConfig(), [], (completed, total) => {
      progress.push([completed, total]);
    });
    const second = runBatchComparison(comparisonConfig());

    expect(second).toEqual(first);
    expect(progress).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
  });

  it("keeps Admin and reality values but resets only technical tuning in the baseline", () => {
    const config = comparisonConfig();
    config.adminParameters.plannedBoardingMinutes = 13;
    config.realityModel.phases.boarding.typical = 9;
    config.forecastTuning.forecast.maximumSamples = 4;
    config.forecastTuning.precall.baselineLeadMinutes = 18;

    const baseline = productionBaselineConfig(config);
    expect(baseline.adminParameters.plannedBoardingMinutes).toBe(13);
    expect(baseline.realityModel.phases.boarding.typical).toBe(9);
    expect(baseline.forecastTuning.forecast.maximumSamples).toBe(12);
    expect(baseline.forecastTuning.precall.baselineLeadMinutes).toBe(12);
  });
});
