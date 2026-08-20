import { ArrowDownUp, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, ModalDialog } from "../../design-system/components";
import {
  type MetricDistribution,
  SEED_BATCH_METRICS,
  type SeedBatchMetricDefinition,
  type SeedBatchMetricId,
  type SeedBatchResult,
} from "./seed-batch";

interface SimulationSeedBatchDialogProps {
  defaultRunCount: number;
  error: string | null;
  onCancel: () => void;
  onClose: () => void;
  onExport: () => void;
  onStart: (runCount: number) => void;
  open: boolean;
  progress: { completed: number; total: number };
  result: SeedBatchResult | null;
  running: boolean;
  seedStart: number;
}

type BatchTab = "operation" | "forecast";
type SortDirection = "ascending" | "descending";

const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function formatMetric(value: number | null, unit = ""): string {
  if (value === null) return "–";
  return `${numberFormatter.format(value)}${unit ? ` ${unit}` : ""}`;
}

function metricDefinition(id: SeedBatchMetricId): SeedBatchMetricDefinition {
  const definition = SEED_BATCH_METRICS.find((entry) => entry.id === id);
  if (!definition) throw new Error(`Unknown seed batch metric: ${id}`);
  return definition;
}

function DistributionChart({
  distribution,
  label,
  unit,
}: Readonly<{ distribution: MetricDistribution; label: string; unit: string }>) {
  if (
    distribution.sampleCount === 0 ||
    distribution.minimum === null ||
    distribution.maximum === null
  ) {
    return <p className="sim-batch-empty">Keine auswertbaren Werte.</p>;
  }
  const minimum = distribution.minimum;
  const span = Math.max(1, distribution.maximum - minimum);
  const position = (value: number | null) =>
    value === null ? 0 : 24 + ((value - minimum) / span) * 252;
  return (
    <svg
      aria-label={`${label}, Verteilung über ${distribution.sampleCount} Läufe`}
      className="sim-batch-distribution"
      role="img"
      viewBox="0 0 300 72"
    >
      <title>{`${label}: Minimum ${formatMetric(distribution.minimum, unit)}, Q1 ${formatMetric(distribution.q1, unit)}, Median ${formatMetric(distribution.median, unit)}, Q3 ${formatMetric(distribution.q3, unit)}, Maximum ${formatMetric(distribution.maximum, unit)}`}</title>
      <line
        className="sim-batch-whisker"
        x1={position(distribution.minimum)}
        x2={position(distribution.maximum)}
        y1="28"
        y2="28"
      />
      <rect
        className="sim-batch-quartile"
        height="22"
        width={Math.max(2, position(distribution.q3) - position(distribution.q1))}
        x={position(distribution.q1)}
        y="17"
      />
      <line
        className="sim-batch-median"
        x1={position(distribution.median)}
        x2={position(distribution.median)}
        y1="14"
        y2="42"
      />
      <circle className="sim-batch-endpoint" cx={position(distribution.minimum)} cy="28" r="3" />
      <circle className="sim-batch-endpoint" cx={position(distribution.maximum)} cy="28" r="3" />
      <text x="18" y="62">
        {formatMetric(distribution.minimum, unit)}
      </text>
      <text textAnchor="middle" x="150" y="62">
        Median {formatMetric(distribution.median, unit)}
      </text>
      <text textAnchor="end" x="282" y="62">
        {formatMetric(distribution.maximum, unit)}
      </text>
    </svg>
  );
}

function DistributionPanel({
  metricId,
  onChange,
  options,
  result,
  title,
}: Readonly<{
  metricId: SeedBatchMetricId;
  onChange: (metricId: SeedBatchMetricId) => void;
  options: readonly SeedBatchMetricId[];
  result: SeedBatchResult;
  title: string;
}>) {
  const definition = metricDefinition(metricId);
  return (
    <article className="sim-batch-panel">
      <header>
        <h3>{title}</h3>
        <select
          aria-label={`${title}: Kennzahl`}
          onChange={(event) => onChange(event.currentTarget.value as SeedBatchMetricId)}
          value={metricId}
        >
          {options.map((id) => {
            const option = metricDefinition(id);
            return (
              <option key={id} value={id}>
                {option.shortLabel}
              </option>
            );
          })}
        </select>
      </header>
      <DistributionChart
        distribution={result.distributions[metricId]}
        label={definition.label}
        unit={definition.unit}
      />
    </article>
  );
}

function ResultCards({
  ids,
  result,
}: Readonly<{ ids: readonly SeedBatchMetricId[]; result: SeedBatchResult }>) {
  return (
    <div className="sim-batch-cards">
      {ids.map((id) => {
        const definition = metricDefinition(id);
        const distribution = result.distributions[id];
        return (
          <article key={id}>
            <span>{definition.shortLabel}</span>
            <strong>{formatMetric(distribution.median, definition.unit)}</strong>
            <small>Median · n={distribution.sampleCount}</small>
          </article>
        );
      })}
    </div>
  );
}

function SortButton({
  active,
  direction,
  label,
  onClick,
}: Readonly<{ active: boolean; direction: SortDirection; label: string; onClick: () => void }>) {
  return (
    <button
      aria-label={`${label} sortieren${active ? `, ${direction}` : ""}`}
      onClick={onClick}
      type="button"
    >
      {label}
      <ArrowDownUp aria-hidden="true" />
    </button>
  );
}

function RunTable({
  ids,
  result,
}: Readonly<{ ids: readonly SeedBatchMetricId[]; result: SeedBatchResult }>) {
  const [sortKey, setSortKey] = useState<"seed" | SeedBatchMetricId>("seed");
  const [direction, setDirection] = useState<SortDirection>("ascending");
  const rows = useMemo(() => {
    const multiplier = direction === "ascending" ? 1 : -1;
    return [...result.runs].sort((left, right) => {
      const leftValue =
        sortKey === "seed" ? left.seed : metricDefinition(sortKey).read(left.metrics);
      const rightValue =
        sortKey === "seed" ? right.seed : metricDefinition(sortKey).read(right.metrics);
      if (leftValue === null) return rightValue === null ? left.seed - right.seed : 1;
      if (rightValue === null) return -1;
      return (leftValue - rightValue || left.seed - right.seed) * multiplier;
    });
  }, [direction, result.runs, sortKey]);
  const changeSort = (key: typeof sortKey) => {
    if (sortKey === key)
      setDirection((current) => (current === "ascending" ? "descending" : "ascending"));
    else {
      setSortKey(key);
      setDirection("ascending");
    }
  };
  return (
    <div className="sim-batch-table-wrap">
      <table className="sim-batch-table">
        <thead>
          <tr>
            <th>
              <SortButton
                active={sortKey === "seed"}
                direction={direction}
                label="Seed"
                onClick={() => changeSort("seed")}
              />
            </th>
            {ids.map((id) => {
              const definition = metricDefinition(id);
              return (
                <th key={id}>
                  <SortButton
                    active={sortKey === id}
                    direction={direction}
                    label={definition.shortLabel}
                    onClick={() => changeSort(id)}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((run) => (
            <tr key={run.seed}>
              <th scope="row">{run.seed}</th>
              {ids.map((id) => {
                const definition = metricDefinition(id);
                return (
                  <td key={id}>{formatMetric(definition.read(run.metrics), definition.unit)}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExtremeNotes({ result }: Readonly<{ result: SeedBatchResult }>) {
  const definitions = [
    metricDefinition("passengersPerHour"),
    metricDefinition("p90PassengerWaitMinutes"),
    metricDefinition("overtimeMinutes"),
  ];
  return (
    <div className="sim-batch-extremes">
      {definitions.map((definition) => {
        const available = result.runs
          .map((run) => ({ seed: run.seed, value: definition.read(run.metrics) }))
          .filter((entry): entry is { seed: number; value: number } => entry.value !== null);
        const extreme =
          available.length === 0 ? null : Math.max(...available.map(({ value }) => value));
        const matches =
          extreme === null
            ? []
            : available
                .filter(({ value }) => value === extreme)
                .sort((left, right) => left.seed - right.seed);
        return (
          <article key={definition.id}>
            <span>{definition.label}</span>
            <strong>{formatMetric(extreme, definition.unit)}</strong>
            <small>
              {matches[0]
                ? `Seed ${matches[0].seed}${matches.length > 1 ? ` · ${matches.length} gleichauf` : ""}`
                : "Keine Daten"}
            </small>
          </article>
        );
      })}
    </div>
  );
}

const operationIds: readonly SeedBatchMetricId[] = [
  "completedRotations",
  "passengersPerHour",
  "p90PassengerWaitMinutes",
  "overtimeMinutes",
  "boardingWindowCoveragePercent",
  "aircraftUtilizationPercent",
];
const accuracyIds: readonly SeedBatchMetricId[] = [
  "initialBoardingMedianErrorMinutes",
  "initialBoardingP90ErrorMinutes",
  "latestBoardingMedianErrorMinutes",
  "latestBoardingP90ErrorMinutes",
];
const stabilityIds: readonly SeedBatchMetricId[] = [
  "averageForecastChangeMinutes",
  "maximumForecastJumpMinutes",
  "jumpsOver15Minutes",
  "jumpsOver30Minutes",
];

export function SimulationSeedBatchDialog(props: Readonly<SimulationSeedBatchDialogProps>) {
  const [tab, setTab] = useState<BatchTab>("operation");
  const [runCount, setRunCount] = useState(props.defaultRunCount);
  const [operationMetric, setOperationMetric] = useState<SeedBatchMetricId>("passengersPerHour");
  const [accuracyMetric, setAccuracyMetric] = useState<SeedBatchMetricId>(
    "initialBoardingMedianErrorMinutes",
  );
  const [stabilityMetric, setStabilityMetric] = useState<SeedBatchMetricId>(
    "averageForecastChangeMinutes",
  );
  useEffect(() => {
    if (props.open) setRunCount(props.defaultRunCount);
  }, [props.defaultRunCount, props.open]);
  const countValid = Number.isInteger(runCount) && runCount >= 5 && runCount <= 100;
  const footer = (
    <>
      {props.running ? (
        <Button onClick={props.onCancel}>Abbrechen</Button>
      ) : (
        <Button
          disabled={!countValid}
          onClick={() => props.onStart(runCount)}
          variant={props.result ? "secondary" : "primary"}
        >
          {props.result ? "Erneut berechnen" : "Mehrfachlauf starten"}
        </Button>
      )}
      {props.result ? (
        <Button onClick={props.onExport}>
          <Download aria-hidden="true" /> ZIP exportieren
        </Button>
      ) : null}
      <Button onClick={props.onClose} variant={props.result ? "primary" : "secondary"}>
        Schließen
      </Button>
    </>
  );
  return (
    <ModalDialog
      description="Dasselbe Szenario wird lokal mit fortlaufenden Seeds berechnet. Die Konfiguration bleibt unverändert."
      footer={footer}
      onClose={props.onClose}
      open={props.open}
      size="wide"
      title="Mehrfachlauf vergleichen"
    >
      <div className="sim-batch-parameters">
        <label>
          Anzahl Läufe
          <input
            aria-describedby="sim-batch-count-hint"
            max="100"
            min="5"
            onChange={(event) => setRunCount(event.currentTarget.valueAsNumber)}
            type="number"
            value={runCount}
          />
        </label>
        <label>
          Start-Seed
          <input aria-label="Start-Seed" readOnly value={props.seedStart} />
        </label>
        <small id="sim-batch-count-hint">5–100 Läufe · Seeds werden fortlaufend vergeben.</small>
      </div>
      {!countValid ? (
        <p className="sim-editor-errors" role="alert">
          Bitte 5 bis 100 Läufe wählen.
        </p>
      ) : null}
      {props.running ? (
        <section aria-live="polite" className="sim-comparison-progress">
          <strong>
            Lauf {props.progress.completed} von {props.progress.total}
          </strong>
          <progress max={Math.max(1, props.progress.total)} value={props.progress.completed} />
          <p>Berechnung im separaten lokalen Browser-Worker.</p>
        </section>
      ) : null}
      {props.error ? (
        <p className="sim-editor-errors" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.result ? (
        <>
          <div aria-label="Mehrfachlauf-Auswertung" className="sim-batch-tabs" role="tablist">
            <button
              aria-controls="sim-batch-operation"
              aria-selected={tab === "operation"}
              id="sim-batch-operation-tab"
              onClick={() => setTab("operation")}
              role="tab"
              type="button"
            >
              Betrieb
            </button>
            <button
              aria-controls="sim-batch-forecast"
              aria-selected={tab === "forecast"}
              id="sim-batch-forecast-tab"
              onClick={() => setTab("forecast")}
              role="tab"
              type="button"
            >
              Prognose
            </button>
          </div>
          {tab === "operation" ? (
            <section
              aria-labelledby="sim-batch-operation-tab"
              id="sim-batch-operation"
              role="tabpanel"
            >
              <ResultCards ids={operationIds} result={props.result} />
              <DistributionPanel
                metricId={operationMetric}
                onChange={setOperationMetric}
                options={[
                  "passengersPerHour",
                  "p90PassengerWaitMinutes",
                  "overtimeMinutes",
                  "aircraftUtilizationPercent",
                ]}
                result={props.result}
                title="Seed-Verteilung Betrieb"
              />
              <ExtremeNotes result={props.result} />
              <h3>Einzelläufe</h3>
              <RunTable ids={operationIds} result={props.result} />
            </section>
          ) : (
            <section
              aria-labelledby="sim-batch-forecast-tab"
              id="sim-batch-forecast"
              role="tabpanel"
            >
              <ResultCards
                ids={[...accuracyIds, ...stabilityIds.slice(0, 2)]}
                result={props.result}
              />
              <div className="sim-batch-panel-grid">
                <DistributionPanel
                  metricId={accuracyMetric}
                  onChange={setAccuracyMetric}
                  options={accuracyIds}
                  result={props.result}
                  title="Genauigkeit nach Seed"
                />
                <DistributionPanel
                  metricId={stabilityMetric}
                  onChange={setStabilityMetric}
                  options={stabilityIds}
                  result={props.result}
                  title="Stabilität nach Seed"
                />
              </div>
              <h3>Einzelläufe</h3>
              <RunTable ids={[...accuracyIds, ...stabilityIds]} result={props.result} />
            </section>
          )}
        </>
      ) : null}
    </ModalDialog>
  );
}
