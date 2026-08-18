import {
  AlertTriangle,
  ArrowLeft,
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
import { useEffect, useMemo, useState } from "react";
import { Button, ModalDialog } from "../../design-system/components";
import { ThemeToggle } from "../../design-system/ThemeToggle";
import { TimeDiagramZoomControls } from "../../shared/TimeDiagramZoomControls";
import {
  timeDiagramAxisTickValues,
  useTimeDiagramViewport,
} from "../../shared/time-diagram-viewport";
import { calculateSimulationMetrics, runSimulation } from "./engine";
import { ForecastTimeline } from "./ForecastTimeline";
import {
  calculateSimulationDemandSummary,
  forecastUncertaintyLabel,
  type ManualIncident,
  type SimulationConfig,
  type SimulationForecastSnapshot,
  type SimulationRotation,
  simulationConfigForPreset,
  validateSimulationConfig,
} from "./model";
import { ScenarioEditor } from "./ScenarioEditor";
import { SimulationComparisonDialog } from "./SimulationComparisonDialog";
import { SimulationImportDialog, type SimulationImportResult } from "./SimulationFoundationDialog";
import { SimulationHistoryDialog } from "./SimulationHistoryDialog";
import {
  type BoardingErrorTrendBasis,
  buildBoardingErrorTrendPoints,
} from "./simulation-error-trend";
import { createSimulationExport } from "./simulation-export";
import { useSimulationFidsPublisher } from "./simulation-fids-channel";
import {
  createSimulationScenarioTemplate,
  simulationScenarioTemplateFileName,
} from "./simulation-scenario-template";
import { useSimulationComparison } from "./useSimulationComparison";
import { useSimulationPlayback } from "./useSimulationPlayback";
import "../../design-system/switch-field.css";
import "./forecast-simulation.css";

const MINUTE_MS = 60_000;
const TICK_MS = 30_000;
const SPEEDS = [1, 10, 60, 300] as const;
const HOSTED_SIMULATOR = import.meta.env.MODE !== "simulator";

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

function forecastQualityLabel(quality: SimulationForecastSnapshot["quality"]): string {
  switch (quality) {
    case "STABLE":
      return "Stabil";
    case "CHANGING":
      return "Veränderlich";
    default:
      return "Unsicher";
  }
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

function ErrorChart({
  ariaLabel,
  basis,
  resetKey,
  rotations,
  snapshotLabel,
  snapshots,
}: Readonly<{
  ariaLabel: string;
  basis: BoardingErrorTrendBasis;
  resetKey: unknown;
  rotations: readonly SimulationRotation[];
  snapshotLabel: string;
  snapshots: readonly SimulationForecastSnapshot[];
}>) {
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const points = useMemo(
    () => buildBoardingErrorTrendPoints(rotations, snapshots, basis),
    [basis, rotations, snapshots],
  );
  const minimumTime = points.length > 0 ? Math.min(...points.map((point) => point.at)) : 0;
  const maximumTime = points.length > 0 ? Math.max(...points.map((point) => point.at)) : 1;
  const {
    changeZoom,
    dragging,
    onClickCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    reset,
    setViewportRef,
    viewportWidth,
    visibleDomain,
    zoom,
    zoomLevels,
  } = useTimeDiagramViewport({
    domain: { from: minimumTime, until: maximumTime },
    insetRatios: { left: 54 / 720, right: 18 / 720 },
    resetKey,
  });
  if (points.length < 2) {
    return (
      <div className="sim-chart-empty">Noch nicht genügend abgeschlossene Prognosevergleiche.</div>
    );
  }
  const width = 720;
  const height = 170;
  const plotLeft = 54;
  const plotRight = 18;
  const plotTop = 14;
  const plotBottom = 28;
  const plotUntil = width - plotRight;
  const axisY = height - plotBottom;
  const zeroY = plotTop + (axisY - plotTop) / 2;
  const maxError = Math.ceil(Math.max(5, ...points.map((point) => Math.abs(point.error))) / 5) * 5;
  const visibleSpan = Math.max(1, visibleDomain.until - visibleDomain.from);
  const plotPixelWidth = Math.max(240, (viewportWidth || width) - plotLeft - plotRight);
  const endpointClearance = (visibleSpan * 56) / plotPixelWidth;
  const axisTicks = timeDiagramAxisTickValues({
    domain: visibleDomain,
    minimumLabelSpacing: 82,
    pixelWidth: plotPixelWidth,
  }).filter(
    (tick) =>
      tick - visibleDomain.from > endpointClearance &&
      visibleDomain.until - tick > endpointClearance,
  );
  const plottedPoints = points.map((point) => {
    const x = plotLeft + ((point.at - visibleDomain.from) / visibleSpan) * (plotUntil - plotLeft);
    const y = zeroY - (point.error / maxError) * ((axisY - plotTop) / 2);
    return { ...point, x, y };
  });
  const activePoint = activePointIndex === null ? null : plottedPoints[activePointIndex];
  const selectNearestPoint = (pointerX: number) => {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [index, point] of plottedPoints.entries()) {
      const distance = Math.abs(point.x - pointerX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    setActivePointIndex(nearestIndex);
  };
  return (
    <div className="sim-time-chart-stack">
      <TimeDiagramZoomControls
        onChange={changeZoom}
        onReset={reset}
        showInteractionHint={false}
        value={zoom}
        visibleSpanMs={visibleDomain.until - visibleDomain.from}
        zoomLevels={zoomLevels}
      />
      <div
        className={`sim-chart-interactive sim-error-chart-stage time-diagram-viewport${zoom > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
        onClickCapture={onClickCapture}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={setViewportRef}
      >
        <svg
          aria-label={ariaLabel}
          className="sim-error-chart"
          data-basis={basis.toLowerCase()}
          onPointerLeave={() => setActivePointIndex(null)}
          onPointerMove={(event) => {
            const matrix = event.currentTarget.getScreenCTM();
            if (!matrix) return;
            const pointer = event.currentTarget.createSVGPoint();
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            selectNearestPoint(pointer.matrixTransform(matrix.inverse()).x);
          }}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {[plotTop, zeroY, axisY].map((position) => (
            <line
              className={position === zeroY ? "sim-chart-axis" : "sim-chart-grid"}
              key={position}
              x1={plotLeft}
              x2={plotUntil}
              y1={position}
              y2={position}
            />
          ))}
          {[
            { label: `+${maxError} Min.`, y: plotTop },
            { label: "0", y: zeroY },
            { label: `−${maxError} Min.`, y: axisY },
          ].map((entry) => (
            <text
              className="sim-chart-axis-label"
              dominantBaseline="middle"
              key={entry.label}
              textAnchor="end"
              x={plotLeft - 8}
              y={entry.y}
            >
              {entry.label}
            </text>
          ))}
          {[visibleDomain.from, ...axisTicks, visibleDomain.until].map((tick, index, ticks) => (
            <g className="sim-chart-x-tick" key={tick}>
              <line
                x1={plotLeft + ((tick - visibleDomain.from) / visibleSpan) * (plotUntil - plotLeft)}
                x2={plotLeft + ((tick - visibleDomain.from) / visibleSpan) * (plotUntil - plotLeft)}
                y1={axisY}
                y2={axisY + 4}
              />
              <text
                textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}
                x={plotLeft + ((tick - visibleDomain.from) / visibleSpan) * (plotUntil - plotLeft)}
                y={height - 4}
              >
                {formatTime(tick)}
              </text>
            </g>
          ))}
          <polyline
            className="sim-chart-line"
            fill="none"
            points={plottedPoints.map((point) => `${point.x},${point.y}`).join(" ")}
          />
          {activePoint ? (
            <>
              <line
                className="sim-chart-cursor"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={plotTop}
                y2={axisY}
              />
              <circle
                className="sim-chart-active-point"
                cx={activePoint.x}
                cy={activePoint.y}
                r={4}
              />
            </>
          ) : null}
        </svg>
        {activePoint ? (
          <output
            className="sim-chart-tooltip"
            data-align={activePoint.x > width * 0.68 ? "right" : "center"}
            style={{ left: `${(activePoint.x / width) * 100}%` }}
          >
            <strong>Fluggruppe {activePoint.communicationNumber}</strong>
            <dl>
              <div>
                <dt>{snapshotLabel}</dt>
                <dd>{formatTime(activePoint.capturedAt)}</dd>
              </div>
              <div>
                <dt>Boarding-Prognose</dt>
                <dd>{formatTime(activePoint.predictedBoardingAt)}</dd>
              </div>
              <div>
                <dt>Boarding (Ist)</dt>
                <dd>{formatTime(activePoint.at)}</dd>
              </div>
              <div>
                <dt>Fehler</dt>
                <dd>
                  {activePoint.error > 0 ? "+" : ""}
                  {metric(activePoint.error, " Min.")}
                </dd>
              </div>
            </dl>
          </output>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: string; hint: string }>) {
  return (
    <article className="sim-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

export function ForecastSimulationView() {
  const initialConfig = useMemo(() => simulationConfigForPreset("NORMAL"), []);
  const [scenarioName, setScenarioName] = useState("Normalbetrieb");
  const [config, setConfig] = useState<SimulationConfig>(initialConfig);
  const [manualIncidents, setManualIncidents] = useState<ManualIncident[]>([]);
  const [result, setResult] = useState(() => runSimulation(initialConfig));
  const [currentMs, setCurrentMs] = useState(() =>
    Math.min(
      Date.parse(initialConfig.schedule.salesStartAt),
      Date.parse(initialConfig.schedule.operationsStartAt),
    ),
  );
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
  const [importOpen, setImportOpen] = useState(false);
  const comparison = useSimulationComparison();
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const editorErrors = validateSimulationConfig(editorConfig);
  const simulationEnd = Date.parse(result.runWindow.endAt);

  useEffect(() => {
    document.title = "Prognose-Simulation · Rundflug-Leitstand";
  }, []);

  useSimulationPlayback({
    endAt: simulationEnd,
    running,
    setCurrentMs,
    setRunning,
    speed,
  });

  const loadSimulation = (
    nextConfig: SimulationConfig,
    incidents: readonly ManualIncident[] = [],
  ) => {
    const nextResult = runSimulation(nextConfig, incidents);
    setConfig(structuredClone(nextConfig));
    setManualIncidents([...incidents]);
    setResult(nextResult);
    setCurrentMs(Date.parse(nextResult.runWindow.startAt));
    setRunning(false);
    setSelectedRotationId(null);
    setSelectedAircraftId(nextResult.aircraft[0]?.id ?? "");
  };

  const restart = (nextConfig = config, incidents: readonly ManualIncident[] = []) => {
    loadSimulation(nextConfig, incidents);
  };
  const visibleAt = Math.floor(currentMs / TICK_MS) * TICK_MS;
  const { fidsHref } = useSimulationFidsPublisher({
    result,
    clockMs: currentMs,
    running,
    speed,
    visibleAt,
  });
  const operationsAvailableNow =
    visibleAt >= Date.parse(config.schedule.operationsStartAt) &&
    visibleAt < Date.parse(config.schedule.operationsEndAt);
  const demandSummary = calculateSimulationDemandSummary(config);
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

  const exportScenario = () => {
    try {
      const template = createSimulationScenarioTemplate(scenarioName, config);
      const blob = new Blob([JSON.stringify(template, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = simulationScenarioTemplateFileName(template.name);
      anchor.click();
      URL.revokeObjectURL(url);
      setImportMessage(`${template.name} als Szenario-Konfiguration exportiert.`);
    } catch {
      setImportMessage("Das aktuelle Szenario konnte nicht exportiert werden.");
    }
  };

  const applyImport = (importResult: SimulationImportResult) => {
    loadSimulation(importResult.config);
    setImportOpen(false);
    if (importResult.kind === "CALIBRATION") {
      setImportMessage(
        `${importResult.validRows} Umläufe kalibriert, ${importResult.excludedRows} ausgeschlossen. Puffer blieb unverändert.`,
      );
      return;
    }
    setScenarioName(importResult.sourceName);
    setImportMessage(
      importResult.format === "rundflug-simulation-scenario"
        ? `${importResult.sourceName} als aktuelles Szenario geladen.`
        : `${importResult.sourceName} als aktuelles Szenario übernommen; keine Tickets, Queues oder Ist-Zustände importiert.`,
    );
  };

  const exportResult = () => {
    const blob = new Blob(
      [JSON.stringify(createSimulationExport(result, manualIncidents, comparison.result), null, 2)],
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

  const startComparison = () => comparison.start(config, manualIncidents);
  const closeComparison = () => {
    comparison.cancel();
    comparison.setOpen(false);
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
          Nur Simulation – keine Tickets oder Ist-Zustände
        </div>
        <a
          className="sim-fids-button ds-button ds-button--default ds-button--secondary"
          href={fidsHref}
          rel="noopener"
          target="_blank"
        >
          <Monitor aria-hidden="true" />
          FIDS in neuem Tab öffnen
        </a>
        {HOSTED_SIMULATOR ? (
          <a className="sim-admin-return" href="/admin?area=evaluation">
            <ArrowLeft aria-hidden="true" />
            Administration
          </a>
        ) : null}
        <ThemeToggle />
      </header>
      <main className="sim-layout">
        <aside className="sim-sidebar">
          <section className="sim-current-scenario" aria-labelledby="sim-current-scenario-title">
            <h2 id="sim-current-scenario-title">Aktuelles Szenario</h2>
            <strong>{scenarioName}</strong>
            <small>Nicht gespeichert</small>
          </section>
          <section className="sim-scenario-summary">
            <h2>Szenarioübersicht</h2>
            <dl>
              <div>
                <dt>Flugzeuge</dt>
                <dd>
                  <strong>
                    {config.operationalModel
                      ? config.operationalModel.aircraft.length
                      : config.adminParameters.aircraftCount}
                  </strong>
                </dd>
              </div>
              <div>
                <dt>Gruppen / Produkte</dt>
                <dd>
                  <strong>
                    {config.operationalModel
                      ? `${config.operationalModel.resourceGroups.length} / ${config.operationalModel.products.length}`
                      : "1 / 1"}
                  </strong>
                </dd>
              </div>
              <div>
                <dt>Nachfrage</dt>
                <dd>
                  <strong>Ø {metric(demandSummary.averagePersonsPerHour)}/h</strong>
                </dd>
              </div>
              <div>
                <dt>Modelle</dt>
                <dd>
                  <strong>4 Phasen · 4 Ereignisse</strong>
                </dd>
              </div>
              <div>
                <dt>Seed</dt>
                <dd>
                  <strong>{config.seed}</strong>
                </dd>
              </div>
            </dl>
          </section>
          <Button
            aria-label="Szenario konfigurieren"
            className="sim-full-button"
            onClick={() => {
              setEditorConfig(structuredClone(config));
              setEditorOpen(true);
            }}
          >
            <Settings2 aria-hidden="true" /> Konfigurieren
          </Button>
          <Button className="sim-full-button" onClick={() => setImportOpen(true)}>
            <Upload aria-hidden="true" /> Importieren …
          </Button>
          <Button className="sim-full-button" onClick={exportScenario}>
            <Download aria-hidden="true" /> Szenario exportieren
          </Button>
          <Button className="sim-full-button" onClick={() => restart(config)} variant="primary">
            <RotateCcw aria-hidden="true" /> Neu starten
          </Button>
          <nav aria-label="Simulationsauswertung" className="sim-sidebar-analysis-actions">
            <Button onClick={() => setDetailsOpen(true)}>Kennzahlen im Detail</Button>
            <Button onClick={() => setHistoryOpen(true)}>Lauf auswerten</Button>
            <Button onClick={startComparison}>Baseline und Kandidat vergleichen</Button>
            <Button onClick={exportResult}>
              <Download aria-hidden="true" /> Ergebnis exportieren
            </Button>
          </nav>
          {importMessage ? <output className="sim-import-message">{importMessage}</output> : null}
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
                disabled={!operationsAvailableNow}
                onClick={() =>
                  inject("UNPLANNED_PAUSE", {
                    durationMinutes: config.realityModel.incidents.unplannedPause.duration.typical,
                  })
                }
              >
                <Coffee aria-hidden="true" /> Pause
              </Button>
              <Button
                disabled={!operationsAvailableNow}
                onClick={() =>
                  inject("REFUELING", {
                    durationMinutes: config.realityModel.incidents.refueling.duration.typical,
                  })
                }
              >
                <Fuel aria-hidden="true" /> Tanken
              </Button>
              <Button
                disabled={!operationsAvailableNow}
                onClick={() =>
                  inject("TECHNICAL_DEFECT", {
                    durationMinutes: config.realityModel.incidents.technicalDefect.duration.typical,
                  })
                }
              >
                <Wrench aria-hidden="true" /> Defekt
              </Button>
              <Button
                disabled={!operationsAvailableNow}
                onClick={() => inject("TECHNICAL_DEFECT", { dayOutage: true, durationMinutes: 0 })}
              >
                <Plane aria-hidden="true" /> Flugzeugausfall
              </Button>
              <Button
                disabled={!operationsAvailableNow}
                onClick={() => inject("EVENT_INTERRUPTION", { durationMinutes: 30 })}
              >
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
            result={result}
            selectedRotationId={selectedRotationId}
          />

          <section className="sim-analysis">
            <div className="sim-chart-panel">
              <header>
                <strong>Letzter Boarding-Prognosefehler vor Ist</strong>
              </header>
              <ErrorChart
                ariaLabel="Interaktiver Verlauf des letzten Boarding-Prognosefehlers"
                basis="LATEST"
                resetKey={result}
                rotations={visibleRotations}
                snapshotLabel="Letzter Snapshot"
                snapshots={visibleSnapshots}
              />
            </div>
            <div className="sim-chart-panel">
              <header>
                <strong>Erste Boardingprognose vs. Ist im Tagesverlauf</strong>
              </header>
              <ErrorChart
                ariaLabel="Interaktiver Verlauf des ersten Boarding-Prognosefehlers"
                basis="INITIAL"
                resetKey={result}
                rotations={visibleRotations}
                snapshotLabel="Erster Snapshot"
                snapshots={visibleSnapshots}
              />
            </div>
            <div className="sim-metrics-grid">
              <MetricCard
                hint={`${visibleMetrics.boarding.samples} Fluggruppen · letzter Snapshot`}
                label="Letztes Boardingfenster getroffen"
                value={metric(visibleMetrics.boarding.windowCoveragePercent, " %")}
              />
              <MetricCard
                hint={`${visibleMetrics.initialBoarding.samples} Fluggruppen · Median absolut`}
                label="Erstprognose Boarding"
                value={metric(visibleMetrics.initialBoarding.medianAbsoluteErrorMinutes, " Min.")}
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
        </div>
      </main>
      <footer className="sim-app-footer">
        Hinweis: Alle Abläufe und Ist-Zeiten sind virtuell und synthetisch. Importierte Stammdaten
        besitzen keine operative Wirkung.
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
        rotations={result.rotations}
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

      {importOpen ? (
        <SimulationImportDialog
          activeConfig={config}
          onClose={() => setImportOpen(false)}
          onImport={applyImport}
        />
      ) : null}

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
            ["Boarding (letzter Snapshot)", visibleMetrics.boarding],
            ["Boarding (Erstprognose)", visibleMetrics.initialBoarding],
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
                {forecastQualityLabel(selectedSnapshot.quality)}
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
          <article>
            <h3>Dispatch</h3>
            <p>
              Durchsatz: {metric(visibleMetrics.dispatch.passengersPerHour, " Pers./h")} ·{" "}
              {metric(visibleMetrics.dispatch.passengersPerAircraftHour, " Pers./Flzg.-h")}
            </p>
            <p>
              Sitze: {visibleMetrics.dispatch.occupiedSeats} von{" "}
              {visibleMetrics.dispatch.offeredSeats} belegt ·{" "}
              {metric(visibleMetrics.dispatch.averageSeatUtilizationPercent, " %")}
            </p>
            <p>
              Passagierwartezeit: P50{" "}
              {metric(visibleMetrics.dispatch.p50PassengerWaitMinutes, " Min.")} · P90{" "}
              {metric(visibleMetrics.dispatch.p90PassengerWaitMinutes, " Min.")} · Max.{" "}
              {metric(visibleMetrics.dispatch.maximumPassengerWaitMinutes, " Min.")}
            </p>
            <p>
              Überholungen: {visibleMetrics.dispatch.projectedOvertakes} · max.{" "}
              {visibleMetrics.dispatch.maximumOvertakesPerGroup} je Gruppe
            </p>
            <p>
              Max. Produkt-Service-Defizit:{" "}
              {metric(visibleMetrics.dispatch.maximumProductServiceDeficitMinutes, " Min.")}
            </p>
            <p>
              Planänderungen: {visibleMetrics.dispatch.unnecessaryPlanChanges} · Rücknahmen von{" "}
              Bereithalten: {visibleMetrics.dispatch.prepareDemotions} · Neuplanung nach Bitte zum{" "}
              Gate: {visibleMetrics.dispatch.goToGateReplans}
            </p>
            <p className="sim-diagnostic-reasons">
              Wartezeit je Produkt:{" "}
              {Object.entries(visibleMetrics.dispatch.waitMinutesByProduct)
                .map(([productId, value]) => `${productId} ${value} Min.`)
                .join(" · ") || "–"}
              {" · "}Serviceanteil:{" "}
              {Object.entries(visibleMetrics.dispatch.serviceSharePercentByProduct)
                .map(([productId, value]) => `${productId} ${value} %`)
                .join(" · ") || "–"}
            </p>
          </article>
        </div>
      </ModalDialog>

      <SimulationComparisonDialog
        error={comparison.error}
        onCancel={comparison.cancel}
        onClose={closeComparison}
        onRestart={startComparison}
        open={comparison.open}
        progress={comparison.progress}
        result={comparison.result}
        running={comparison.running}
      />
    </div>
  );
}

export default ForecastSimulationView;
