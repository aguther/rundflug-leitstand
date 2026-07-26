import { describe, expect, it } from "vitest";
import { productionBaselineConfig, runBatchComparison } from "./comparison";
import { demandForProfile, simulationConfigForPreset } from "./model";

function comparisonConfig() {
  const config = simulationConfigForPreset("NORMAL");
  config.schedule.salesEndAt = "2026-07-22T10:00:00.000Z";
  config.schedule.operationsEndAt = "2026-07-22T11:00:00.000Z";
  config.realityModel.demand = demandForProfile("TWO_WAVES", 180);
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

  it("captures the approved 25-seed two-wave baseline", () => {
    const config = simulationConfigForPreset("NORMAL");
    const result = runBatchComparison(config);
    const baseline = Object.fromEntries(result.rows.map((row) => [row.id, row.baseline]));

    expect({
      boardingMedian: baseline["boarding-median"],
      boardingP90: baseline["boarding-p90"],
      boardingBias: baseline["boarding-bias"],
      boardingWidth: baseline["boarding-width"],
      horizon60: baseline["horizon-60"],
      horizon30: baseline["horizon-30"],
      horizon15: baseline["horizon-15"],
      departureP90: baseline["departure-p90"],
      landingP90: baseline["landing-p90"],
      completionP90: baseline["completion-p90"],
      uncertainCountdowns: baseline["uncertain-countdowns"],
      precallMedian: baseline["precall-median"],
      precallP90: baseline["precall-p90"],
    }).toEqual({
      boardingMedian: 0.5,
      boardingP90: 19.7,
      boardingBias: 4.75,
      boardingWidth: 0,
      horizon60: 60,
      horizon30: 30,
      horizon15: 20.6,
      departureP90: 2.3,
      landingP90: 6.98,
      completionP90: 0.45,
      uncertainCountdowns: 0,
      precallMedian: 16.5,
      precallP90: 34.65,
    });
  }, 30_000);
});
