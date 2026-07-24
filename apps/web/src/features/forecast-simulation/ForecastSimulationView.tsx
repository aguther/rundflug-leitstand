import {
  AlertTriangle,
  ArrowLeft,
  Clock3,
  Coffee,
  Download,
  Fuel,
  Monitor,
  Pause,
  Plane,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Square,
  Upload,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ModalDialog } from "../../design-system/components";
import { ThemeToggle } from "../../design-system/ThemeToggle";
import type { BatchComparisonResult } from "./comparison";
import { CalibrationCsvError, calibrateFromCsv } from "./csv-calibration";
import { calculateSimulationMetrics, runSimulation } from "./engine";
import { ForecastTimeline } from "./ForecastTimeline";
import {
  forecastUncertaintyLabel,
  type ManualIncident,
  SIMULATION_PRESET_LABELS,
  type SimulationConfig,
  type SimulationForecastSnapshot,
  type SimulationPresetId,
  type SimulationRotation,
  simulationConfigForPreset,
  validateSimulationConfig,
} from "./model";
import { ScenarioEditor } from "./ScenarioEditor";
import { SimulationFidsPopout, type SimulationFidsPopoutHandle } from "./SimulationFidsPopout";
import { SimulationHistoryDialog } from "./SimulationHistoryDialog";
import "./forecast-simulation.css";

const MINUTE_MS = 60_000;
const TICK_MS = 30_000;
const SPEEDS = [1, 10, 60, 300] as const;
const HOSTED_SIMULATOR = import.meta.env.MODE !== "simulator";

function createComparisonWorker(): Worker {
  return new Worker(new URL("./comparison-worker.ts", import.meta.url), {
    type: "module",
  });
}

const timeFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Berlin",
});

function formatTime(value: number | string): string {
  return timeFormatter.format(new Date(value));
}

function metric(value: number | null, unit = ""): string {
  if (value === null) return "–";
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value)}${unit}`;
}

function milestoneVisible(value: string | null, nowMs: number): string | null {
  return value && Date.parse(value) <= nowMs ? value : null;
}

function rotationsAt(
  rotations: readonly SimulationRotation[],
  nowMs: number,
): SimulationRotation[] {
  return rotations.map((rotation) => ({
    ...rotation,
    precalledAt: milestoneVisible(rotation.precalledAt, nowMs),
    calledAt: milestoneVisible(rotation.calledAt, nowMs),
    departedAt: milestoneVisible(rotation.departedAt, nowMs),
    landedAt: milestoneVisible(rotation.landedAt, nowMs),
    completedAt: milestoneVisible(rotation.completedAt, nowMs),
  }));
}

function latestSnapshotBefore(
  snapshots: readonly SimulationForecastSnapshot[],
  rotationId: string,
  before: string,
  status: SimulationForecastSnapshot["status"],
) {
  return snapshots
    .filter(
      (snapshot) =>
        snapshot.rotationId === rotationId &&
        snapshot.status === status &&
        Date.parse(snapshot.capturedAt) < Date.parse(before),
    )
    .at(-1);
}

function ErrorChart({
  rotations,
  snapshots,
}: {
  rotations: readonly SimulationRotation[];
  snapshots: readonly SimulationForecastSnapshot[];
}) {
  const points = rotations.flatMap((rotation) => {
    if (!rotation.calledAt) return [];
    const snapshot = latestSnapshotBefore(snapshots, rotation.id, rotation.calledAt, "DRAFT");
    if (!snapshot) return [];
    return [
      {
        at: Date.parse(rotation.calledAt),
        error:
          (Date.parse(snapshot.predictedBoardingAt) - Date.parse(rotation.calledAt)) / MINUTE_MS,
      },
    ];
  });
  if (points.length < 2) {
    return (
      <div className="sim-chart-empty">Noch nicht genügend abgeschlossene Prognosevergleiche.</div>
    );
  }
  const width = 720;
  const height = 170;
  const padding = 26;
  const minAt = Math.min(...points.map((point) => point.at));
  const maxAt = Math.max(...points.map((point) => point.at));
  const maxError = Math.max(10, ...points.map((point) => Math.abs(point.error)));
  const coordinates = points.map((point) => {
    const x = padding + ((point.at - minAt) / Math.max(1, maxAt - minAt)) * (width - padding * 2);
    const y = height / 2 - (point.error / maxError) * (height / 2 - padding);
    return `${x},${y}`;
  });
  return (
    <svg
      aria-label="Verlauf des Boarding-Prognosefehlers"
      className="sim-error-chart"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <line
        className="sim-chart-axis"
        x1={padding}
        x2={width - padding}
        y1={height / 2}
        y2={height / 2}
      />
      {[0.25, 0.75].map((position) => (
        <line
          className="sim-chart-grid"
          key={position}
          x1={padding}
          x2={width - padding}
          y1={height * position}
          y2={height * position}
        />
      ))}
      <polyline className="sim-chart-line" fill="none" points={coordinates.join(" ")} />
      <text x={2} y={height / 2 - 5}>
        0
      </text>
      <text x={padding} y={height - 4}>
        {formatTime(minAt)}
      </text>
      <text textAnchor="end" x={width - padding} y={height - 4}>
        {formatTime(maxAt)}
      </text>
    </svg>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="sim-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
      <footer>Synthetischer Lauf</footer>
    </article>
  );
}

function safeExport(
  result: ReturnType<typeof runSimulation>,
  manualIncidents: readonly ManualIncident[],
  comparison: BatchComparisonResult | null,
) {
  return {
    schema: "rundflug-forecast-simulation/v4",
    scenario: result.config,
    seed: result.config.seed,
    adminParameters: result.config.adminParameters,
    realityModel: result.config.realityModel,
    forecastTuning: result.config.forecastTuning,
    manualIncidents,
    syntheticEventLedger: result.events,
    forecastSnapshots: result.snapshots,
    aircraft: result.aircraft,
    rotations: result.rotations,
    metrics: result.metrics,
    batchComparison: comparison,
  };
}

export function ForecastSimulationView() {
  const initialConfig = useMemo(() => simulationConfigForPreset("NORMAL"), []);
  const [config, setConfig] = useState<SimulationConfig>(initialConfig);
  const [manualIncidents, setManualIncidents] = useState<ManualIncident[]>([]);
  const [result, setResult] = useState(() => runSimulation(initialConfig));
  const [currentMs, setCurrentMs] = useState(() => Date.parse(initialConfig.startAt));
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(10);
  const [running, setRunning] = useState(false);
  const [selectedRotationId, setSelectedRotationId] = useState<string | null>(null);
  const [selectedAircraftId, setSelectedAircraftId] = useState("aircraft-1");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorConfig, setEditorConfig] = useState<SimulationConfig>(() =>
    structuredClone(initialConfig),
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<BatchComparisonResult | null>(null);
  const [comparisonProgress, setComparisonProgress] = useState({ completed: 0, total: 0 });
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonRunning, setComparisonRunning] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [fidsWindowError, setFidsWindowError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const comparisonWorkerRef = useRef<Worker | null>(null);
  const fidsPopoutRef = useRef<SimulationFidsPopoutHandle>(null);
  const editorErrors = validateSimulationConfig(editorConfig);
  const simulationEnd = Date.parse(config.endAt);

  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - previous;
      previous = now;
      setCurrentMs((value) => {
        const next = Math.min(simulationEnd, value + elapsed * speed);
        if (next >= simulationEnd) setRunning(false);
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [running, simulationEnd, speed]);

  useEffect(() => {
    const worker = createComparisonWorker();
    comparisonWorkerRef.current = worker;
    return () => {
      worker.terminate();
      if (comparisonWorkerRef.current === worker) comparisonWorkerRef.current = null;
    };
  }, []);

  const restart = (nextConfig = config, incidents: readonly ManualIncident[] = []) => {
    const nextResult = runSimulation(nextConfig, incidents);
    setConfig(structuredClone(nextConfig));
    setManualIncidents([...incidents]);
    setResult(nextResult);
    setCurrentMs(Date.parse(nextConfig.startAt));
    setRunning(false);
    setSelectedRotationId(null);
    setSelectedAircraftId("aircraft-1");
  };

  const applyPreset = (preset: SimulationPresetId) => restart(simulationConfigForPreset(preset));
  const applyQuickConfig = (nextConfig: SimulationConfig) => {
    if (validateSimulationConfig(nextConfig).length === 0) restart(nextConfig);
  };
  const visibleAt = Math.floor(currentMs / TICK_MS) * TICK_MS;
  const visibleSnapshots = useMemo(
    () => result.snapshots.filter((snapshot) => Date.parse(snapshot.capturedAt) <= visibleAt),
    [result.snapshots, visibleAt],
  );
  const visibleRotations = useMemo(
    () => rotationsAt(result.rotations, visibleAt),
    [result.rotations, visibleAt],
  );
  const visibleEvents = useMemo(
    () => result.events.filter((event) => Date.parse(event.occurredAt) <= visibleAt),
    [result.events, visibleAt],
  );
  const visibleMetrics = useMemo(
    () =>
      calculateSimulationMetrics({
        rotations: visibleRotations,
        snapshots: visibleSnapshots,
        events: visibleEvents,
      }),
    [visibleEvents, visibleRotations, visibleSnapshots],
  );
  const latestVisibleSnapshotByRotation = useMemo(() => {
    const snapshots = new Map<string, SimulationForecastSnapshot>();
    for (const snapshot of visibleSnapshots) snapshots.set(snapshot.rotationId, snapshot);
    return snapshots;
  }, [visibleSnapshots]);
  const selectedRotation = result.rotations.find((entry) => entry.id === selectedRotationId);
  const selectedSnapshot = selectedRotationId
    ? latestVisibleSnapshotByRotation.get(selectedRotationId)
    : undefined;

  const inject = (
    type: ManualIncident["type"],
    options: { dayOutage?: boolean; durationMinutes: number },
  ) => {
    const incident: ManualIncident = {
      id: `manual-${String(manualIncidents.length + 1).padStart(3, "0")}`,
      type,
      at: new Date(visibleAt).toISOString(),
      aircraftId: type === "EVENT_INTERRUPTION" ? null : selectedAircraftId,
      durationMinutes: options.durationMinutes,
      dayOutage: options.dayOutage ?? false,
    };
    const nextIncidents = [...manualIncidents, incident];
    setManualIncidents(nextIncidents);
    setResult(runSimulation(config, nextIncidents));
  };

  const handleCsv = async (file: File | undefined) => {
    if (!file) return;
    setImportingCsv(true);
    try {
      const calibration = calibrateFromCsv(await file.text(), config.realityModel.phases.buffer);
      const nextConfig = {
        ...config,
        realityModel: {
          ...config.realityModel,
          phases: calibration.suggestedPhases,
        },
      };
      restart(nextConfig);
      setImportMessage(
        `${calibration.validRows} Umläufe kalibriert, ${calibration.excludedRows} ausgeschlossen. Puffer blieb unverändert.`,
      );
    } catch (error) {
      setImportMessage(
        error instanceof CalibrationCsvError
          ? error.message
          : "Die Datei konnte nicht gelesen werden.",
      );
    } finally {
      setImportingCsv(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const exportResult = () => {
    const blob = new Blob(
      [JSON.stringify(safeExport(result, manualIncidents, comparisonResult), null, 2)],
      {
        type: "application/json;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `prognose-simulation-${config.seed}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const cancelComparison = () => {
    comparisonWorkerRef.current?.terminate();
    comparisonWorkerRef.current = null;
    setComparisonRunning(false);
  };

  const startComparison = () => {
    if (comparisonRunning) cancelComparison();
    setComparisonOpen(true);
    setComparisonResult(null);
    setComparisonError(null);
    setComparisonProgress({ completed: 0, total: config.forecastTuning.comparisonRuns });
    setComparisonRunning(true);
    const worker = comparisonWorkerRef.current ?? createComparisonWorker();
    comparisonWorkerRef.current = worker;
    worker.onmessage = (
      event: MessageEvent<
        | { type: "progress"; completedRuns: number; totalRuns: number }
        | { type: "result"; result: BatchComparisonResult }
        | { type: "error"; message: string }
      >,
    ) => {
      if (event.data.type === "progress") {
        setComparisonProgress({
          completed: event.data.completedRuns,
          total: event.data.totalRuns,
        });
        return;
      }
      if (event.data.type === "result") {
        setComparisonResult(event.data.result);
      } else {
        setComparisonError(event.data.message);
        worker.terminate();
        comparisonWorkerRef.current = null;
      }
      setComparisonRunning(false);
    };
    worker.onerror = () => {
      setComparisonError("Der lokale A/B-Vergleich ist fehlgeschlagen.");
      worker.terminate();
      comparisonWorkerRef.current = null;
      setComparisonRunning(false);
    };
    worker.postMessage({
      config: structuredClone(config),
      manualIncidents: structuredClone(manualIncidents),
    });
  };

  return (
    <div className="forecast-simulator">
      <header className="sim-app-header">
        <div className="sim-brand">
          <Plane aria-hidden="true" />
          <strong>Rundflug-Leitstand</strong>
        </div>
        <div className="sim-view-name">Prognose-Simulation</div>
        <div className="sim-safety-notice">
          <AlertTriangle aria-hidden="true" />
          Nur Simulation – keine Betriebsdaten
        </div>
        <Button className="sim-fids-button" onClick={() => fidsPopoutRef.current?.open()}>
          <Monitor aria-hidden="true" />
          FIDS öffnen
        </Button>
        <div className="sim-run-label">
          <Clock3 aria-hidden="true" />
          Synthetischer Lauf
        </div>
        {HOSTED_SIMULATOR ? (
          <a className="sim-admin-return" href="/admin?area=evaluation">
            <ArrowLeft aria-hidden="true" />
            Administration
          </a>
        ) : null}
        <ThemeToggle />
      </header>
      {fidsWindowError ? (
        <p className="sim-fids-window-error" role="alert">
          {fidsWindowError}
        </p>
      ) : null}

      <main className="sim-layout">
        <aside className="sim-sidebar">
          <section>
            <label htmlFor="sim-preset">Szenario</label>
            <select
              id="sim-preset"
              onChange={(event) => applyPreset(event.currentTarget.value as SimulationPresetId)}
              value={config.preset}
            >
              {(Object.keys(SIMULATION_PRESET_LABELS) as SimulationPresetId[]).map((preset) => (
                <option key={preset} value={preset}>
                  {SIMULATION_PRESET_LABELS[preset]}
                </option>
              ))}
            </select>
          </section>
          <section>
            <span>Flugzeuge</span>
            <div className="sim-stepper">
              <output>{config.adminParameters.aircraftCount}</output>
              <button
                aria-label="Ein Flugzeug entfernen"
                disabled={config.adminParameters.aircraftCount <= 1}
                onClick={() =>
                  applyQuickConfig({
                    ...config,
                    adminParameters: {
                      ...config.adminParameters,
                      aircraftCount: config.adminParameters.aircraftCount - 1,
                    },
                  })
                }
                type="button"
              >
                −
              </button>
              <button
                aria-label="Ein Flugzeug hinzufügen"
                disabled={config.adminParameters.aircraftCount >= 12}
                onClick={() =>
                  applyQuickConfig({
                    ...config,
                    adminParameters: {
                      ...config.adminParameters,
                      aircraftCount: config.adminParameters.aircraftCount + 1,
                    },
                  })
                }
                type="button"
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
          </section>
          <section>
            <label htmlFor="sim-demand">Nachfrage</label>
            <div className="sim-input-unit">
              <input
                id="sim-demand"
                min={0}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(value))
                    applyQuickConfig({
                      ...config,
                      realityModel: { ...config.realityModel, demandPersonsPerHour: value },
                    });
                }}
                type="number"
                value={config.realityModel.demandPersonsPerHour}
              />
              <span>Pers./Std.</span>
            </div>
          </section>
          <section className="sim-model-summary">
            <span>Zeitmodell</span>
            <strong>4 Phasen</strong>
            <small>Boarding · Flug · Boden · Puffer</small>
          </section>
          <section className="sim-model-summary">
            <span>Störmodell</span>
            <strong>4 Ereignisarten</strong>
            <small>Tanken · Pausen · Defekte</small>
          </section>
          <Button
            className="sim-full-button"
            onClick={() => {
              setEditorConfig(structuredClone(config));
              setEditorOpen(true);
            }}
          >
            <Settings2 aria-hidden="true" /> Szenario konfigurieren
          </Button>
          <section>
            <label htmlFor="sim-seed">Seed</label>
            <input
              id="sim-seed"
              min={1}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isInteger(value)) applyQuickConfig({ ...config, seed: value });
              }}
              type="number"
              value={config.seed}
            />
          </section>
          <input
            accept=".csv,text/csv"
            className="visually-hidden"
            onChange={(event) => void handleCsv(event.currentTarget.files?.[0])}
            ref={fileInputRef}
            type="file"
          />
          <Button
            busy={importingCsv}
            className="sim-full-button"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden="true" /> CSV importieren
          </Button>
          <Button className="sim-full-button" onClick={() => restart(config)} variant="primary">
            <RotateCcw aria-hidden="true" /> Neu starten
          </Button>
          {importMessage ? (
            <p className="sim-import-message" role="status">
              {importMessage}
            </p>
          ) : null}
          <section className="sim-presets">
            <span>Szenario-Vorlagen</span>
            {(Object.keys(SIMULATION_PRESET_LABELS) as SimulationPresetId[]).map((preset) => (
              <button
                aria-current={config.preset === preset ? "true" : undefined}
                key={preset}
                onClick={() => applyPreset(preset)}
                type="button"
              >
                {SIMULATION_PRESET_LABELS[preset]}
              </button>
            ))}
          </section>
          <p className="sim-sidebar-note">Alle Daten sind synthetisch und nur für lokale Tests.</p>
        </aside>

        <div className="sim-workspace">
          <section className="sim-controls">
            <div className="sim-playback">
              <Button onClick={() => setRunning(true)} variant="primary">
                <Play aria-hidden="true" /> Start
              </Button>
              <Button onClick={() => setRunning(false)}>
                <Pause aria-hidden="true" /> Pause
              </Button>
              <Button
                onClick={() =>
                  setCurrentMs((value) => Math.min(simulationEnd, value + 5 * MINUTE_MS))
                }
              >
                <Plus aria-hidden="true" /> +5 Min.
              </Button>
              <select
                aria-label="Simulationsgeschwindigkeit"
                onChange={(event) =>
                  setSpeed(Number(event.currentTarget.value) as (typeof SPEEDS)[number])
                }
                value={speed}
              >
                {SPEEDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}×
                  </option>
                ))}
              </select>
            </div>
            <div className="sim-clock">
              <span>Virtuelle Zeit</span>
              <strong>{formatTime(currentMs)}</strong>
            </div>
            <div className="sim-injector">
              <div>
                <label htmlFor="sim-aircraft-select">Ereignis für</label>
                <select
                  id="sim-aircraft-select"
                  onChange={(event) => setSelectedAircraftId(event.currentTarget.value)}
                  value={selectedAircraftId}
                >
                  {result.aircraft.map((aircraft) => (
                    <option key={aircraft.id} value={aircraft.id}>
                      {aircraft.registration}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() =>
                  inject("UNPLANNED_PAUSE", {
                    durationMinutes: config.realityModel.incidents.unplannedPause.duration.typical,
                  })
                }
              >
                <Coffee aria-hidden="true" /> Pause
              </Button>
              <Button
                onClick={() =>
                  inject("REFUELING", {
                    durationMinutes: config.realityModel.incidents.refueling.duration.typical,
                  })
                }
              >
                <Fuel aria-hidden="true" /> Tanken
              </Button>
              <Button
                onClick={() =>
                  inject("TECHNICAL_DEFECT", {
                    durationMinutes: config.realityModel.incidents.technicalDefect.duration.typical,
                  })
                }
              >
                <Wrench aria-hidden="true" /> Defekt
              </Button>
              <Button
                onClick={() => inject("TECHNICAL_DEFECT", { dayOutage: true, durationMinutes: 0 })}
              >
                <Plane aria-hidden="true" /> Flugzeugausfall
              </Button>
              <Button onClick={() => inject("EVENT_INTERRUPTION", { durationMinutes: 30 })}>
                <Square aria-hidden="true" /> Betrieb unterbrechen
              </Button>
            </div>
          </section>

          <ForecastTimeline
            currentMs={currentMs}
            onSelectRotation={(rotationId) => {
              setSelectedRotationId(rotationId);
              const rotation = result.rotations.find((entry) => entry.id === rotationId);
              if (rotation?.aircraftId) setSelectedAircraftId(rotation.aircraftId);
            }}
            onShowHistory={() => setHistoryOpen(true)}
            result={result}
            selectedRotationId={selectedRotationId}
          />

          <section className="sim-analysis">
            <div className="sim-chart-panel">
              <header>
                <strong>Prognosefehler über den Tagesverlauf</strong>
                <span>Boarding · Fehler in Minuten</span>
              </header>
              <ErrorChart rotations={visibleRotations} snapshots={visibleSnapshots} />
            </div>
            <div className="sim-metrics-grid">
              <MetricCard
                hint={`${visibleMetrics.boarding.samples} Vergleiche`}
                label="Zeitfenster getroffen"
                value={metric(visibleMetrics.boarding.windowCoveragePercent, " %")}
              />
              <MetricCard
                hint="Median absolut"
                label="Medianfehler Boarding"
                value={metric(visibleMetrics.boarding.medianAbsoluteErrorMinutes, " Min.")}
              />
              <MetricCard
                hint="90. Perzentil"
                label="P90 Boarding"
                value={metric(visibleMetrics.boarding.p90AbsoluteErrorMinutes, " Min.")}
              />
              <MetricCard
                hint="Mittelwert"
                label="Ø Fensterbreite"
                value={metric(visibleMetrics.boarding.averageWindowWidthMinutes, " Min.")}
              />
            </div>
          </section>
          <div className="sim-export-row">
            <Button onClick={() => setDetailsOpen(true)}>Kennzahlen im Detail</Button>
            <Button onClick={() => setHistoryOpen(true)}>Lauf auswerten</Button>
            <Button onClick={startComparison}>Baseline und Kandidat vergleichen</Button>
            <Button onClick={exportResult}>
              <Download aria-hidden="true" /> Ergebnis exportieren
            </Button>
          </div>
        </div>
      </main>
      <footer className="sim-app-footer">
        Hinweis: Alle Zeiten sind virtuell und rein synthetisch. Ergebnisse dienen nur der Bewertung
        der Prognosequalität im lokalen Test.
      </footer>

      <ScenarioEditor
        config={editorConfig}
        errors={editorErrors}
        onApply={() => {
          restart(editorConfig);
          setEditorOpen(false);
        }}
        onChange={setEditorConfig}
        onClose={() => setEditorOpen(false)}
        open={editorOpen}
      />

      <SimulationFidsPopout
        clockMs={currentMs}
        onWindowError={setFidsWindowError}
        ref={fidsPopoutRef}
        result={result}
        visibleAt={visibleAt}
      />

      <SimulationHistoryDialog
        initialAircraftId={selectedAircraftId}
        initialRotationId={selectedRotationId}
        onClose={() => setHistoryOpen(false)}
        onExport={exportResult}
        open={historyOpen}
        result={result}
        visibleAt={visibleAt}
      />

      <ModalDialog
        description={
          selectedRotation ? `Fluggruppe ${selectedRotation.communicationNumber}` : undefined
        }
        footer={
          <Button onClick={() => setDetailsOpen(false)} variant="primary">
            Schließen
          </Button>
        }
        onClose={() => setDetailsOpen(false)}
        open={detailsOpen}
        size="wide"
        title="Prognosegüte im Detail"
      >
        <div className="sim-detail-grid">
          {[
            ["Boarding", visibleMetrics.boarding],
            ["Start", visibleMetrics.departure],
            ["Landung", visibleMetrics.landing],
            ["Abschluss", visibleMetrics.completion],
          ].map(([label, summary]) => {
            const values = summary as typeof visibleMetrics.departure;
            return (
              <article key={label as string}>
                <h3>{label as string}</h3>
                <dl>
                  <div>
                    <dt>MAE</dt>
                    <dd>{metric(values.maeMinutes, " Min.")}</dd>
                  </div>
                  <div>
                    <dt>Median</dt>
                    <dd>{metric(values.medianAbsoluteErrorMinutes, " Min.")}</dd>
                  </div>
                  <div>
                    <dt>P90</dt>
                    <dd>{metric(values.p90AbsoluteErrorMinutes, " Min.")}</dd>
                  </div>
                  <div>
                    <dt>Bias</dt>
                    <dd>{metric(values.biasMinutes, " Min.")}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
        {selectedSnapshot ? (
          <section className="sim-raw-forecast" aria-label="Diagnostischer Prognose-Snapshot">
            <header>
              <div>
                <h3>Aktueller Prognose-Snapshot</h3>
                <p>{formatTime(selectedSnapshot.capturedAt)} · nur interne Diagnose</p>
              </div>
              <strong data-quality={selectedSnapshot.quality}>
                {selectedSnapshot.quality === "STABLE"
                  ? "Stabil"
                  : selectedSnapshot.quality === "CHANGING"
                    ? "Veränderlich"
                    : "Unsicher"}
              </strong>
            </header>
            <dl>
              <div>
                <dt>Rohwert Boarding</dt>
                <dd>{formatTime(selectedSnapshot.predictedBoardingAt)}</dd>
              </div>
              <div>
                <dt>Rohwert Start</dt>
                <dd>{formatTime(selectedSnapshot.predictedDepartureAt)}</dd>
              </div>
              <div>
                <dt>Rohwert Landung</dt>
                <dd>{formatTime(selectedSnapshot.predictedLandingAt)}</dd>
              </div>
              <div>
                <dt>Rohwert Abschluss</dt>
                <dd>{formatTime(selectedSnapshot.predictedCompletionAt)}</dd>
              </div>
              <div>
                <dt>Stichprobe</dt>
                <dd>n={selectedSnapshot.sampleSize}</dd>
              </div>
              <div>
                <dt>Lernwertalter</dt>
                <dd>{metric(selectedSnapshot.dataAgeMinutes, " Min.")}</dd>
              </div>
              <div>
                <dt>Aktive Kapazität</dt>
                <dd>{selectedSnapshot.activeCapacity}</dd>
              </div>
              <div>
                <dt>Unterdrückungsgrund</dt>
                <dd>
                  {selectedSnapshot.uncertaintyReasons.length === 0
                    ? "keiner"
                    : forecastUncertaintyLabel(selectedSnapshot.uncertaintyReasons)}
                </dd>
              </div>
            </dl>
            {selectedSnapshot.quality === "UNCERTAIN" ? (
              <p className="sim-raw-forecast-warning">
                Countdown unterdrückt · Rohwerte nicht als operative Zeit freigegeben.
              </p>
            ) : null}
          </section>
        ) : null}
        <div className="sim-detail-diagnostics">
          <article>
            <h3>Horizonte Boarding</h3>
            <p>60 Min.: {metric(visibleMetrics.horizons["60"].maeMinutes, " Min. MAE")}</p>
            <p>30 Min.: {metric(visibleMetrics.horizons["30"].maeMinutes, " Min. MAE")}</p>
            <p>15 Min.: {metric(visibleMetrics.horizons["15"].maeMinutes, " Min. MAE")}</p>
          </article>
          <article>
            <h3>Diagnostik</h3>
            <p>Reaktionszeit max.: {metric(visibleMetrics.maximumEventReactionSeconds, " Sek.")}</p>
            <p>Countdowns bei UNCERTAIN: {visibleMetrics.uncertainCountdownViolations}</p>
            <p>
              GO TO GATE: {visibleMetrics.precall.precalledGroups}/
              {visibleMetrics.precall.eligibleGroups} Gruppen ·{" "}
              {metric(visibleMetrics.precall.coveragePercent, " %")}
            </p>
            <p>
              GO TO GATE → Boarding: Median{" "}
              {metric(visibleMetrics.precall.medianGateWaitMinutes, " Min.")} · P90{" "}
              {metric(visibleMetrics.precall.p90GateWaitMinutes, " Min.")}
            </p>
            <p>
              Gleicher Tick: {visibleMetrics.precall.sameTickCount} · bei UNCERTAIN:{" "}
              {visibleMetrics.precall.uncertainPrecallCount}
            </p>
            <p>
              Qualität: {visibleMetrics.qualities.STABLE} stabil ·{" "}
              {visibleMetrics.qualities.CHANGING} veränderlich ·{" "}
              {visibleMetrics.qualities.UNCERTAIN} unsicher
            </p>
            <p className="sim-diagnostic-reasons">
              Unterdrückungsgründe: Betrieb{" "}
              {visibleMetrics.uncertaintyReasons.OPERATION_INTERRUPTED}
              {" · "}Notfall {visibleMetrics.uncertaintyReasons.EMERGENCY_MODE}
              {" · "}Ressourcengruppe {visibleMetrics.uncertaintyReasons.RESOURCE_GROUP_INACTIVE}
              {" · "}Kapazität {visibleMetrics.uncertaintyReasons.NO_ACTIVE_CAPACITY}
              {" · "}veraltet {visibleMetrics.uncertaintyReasons.STALE_PREDICTION}
            </p>
          </article>
        </div>
      </ModalDialog>

      <ModalDialog
        description="Produktions-Baseline und lokaler Kandidat verwenden dieselben Seeds und Szenarien."
        footer={
          <>
            {comparisonRunning ? (
              <Button onClick={cancelComparison}>Vergleich abbrechen</Button>
            ) : (
              <Button onClick={startComparison}>Erneut ausführen</Button>
            )}
            <Button
              onClick={() => {
                cancelComparison();
                setComparisonOpen(false);
              }}
              variant="primary"
            >
              Schließen
            </Button>
          </>
        }
        onClose={() => {
          cancelComparison();
          setComparisonOpen(false);
        }}
        open={comparisonOpen}
        size="wide"
        title="A/B-Prognosevergleich"
      >
        {comparisonRunning ? (
          <section className="sim-comparison-progress" aria-live="polite">
            <strong>
              Seed-Lauf {comparisonProgress.completed} von {comparisonProgress.total}
            </strong>
            <progress
              max={Math.max(1, comparisonProgress.total)}
              value={comparisonProgress.completed}
            />
            <p>Die Berechnung läuft ausschließlich lokal in einem Browser-Worker.</p>
          </section>
        ) : null}
        {comparisonError ? (
          <p className="sim-editor-errors" role="alert">
            {comparisonError}
          </p>
        ) : null}
        {comparisonResult ? (
          <>
            <p className="sim-comparison-summary">
              Median je Kennzahl über {comparisonResult.runCount} Läufe ab Seed{" "}
              {comparisonResult.seedStart}. Ein positives Delta bedeutet Kandidat minus Baseline.
            </p>
            <div className="sim-comparison-table-wrap">
              <table className="sim-comparison-table">
                <thead>
                  <tr>
                    <th>Kategorie</th>
                    <th>Kennzahl</th>
                    <th>Baseline</th>
                    <th>Kandidat</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonResult.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.category}</td>
                      <th scope="row">{row.label}</th>
                      <td>{metric(row.baseline, row.unit ? ` ${row.unit}` : "")}</td>
                      <td>{metric(row.candidate, row.unit ? ` ${row.unit}` : "")}</td>
                      <td>
                        {row.delta === null
                          ? "–"
                          : `${row.delta > 0 ? "+" : ""}${metric(
                              row.delta,
                              row.unit ? ` ${row.unit}` : "",
                            )}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sim-editor-hint">
              Die Tabelle spricht keine automatische Empfehlung aus: Fehler, Fensterbreite, Qualität
              und Gate-Wartezeit sind getrennte Zielgrößen.
            </p>
          </>
        ) : null}
      </ModalDialog>
    </div>
  );
}

export default ForecastSimulationView;
