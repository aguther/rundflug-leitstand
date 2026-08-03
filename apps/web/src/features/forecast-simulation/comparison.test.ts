import { describe, expect, it } from "vitest";
import { productionBaselineConfig, runBatchComparison } from "./comparison";
import { demandForProfile, simulationConfigForPreset } from "./model";

const BATCH_BASELINE_TIMEOUT_MS = 180_000;
const COMPARISON_SMOKE_TIMEOUT_MS = 20_000;

function comparisonConfig() {
  const config = simulationConfigForPreset("NORMAL");
  config.schedule.salesEndAt = "2026-07-22T10:00:00.000Z";
  config.schedule.operationsEndAt = "2026-07-22T11:00:00.000Z";
  config.realityModel.demand = demandForProfile("TWO_WAVES", 180);
  config.forecastTuning.comparisonRuns = 5;
  return config;
}

describe("local forecast A/B comparison", () => {
  it(
    "compares the scalar baseline with the time-dependent resource model",
    () => {
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
          expect.objectContaining({ id: "dispatch-passengers-per-hour" }),
          expect.objectContaining({ id: "dispatch-passengers-per-aircraft-hour" }),
          expect.objectContaining({ id: "dispatch-maximum-overtakes" }),
          expect.objectContaining({ id: "dispatch-go-to-gate-replans" }),
        ]),
      );
      const boardingP90 = result.rows.find((row) => row.id === "boarding-p90");
      expect(boardingP90?.baseline).not.toBeNull();
      expect(boardingP90?.candidate).not.toBeNull();
      expect(boardingP90?.candidate ?? Number.POSITIVE_INFINITY).toBeLessThan(
        boardingP90?.baseline ?? Number.NEGATIVE_INFINITY,
      );
      expect(result.rows.some((row) => row.delta !== 0 && row.delta !== null)).toBe(true);
    },
    COMPARISON_SMOKE_TIMEOUT_MS,
  );

  it(
    "uses deterministic consecutive seeds and reports progress",
    () => {
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
    },
    COMPARISON_SMOKE_TIMEOUT_MS,
  );

  it("keeps Admin and reality values but resets only technical tuning in the baseline", () => {
    const config = comparisonConfig();
    config.adminParameters.plannedBoardingMinutes = 13;
    config.realityModel.phases.boarding.typical = 9;
    config.demandByProduct = {
      "product-a": demandForProfile("UNIFORM", 180, 6),
      "product-b": demandForProfile("LATE_RUSH", 180, 30),
    };
    config.forecastTuning.forecast.maximumSamples = 4;
    config.forecastTuning.precall.baselineLeadMinutes = 18;

    const baseline = productionBaselineConfig(config);
    expect(baseline.adminParameters.plannedBoardingMinutes).toBe(13);
    expect(baseline.realityModel.phases.boarding.typical).toBe(9);
    expect(baseline.demandByProduct).toEqual(config.demandByProduct);
    expect(baseline.demandByProduct).not.toBe(config.demandByProduct);
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
        boardingMedian: 2,
        boardingP90: 20.2,
        boardingBias: 5.63,
        boardingWidth: 4.62,
        horizon60: 58.35,
        horizon30: 28.5,
        horizon15: 13.5,
        departureP90: 2.3,
        landingP90: 6.98,
        completionP90: 0.45,
        uncertainCountdowns: 0,
        precallMedian: 142.5,
        precallP90: 174.9,
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
        baselineCoverage: 67.86,
        candidateCoverage: 81.48,
        candidateP90: 15.5,
        baselineAverageChange: 0.97,
        candidateAverageChange: 0.86,
        baselineJumps15: 127,
        candidateJumps15: 153,
        baselineJumps30: 64,
        candidateJumps30: 54,
        baselineMaximumJump: 61,
        candidateMaximumJump: 94,
        baselineThroughput: 27,
        candidateThroughput: 27,
      });
    },
    BATCH_BASELINE_TIMEOUT_MS,
  );
});
