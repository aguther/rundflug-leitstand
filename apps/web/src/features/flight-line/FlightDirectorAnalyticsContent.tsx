import type { ForecastHistory, OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import { ArrowLeft, ArrowRight, ChartNoAxesCombined, Plane, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "../../design-system/components";
import type { AnalyticsTab } from "./FlightDirectorAnalyticsDialog";
import {
  boardingForecastChangeMinutes,
  forecastChartData,
  formatDuration,
  resourceDayMetrics,
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
  pilotId: string;
  rotationId: string;
  tab: AnalyticsTab;
}

const MINUTE_MS = 60_000;
const PAGE_SIZE = 8;

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

function ForecastPanel({
  board,
  entries,
  error,
  loading,
  onRotationIdChange,
  rotation,
  rotationId,
}: {
  board: OperationBoard;
  entries: ForecastEntry[];
  error: string | null;
  loading: boolean;
  onRotationIdChange: (rotationId: string) => void;
  rotation: Rotation | undefined;
  rotationId: string;
}) {
  const [page, setPage] = useState(0);
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
  const metrics = [
    { label: "Snapshots", value: sorted.length },
    { label: "Aktuelle Qualität", value: qualityLabel(latest?.quality) },
    {
      label: "Boarding seit letztem Stand",
      value: signedMinutes(boardingForecastChangeMinutes(entries)),
    },
    { label: "Datenbasis", value: latest ? `${latest.sampleSize} Umläufe` : "–" },
  ];
  const milestones: Array<[string, string | null]> = [
    ["Boarding", actual?.boardingAt ?? null],
    ["Off-Block", actual?.departureAt ?? null],
    ["On-Block", actual?.landingAt ?? null],
    ["Abschluss", actual?.completionAt ?? null],
  ];

  return (
    <section aria-labelledby="analytics-group-title" className="flight-director-analytics-panel">
      <header className="flight-director-analytics-panel-heading">
        <div>
          <h3 id="analytics-group-title">Prognoseverlauf {rotation?.communicationLabel ?? ""}</h3>
          <p>Wie sich die vier prognostizierten Meilensteine im Tagesverlauf verändert haben.</p>
        </div>
        <label>
          <span>Fluggruppe</span>
          <select onChange={(event) => onRotationIdChange(event.target.value)} value={rotationId}>
            {board.rotations.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.communicationLabel} · {entry.productName}
              </option>
            ))}
          </select>
        </label>
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
          <div className="flight-director-forecast-chart" role="img">
            <ResponsiveContainer height="100%" width="100%">
              <LineChart
                accessibilityLayer
                data={chartData}
                margin={{ top: 18, right: 28, bottom: 2, left: 12 }}
              >
                <CartesianGrid stroke="var(--ui-border)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="capturedAt"
                  domain={["dataMin", "dataMax"]}
                  minTickGap={44}
                  scale="time"
                  tickFormatter={(value: number) => formatTime(value, timeZone)}
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
    </section>
  );
}

interface TimelineRow {
  bindingRange: [number, number];
  boardingAt: number;
  departureAt: number | null;
  landingAt: number | null;
  completionAt: number | null;
  communicationLabel: string;
  rotation: ResourceDayHistory["rotations"][number];
}

function TimelineShape({
  height = 12,
  payload,
  width = 0,
  x = 0,
  y = 0,
}: {
  height?: number;
  payload?: TimelineRow;
  width?: number;
  x?: number;
  y?: number;
}) {
  if (!payload) return null;
  const [start, end] = payload.bindingRange;
  const span = Math.max(1, end - start);
  const position = (value: number | null) =>
    value === null ? null : x + ((Math.min(end, Math.max(start, value)) - start) / span) * width;
  const departureX = position(payload.departureAt) ?? x;
  const landingX = position(payload.landingAt) ?? departureX;
  const completionX = position(payload.completionAt) ?? x + width;
  const top = y + Math.max(0, (height - 14) / 2);
  return (
    <g>
      <rect
        className="timeline-boarding"
        height={14}
        rx={3}
        width={Math.max(2, departureX - x)}
        x={x}
        y={top}
      />
      {payload.departureAt !== null ? (
        <rect
          className="timeline-flight"
          height={14}
          width={Math.max(2, landingX - departureX)}
          x={departureX}
          y={top}
        />
      ) : null}
      {payload.landingAt !== null ? (
        <rect
          className="timeline-turnaround"
          height={14}
          rx={3}
          width={Math.max(2, completionX - landingX)}
          x={landingX}
          y={top}
        />
      ) : null}
    </g>
  );
}

function ResourceTooltip({
  active,
  payload,
  timeZone,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: TimelineRow }>;
  timeZone: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="flight-director-analytics-tooltip">
      <strong>{row.communicationLabel}</strong>
      <span>
        {formatTime(row.rotation.actual.boardingAt, timeZone)}–{" "}
        {formatTime(row.rotation.actual.completionAt, timeZone)} Uhr
      </span>
      <span>
        {row.rotation.passengerCount}/{row.rotation.usableCapacity} Plätze ·{" "}
        {row.rotation.aircraftRegistration ?? "kein Flugzeug"} ·{" "}
        {row.rotation.pilotOperationalCode ?? "kein Pilot"}
      </span>
    </div>
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
  const timelineRows = useMemo<TimelineRow[]>(
    () =>
      history?.rotations
        .filter((rotation) => rotation.actual.boardingAt)
        .map((rotation) => {
          const boardingAt = Date.parse(rotation.actual.boardingAt ?? history.from);
          const completionAt = Date.parse(rotation.actual.completionAt ?? history.observedUntil);
          return {
            bindingRange: [boardingAt, Math.max(boardingAt + 1, completionAt)],
            boardingAt,
            departureAt: rotation.actual.departureAt
              ? Date.parse(rotation.actual.departureAt)
              : null,
            landingAt: rotation.actual.landingAt ? Date.parse(rotation.actual.landingAt) : null,
            completionAt: rotation.actual.completionAt
              ? Date.parse(rotation.actual.completionAt)
              : null,
            communicationLabel: rotation.communicationLabel,
            rotation,
          };
        }) ?? [],
    [history],
  );
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
        ) : !history || timelineRows.length === 0 ? (
          <AnalyticsEmpty message="Für diese Ressource liegen heute noch keine bestätigten Umläufe vor." />
        ) : (
          <>
            <div className="flight-director-resource-chart" role="img">
              <ResponsiveContainer height="100%" width="100%">
                <BarChart
                  accessibilityLayer
                  barCategoryGap={12}
                  data={timelineRows}
                  layout="vertical"
                  margin={{ top: 14, right: 24, bottom: 2, left: 8 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="var(--ui-border)"
                    strokeDasharray="2 4"
                  />
                  <XAxis
                    domain={[Date.parse(history.from), Date.parse(history.until)]}
                    scale="time"
                    tickFormatter={(value: number) => formatTime(value, timeZone)}
                    type="number"
                  />
                  <YAxis
                    dataKey="communicationLabel"
                    tick={{ fontSize: 11 }}
                    type="category"
                    width={86}
                  />
                  <Tooltip
                    content={(props) => (
                      <ResourceTooltip
                        active={props.active}
                        payload={props.payload}
                        timeZone={timeZone}
                      />
                    )}
                    cursor={{ fill: "color-mix(in srgb, var(--ui-accent) 7%, transparent)" }}
                  />
                  {history.blocks.map((block) => (
                    <ReferenceArea
                      className={`resource-block resource-block--${block.type.toLowerCase()}`}
                      fill={
                        block.type === "REFUELING"
                          ? "var(--analytics-refueling)"
                          : block.type === "INTERRUPTION"
                            ? "var(--analytics-interruption)"
                            : "var(--analytics-pause)"
                      }
                      fillOpacity={0.14}
                      key={block.id}
                      x1={Date.parse(block.startedAt)}
                      x2={Date.parse(block.endedAt ?? history.observedUntil)}
                    />
                  ))}
                  <ReferenceLine
                    stroke="var(--ui-border-strong)"
                    strokeDasharray="4 4"
                    x={Date.parse(history.observedUntil)}
                  />
                  <Bar
                    dataKey="bindingRange"
                    isAnimationActive={false}
                    shape={(props) => <TimelineShape {...props} />}
                  />
                </BarChart>
              </ResponsiveContainer>
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
  pilotId,
  rotationId,
  tab,
}: FlightDirectorAnalyticsContentProps) {
  const [forecastEntries, setForecastEntries] = useState<ForecastEntry[]>([]);
  const [resourceHistory, setResourceHistory] = useState<ResourceDayHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const forecastCache = useRef(new Map<string, ForecastEntry[]>());
  const resourceCache = useRef(new Map<string, ResourceDayHistory>());

  useEffect(() => {
    const requestId = ++requestSequence.current;
    setError(null);
    if (tab === "groups") {
      if (!rotationId) {
        setForecastEntries([]);
        return;
      }
      const cached = forecastCache.current.get(rotationId);
      if (cached) {
        setForecastEntries(cached);
        setLoading(false);
        return;
      }
      setLoading(true);
      void loadForecastHistory(rotationId)
        .then((entries) => {
          if (requestSequence.current !== requestId) return;
          forecastCache.current.set(rotationId, entries);
          setForecastEntries(entries);
        })
        .catch((caught: unknown) => {
          if (requestSequence.current !== requestId) return;
          setError(caught instanceof Error ? caught.message : "Prognoseverlauf nicht verfügbar.");
        })
        .finally(() => {
          if (requestSequence.current === requestId) setLoading(false);
        });
      return;
    }

    const scopeType = tab === "aircraft" ? "AIRCRAFT" : "PILOT";
    const scopeId = tab === "aircraft" ? aircraftId : pilotId;
    if (!scopeId) {
      setResourceHistory(null);
      return;
    }
    const cacheKey = `${scopeType}:${scopeId}`;
    const cached = resourceCache.current.get(cacheKey);
    if (cached) {
      setResourceHistory(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadResourceHistory(scopeType, scopeId)
      .then((history) => {
        if (requestSequence.current !== requestId) return;
        resourceCache.current.set(cacheKey, history);
        setResourceHistory(history);
      })
      .catch((caught: unknown) => {
        if (requestSequence.current !== requestId) return;
        setError(caught instanceof Error ? caught.message : "Tagesverlauf nicht verfügbar.");
      })
      .finally(() => {
        if (requestSequence.current === requestId) setLoading(false);
      });
  }, [aircraftId, loadForecastHistory, loadResourceHistory, pilotId, rotationId, tab]);

  if (tab === "groups") {
    return (
      <ForecastPanel
        board={board}
        entries={forecastEntries}
        error={error}
        key={rotationId}
        loading={loading}
        onRotationIdChange={onRotationIdChange}
        rotation={board.rotations.find((entry) => entry.id === rotationId)}
        rotationId={rotationId}
      />
    );
  }
  return (
    <ResourcePanel
      board={board}
      error={error}
      history={resourceHistory}
      loading={loading}
      onOpenRotation={onOpenRotation}
      onScopeIdChange={tab === "aircraft" ? onAircraftIdChange : onPilotIdChange}
      scopeId={tab === "aircraft" ? aircraftId : pilotId}
      scopeType={tab === "aircraft" ? "AIRCRAFT" : "PILOT"}
    />
  );
}
