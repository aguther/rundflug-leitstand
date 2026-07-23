import { DEFAULT_FORECAST_TUNING_PROFILE, DEFAULT_PRECALL_TUNING_PROFILE } from "@rundflug/domain";
import { runSimulation } from "./engine";
import type { ManualIncident, SimulationConfig, SimulationMetrics } from "./model";

export interface ComparisonMetricDefinition {
  id: string;
  category: "Boarding" | "Meilensteine" | "Horizonte" | "Qualität" | "Unterdrückung" | "GO TO GATE";
  label: string;
  unit: string;
}

export interface ComparisonMetricResult extends ComparisonMetricDefinition {
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
}

export interface BatchComparisonResult {
  seedStart: number;
  runCount: number;
  rows: ComparisonMetricResult[];
}

const METRIC_DEFINITIONS: readonly (ComparisonMetricDefinition & {
  read: (metrics: SimulationMetrics) => number | null;
})[] = [
  {
    id: "boarding-coverage",
    category: "Boarding",
    label: "Zeitfenster getroffen",
    unit: "%",
    read: (metrics) => metrics.boarding.windowCoveragePercent,
  },
  {
    id: "boarding-median",
    category: "Boarding",
    label: "Median absolut",
    unit: "Min.",
    read: (metrics) => metrics.boarding.medianAbsoluteErrorMinutes,
  },
  {
    id: "boarding-p90",
    category: "Boarding",
    label: "P90 absolut",
    unit: "Min.",
    read: (metrics) => metrics.boarding.p90AbsoluteErrorMinutes,
  },
  {
    id: "boarding-bias",
    category: "Boarding",
    label: "Bias",
    unit: "Min.",
    read: (metrics) => metrics.boarding.biasMinutes,
  },
  {
    id: "boarding-width",
    category: "Boarding",
    label: "Ø Fensterbreite",
    unit: "Min.",
    read: (metrics) => metrics.boarding.averageWindowWidthMinutes,
  },
  {
    id: "departure-mae",
    category: "Meilensteine",
    label: "Off-Block MAE",
    unit: "Min.",
    read: (metrics) => metrics.departure.maeMinutes,
  },
  {
    id: "departure-median",
    category: "Meilensteine",
    label: "Off-Block Median",
    unit: "Min.",
    read: (metrics) => metrics.departure.medianAbsoluteErrorMinutes,
  },
  {
    id: "departure-p90",
    category: "Meilensteine",
    label: "Off-Block P90",
    unit: "Min.",
    read: (metrics) => metrics.departure.p90AbsoluteErrorMinutes,
  },
  {
    id: "departure-bias",
    category: "Meilensteine",
    label: "Off-Block Bias",
    unit: "Min.",
    read: (metrics) => metrics.departure.biasMinutes,
  },
  {
    id: "landing-mae",
    category: "Meilensteine",
    label: "On-Block MAE",
    unit: "Min.",
    read: (metrics) => metrics.landing.maeMinutes,
  },
  {
    id: "landing-median",
    category: "Meilensteine",
    label: "On-Block Median",
    unit: "Min.",
    read: (metrics) => metrics.landing.medianAbsoluteErrorMinutes,
  },
  {
    id: "landing-p90",
    category: "Meilensteine",
    label: "On-Block P90",
    unit: "Min.",
    read: (metrics) => metrics.landing.p90AbsoluteErrorMinutes,
  },
  {
    id: "landing-bias",
    category: "Meilensteine",
    label: "On-Block Bias",
    unit: "Min.",
    read: (metrics) => metrics.landing.biasMinutes,
  },
  {
    id: "completion-mae",
    category: "Meilensteine",
    label: "Abschluss MAE",
    unit: "Min.",
    read: (metrics) => metrics.completion.maeMinutes,
  },
  {
    id: "completion-median",
    category: "Meilensteine",
    label: "Abschluss Median",
    unit: "Min.",
    read: (metrics) => metrics.completion.medianAbsoluteErrorMinutes,
  },
  {
    id: "completion-p90",
    category: "Meilensteine",
    label: "Abschluss P90",
    unit: "Min.",
    read: (metrics) => metrics.completion.p90AbsoluteErrorMinutes,
  },
  {
    id: "completion-bias",
    category: "Meilensteine",
    label: "Abschluss Bias",
    unit: "Min.",
    read: (metrics) => metrics.completion.biasMinutes,
  },
  ...(["60", "30", "15"] as const).map((horizon) => ({
    id: `horizon-${horizon}`,
    category: "Horizonte" as const,
    label: `${horizon} Minuten vor Boarding: P90`,
    unit: "Min.",
    read: (metrics: SimulationMetrics) => metrics.horizons[horizon].p90AbsoluteErrorMinutes,
  })),
  {
    id: "quality-stable",
    category: "Qualität",
    label: "STABLE-Snapshots",
    unit: "",
    read: (metrics) => metrics.qualities.STABLE,
  },
  {
    id: "quality-changing",
    category: "Qualität",
    label: "CHANGING-Snapshots",
    unit: "",
    read: (metrics) => metrics.qualities.CHANGING,
  },
  {
    id: "quality-uncertain",
    category: "Qualität",
    label: "UNCERTAIN-Snapshots",
    unit: "",
    read: (metrics) => metrics.qualities.UNCERTAIN,
  },
  {
    id: "uncertain-countdowns",
    category: "Qualität",
    label: "Countdowns bei UNCERTAIN",
    unit: "",
    read: (metrics) => metrics.uncertainCountdownViolations,
  },
  {
    id: "suppression-operation-interrupted",
    category: "Unterdrückung",
    label: "Betrieb unterbrochen",
    unit: "",
    read: (metrics) => metrics.uncertaintyReasons.OPERATION_INTERRUPTED,
  },
  {
    id: "suppression-emergency",
    category: "Unterdrückung",
    label: "Notfallmodus",
    unit: "",
    read: (metrics) => metrics.uncertaintyReasons.EMERGENCY_MODE,
  },
  {
    id: "suppression-resource-group",
    category: "Unterdrückung",
    label: "Ressourcengruppe inaktiv",
    unit: "",
    read: (metrics) => metrics.uncertaintyReasons.RESOURCE_GROUP_INACTIVE,
  },
  {
    id: "suppression-capacity",
    category: "Unterdrückung",
    label: "Keine aktive Kapazität",
    unit: "",
    read: (metrics) => metrics.uncertaintyReasons.NO_ACTIVE_CAPACITY,
  },
  {
    id: "suppression-stale-prediction",
    category: "Unterdrückung",
    label: "Prognose veraltet",
    unit: "",
    read: (metrics) => metrics.uncertaintyReasons.STALE_PREDICTION,
  },
  {
    id: "precall-coverage",
    category: "GO TO GATE",
    label: "Voraufruf-Abdeckung",
    unit: "%",
    read: (metrics) => metrics.precall.coveragePercent,
  },
  {
    id: "precall-median",
    category: "GO TO GATE",
    label: "Median bis Boarding",
    unit: "Min.",
    read: (metrics) => metrics.precall.medianGateWaitMinutes,
  },
  {
    id: "precall-p90",
    category: "GO TO GATE",
    label: "P90 bis Boarding",
    unit: "Min.",
    read: (metrics) => metrics.precall.p90GateWaitMinutes,
  },
];

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function nextSeed(seedStart: number, offset: number): number {
  const maximumSeed = 4_294_967_295;
  return ((seedStart - 1 + offset) % maximumSeed) + 1;
}

export function productionBaselineConfig(config: SimulationConfig): SimulationConfig {
  const baseline = structuredClone(config);
  baseline.forecastTuning.forecast = { ...DEFAULT_FORECAST_TUNING_PROFILE };
  baseline.forecastTuning.precall = { ...DEFAULT_PRECALL_TUNING_PROFILE };
  return baseline;
}

export function runBatchComparison(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[] = [],
  onProgress?: (completedRuns: number, totalRuns: number) => void,
): BatchComparisonResult {
  const baselineValues = new Map<string, number[]>();
  const candidateValues = new Map<string, number[]>();
  const baselineConfig = productionBaselineConfig(config);
  const runCount = config.forecastTuning.comparisonRuns;

  for (let index = 0; index < runCount; index += 1) {
    const seed = nextSeed(config.seed, index);
    baselineConfig.seed = seed;
    const candidateConfig = structuredClone(config);
    candidateConfig.seed = seed;
    const baselineMetrics = runSimulation(baselineConfig, manualIncidents).metrics;
    const candidateMetrics = runSimulation(candidateConfig, manualIncidents).metrics;
    for (const definition of METRIC_DEFINITIONS) {
      const baselineValue = definition.read(baselineMetrics);
      const candidateValue = definition.read(candidateMetrics);
      if (baselineValue !== null) {
        const values = baselineValues.get(definition.id) ?? [];
        values.push(baselineValue);
        baselineValues.set(definition.id, values);
      }
      if (candidateValue !== null) {
        const values = candidateValues.get(definition.id) ?? [];
        values.push(candidateValue);
        candidateValues.set(definition.id, values);
      }
    }
    onProgress?.(index + 1, runCount);
  }

  return {
    seedStart: config.seed,
    runCount,
    rows: METRIC_DEFINITIONS.map(({ read: _read, ...definition }) => {
      const baseline = median(baselineValues.get(definition.id) ?? []);
      const candidate = median(candidateValues.get(definition.id) ?? []);
      return {
        ...definition,
        baseline,
        candidate,
        delta: baseline === null || candidate === null ? null : candidate - baseline,
      };
    }),
  };
}
