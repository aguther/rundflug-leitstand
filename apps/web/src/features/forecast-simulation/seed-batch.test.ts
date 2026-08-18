import { describe, expect, it, vi } from "vitest";
import { type SimulationMetrics, simulationConfigForPreset } from "./model";
import { metricDistribution, runSeedBatch, runSeedBatchWithRunner } from "./seed-batch";
import { advanceSimulationSeed } from "./simulation-statistics";

function metrics(value: number | null): SimulationMetrics {
  return {
    boarding: {
      samples: 1,
      maeMinutes: value,
      medianAbsoluteErrorMinutes: value,
      p90AbsoluteErrorMinutes: value,
      biasMinutes: value,
      windowCoveragePercent: value,
      averageWindowWidthMinutes: value,
    },
    initialBoarding: {
      samples: 1,
      maeMinutes: value,
      medianAbsoluteErrorMinutes: value,
      p90AbsoluteErrorMinutes: value,
      biasMinutes: value,
    },
    departure: {
      samples: 0,
      maeMinutes: null,
      medianAbsoluteErrorMinutes: null,
      p90AbsoluteErrorMinutes: null,
      biasMinutes: null,
    },
    landing: {
      samples: 0,
      maeMinutes: null,
      medianAbsoluteErrorMinutes: null,
      p90AbsoluteErrorMinutes: null,
      biasMinutes: null,
    },
    completion: {
      samples: 0,
      maeMinutes: null,
      medianAbsoluteErrorMinutes: null,
      p90AbsoluteErrorMinutes: null,
      biasMinutes: null,
    },
    horizons: {
      "15": {
        samples: 0,
        maeMinutes: null,
        medianAbsoluteErrorMinutes: null,
        p90AbsoluteErrorMinutes: null,
        biasMinutes: null,
      },
      "30": {
        samples: 0,
        maeMinutes: null,
        medianAbsoluteErrorMinutes: null,
        p90AbsoluteErrorMinutes: null,
        biasMinutes: null,
      },
      "60": {
        samples: 0,
        maeMinutes: null,
        medianAbsoluteErrorMinutes: null,
        p90AbsoluteErrorMinutes: null,
        biasMinutes: null,
      },
    },
    qualities: { STABLE: 0, CHANGING: 0, UNCERTAIN: 0 },
    uncertaintyReasons: {
      OPERATION_INTERRUPTED: 0,
      EMERGENCY_MODE: 0,
      RESOURCE_GROUP_INACTIVE: 0,
      NO_ACTIVE_CAPACITY: 0,
      STALE_PREDICTION: 0,
      NO_FITTING_AIRCRAFT: 0,
      NO_FORECAST_CAPACITY: 0,
      PLANNED_CONSTRAINT_OVERDUE: 0,
      UNPLANNED_RESOURCE_RETURN: 0,
    },
    precall: {
      eligibleGroups: 0,
      precalledGroups: 0,
      coveragePercent: null,
      medianGateWaitMinutes: null,
      p90GateWaitMinutes: null,
      sameTickCount: 0,
      uncertainPrecallCount: 0,
    },
    stability: {
      changes: 0,
      averageAbsoluteChangeMinutes: value,
      maximumJumpMinutes: value ?? 0,
      jumpsOver15Minutes: 0,
      jumpsOver30Minutes: 0,
      maximumWindowWidthMinutes: 0,
    },
    operations: {
      completedRotations: value ?? 0,
      overtimeMinutes: value ?? 0,
      aircraftUtilizationPercent: value,
      averageSeatUtilizationPercent: value,
      averagePassengerWaitMinutes: value,
      p90PassengerWaitMinutes: value,
      maximumPassengerWaitMinutes: value,
      overtakes: 0,
      overtakeRatePercent: null,
      maximumProductServiceDeficitMinutes: null,
    },
    dispatch: {
      passengersPerHour: value,
      passengersPerAircraftHour: value,
      offeredSeats: 0,
      occupiedSeats: 0,
      averageSeatUtilizationPercent: value,
      p50PassengerWaitMinutes: value,
      p90PassengerWaitMinutes: value,
      maximumPassengerWaitMinutes: value,
      waitMinutesByProduct: {},
      projectedOvertakes: 0,
      maximumOvertakesPerGroup: 0,
      serviceSharePercentByProduct: {},
      maximumProductServiceDeficitMinutes: null,
      unnecessaryPlanChanges: 0,
      prepareDemotions: 0,
      goToGateReplans: 0,
    },
    uncertainCountdownViolations: 0,
    maximumEventReactionSeconds: 0,
  };
}

describe("seed batch statistics", () => {
  it("advances seeds deterministically and wraps after uint32 maximum", () => {
    expect([0, 1, 2, 3].map((offset) => advanceSimulationSeed(4_294_967_294, offset))).toEqual([
      4_294_967_294, 4_294_967_295, 1, 2,
    ]);
  });

  it("excludes nulls and interpolates quartiles", () => {
    expect(metricDistribution([null, 1, 3, 5, 7])).toEqual({
      sampleCount: 4,
      minimum: 1,
      q1: 2.5,
      median: 4,
      q3: 5.5,
      maximum: 7,
    });
    expect(metricDistribution([null])).toEqual({
      sampleCount: 0,
      minimum: null,
      q1: null,
      median: null,
      q3: null,
      maximum: null,
    });
  });

  it("keeps the source config unchanged and forwards identical incidents", () => {
    const config = simulationConfigForPreset("NORMAL");
    config.seed = 4_294_967_294;
    const original = structuredClone(config);
    const incidents = [
      {
        id: "manual-001",
        type: "EVENT_INTERRUPTION" as const,
        at: config.schedule.operationsStartAt,
        aircraftId: null,
        durationMinutes: 5,
        dayOutage: false,
      },
    ];
    const seenConfigs: (typeof config)[] = [];
    const seenIncidents: unknown[] = [];
    const runner = vi.fn((runConfig: typeof config, runIncidents = incidents) => {
      seenConfigs.push(structuredClone(runConfig));
      seenIncidents.push(runIncidents);
      return { metrics: metrics(runConfig.seed) };
    });
    const progress = vi.fn();

    const result = runSeedBatchWithRunner(config, incidents, 5, progress, runner);

    expect(config).toEqual(original);
    expect(result.runs.map((run) => run.seed)).toEqual([4_294_967_294, 4_294_967_295, 1, 2, 3]);
    expect(seenConfigs.map(({ seed }) => seed)).toEqual(result.runs.map(({ seed }) => seed));
    const { seed: _originalSeed, ...expectedConfig } = original;
    for (const { seed: _runSeed, ...runConfig } of seenConfigs) {
      expect(runConfig).toEqual(expectedConfig);
    }
    expect(seenIncidents.every((value) => value === incidents)).toBe(true);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it("accepts the boundary counts and rejects values outside 5–100", () => {
    const config = simulationConfigForPreset("NORMAL");
    const runner = () => ({ metrics: metrics(1) });
    expect(runSeedBatchWithRunner(config, [], 5, undefined, runner).runs).toHaveLength(5);
    expect(runSeedBatchWithRunner(config, [], 100, undefined, runner).runs).toHaveLength(100);
    expect(() => runSeedBatchWithRunner(config, [], 4, undefined, runner)).toThrow(/5 und 100/);
    expect(() => runSeedBatchWithRunner(config, [], 101, undefined, runner)).toThrow(/5 und 100/);
  });

  it("repeats twenty-five compact simulation runs deterministically", () => {
    const config = simulationConfigForPreset("NORMAL");
    config.realityModel.demand.windows = config.realityModel.demand.windows.map((window) => ({
      ...window,
      personsPerHour: 4,
    }));
    const first = runSeedBatch(config, [], 25);
    const second = runSeedBatch(config, [], 25);

    expect(second).toEqual(first);
    expect(first.runs).toHaveLength(25);
    expect(first.runs.every((run) => run.metrics.operations.completedRotations > 0)).toBe(true);
  }, 60_000);
});
