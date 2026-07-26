import { describe, expect, it } from "vitest";
import { productionBaselineConfig, runBatchComparison } from "./comparison";
import { demandForProfile, simulationConfigForPreset } from "./model";

const BATCH_BASELINE_TIMEOUT_MS = 90_000;

function comparisonConfig() {
  const config = simulationConfigForPreset("NORMAL");
  config.schedule.salesEndAt = "2026-07-22T10:00:00.000Z";
  config.schedule.operationsEndAt = "2026-07-22T11:00:00.000Z";
  config.realityModel.demand = demandForProfile("TWO_WAVES", 180);
  config.forecastTuning.comparisonRuns = 5;
  return config;
}

describe("local forecast A/B comparison", () => {
  it("compares the scalar baseline with the time-dependent resource model", () => {
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
    const boardingP90 = result.rows.find((row) => row.id === "boarding-p90");
    expect(boardingP90?.baseline).not.toBeNull();
    expect(boardingP90?.candidate).not.toBeNull();
    expect(boardingP90?.candidate ?? Number.POSITIVE_INFINITY).toBeLessThan(
      boardingP90?.baseline ?? Number.NEGATIVE_INFINITY,
    );
    expect(result.rows.some((row) => row.delta !== 0 && row.delta !== null)).toBe(true);
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
    expect(baseline.forecastTuning.availabilityModel).toBe("SCALAR");
  });

  it(
    "captures the approved 25-seed two-wave baseline and time-dependent candidate",
    () => {
      const config = simulationConfigForPreset("NORMAL");
      const result = runBatchComparison(config);
      const baseline = Object.fromEntries(result.rows.map((row) => [row.id, row.baseline]));
      const candidate = Object.fromEntries(result.rows.map((row) => [row.id, row.candidate]));

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
        boardingMedian: 1.5,
        boardingP90: 19.7,
        boardingBias: 5.69,
        boardingWidth: 3.87,
        horizon60: 60,
        horizon30: 30,
        horizon15: 23.8,
        departureP90: 2.3,
        landingP90: 6.98,
        completionP90: 0.45,
        uncertainCountdowns: 0,
        precallMedian: 16.5,
        precallP90: 34.65,
      });
      expect({
        baselineCoverage: baseline["boarding-coverage"],
        candidateCoverage: candidate["boarding-coverage"],
        candidateP90: candidate["boarding-p90"],
        baselineAverageChange: baseline["stability-average-change"],
        candidateAverageChange: candidate["stability-average-change"],
        baselineJumps15: baseline["stability-jumps-15"],
        candidateJumps15: candidate["stability-jumps-15"],
        baselineJumps30: baseline["stability-jumps-30"],
        candidateJumps30: candidate["stability-jumps-30"],
        baselineMaximumJump: baseline["stability-maximum-jump"],
        candidateMaximumJump: candidate["stability-maximum-jump"],
        baselineThroughput: baseline["operations-throughput"],
        candidateThroughput: candidate["operations-throughput"],
      }).toEqual({
        baselineCoverage: 55.17,
        candidateCoverage: 86.67,
        candidateP90: 7.3,
        baselineAverageChange: 3,
        candidateAverageChange: 0.55,
        baselineJumps15: 221,
        candidateJumps15: 51,
        baselineJumps30: 205,
        candidateJumps30: 7,
        baselineMaximumJump: 465,
        candidateMaximumJump: 38.5,
        baselineThroughput: 27,
        candidateThroughput: 27,
      });
    },
    BATCH_BASELINE_TIMEOUT_MS,
  );
});
