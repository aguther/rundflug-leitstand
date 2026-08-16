import { describe, expect, it } from "vitest";
import {
  productionBaselineConfig,
  runBatchComparison,
  runBatchComparisonWithRunner,
} from "./comparison";
import { runSimulation } from "./engine";
import { demandForProfile, simulationConfigForPreset } from "./model";

const COMPARISON_SMOKE_TIMEOUT_MS = 20_000;

function comparisonConfig() {
  const config = simulationConfigForPreset("NORMAL");
  config.schedule.salesEndAt = "2026-07-22T10:00:00.000Z";
  config.schedule.operationsEndAt = "2026-07-22T11:00:00.000Z";
  config.realityModel.demand = demandForProfile("TWO_WAVES", 180);
  config.forecastTuning.comparisonRuns = 5;
  return config;
}

const deterministicMetrics = runSimulation(productionBaselineConfig(comparisonConfig())).metrics;

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
      expect(Number.isFinite(boardingP90?.baseline)).toBe(true);
      expect(Number.isFinite(boardingP90?.candidate)).toBe(true);
      expect(result.rows.some((row) => row.delta !== 0 && row.delta !== null)).toBe(true);
    },
    COMPARISON_SMOKE_TIMEOUT_MS,
  );

  it(
    "uses deterministic consecutive seeds and reports progress",
    () => {
      const progress: Array<[number, number]> = [];
      const seeds: number[] = [];
      const simulationRunner = (config: ReturnType<typeof comparisonConfig>) => {
        seeds.push(config.seed);
        return { metrics: deterministicMetrics };
      };
      const first = runBatchComparisonWithRunner(
        comparisonConfig(),
        [],
        (completed, total) => {
          progress.push([completed, total]);
        },
        simulationRunner,
      );
      const second = runBatchComparisonWithRunner(
        comparisonConfig(),
        [],
        undefined,
        simulationRunner,
      );

      expect(second).toEqual(first);
      expect(seeds).toEqual([
        20260722, 20260722, 20260723, 20260723, 20260724, 20260724, 20260725, 20260725, 20260726,
        20260726, 20260722, 20260722, 20260723, 20260723, 20260724, 20260724, 20260725, 20260725,
        20260726, 20260726,
      ]);
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
});
