import { describe, expect, it } from "vitest";
import { productionBaselineConfig, runBatchComparison } from "./comparison";
import { demandForProfile, simulationConfigForPreset } from "./model";

function shortComparisonConfig() {
  const config = simulationConfigForPreset("NORMAL");
  config.schedule.salesEndAt = "2026-07-22T09:00:00.000Z";
  config.schedule.operationsEndAt = "2026-07-22T10:00:00.000Z";
  config.realityModel.demand = demandForProfile("UNIFORM", 120, 8);
  config.forecastTuning.comparisonRuns = 5;
  return config;
}

describe("coverage-safe forecast comparison", () => {
  it("compares every published metric for the minimum deterministic seed set", () => {
    const config = shortComparisonConfig();
    const progress: Array<[number, number]> = [];

    const result = runBatchComparison(config, [], (completed, total) => {
      progress.push([completed, total]);
    });

    expect(result.runCount).toBe(5);
    expect(result.seedStart).toBe(config.seed);
    expect(progress).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
    expect(result.rows.length).toBeGreaterThan(30);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(result.rows.length);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "boarding-median" }),
        expect.objectContaining({ id: "dispatch-passengers-per-hour" }),
        expect.objectContaining({ id: "precall-coverage" }),
        expect.objectContaining({ id: "suppression-stale-prediction" }),
      ]),
    );
    for (const row of result.rows) {
      if (row.baseline === null || row.candidate === null) {
        expect(row.delta).toBeNull();
      } else {
        expect(row.delta).toBeCloseTo(row.candidate - row.baseline, 10);
      }
    }
  });

  it("creates an independent scalar baseline without changing operational inputs", () => {
    const config = shortComparisonConfig();
    config.adminParameters.plannedBoardingMinutes = 11;
    config.forecastTuning.forecast.maximumSamples = 3;

    const baseline = productionBaselineConfig(config);

    expect(baseline).not.toBe(config);
    expect(baseline.adminParameters.plannedBoardingMinutes).toBe(11);
    expect(baseline.realityModel).not.toBe(config.realityModel);
    expect(baseline.forecastTuning.availabilityModel).toBe("SCALAR");
    expect(baseline.forecastTuning.forecast.maximumSamples).not.toBe(3);
    expect(config.forecastTuning.forecast.maximumSamples).toBe(3);
  });
});
