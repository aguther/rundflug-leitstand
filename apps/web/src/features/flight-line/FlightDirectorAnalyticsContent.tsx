import type { ForecastHistory, OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import { ArrowLeft, ArrowRight, ChartNoAxesCombined, Plane, UserRound } from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, IconButton } from "../../design-system/components";
import { rotationGroupLabelList } from "../../flight-line-shared";
import { TimeDiagramZoomControls } from "../../shared/TimeDiagramZoomControls";
import {
  clipTimeInterval,
  timeToPercent,
  useTimeDiagramViewport,
} from "../../shared/time-diagram-viewport";
import { nearestChartPoint, TimeSeriesSvgChart } from "../../shared/time-series-svg-chart";
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
import "./flight-director-analytics.css";

type Rotation = OperationBoard["rotations"][number];
type ForecastEntry = ForecastHistory["entries"][number];
type TimestampValue = string | number | null;
type ForecastChartPoint = ReturnType<typeof forecastChartData>[number];
type ResourceTimelineRotation = ReturnType<typeof resourceTimelineRotations>[number];
type ResourceScopeType = "AIRCRAFT" | "PILOT";

interface ResourceOption {
  id: string;
  primary: string;
  secondary: string;
}

interface LabelValue {
  label: string;
  value: string | number;
}

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

function formatTime(value: TimestampValue, timeZone: string): string {
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

function turnaroundSourceLabel(level: "AIRCRAFT_PRODUCT" | "PRODUCT" | "EVENT"): string {
  if (level === "AIRCRAFT_PRODUCT") return "Flugzeug + Produkt";
  if (level === "PRODUCT") return "Produkt";
  return "Veranstaltung";
}

function ticketGroupDescription(labels: readonly string[]): string {
  if (labels.length === 1) return `Ticketgruppe ${labels[0]}`;
  return `Ticketgruppen ${labels.join(", ")}`;
}

function timelineTickTransform(percent: number): string {
  if (percent < 2) return "none";
  if (percent > 98) return "translateX(-100%)";
  return "translateX(-50%)";
}

function AnalyticsError({ message }: Readonly<{ message: string }>) {
  return (
    <div className="flight-director-analytics-state" role="alert">
      <ChartNoAxesCombined aria-hidden="true" />
      <strong>Auswertung nicht verfügbar</strong>
      <span>{message}</span>
    </div>
  );
}

function AnalyticsEmpty({ message }: Readonly<{ message: string }>) {
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

function ForecastTooltip({
  active,
  label,
  payload,
  timeZone,
}: Readonly<{
  active?: boolean;
  label?: number | undefined;
  payload?: ReadonlyArray<{ color?: string; name?: string | number; value?: unknown }>;
  timeZone: string;
}>) {
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

function capturedDomain(chartData: readonly ForecastChartPoint[]): [number, number] {
  const capturedValues = chartData.map((point) => point.capturedAt);
  const capturedMinimum = capturedValues.length > 0 ? Math.min(...capturedValues) : 0;
  const capturedMaximum = capturedValues.length > 0 ? Math.max(...capturedValues) : 1;
  const capturedDomainStart =
    capturedMinimum === capturedMaximum ? capturedMinimum - 5 * MINUTE_MS : capturedMinimum;
  const capturedDomainEnd =
    capturedMinimum === capturedMaximum ? capturedMaximum + 5 * MINUTE_MS : capturedMaximum;
  return [capturedDomainStart, capturedDomainEnd];
}

function forecastValueDomain(
  chartData: readonly ForecastChartPoint[],
  actual: Rotation["timeline"]["actual"] | undefined,
): [number, number] {
  const values = chartData.flatMap((point) =>
    [point.boardingAt, point.departureAt, point.landingAt, point.completionAt].filter(
      (value): value is number => value !== null,
    ),
  );
  const actualValues = [
    actual?.boardingAt,
    actual?.departureAt,
    actual?.landingAt,
    actual?.completionAt,
  ];
  for (const value of actualValues) {
    if (value) values.push(Date.parse(value));
  }
  if (values.length === 0) return [0, 1];
  return [Math.min(...values) - 5 * MINUTE_MS, Math.max(...values) + 5 * MINUTE_MS];
}

function forecastMetrics(
  board: OperationBoard,
  entries: ForecastEntry[],
  sorted: ForecastEntry[],
  rotation: Rotation | undefined,
): LabelValue[] {
  const latest = sorted.at(-1);
  const turnaroundProfile = rotation?.timeline.effectiveTurnaroundProfile;
  const assumedAircraft = board.aircraft.find(
    (aircraft) => aircraft.id === rotation?.timeline.forecastAssumedAircraftId,
  );
  const metrics: LabelValue[] = [
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
            turnaroundSourceLabel(turnaroundProfile.boarding.sourceLevel),
            turnaroundSourceLabel(turnaroundProfile.deboarding.sourceLevel),
            turnaroundSourceLabel(turnaroundProfile.buffer.sourceLevel),
          ].join(" / ")
        : "–",
    },
  ];
  if (rotation?.timeline.extendsBeyondOperationsEnd) {
    metrics.push({
      label: "Betriebsende",
      value: `${formatTime(rotation.timeline.predicted.completionAt, board.event.timeZone)} · +${rotation.timeline.overtimeMinutes} Min.`,
    });
  }
  return metrics;
}

function ForecastDiagram({
  chartData,
  resetKey,
  rotation,
  timeZone,
}: Readonly<{
  chartData: ForecastChartPoint[];
  resetKey: string;
  rotation: Rotation | undefined;
  timeZone: string;
}>) {
  const [hoveredPoint, setHoveredPoint] = useState<ForecastChartPoint | null>(null);
  const domain = useMemo(() => capturedDomain(chartData), [chartData]);
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
    domain: { from: domain[0] ?? 0, until: domain[1] ?? 1 },
    insets: { left: 64, right: 28 },
    resetKey,
  });
  const actual = rotation?.timeline.actual;
  const [minimum, maximum] = forecastValueDomain(chartData, actual);
  const chartPixelWidth = Math.max(320, viewportWidth || 720) - FORECAST_CHART_HORIZONTAL_INSET_PX;
  const timeAxisTicks = calculateTimeAxisTicks({
    from: visibleDomain.from,
    minimumLabelSpacing: MINIMUM_TIME_LABEL_SPACING_PX,
    pixelWidth: chartPixelWidth,
    timeZone,
    until: visibleDomain.until,
  });
  const chartWidth = Math.max(320, viewportWidth || 720);
  const yStep = (maximum - minimum) / 4;
  const yTicks = Array.from({ length: 5 }, (_, index) => minimum + yStep * index);
  const series = [
    {
      color: "var(--analytics-boarding)",
      curve: "monotone" as const,
      id: "boarding",
      label: "Boarding",
      points: chartData.flatMap((point) =>
        point.boardingAt === null ? [] : [{ x: point.capturedAt, y: point.boardingAt }],
      ),
      showPoints: true,
    },
    {
      color: "var(--analytics-departure)",
      curve: "monotone" as const,
      id: "departure",
      label: "Off-Block",
      points: chartData.flatMap((point) =>
        point.departureAt === null ? [] : [{ x: point.capturedAt, y: point.departureAt }],
      ),
      showPoints: true,
    },
    {
      color: "var(--analytics-landing)",
      curve: "monotone" as const,
      id: "landing",
      label: "On-Block",
      points: chartData.flatMap((point) =>
        point.landingAt === null ? [] : [{ x: point.capturedAt, y: point.landingAt }],
      ),
      showPoints: true,
    },
    {
      color: "var(--analytics-completion)",
      curve: "monotone" as const,
      id: "completion",
      label: "Abschluss",
      points: chartData.flatMap((point) =>
        point.completionAt === null ? [] : [{ x: point.capturedAt, y: point.completionAt }],
      ),
      showPoints: true,
    },
  ];
  const actualReferenceValues: Array<{ color: string; value: string | null | undefined }> = [
    { color: "var(--analytics-boarding)", value: actual?.boardingAt },
    { color: "var(--analytics-departure)", value: actual?.departureAt },
    { color: "var(--analytics-landing)", value: actual?.landingAt },
    { color: "var(--analytics-completion)", value: actual?.completionAt },
  ];
  const horizontalReferences = actualReferenceValues.flatMap(({ color, value }) =>
    value ? [{ color, dash: "3 5", value: Date.parse(value) }] : [],
  );
  const updateHover = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.buttons !== 0) {
        setHoveredPoint(null);
        return;
      }
      const viewport = event.currentTarget;
      const bounds = viewport.getBoundingClientRect();
      const plotWidth = Math.max(1, viewport.clientWidth - FORECAST_CHART_HORIZONTAL_INSET_PX);
      const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left - 64) / plotWidth));
      const at = visibleDomain.from + ratio * (visibleDomain.until - visibleDomain.from);
      setHoveredPoint(
        nearestChartPoint(
          chartData
            .filter(
              (point) =>
                point.capturedAt >= visibleDomain.from && point.capturedAt <= visibleDomain.until,
            )
            .map((point) => ({ ...point, x: point.capturedAt })),
          at,
        ),
      );
    },
    [chartData, visibleDomain],
  );
  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onPointerMove(event);
      updateHover(event);
    },
    [onPointerMove, updateHover],
  );
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      setHoveredPoint(null);
      onPointerDown(event);
    },
    [onPointerDown],
  );
  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onPointerUp(event);
      if (!dragging) updateHover(event);
    },
    [dragging, onPointerUp, updateHover],
  );
  const hoveredPayload = hoveredPoint
    ? [
        { color: "var(--analytics-boarding)", name: "Boarding", value: hoveredPoint.boardingAt },
        {
          color: "var(--analytics-departure)",
          name: "Off-Block",
          value: hoveredPoint.departureAt,
        },
        { color: "var(--analytics-landing)", name: "On-Block", value: hoveredPoint.landingAt },
        {
          color: "var(--analytics-completion)",
          name: "Abschluss",
          value: hoveredPoint.completionAt,
        },
      ]
    : [];
  const hoveredLeft = hoveredPoint
    ? 64 +
      ((hoveredPoint.capturedAt - visibleDomain.from) /
        Math.max(1, visibleDomain.until - visibleDomain.from)) *
        Math.max(1, chartWidth - FORECAST_CHART_HORIZONTAL_INSET_PX)
    : 0;
  return (
    <>
      <TimeDiagramZoomControls
        onChange={changeZoom}
        onReset={reset}
        value={zoom}
        zoomLevels={zoomLevels}
      />
      <div
        className={`flight-director-chart-viewport time-diagram-viewport${zoom > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
        onClickCapture={onClickCapture}
        onPointerCancel={onPointerCancel}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => setHoveredPoint(null)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheelCapture={() => setHoveredPoint(null)}
        ref={setViewportRef}
      >
        <div
          aria-label="Prognosediagramm; mit Strg und Mausrad zoomen, mit dem Mausrad oder durch Ziehen verschieben"
          className="flight-director-forecast-chart"
          role="img"
        >
          <TimeSeriesSvgChart
            className="flight-director-forecast-svg"
            formatXTick={(value) => formatTime(value, timeZone)}
            formatYTick={(value) => formatTime(value, timeZone)}
            height={260}
            horizontalReferences={horizontalReferences}
            insets={{ bottom: 22, left: 64, right: 28, top: 18 }}
            series={series}
            verticalReferences={
              rotation?.precalledAt &&
              Date.parse(rotation.precalledAt) >= visibleDomain.from &&
              Date.parse(rotation.precalledAt) <= visibleDomain.until
                ? [
                    {
                      color: "var(--ui-warning)",
                      dash: "4 4",
                      label: "GO TO GATE",
                      value: Date.parse(rotation.precalledAt),
                    },
                  ]
                : []
            }
            width={chartWidth}
            xDomain={[visibleDomain.from, visibleDomain.until]}
            xTicks={timeAxisTicks.map((tick) => tick.value)}
            yDomain={[minimum, maximum]}
            yTicks={yTicks}
          />
        </div>
        {hoveredPoint ? (
          <div
            className="flight-director-analytics-tooltip-position"
            data-edge={hoveredLeft > chartWidth - 190 ? "right" : "default"}
            style={{ left: hoveredLeft, top: 12 }}
          >
            <ForecastTooltip
              active
              label={hoveredPoint.capturedAt}
              payload={hoveredPayload}
              timeZone={timeZone}
            />
          </div>
        ) : null}
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
  );
}

function ForecastState({
  chartData,
  error,
  loading,
  resetKey,
  rotation,
  timeZone,
}: Readonly<{
  chartData: ForecastChartPoint[];
  error: string | null;
  loading: boolean;
  resetKey: string;
  rotation: Rotation | undefined;
  timeZone: string;
}>) {
  if (loading) return <AnalyticsLoading />;
  if (error) return <AnalyticsError message={error} />;
  if (chartData.length === 0) {
    return (
      <AnalyticsEmpty message="Für diese Fluggruppe wurden noch keine Prognose-Snapshots erfasst." />
    );
  }
  return (
    <ForecastDiagram
      chartData={chartData}
      resetKey={resetKey}
      rotation={rotation}
      timeZone={timeZone}
    />
  );
}

function ForecastSnapshotTable({
  entries,
  timeZone,
}: Readonly<{ entries: ForecastEntry[]; timeZone: string }>) {
  return (
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
          {entries.map((entry) => (
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
  );
}

function ForecastRotationPanel({
  board,
  entries,
  error,
  loading,
  resetKey,
  rotation,
}: Readonly<{
  board: OperationBoard;
  entries: ForecastEntry[];
  error: string | null;
  loading: boolean;
  resetKey: string;
  rotation: Rotation | undefined;
}>) {
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => sortedForecastEntries(entries), [entries]);
  const chartData = useMemo(() => forecastChartData(entries), [entries]);
  const timeZone = board.event.timeZone;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const visibleEntries = [...sorted]
    .reverse()
    .slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const actual = rotation?.timeline.actual;
  const milestones: Array<[string, string | null]> = [
    ["Boarding", actual?.boardingAt ?? null],
    ["Off-Block", actual?.departureAt ?? null],
    ["On-Block", actual?.landingAt ?? null],
    ["Abschluss", actual?.completionAt ?? null],
  ];
  const metrics = forecastMetrics(board, entries, sorted, rotation);

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
      <ForecastState
        chartData={chartData}
        error={error}
        loading={loading}
        resetKey={resetKey}
        rotation={rotation}
        timeZone={timeZone}
      />
      <ForecastSnapshotTable entries={visibleEntries} timeZone={timeZone} />
      {sorted.length > PAGE_SIZE && (
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
      )}
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
}: Readonly<{
  board: OperationBoard;
  forecastResults: Record<string, ForecastLoadResult>;
  onRotationIdChange: (rotationId: string) => void;
  onTicketGroupIdChange: (ticketGroupId: string) => void;
  rotationId: string;
  ticketGroupId: string;
  ticketGroups: AnalyticsTicketGroup[];
}>) {
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

function resourceOptions(board: OperationBoard, scopeType: ResourceScopeType): ResourceOption[] {
  if (scopeType === "AIRCRAFT") {
    return board.aircraft.map((entry) => ({
      id: entry.id,
      primary: entry.registration,
      secondary: `${entry.aircraftType} · ${entry.passengerSeats} Plätze`,
    }));
  }
  return board.pilots.map((entry) => {
    let secondary = "Inaktiv";
    if (entry.paused) secondary = "Pause";
    else if (entry.active) secondary = "Aktiv";
    return { id: entry.id, primary: entry.operationalCode, secondary };
  });
}

function resourceSummary(
  history: ResourceDayHistory | null,
  scopeType: ResourceScopeType,
): Array<[string, string | number]> {
  const metrics = history ? resourceDayMetrics(history) : null;
  if (scopeType === "PILOT") {
    return [
      ["Umläufe", history?.rotations.length ?? "–"],
      ["Bindungszeit", formatDuration(metrics?.bindingMinutes ?? null)],
      ["Gemessene Flugzeit", formatDuration(metrics?.flightMinutes ?? null)],
      ["Pausenzeit", formatDuration(metrics?.pauseMinutes ?? null)],
    ];
  }
  const seatUtilization = metrics?.averageSeatUtilization;
  return [
    ["Abgeschlossene Umläufe", metrics?.completedRotations ?? "–"],
    ["Bindungszeit", formatDuration(metrics?.bindingMinutes ?? null)],
    ["Ø Turnaround", formatDuration(metrics?.averageTurnaroundMinutes ?? null)],
    ["Ø Sitzauslastung", seatUtilization == null ? "–" : `${Math.round(seatUtilization * 100)} %`],
  ];
}

function ResourceIcon({ scopeType }: Readonly<{ scopeType: ResourceScopeType }>) {
  if (scopeType === "AIRCRAFT") return <Plane aria-hidden="true" />;
  return <UserRound aria-hidden="true" />;
}

function ResourceAnalyticsState({
  children,
  error,
  hasHistory,
  loading,
}: Readonly<{
  children: ReactNode;
  error: string | null;
  hasHistory: boolean;
  loading: boolean;
}>) {
  if (loading) return <AnalyticsLoading />;
  if (error) return <AnalyticsError message={error} />;
  if (!hasHistory) {
    return (
      <AnalyticsEmpty message="Für diese Ressource liegen in der Veranstaltung noch keine bestätigten Umläufe vor." />
    );
  }
  return children;
}

function resourceTimelineTitle(
  item: ResourceTimelineRotation,
  ticketGroupLabels: readonly string[],
  timeZone: string,
): string {
  return `${ticketGroupDescription(ticketGroupLabels)} · Fluggruppe ${item.label} · ${formatTime(item.rotation.actual.boardingAt, timeZone)}–${formatTime(item.rotation.actual.completionAt, timeZone)} Uhr · ${item.rotation.passengerCount}/${item.rotation.usableCapacity} Personen · ${item.rotation.aircraftRegistration ?? "kein Flugzeug"} · ${item.rotation.pilotOperationalCode ?? "kein Pilot"}`;
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
}: Readonly<{
  board: OperationBoard;
  error: string | null;
  history: ResourceDayHistory | null;
  loading: boolean;
  onOpenRotation: (rotationId: string) => void;
  onScopeIdChange: (scopeId: string) => void;
  scopeId: string;
  scopeType: ResourceScopeType;
}>) {
  const timelineFrom = history ? Date.parse(history.from) : 0;
  const timelineUntil = history ? Date.parse(history.until) : 1;
  const timelineSpan = Math.max(1, timelineUntil - timelineFrom);
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
    domain: { from: timelineFrom, until: timelineUntil },
    insets: { left: 0, right: 0 },
    resetKey: `${scopeType}:${scopeId}`,
  });
  const timeZone = board.event.timeZone;
  const resources = resourceOptions(board, scopeType);
  const selected = resources.find((resource) => resource.id === scopeId);
  const timelineRotations = useMemo(
    () => (history ? resourceTimelineRotations(history) : []),
    [history],
  );
  const blocks = history?.blocks ?? [];
  const observedUntil = history?.observedUntil ?? new Date(timelineUntil).toISOString();
  const timelinePercent = (value: string | number) =>
    Math.min(
      100,
      Math.max(
        0,
        timeToPercent(typeof value === "number" ? value : Date.parse(value), visibleDomain),
      ),
    );
  const timelineTicks = calculateTimeAxisTicks({
    from: visibleDomain.from,
    minimumLabelSpacing: MINIMUM_TIME_LABEL_SPACING_PX,
    pixelWidth: Math.max(320, viewportWidth || 720) - RESOURCE_CHART_HORIZONTAL_INSET_PX,
    timeZone,
    until: visibleDomain.until,
  }).map((tick) => ({
    ...tick,
    percent: timeToPercent(tick.value, visibleDomain),
  }));
  const ticketGroupsByRotationId = useMemo(() => {
    return new Map(
      board.rotations.map((rotation) => [rotation.id, rotationGroupLabelList(rotation)]),
    );
  }, [board.rotations]);
  const summary = resourceSummary(history, scopeType);
  const isAircraft = scopeType === "AIRCRAFT";
  const selectionLabel = isAircraft ? "Flugzeug auswählen" : "Pilot auswählen";
  const resourceLabel = isAircraft ? "Flugzeuge" : "Piloten";
  const heading = isAircraft ? "Tagesumlauf" : "Piloteneinsatz";
  const description = isAircraft
    ? "Bestätigte Boarding-, Flug- und Turnaround-Zeiten einschließlich Sperren."
    : "Organisatorische Zuordnung zu Umläufen, Flugzeugen und erfassten Pausen.";

  return (
    <div className="flight-director-resource-layout">
      <aside aria-label={selectionLabel}>
        <strong>{resourceLabel}</strong>
        {resources.map((resource) => (
          <button
            aria-pressed={resource.id === scopeId}
            className={resource.id === scopeId ? "active" : ""}
            key={resource.id}
            onClick={() => onScopeIdChange(resource.id)}
            type="button"
          >
            <ResourceIcon scopeType={scopeType} />
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
              {heading} {selected?.primary ?? ""}
            </h3>
            <p>{description}</p>
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
        <ResourceAnalyticsState
          error={error}
          hasHistory={history !== null && timelineRotations.length > 0}
          loading={loading}
        >
          <TimeDiagramZoomControls
            onChange={changeZoom}
            onReset={reset}
            value={zoom}
            zoomLevels={zoomLevels}
          />
          <div
            className={`flight-director-chart-viewport time-diagram-viewport${zoom > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
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
                      transform: timelineTickTransform(tick.percent),
                    }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
              <div className="resource-timeline-lane">
                {blocks.map((block) => {
                  const clipped = clipTimeInterval(
                    Date.parse(block.startedAt),
                    Date.parse(block.endedAt ?? observedUntil),
                    visibleDomain,
                  );
                  if (!clipped) return null;
                  const start = timelinePercent(clipped.from);
                  const end = timelinePercent(clipped.until);
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
                {Date.parse(observedUntil) >= visibleDomain.from &&
                  Date.parse(observedUntil) <= visibleDomain.until && (
                    <span
                      aria-hidden="true"
                      className="resource-timeline-observed"
                      style={{ left: `${timelinePercent(observedUntil)}%` }}
                    />
                  )}
                {timelineRotations.map((item) => {
                  const itemStart = Date.parse(item.rotation.actual.boardingAt ?? "");
                  const itemEnd = Date.parse(item.rotation.actual.completionAt ?? observedUntil);
                  const clippedItem = clipTimeInterval(itemStart, itemEnd, visibleDomain);
                  if (!clippedItem) return null;
                  const itemLeft = timelinePercent(clippedItem.from);
                  const itemRight = timelinePercent(clippedItem.until);
                  const width = Math.max(0.15, itemRight - itemLeft);
                  const ticketGroupLabels = ticketGroupsByRotationId.get(item.id) ?? [];
                  const title = resourceTimelineTitle(item, ticketGroupLabels, timeZone);
                  return (
                    <div
                      className="resource-timeline-rotation"
                      key={item.id}
                      style={{ left: `${itemLeft}%`, width: `${width}%` }}
                    >
                      {item.phases.map((phase) => {
                        const phaseStart = timelineFrom + (phase.startPercent / 100) * timelineSpan;
                        const phaseEnd = timelineFrom + (phase.endPercent / 100) * timelineSpan;
                        const clippedPhase = clipTimeInterval(phaseStart, phaseEnd, clippedItem);
                        if (!clippedPhase) return null;
                        return (
                          <span
                            aria-hidden="true"
                            className={`resource-timeline-phase resource-timeline-phase--${phase.type.toLowerCase()}`}
                            key={phase.type}
                            style={{
                              left: `${((timelinePercent(clippedPhase.from) - itemLeft) / width) * 100}%`,
                              width: `${Math.max(1, ((timelinePercent(clippedPhase.until) - timelinePercent(clippedPhase.from)) / width) * 100)}%`,
                            }}
                          />
                        );
                      })}
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
        </ResourceAnalyticsState>
        <div className="flight-director-analytics-table-wrap">
          <table className="flight-director-analytics-table is-resource-history">
            <colgroup>
              <col className="resource-ticket-groups" />
              <col className="resource-flight-group" />
              <col className="resource-aircraft" />
              <col className="resource-pilot" />
              <col className="resource-people" />
              <col className="resource-time" span={4} />
              <col className="resource-action" />
            </colgroup>
            <thead>
              <tr>
                <th>Ticketgruppe</th>
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
              {history?.rotations.map((rotation) => {
                const ticketGroupLabels = ticketGroupsByRotationId.get(rotation.rotationId) ?? [];
                const ticketGroupText =
                  ticketGroupLabels.length > 0 ? ticketGroupLabels.join(", ") : "–";
                return (
                  <tr key={rotation.rotationId}>
                    <td title={ticketGroupText}>{ticketGroupText}</td>
                    <td title={rotation.communicationLabel}>{rotation.communicationLabel}</td>
                    <td title={rotation.aircraftRegistration ?? undefined}>
                      {rotation.aircraftRegistration ?? "–"}
                    </td>
                    <td title={rotation.pilotOperationalCode ?? undefined}>
                      {rotation.pilotOperationalCode ?? "–"}
                    </td>
                    <td>
                      {rotation.passengerCount}/{rotation.usableCapacity}
                    </td>
                    <td>{formatTime(rotation.actual.boardingAt, timeZone)}</td>
                    <td>{formatTime(rotation.actual.departureAt, timeZone)}</td>
                    <td>{formatTime(rotation.actual.landingAt, timeZone)}</td>
                    <td>{formatTime(rotation.actual.completionAt, timeZone)}</td>
                    <td className="resource-history-action">
                      <IconButton
                        label={`Prognose für ${rotation.communicationLabel} öffnen`}
                        onClick={() => onOpenRotation(rotation.rotationId)}
                        size="compact"
                        type="button"
                      >
                        <ChartNoAxesCombined aria-hidden="true" />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
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
}: Readonly<FlightDirectorAnalyticsContentProps>) {
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
        } catch (error_: unknown) {
          return [
            id,
            {
              entries: [],
              error: error_ instanceof Error ? error_.message : "Prognoseverlauf nicht verfügbar.",
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
      .catch((error_: unknown) => {
        if (resourceRequestSequence.current !== requestId) return;
        setResourceError(
          error_ instanceof Error ? error_.message : "Tagesverlauf nicht verfügbar.",
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
