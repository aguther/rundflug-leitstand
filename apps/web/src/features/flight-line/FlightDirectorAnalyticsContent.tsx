import type { ForecastHistory, OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import {
  ArrowLeft,
  ArrowRight,
  ChartNoAxesCombined,
  Maximize2,
  Plane,
  UserRound,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "../../design-system/components";
import { ANALYTICS_ZOOM_LEVELS, useAnalyticsDiagramViewport } from "./analytics-diagram-viewport";
import type { AnalyticsTab } from "./FlightDirectorAnalyticsDialog";
import {
  type AnalyticsTicketGroup,
  analyticsTicketGroups,
  boardingForecastChangeMinutes,
  calculateTimeAxisTicks,
  forecastChartData,
  formatDuration,
  resourceDayMetrics,
  resourceTimelineRotations,
  sortedForecastEntries,
} from "./flight-director-analytics-model";

type Rotation = OperationBoard["rotations"][number];
type ForecastEntry = ForecastHistory["entries"][number];

interface FlightDirectorAnalyticsContentProps {
  aircraftId: string;
  board: OperationBoard;
  loadForecastHistory: (rotationId: string) => Promise<ForecastEntry[]>;
  loadResourceHistory: (
    scopeType: "AIRCRAFT" | "PILOT",
    scopeId: string,
  ) => Promise<ResourceDayHistory>;
  onAircraftIdChange: (aircraftId: string) => void;
  onOpenRotation: (rotationId: string) => void;
  onPilotIdChange: (pilotId: string) => void;
  onRotationIdChange: (rotationId: string) => void;
  onTicketGroupIdChange: (ticketGroupId: string) => void;
  pilotId: string;
  rotationId: string;
  tab: AnalyticsTab;
  ticketGroupId: string;
}

const MINUTE_MS = 60_000;
const PAGE_SIZE = 8;
const MINIMUM_TIME_LABEL_SPACING_PX = 64;
const FORECAST_CHART_HORIZONTAL_INSET_PX = 116;
const RESOURCE_CHART_HORIZONTAL_INSET_PX = 28;

function formatTime(value: string | number | null, timeZone: string): string {
  if (value === null) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function qualityLabel(value: ForecastEntry["quality"] | undefined): string {
  if (value === "STABLE") return "Stabil";
  if (value === "CHANGING") return "Veränderlich";
  if (value === "UNCERTAIN") return "Unsicher";
  return "–";
}

function signedMinutes(value: number | null): string {
  if (value === null) return "–";
  if (value === 0) return "unverändert";
  return `${value > 0 ? "+" : ""}${value} Min.`;
}

function AnalyticsError({ message }: { message: string }) {
  return (
    <div className="flight-director-analytics-state" role="alert">
      <ChartNoAxesCombined aria-hidden="true" />
      <strong>Auswertung nicht verfügbar</strong>
      <span>{message}</span>
    </div>
  );
}

function AnalyticsEmpty({ message }: { message: string }) {
  return (
    <div className="flight-director-analytics-state">
      <ChartNoAxesCombined aria-hidden="true" />
      <strong>Noch kein Verlauf</strong>
      <span>{message}</span>
    </div>
  );
}

function AnalyticsLoading() {
  return (
    <div aria-busy="true" className="flight-director-analytics-panel-loading">
      <span />
      <span />
      <span />
    </div>
  );
}

function DiagramZoomControls({
  onChange,
  onReset,
  value,
}: {
  onChange: (zoom: number) => void;
  onReset: () => void;
  value: number;
}) {
  const index = ANALYTICS_ZOOM_LEVELS.indexOf(value as (typeof ANALYTICS_ZOOM_LEVELS)[number]);
  return (
    <fieldset className="flight-director-diagram-zoom">
      <legend className="visually-hidden">Diagramm-Zoom</legend>
      <small>Mausrad: Zoom · Ziehen: Verschieben</small>
      <Button
        aria-label="Diagramm verkleinern"
        disabled={index <= 0}
        onClick={() => onChange(ANALYTICS_ZOOM_LEVELS[Math.max(0, index - 1)] ?? 1)}
        type="button"
        variant="secondary"
      >
        <ZoomOut aria-hidden="true" />
      </Button>
      <span aria-live="polite">{Math.round(value * 100)} %</span>
      <Button
        aria-label="Diagramm vergrößern"
        disabled={index < 0 || index >= ANALYTICS_ZOOM_LEVELS.length - 1}
        onClick={() =>
          onChange(
            ANALYTICS_ZOOM_LEVELS[Math.min(ANALYTICS_ZOOM_LEVELS.length - 1, index + 1)] ?? value,
          )
        }
        type="button"
        variant="secondary"
      >
        <ZoomIn aria-hidden="true" />
      </Button>
      <Button
        aria-label="Gesamten Veranstaltungsverlauf anzeigen"
        disabled={value === 1}
        onClick={onReset}
        type="button"
        variant="secondary"
      >
        <Maximize2 aria-hidden="true" />
        Gesamt
      </Button>
    </fieldset>
  );
}

function ForecastTooltip({
  active,
  label,
  payload,
  timeZone,
}: {
  active?: boolean;
  label?: number | undefined;
  payload?: ReadonlyArray<{ color?: string; name?: string | number; value?: unknown }>;
  timeZone: string;
}) {
  if (!active || label === undefined || !payload?.length) return null;
  return (
    <div className="flight-director-analytics-tooltip">
      <strong>Stand {formatTime(label, timeZone)} Uhr</strong>
      {payload
        .filter((item) => item.value !== null && item.value !== undefined)
        .map((item) => (
          <span key={String(item.name)} style={{ color: item.color }}>
            {item.name}: {formatTime(Number(item.value), timeZone)} Uhr
          </span>
        ))}
    </div>
  );
}

function ForecastRotationPanel({
  board,
  entries,
  error,
  loading,
  resetKey,
  rotation,
}: {
  board: OperationBoard;
  entries: ForecastEntry[];
  error: string | null;
  loading: boolean;
  resetKey: string;
  rotation: Rotation | undefined;
}) {
  const [page, setPage] = useState(0);
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
    zoom,
  } = useAnalyticsDiagramViewport(resetKey);
  const sorted = useMemo(() => sortedForecastEntries(entries), [entries]);
  const chartData = useMemo(() => forecastChartData(entries), [entries]);
  const latest = sorted.at(-1);
  const actual = rotation?.timeline.actual;
  const timeZone = board.event.timeZone;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const visibleEntries = [...sorted]
    .reverse()
    .slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const values = chartData.flatMap((point) =>
    [point.boardingAt, point.departureAt, point.landingAt, point.completionAt].filter(
      (value): value is number => value !== null,
    ),
  );
  for (const value of [
    actual?.boardingAt,
    actual?.departureAt,
    actual?.landingAt,
    actual?.completionAt,
  ]) {
    if (value) values.push(Date.parse(value));
  }
  const minimum = values.length > 0 ? Math.min(...values) - 5 * MINUTE_MS : 0;
  const maximum = values.length > 0 ? Math.max(...values) + 5 * MINUTE_MS : 1;
  const capturedValues = chartData.map((point) => point.capturedAt);
  const capturedMinimum = capturedValues.length > 0 ? Math.min(...capturedValues) : 0;
  const capturedMaximum = capturedValues.length > 0 ? Math.max(...capturedValues) : 1;
  const capturedDomain =
    capturedMinimum === capturedMaximum
      ? [capturedMinimum - 5 * MINUTE_MS, capturedMaximum + 5 * MINUTE_MS]
      : [capturedMinimum, capturedMaximum];
  const chartPixelWidth =
    Math.max(320, viewportWidth || 720) * zoom - FORECAST_CHART_HORIZONTAL_INSET_PX;
  const timeAxisTicks = calculateTimeAxisTicks({
    from: capturedDomain[0] ?? 0,
    minimumLabelSpacing: MINIMUM_TIME_LABEL_SPACING_PX,
    pixelWidth: chartPixelWidth,
    timeZone,
    until: capturedDomain[1] ?? 1,
  });
  const turnaroundProfile = rotation?.timeline.effectiveTurnaroundProfile;
  const assumedAircraft = board.aircraft.find(
    (aircraft) => aircraft.id === rotation?.timeline.forecastAssumedAircraftId,
  );
  const sourceLabel = (level: "AIRCRAFT_PRODUCT" | "PRODUCT" | "EVENT") =>
    level === "AIRCRAFT_PRODUCT"
      ? "Flugzeug + Produkt"
      : level === "PRODUCT"
        ? "Produkt"
        : "Veranstaltung";
  const metrics = [
    { label: "Snapshots", value: sorted.length },
    { label: "Aktuelle Qualität", value: qualityLabel(latest?.quality) },
    {
      label: "Boarding seit letztem Stand",
      value: signedMinutes(boardingForecastChangeMinutes(entries)),
    },
    { label: "Datenbasis", value: latest ? `${latest.sampleSize} Umläufe` : "–" },
    {
      label: "Prognoseannahme",
      value: assumedAircraft?.registration ?? "bestätigte Ressource",
    },
    {
      label: "Bodenprofil",
      value: turnaroundProfile
        ? `${turnaroundProfile.boarding.valueMinutes} + ${turnaroundProfile.deboarding.valueMinutes} + ${turnaroundProfile.buffer.valueMinutes} Min.`
        : "–",
    },
    {
      label: "Quellen",
      value: turnaroundProfile
        ? [
            sourceLabel(turnaroundProfile.boarding.sourceLevel),
            sourceLabel(turnaroundProfile.deboarding.sourceLevel),
            sourceLabel(turnaroundProfile.buffer.sourceLevel),
          ].join(" / ")
        : "–",
    },
  ];
  const milestones: Array<[string, string | null]> = [
    ["Boarding", actual?.boardingAt ?? null],
    ["Off-Block", actual?.departureAt ?? null],
    ["On-Block", actual?.landingAt ?? null],
    ["Abschluss", actual?.completionAt ?? null],
  ];

  return (
    <article
      aria-labelledby={`analytics-rotation-${rotation?.id ?? "unknown"}`}
      className="flight-director-forecast-detail"
    >
      <header className="flight-director-analytics-panel-heading">
        <div>
          <h4 id={`analytics-rotation-${rotation?.id ?? "unknown"}`}>
            Fluggruppe {rotation?.communicationLabel ?? "–"}
          </h4>
          <p>{rotation?.productName ?? "Zugehöriger Umlauf"}</p>
        </div>
      </header>
      <dl className="flight-director-analytics-milestones">
        {milestones.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatTime(value, timeZone)}</dd>
          </div>
        ))}
      </dl>
      <dl className="flight-director-analytics-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>
      {loading ? (
        <AnalyticsLoading />
      ) : error ? (
        <AnalyticsError message={error} />
      ) : chartData.length === 0 ? (
        <AnalyticsEmpty message="Für diese Fluggruppe wurden noch keine Prognose-Snapshots erfasst." />
      ) : (
        <>
          <DiagramZoomControls onChange={changeZoom} onReset={reset} value={zoom} />
          <div
            className={`flight-director-chart-viewport${zoom > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
            onClickCapture={onClickCapture}
            onPointerCancel={onPointerCancel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            ref={setViewportRef}
          >
            <div
              aria-label="Prognosediagramm; mit dem Mausrad zoomen und durch Ziehen verschieben"
              className="flight-director-forecast-chart"
              role="img"
              style={{ width: `${zoom * 100}%` }}
            >
              <ResponsiveContainer height="100%" width="100%">
                <LineChart
                  accessibilityLayer
                  data={chartData}
                  margin={{ top: 18, right: 28, bottom: 2, left: 12 }}
                >
                  <CartesianGrid stroke="var(--ui-border)" strokeDasharray="2 4" />
                  <XAxis
                    dataKey="capturedAt"
                    domain={capturedDomain}
                    interval={0}
                    scale="time"
                    tickFormatter={(value: number) => formatTime(value, timeZone)}
                    ticks={timeAxisTicks.map((tick) => tick.value)}
                    type="number"
                  />
                  <YAxis
                    domain={[minimum, maximum]}
                    scale="time"
                    tickFormatter={(value: number) => formatTime(value, timeZone)}
                    type="number"
                    width={52}
                  />
                  <Tooltip
                    content={(props) => (
                      <ForecastTooltip
                        active={props.active}
                        label={typeof props.label === "number" ? props.label : undefined}
                        payload={props.payload}
                        timeZone={timeZone}
                      />
                    )}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="boardingAt"
                    dot={{ r: 2 }}
                    isAnimationActive={false}
                    name="Boarding"
                    stroke="var(--analytics-boarding)"
                    strokeWidth={1.75}
                    type="monotone"
                  />
                  <Line
                    dataKey="departureAt"
                    dot={{ r: 2 }}
                    isAnimationActive={false}
                    name="Off-Block"
                    stroke="var(--analytics-departure)"
                    strokeWidth={1.75}
                    type="monotone"
                  />
                  <Line
                    dataKey="landingAt"
                    dot={{ r: 2 }}
                    isAnimationActive={false}
                    name="On-Block"
                    stroke="var(--analytics-landing)"
                    strokeWidth={1.75}
                    type="monotone"
                  />
                  <Line
                    dataKey="completionAt"
                    dot={{ r: 2 }}
                    isAnimationActive={false}
                    name="Abschluss"
                    stroke="var(--analytics-completion)"
                    strokeWidth={1.75}
                    type="monotone"
                  />
                  {actual?.boardingAt ? (
                    <ReferenceLine
                      stroke="var(--analytics-boarding)"
                      strokeDasharray="3 5"
                      y={Date.parse(actual.boardingAt)}
                    />
                  ) : null}
                  {actual?.departureAt ? (
                    <ReferenceLine
                      stroke="var(--analytics-departure)"
                      strokeDasharray="3 5"
                      y={Date.parse(actual.departureAt)}
                    />
                  ) : null}
                  {actual?.landingAt ? (
                    <ReferenceLine
                      stroke="var(--analytics-landing)"
                      strokeDasharray="3 5"
                      y={Date.parse(actual.landingAt)}
                    />
                  ) : null}
                  {actual?.completionAt ? (
                    <ReferenceLine
                      stroke="var(--analytics-completion)"
                      strokeDasharray="3 5"
                      y={Date.parse(actual.completionAt)}
                    />
                  ) : null}
                  {rotation?.precalledAt ? (
                    <ReferenceLine
                      label={{ value: "GO TO GATE", fill: "var(--ui-muted)", fontSize: 10 }}
                      stroke="var(--ui-warning)"
                      strokeDasharray="4 4"
                      x={Date.parse(rotation.precalledAt)}
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <fieldset className="flight-director-forecast-legend">
            <legend className="visually-hidden">Diagrammlegende</legend>
            <span className="boarding">Boarding</span>
            <span className="departure">Off-Block</span>
            <span className="landing">On-Block</span>
            <span className="completion">Abschluss</span>
            <small>Gestrichelt: bestätigte Ist-Zeit</small>
          </fieldset>
        </>
      )}
      <div className="flight-director-analytics-table-wrap">
        <table className="flight-director-analytics-table">
          <thead>
            <tr>
              <th>Stand</th>
              <th>Qualität</th>
              <th>Boarding</th>
              <th>Off-Block</th>
              <th>On-Block</th>
              <th>Abschluss</th>
              <th>Datenbasis</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => (
              <tr key={entry.snapshotId}>
                <td>{formatTime(entry.capturedAt, timeZone)}</td>
                <td>{qualityLabel(entry.quality)}</td>
                <td>{formatTime(entry.predicted.boardingAt, timeZone)}</td>
                <td>{formatTime(entry.predicted.departureAt, timeZone)}</td>
                <td>{formatTime(entry.predicted.landingAt, timeZone)}</td>
                <td>{formatTime(entry.predicted.completionAt, timeZone)}</td>
                <td>{entry.sampleSize} Umläufe</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE_SIZE ? (
        <nav aria-label="Prognose-Snapshots durchblättern" className="analytics-pagination">
          <Button
            disabled={page === 0}
            onClick={() => setPage((current) => current - 1)}
            type="button"
            variant="secondary"
          >
            <ArrowLeft aria-hidden="true" /> Zurück
          </Button>
          <span>
            Seite {page + 1} von {totalPages}
          </span>
          <Button
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((current) => current + 1)}
            type="button"
            variant="secondary"
          >
            Weiter <ArrowRight aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
    </article>
  );
}

interface ForecastLoadResult {
  entries: ForecastEntry[];
  error: string | null;
}

function ForecastPanel({
  board,
  forecastResults,
  onRotationIdChange,
  onTicketGroupIdChange,
  rotationId,
  ticketGroupId,
  ticketGroups,
}: {
  board: OperationBoard;
  forecastResults: Record<string, ForecastLoadResult>;
  onRotationIdChange: (rotationId: string) => void;
  onTicketGroupIdChange: (ticketGroupId: string) => void;
  rotationId: string;
  ticketGroupId: string;
  ticketGroups: AnalyticsTicketGroup[];
}) {
  const ticketGroup = ticketGroups.find((group) => group.id === ticketGroupId);
  const relatedRotations =
    ticketGroup?.rotationIds.flatMap((id) => {
      const rotation = board.rotations.find((entry) => entry.id === id);
      return rotation ? [rotation] : [];
    }) ?? [];
  const visibleRotations =
    rotationId === "all"
      ? relatedRotations
      : relatedRotations.filter((rotation) => rotation.id === rotationId);

  return (
    <section
      aria-labelledby="analytics-ticket-group-title"
      className="flight-director-analytics-panel"
    >
      <header className="flight-director-analytics-panel-heading">
        <div>
          <h3 id="analytics-ticket-group-title">Prognoseverlauf {ticketGroup?.label ?? ""}</h3>
          <p>
            Die Ticketgruppe ist führend; darunter werden alle zugehörigen Fluggruppen ausgewertet.
          </p>
        </div>
        <div className="flight-director-analytics-selectors">
          <label>
            <span>Ticketgruppe</span>
            <select
              onChange={(event) => onTicketGroupIdChange(event.target.value)}
              value={ticketGroupId}
            >
              {ticketGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Fluggruppe</span>
            <select
              disabled={relatedRotations.length === 0}
              onChange={(event) => onRotationIdChange(event.target.value)}
              value={rotationId}
            >
              {relatedRotations.length > 1 ? (
                <option value="all">Alle zugehörigen ({relatedRotations.length})</option>
              ) : null}
              {relatedRotations.map((rotation) => (
                <option key={rotation.id} value={rotation.id}>
                  {rotation.communicationLabel}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {!ticketGroup || visibleRotations.length === 0 ? (
        <AnalyticsEmpty message="Für diese Ticketgruppe liegt noch keine zugehörige Fluggruppe vor." />
      ) : (
        <div className="flight-director-forecast-list">
          {visibleRotations.map((rotation) => {
            const result = forecastResults[rotation.id];
            return (
              <ForecastRotationPanel
                board={board}
                entries={result?.entries ?? []}
                error={result?.error ?? null}
                key={rotation.id}
                loading={!result}
                resetKey={`${ticketGroupId}:${rotationId}:${rotation.id}`}
                rotation={rotation}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function ResourcePanel({
  board,
  error,
  history,
  loading,
  onOpenRotation,
  onScopeIdChange,
  scopeId,
  scopeType,
}: {
  board: OperationBoard;
  error: string | null;
  history: ResourceDayHistory | null;
  loading: boolean;
  onOpenRotation: (rotationId: string) => void;
  onScopeIdChange: (scopeId: string) => void;
  scopeId: string;
  scopeType: "AIRCRAFT" | "PILOT";
}) {
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
    zoom,
  } = useAnalyticsDiagramViewport(`${scopeType}:${scopeId}`);
  const timeZone = board.event.timeZone;
  const resources =
    scopeType === "AIRCRAFT"
      ? board.aircraft.map((entry) => ({
          id: entry.id,
          primary: entry.registration,
          secondary: `${entry.aircraftType} · ${entry.passengerSeats} Plätze`,
        }))
      : board.pilots.map((entry) => ({
          id: entry.id,
          primary: entry.operationalCode,
          secondary: entry.paused ? "Pause" : entry.active ? "Aktiv" : "Inaktiv",
        }));
  const selected = resources.find((resource) => resource.id === scopeId);
  const metrics = history ? resourceDayMetrics(history) : null;
  const timelineRotations = useMemo(
    () => (history ? resourceTimelineRotations(history) : []),
    [history],
  );
  const timelineFrom = history ? Date.parse(history.from) : 0;
  const timelineUntil = history ? Date.parse(history.until) : 1;
  const timelineSpan = Math.max(1, timelineUntil - timelineFrom);
  const timelinePercent = (value: string) =>
    Math.min(100, Math.max(0, ((Date.parse(value) - timelineFrom) / timelineSpan) * 100));
  const timelineTicks = calculateTimeAxisTicks({
    from: timelineFrom,
    minimumLabelSpacing: MINIMUM_TIME_LABEL_SPACING_PX,
    pixelWidth: Math.max(320, viewportWidth || 720) * zoom - RESOURCE_CHART_HORIZONTAL_INSET_PX,
    timeZone,
    until: timelineUntil,
  }).map((tick) => ({
    ...tick,
    percent: ((tick.value - timelineFrom) / timelineSpan) * 100,
  }));
  const ticketGroupsByRotationId = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const ticketGroup of analyticsTicketGroups(board.rotations)) {
      for (const relatedRotationId of ticketGroup.rotationIds) {
        const labels = result.get(relatedRotationId) ?? [];
        labels.push(ticketGroup.label);
        result.set(relatedRotationId, labels);
      }
    }
    return result;
  }, [board.rotations]);
  const summary =
    scopeType === "AIRCRAFT"
      ? [
          ["Abgeschlossene Umläufe", metrics?.completedRotations ?? "–"],
          ["Bindungszeit", formatDuration(metrics?.bindingMinutes ?? null)],
          ["Ø Turnaround", formatDuration(metrics?.averageTurnaroundMinutes ?? null)],
          [
            "Ø Sitzauslastung",
            metrics?.averageSeatUtilization === null || metrics === null
              ? "–"
              : `${Math.round(metrics.averageSeatUtilization * 100)} %`,
          ],
        ]
      : [
          ["Umläufe", history?.rotations.length ?? "–"],
          ["Bindungszeit", formatDuration(metrics?.bindingMinutes ?? null)],
          ["Gemessene Flugzeit", formatDuration(metrics?.flightMinutes ?? null)],
          ["Pausenzeit", formatDuration(metrics?.pauseMinutes ?? null)],
        ];

  return (
    <div className="flight-director-resource-layout">
      <aside aria-label={scopeType === "AIRCRAFT" ? "Flugzeug auswählen" : "Pilot auswählen"}>
        <strong>{scopeType === "AIRCRAFT" ? "Flugzeuge" : "Piloten"}</strong>
        {resources.map((resource) => (
          <button
            aria-pressed={resource.id === scopeId}
            className={resource.id === scopeId ? "active" : ""}
            key={resource.id}
            onClick={() => onScopeIdChange(resource.id)}
            type="button"
          >
            {scopeType === "AIRCRAFT" ? (
              <Plane aria-hidden="true" />
            ) : (
              <UserRound aria-hidden="true" />
            )}
            <span>
              <strong>{resource.primary}</strong>
              <small>{resource.secondary}</small>
            </span>
          </button>
        ))}
      </aside>
      <section className="flight-director-analytics-panel">
        <header className="flight-director-analytics-panel-heading">
          <div>
            <h3>
              {scopeType === "AIRCRAFT" ? "Tagesumlauf" : "Piloteneinsatz"}{" "}
              {selected?.primary ?? ""}
            </h3>
            <p>
              {scopeType === "AIRCRAFT"
                ? "Bestätigte Boarding-, Flug- und Turnaround-Zeiten einschließlich Sperren."
                : "Organisatorische Zuordnung zu Umläufen, Flugzeugen und erfassten Pausen."}
            </p>
          </div>
        </header>
        <dl className="flight-director-analytics-metrics">
          {summary.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {loading ? (
          <AnalyticsLoading />
        ) : error ? (
          <AnalyticsError message={error} />
        ) : !history || timelineRotations.length === 0 ? (
          <AnalyticsEmpty message="Für diese Ressource liegen in der Veranstaltung noch keine bestätigten Umläufe vor." />
        ) : (
          <>
            <DiagramZoomControls onChange={changeZoom} onReset={reset} value={zoom} />
            <div
              className={`flight-director-chart-viewport${zoom > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
              onClickCapture={onClickCapture}
              onPointerCancel={onPointerCancel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              ref={setViewportRef}
            >
              <section
                aria-label={`Tagesverlauf ${selected?.primary ?? ""}: ${timelineRotations.length} Umläufe hintereinander`}
                className="flight-director-resource-chart"
                style={{ width: `${zoom * 100}%` }}
              >
                <div aria-hidden="true" className="resource-timeline-grid">
                  {timelineTicks.map((tick) => (
                    <i key={tick.value} style={{ left: `${tick.percent}%` }} />
                  ))}
                </div>
                <div aria-hidden="true" className="resource-timeline-axis">
                  {timelineTicks.map((tick) => (
                    <span
                      key={tick.value}
                      style={{
                        left: `${tick.percent}%`,
                        transform:
                          tick.percent < 2
                            ? "none"
                            : tick.percent > 98
                              ? "translateX(-100%)"
                              : "translateX(-50%)",
                      }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
                <div className="resource-timeline-lane">
                  {history.blocks.map((block) => {
                    const start = timelinePercent(block.startedAt);
                    const end = timelinePercent(block.endedAt ?? history.observedUntil);
                    return (
                      <span
                        aria-hidden="true"
                        className={`resource-timeline-block resource-timeline-block--${block.type.toLowerCase()}`}
                        key={block.id}
                        style={{
                          left: `${start}%`,
                          width: `${Math.max(0.15, end - start)}%`,
                        }}
                      />
                    );
                  })}
                  <span
                    aria-hidden="true"
                    className="resource-timeline-observed"
                    style={{ left: `${timelinePercent(history.observedUntil)}%` }}
                  />
                  {timelineRotations.map((item) => {
                    const width = Math.max(0.15, item.endPercent - item.startPercent);
                    const ticketGroupLabels = ticketGroupsByRotationId.get(item.id) ?? [];
                    const ticketGroupText =
                      ticketGroupLabels.length === 1
                        ? `Ticketgruppe ${ticketGroupLabels[0]}`
                        : `Ticketgruppen ${ticketGroupLabels.join(", ")}`;
                    const title = `${ticketGroupText} · Fluggruppe ${item.label} · ${formatTime(item.rotation.actual.boardingAt, timeZone)}–${formatTime(item.rotation.actual.completionAt, timeZone)} Uhr · ${item.rotation.passengerCount}/${item.rotation.usableCapacity} Personen · ${item.rotation.aircraftRegistration ?? "kein Flugzeug"} · ${item.rotation.pilotOperationalCode ?? "kein Pilot"}`;
                    return (
                      <div
                        className="resource-timeline-rotation"
                        key={item.id}
                        style={{ left: `${item.startPercent}%`, width: `${width}%` }}
                      >
                        {item.phases.map((phase) => (
                          <span
                            aria-hidden="true"
                            className={`resource-timeline-phase resource-timeline-phase--${phase.type.toLowerCase()}`}
                            key={phase.type}
                            style={{
                              left: `${((phase.startPercent - item.startPercent) / width) * 100}%`,
                              width: `${Math.max(1, ((phase.endPercent - phase.startPercent) / width) * 100)}%`,
                            }}
                          />
                        ))}
                        <button
                          aria-label={`${title} · Prognose öffnen`}
                          onClick={() => onOpenRotation(item.id)}
                          title={title}
                          type="button"
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
            <div className="flight-director-resource-legend">
              <span className="boarding">Boarding</span>
              <span className="flight">Flug</span>
              <span className="turnaround">Turnaround</span>
              <span className="pause">Pause/Sperre</span>
            </div>
          </>
        )}
        <div className="flight-director-analytics-table-wrap">
          <table className="flight-director-analytics-table">
            <thead>
              <tr>
                <th>Fluggruppe</th>
                <th>Flugzeug</th>
                <th>Pilot</th>
                <th>Personen</th>
                <th>Boarding</th>
                <th>Off-Block</th>
                <th>On-Block</th>
                <th>Abschluss</th>
                <th>
                  <span className="visually-hidden">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {history?.rotations.map((rotation) => (
                <tr key={rotation.rotationId}>
                  <td>{rotation.communicationLabel}</td>
                  <td>{rotation.aircraftRegistration ?? "–"}</td>
                  <td>{rotation.pilotOperationalCode ?? "–"}</td>
                  <td>
                    {rotation.passengerCount}/{rotation.usableCapacity}
                  </td>
                  <td>{formatTime(rotation.actual.boardingAt, timeZone)}</td>
                  <td>{formatTime(rotation.actual.departureAt, timeZone)}</td>
                  <td>{formatTime(rotation.actual.landingAt, timeZone)}</td>
                  <td>{formatTime(rotation.actual.completionAt, timeZone)}</td>
                  <td>
                    <Button
                      onClick={() => onOpenRotation(rotation.rotationId)}
                      type="button"
                      variant="secondary"
                    >
                      Prognose öffnen
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function FlightDirectorAnalyticsContent({
  aircraftId,
  board,
  loadForecastHistory,
  loadResourceHistory,
  onAircraftIdChange,
  onOpenRotation,
  onPilotIdChange,
  onRotationIdChange,
  onTicketGroupIdChange,
  pilotId,
  rotationId,
  tab,
  ticketGroupId,
}: FlightDirectorAnalyticsContentProps) {
  const [forecastResults, setForecastResults] = useState<Record<string, ForecastLoadResult>>({});
  const [resourceHistory, setResourceHistory] = useState<ResourceDayHistory | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const forecastRequestSequence = useRef(0);
  const resourceRequestSequence = useRef(0);
  const forecastCache = useRef(new Map<string, ForecastEntry[]>());
  const resourceCache = useRef(new Map<string, ResourceDayHistory>());
  const ticketGroups = useMemo(() => analyticsTicketGroups(board.rotations), [board.rotations]);
  const selectedForecastRotationIds = useMemo(() => {
    const related = ticketGroups.find((group) => group.id === ticketGroupId)?.rotationIds ?? [];
    return rotationId === "all" ? related : related.filter((id) => id === rotationId);
  }, [rotationId, ticketGroupId, ticketGroups]);

  useEffect(() => {
    if (tab !== "groups") return;
    const requestId = ++forecastRequestSequence.current;
    const cachedResults = Object.fromEntries(
      selectedForecastRotationIds.flatMap((id) => {
        const entries = forecastCache.current.get(id);
        return entries ? [[id, { entries, error: null } satisfies ForecastLoadResult]] : [];
      }),
    );
    setForecastResults(cachedResults);
    if (selectedForecastRotationIds.length === 0) return;

    void Promise.all(
      selectedForecastRotationIds.map(async (id): Promise<[string, ForecastLoadResult]> => {
        const cached = forecastCache.current.get(id);
        if (cached) return [id, { entries: cached, error: null }];
        try {
          const entries = await loadForecastHistory(id);
          forecastCache.current.set(id, entries);
          return [id, { entries, error: null }];
        } catch (caught: unknown) {
          return [
            id,
            {
              entries: [],
              error: caught instanceof Error ? caught.message : "Prognoseverlauf nicht verfügbar.",
            },
          ];
        }
      }),
    ).then((results) => {
      if (forecastRequestSequence.current !== requestId) return;
      setForecastResults(Object.fromEntries(results));
    });
  }, [loadForecastHistory, selectedForecastRotationIds, tab]);

  useEffect(() => {
    if (tab === "groups") return;
    const requestId = ++resourceRequestSequence.current;
    setResourceError(null);
    const scopeType = tab === "aircraft" ? "AIRCRAFT" : "PILOT";
    const scopeId = tab === "aircraft" ? aircraftId : pilotId;
    if (!scopeId) {
      setResourceHistory(null);
      setResourceLoading(false);
      return;
    }
    const cacheKey = `${scopeType}:${scopeId}`;
    const cached = resourceCache.current.get(cacheKey);
    if (cached) {
      setResourceHistory(cached);
      setResourceLoading(false);
      return;
    }
    setResourceLoading(true);
    void loadResourceHistory(scopeType, scopeId)
      .then((history) => {
        if (resourceRequestSequence.current !== requestId) return;
        resourceCache.current.set(cacheKey, history);
        setResourceHistory(history);
      })
      .catch((caught: unknown) => {
        if (resourceRequestSequence.current !== requestId) return;
        setResourceError(
          caught instanceof Error ? caught.message : "Tagesverlauf nicht verfügbar.",
        );
      })
      .finally(() => {
        if (resourceRequestSequence.current === requestId) setResourceLoading(false);
      });
  }, [aircraftId, loadResourceHistory, pilotId, tab]);

  if (tab === "groups") {
    return (
      <ForecastPanel
        board={board}
        forecastResults={forecastResults}
        onRotationIdChange={onRotationIdChange}
        onTicketGroupIdChange={onTicketGroupIdChange}
        rotationId={rotationId}
        ticketGroupId={ticketGroupId}
        ticketGroups={ticketGroups}
      />
    );
  }
  return (
    <ResourcePanel
      board={board}
      error={resourceError}
      history={resourceHistory}
      loading={resourceLoading}
      onOpenRotation={onOpenRotation}
      onScopeIdChange={tab === "aircraft" ? onAircraftIdChange : onPilotIdChange}
      scopeId={tab === "aircraft" ? aircraftId : pilotId}
      scopeType={tab === "aircraft" ? "AIRCRAFT" : "PILOT"}
    />
  );
}
