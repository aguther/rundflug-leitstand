import { describe, expect, it } from "vitest";
import { runBatchComparison } from "./comparison";
import { simulationConfigForPreset } from "./model";

const BATCH_BASELINE_TIMEOUT_MS = 300_000;

describe("forecast comparison golden baseline", () => {
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
        boardingMedian: 1,
        boardingP90: 2,
        boardingBias: 1.3,
        boardingWidth: 3.59,
        horizon60: 58.5,
        horizon30: 28.5,
        horizon15: 13.5,
        departureP90: 3.06,
        landingP90: 4.98,
        completionP90: 0.5,
        uncertainCountdowns: 0,
        precallMedian: 100.75,
        precallP90: 203.5,
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
        baselineCoverage: 100,
        candidateCoverage: 95.65,
        candidateP90: 2.5,
        baselineAverageChange: 0.74,
        candidateAverageChange: 0.64,
        baselineJumps15: 116,
        candidateJumps15: 147,
        baselineJumps30: 34,
        candidateJumps30: 60,
        baselineMaximumJump: 39,
        candidateMaximumJump: 100,
        baselineThroughput: 29,
        candidateThroughput: 28,
      });
    },
    BATCH_BASELINE_TIMEOUT_MS,
  );
});
