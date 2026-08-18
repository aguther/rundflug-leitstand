import { runSimulation } from "./engine";
import type { ManualIncident, SimulationConfig, SimulationMetrics } from "./model";
import { advanceSimulationSeed, simulationQuantile } from "./simulation-statistics";

export type SeedBatchMetricId =
  | "completedRotations"
  | "passengersPerHour"
  | "p90PassengerWaitMinutes"
  | "overtimeMinutes"
  | "boardingWindowCoveragePercent"
  | "aircraftUtilizationPercent"
  | "initialBoardingMedianErrorMinutes"
  | "initialBoardingP90ErrorMinutes"
  | "latestBoardingMedianErrorMinutes"
  | "latestBoardingP90ErrorMinutes"
  | "averageForecastChangeMinutes"
  | "maximumForecastJumpMinutes"
  | "jumpsOver15Minutes"
  | "jumpsOver30Minutes";

export interface MetricDistribution {
  sampleCount: number;
  minimum: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  maximum: number | null;
}

export interface SeedBatchRunResult {
  seed: number;
  metrics: SimulationMetrics;
}

export interface SeedBatchResult {
  seedStart: number;
  runCount: number;
  runs: SeedBatchRunResult[];
  distributions: Record<SeedBatchMetricId, MetricDistribution>;
}

export interface SeedBatchMetricDefinition {
  id: SeedBatchMetricId;
  area: "operation" | "forecast";
  group: "accuracy" | "operation" | "stability";
  label: string;
  shortLabel: string;
  unit: string;
  read: (metrics: SimulationMetrics) => number | null;
}

export const SEED_BATCH_METRICS: readonly SeedBatchMetricDefinition[] = [
  {
    id: "completedRotations",
    area: "operation",
    group: "operation",
    label: "Abgeschlossene Umläufe",
    shortLabel: "Umläufe",
    unit: "",
    read: (metrics) => metrics.operations.completedRotations,
  },
  {
    id: "passengersPerHour",
    area: "operation",
    group: "operation",
    label: "Passagiere pro Stunde",
    shortLabel: "Passagiere/h",
    unit: "Pers./h",
    read: (metrics) => metrics.dispatch.passengersPerHour,
  },
  {
    id: "p90PassengerWaitMinutes",
    area: "operation",
    group: "operation",
    label: "P90-Passagierwartezeit",
    shortLabel: "P90 Wartezeit",
    unit: "Min.",
    read: (metrics) => metrics.dispatch.p90PassengerWaitMinutes,
  },
  {
    id: "overtimeMinutes",
    area: "operation",
    group: "operation",
    label: "Überzeit",
    shortLabel: "Überzeit",
    unit: "Min.",
    read: (metrics) => metrics.operations.overtimeMinutes,
  },
  {
    id: "boardingWindowCoveragePercent",
    area: "operation",
    group: "operation",
    label: "Letztes Boardingfenster getroffen",
    shortLabel: "Boardingfenster",
    unit: "%",
    read: (metrics) => metrics.boarding.windowCoveragePercent,
  },
  {
    id: "aircraftUtilizationPercent",
    area: "operation",
    group: "operation",
    label: "Flugzeugauslastung",
    shortLabel: "Auslastung",
    unit: "%",
    read: (metrics) => metrics.operations.aircraftUtilizationPercent,
  },
  {
    id: "initialBoardingMedianErrorMinutes",
    area: "forecast",
    group: "accuracy",
    label: "Medianfehler Erstprognose",
    shortLabel: "Erstprognose Median",
    unit: "Min.",
    read: (metrics) => metrics.initialBoarding.medianAbsoluteErrorMinutes,
  },
  {
    id: "initialBoardingP90ErrorMinutes",
    area: "forecast",
    group: "accuracy",
    label: "P90 Erstprognose",
    shortLabel: "Erstprognose P90",
    unit: "Min.",
    read: (metrics) => metrics.initialBoarding.p90AbsoluteErrorMinutes,
  },
  {
    id: "latestBoardingMedianErrorMinutes",
    area: "forecast",
    group: "accuracy",
    label: "Medianfehler letzte Prognose",
    shortLabel: "Letzte Prognose Median",
    unit: "Min.",
    read: (metrics) => metrics.boarding.medianAbsoluteErrorMinutes,
  },
  {
    id: "latestBoardingP90ErrorMinutes",
    area: "forecast",
    group: "accuracy",
    label: "P90 letzte Prognose",
    shortLabel: "Letzte Prognose P90",
    unit: "Min.",
    read: (metrics) => metrics.boarding.p90AbsoluteErrorMinutes,
  },
  {
    id: "averageForecastChangeMinutes",
    area: "forecast",
    group: "stability",
    label: "Ø absolute Prognoseänderung",
    shortLabel: "Ø Änderung",
    unit: "Min.",
    read: (metrics) => metrics.stability.averageAbsoluteChangeMinutes,
  },
  {
    id: "maximumForecastJumpMinutes",
    area: "forecast",
    group: "stability",
    label: "Größter Prognosesprung",
    shortLabel: "Größter Sprung",
    unit: "Min.",
    read: (metrics) => metrics.stability.maximumJumpMinutes,
  },
  {
    id: "jumpsOver15Minutes",
    area: "forecast",
    group: "stability",
    label: "Sprünge über 15 Minuten",
    shortLabel: "Sprünge >15",
    unit: "",
    read: (metrics) => metrics.stability.jumpsOver15Minutes,
  },
  {
    id: "jumpsOver30Minutes",
    area: "forecast",
    group: "stability",
    label: "Sprünge über 30 Minuten",
    shortLabel: "Sprünge >30",
    unit: "",
    read: (metrics) => metrics.stability.jumpsOver30Minutes,
  },
];

export type SeedBatchSimulationRunner = (
  config: SimulationConfig,
  manualIncidents?: readonly ManualIncident[],
) => { metrics: SimulationMetrics };

export function metricDistribution(values: readonly (number | null)[]): MetricDistribution {
  const available = values.filter((value): value is number => value !== null);
  return {
    sampleCount: available.length,
    minimum: simulationQuantile(available, 0),
    q1: simulationQuantile(available, 0.25),
    median: simulationQuantile(available, 0.5),
    q3: simulationQuantile(available, 0.75),
    maximum: simulationQuantile(available, 1),
  };
}

export function runSeedBatch(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[],
  runCount: number,
  onProgress?: (completedRuns: number, totalRuns: number) => void,
): SeedBatchResult {
  return runSeedBatchWithRunner(config, manualIncidents, runCount, onProgress, runSimulation);
}

export function runSeedBatchWithRunner(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[],
  runCount: number,
  onProgress?: (completedRuns: number, totalRuns: number) => void,
  simulationRunner: SeedBatchSimulationRunner = runSimulation,
): SeedBatchResult {
  if (!Number.isInteger(runCount) || runCount < 5 || runCount > 100) {
    throw new RangeError("Die Anzahl der Läufe muss zwischen 5 und 100 liegen.");
  }
  const runs: SeedBatchRunResult[] = [];
  for (let index = 0; index < runCount; index += 1) {
    const runConfig = structuredClone(config);
    runConfig.seed = advanceSimulationSeed(config.seed, index);
    runs.push({
      seed: runConfig.seed,
      metrics: simulationRunner(runConfig, manualIncidents).metrics,
    });
    onProgress?.(index + 1, runCount);
  }
  return {
    seedStart: config.seed,
    runCount,
    runs,
    distributions: Object.fromEntries(
      SEED_BATCH_METRICS.map((definition) => [
        definition.id,
        metricDistribution(runs.map((run) => definition.read(run.metrics))),
      ]),
    ) as Record<SeedBatchMetricId, MetricDistribution>,
  };
}
