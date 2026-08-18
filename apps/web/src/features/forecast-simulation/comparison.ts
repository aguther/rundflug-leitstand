import { DEFAULT_FORECAST_TUNING_PROFILE, DEFAULT_PRECALL_TUNING_PROFILE } from "@rundflug/domain";
import { runSimulation } from "./engine";
import type { ManualIncident, SimulationConfig, SimulationMetrics } from "./model";
import { advanceSimulationSeed, simulationQuantile } from "./simulation-statistics";

export interface ComparisonMetricDefinition {
  id: string;
  category:
    | "Boarding"
    | "Meilensteine"
    | "Horizonte"
    | "Qualität"
    | "Stabilität"
    | "Betrieb"
    | "Dispatch"
    | "Unterdrückung"
    | "GO TO GATE";
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

export type ComparisonSimulationRunner = (
  config: SimulationConfig,
  manualIncidents?: readonly ManualIncident[],
) => { metrics: SimulationMetrics };

const METRIC_DEFINITIONS: readonly (ComparisonMetricDefinition & {
  read: (metrics: SimulationMetrics) => number | null;
})[] = [
  {
    id: "boarding-coverage",
    category: "Boarding",
    label: "Letztes Boardingfenster getroffen",
    unit: "%",
    read: (metrics) => metrics.boarding.windowCoveragePercent,
  },
  {
    id: "boarding-initial-median",
    category: "Boarding",
    label: "Erstprognose Median absolut",
    unit: "Min.",
    read: (metrics) => metrics.initialBoarding.medianAbsoluteErrorMinutes,
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
    id: "stability-average-change",
    category: "Stabilität",
    label: "Ø Prognoseänderung",
    unit: "Min.",
    read: (metrics) => metrics.stability.averageAbsoluteChangeMinutes,
  },
  {
    id: "stability-jumps-15",
    category: "Stabilität",
    label: "Sprünge über 15 Minuten",
    unit: "",
    read: (metrics) => metrics.stability.jumpsOver15Minutes,
  },
  {
    id: "stability-jumps-30",
    category: "Stabilität",
    label: "Sprünge über 30 Minuten",
    unit: "",
    read: (metrics) => metrics.stability.jumpsOver30Minutes,
  },
  {
    id: "stability-maximum-jump",
    category: "Stabilität",
    label: "Größter Prognosesprung",
    unit: "Min.",
    read: (metrics) => metrics.stability.maximumJumpMinutes,
  },
  {
    id: "stability-maximum-window",
    category: "Stabilität",
    label: "Größtes Zeitfenster",
    unit: "Min.",
    read: (metrics) => metrics.stability.maximumWindowWidthMinutes,
  },
  {
    id: "operations-throughput",
    category: "Betrieb",
    label: "Abgeschlossene Umläufe",
    unit: "",
    read: (metrics) => metrics.operations.completedRotations,
  },
  {
    id: "operations-overtime",
    category: "Betrieb",
    label: "Überziehung Betriebsende",
    unit: "Min.",
    read: (metrics) => metrics.operations.overtimeMinutes,
  },
  {
    id: "operations-utilization",
    category: "Betrieb",
    label: "Flugzeugauslastung",
    unit: "%",
    read: (metrics) => metrics.operations.aircraftUtilizationPercent,
  },
  {
    id: "operations-seat-utilization",
    category: "Dispatch",
    label: "Sitzplatzauslastung",
    unit: "%",
    read: (metrics) => metrics.dispatch.averageSeatUtilizationPercent,
  },
  {
    id: "dispatch-passengers-per-hour",
    category: "Dispatch",
    label: "Personen pro Stunde",
    unit: "Pers./h",
    read: (metrics) => metrics.dispatch.passengersPerHour,
  },
  {
    id: "dispatch-passengers-per-aircraft-hour",
    category: "Dispatch",
    label: "Personen pro Flugzeugstunde",
    unit: "Pers./Flzg.-h",
    read: (metrics) => metrics.dispatch.passengersPerAircraftHour,
  },
  {
    id: "dispatch-offered-seats",
    category: "Dispatch",
    label: "Angebotene Sitze",
    unit: "",
    read: (metrics) => metrics.dispatch.offeredSeats,
  },
  {
    id: "dispatch-occupied-seats",
    category: "Dispatch",
    label: "Belegte Sitze",
    unit: "",
    read: (metrics) => metrics.dispatch.occupiedSeats,
  },
  {
    id: "operations-passenger-wait",
    category: "Dispatch",
    label: "Ø Passagierwartezeit",
    unit: "Min.",
    read: (metrics) => metrics.dispatch.p50PassengerWaitMinutes,
  },
  {
    id: "operations-passenger-wait-p90",
    category: "Dispatch",
    label: "P90 Passagierwartezeit",
    unit: "Min.",
    read: (metrics) => metrics.dispatch.p90PassengerWaitMinutes,
  },
  {
    id: "operations-passenger-wait-maximum",
    category: "Dispatch",
    label: "Maximale Passagierwartezeit",
    unit: "Min.",
    read: (metrics) => metrics.dispatch.maximumPassengerWaitMinutes,
  },
  {
    id: "operations-overtakes",
    category: "Dispatch",
    label: "Überholungen",
    unit: "",
    read: (metrics) => metrics.dispatch.projectedOvertakes,
  },
  {
    id: "operations-overtake-rate",
    category: "Dispatch",
    label: "Überholrate",
    unit: "%",
    read: (metrics) => metrics.operations.overtakeRatePercent,
  },
  {
    id: "operations-product-deficit",
    category: "Dispatch",
    label: "Max. Produkt-Service-Defizit",
    unit: "Min.",
    read: (metrics) => metrics.dispatch.maximumProductServiceDeficitMinutes,
  },
  {
    id: "dispatch-maximum-overtakes",
    category: "Dispatch",
    label: "Max. Überholungen je Gruppe",
    unit: "",
    read: (metrics) => metrics.dispatch.maximumOvertakesPerGroup,
  },
  {
    id: "dispatch-plan-changes",
    category: "Dispatch",
    label: "Unnötige Planänderungen",
    unit: "",
    read: (metrics) => metrics.dispatch.unnecessaryPlanChanges,
  },
  {
    id: "dispatch-prepare-demotions",
    category: "Dispatch",
    label: "Rücknahmen von Bereithalten",
    unit: "",
    read: (metrics) => metrics.dispatch.prepareDemotions,
  },
  {
    id: "dispatch-go-to-gate-replans",
    category: "Dispatch",
    label: "Neuplanungen nach Bitte zum Gate",
    unit: "",
    read: (metrics) => metrics.dispatch.goToGateReplans,
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

function sameValues<T extends object>(left: T, right: T): boolean {
  const keys = Object.keys(left) as Array<keyof T>;
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

export function productionBaselineConfig(config: SimulationConfig): SimulationConfig {
  const baseline = structuredClone(config);
  baseline.forecastTuning.forecast = { ...DEFAULT_FORECAST_TUNING_PROFILE };
  baseline.forecastTuning.precall = { ...DEFAULT_PRECALL_TUNING_PROFILE };
  baseline.forecastTuning.availabilityModel = "SCALAR";
  return baseline;
}

export function runBatchComparison(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[] = [],
  onProgress?: (completedRuns: number, totalRuns: number) => void,
): BatchComparisonResult {
  return runBatchComparisonWithRunner(config, manualIncidents, onProgress, runSimulation);
}

export function runBatchComparisonWithRunner(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[] = [],
  onProgress?: (completedRuns: number, totalRuns: number) => void,
  simulationRunner: ComparisonSimulationRunner = runSimulation,
): BatchComparisonResult {
  const baselineValues = new Map<string, number[]>();
  const candidateValues = new Map<string, number[]>();
  const baselineConfig = productionBaselineConfig(config);
  const runCount = config.forecastTuning.comparisonRuns;
  const candidateUsesProductionTuning =
    sameValues(config.forecastTuning.forecast, baselineConfig.forecastTuning.forecast) &&
    sameValues(config.forecastTuning.precall, baselineConfig.forecastTuning.precall) &&
    config.forecastTuning.availabilityModel === baselineConfig.forecastTuning.availabilityModel;

  for (let index = 0; index < runCount; index += 1) {
    const seed = advanceSimulationSeed(config.seed, index);
    baselineConfig.seed = seed;
    const baselineMetrics = simulationRunner(baselineConfig, manualIncidents).metrics;
    let candidateMetrics = baselineMetrics;
    if (!candidateUsesProductionTuning) {
      const candidateConfig = structuredClone(config);
      candidateConfig.seed = seed;
      candidateMetrics = simulationRunner(candidateConfig, manualIncidents).metrics;
    }
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
      const baseline = simulationQuantile(baselineValues.get(definition.id) ?? [], 0.5);
      const candidate = simulationQuantile(candidateValues.get(definition.id) ?? [], 0.5);
      return {
        ...definition,
        baseline,
        candidate,
        delta: baseline === null || candidate === null ? null : candidate - baseline,
      };
    }),
  };
}
