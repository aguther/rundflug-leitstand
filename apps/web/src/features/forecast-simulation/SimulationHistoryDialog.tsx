import { ArrowUpRight, CheckCircle2, Download, Info, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, ModalDialog } from "../../design-system/components";
import {
  forecastUncertaintyLabel,
  type SimulationAircraft,
  type SimulationEvent,
  type SimulationForecastSnapshot,
  type SimulationResult,
  type SimulationRotation,
} from "./model";

const MINUTE_MS = 60_000;

const timeFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Berlin",
});

function formatTime(value: string | number | null): string {
  if (value === null) return "–";
  return timeFormatter.format(new Date(value));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} Min.`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return `${hours}:${String(remainder).padStart(2, "0")} h`;
}

function visibleMilestone(value: string | null, visibleAt: number): string | null {
  return value && Date.parse(value) <= visibleAt ? value : null;
}

function rotationAt(rotation: SimulationRotation, visibleAt: number): SimulationRotation | null {
  if (Date.parse(rotation.createdAt) > visibleAt) return null;
  const calledAt = visibleMilestone(rotation.calledAt, visibleAt);
  const precalledAt = visibleMilestone(rotation.precalledAt, visibleAt);
  return {
    ...rotation,
    precalledAt,
    precallTrigger: precalledAt ? rotation.precallTrigger : null,
    precallPredictionQuality: precalledAt ? rotation.precallPredictionQuality : null,
    precallPredictedBoardingAt: precalledAt ? rotation.precallPredictedBoardingAt : null,
    precallAdaptiveLeadMinutes: precalledAt ? rotation.precallAdaptiveLeadMinutes : null,
    aircraftId: calledAt ? rotation.aircraftId : null,
    calledAt,
    departedAt: visibleMilestone(rotation.departedAt, visibleAt),
    landedAt: visibleMilestone(rotation.landedAt, visibleAt),
    completedAt: visibleMilestone(rotation.completedAt, visibleAt),
  };
}

function rotationStatus(rotation: SimulationRotation): string {
  if (rotation.completedAt) return "Abgeschlossen";
  if (rotation.landedAt) return "On-Block";
  if (rotation.departedAt) return "Im Flug";
  if (rotation.calledAt) return "Boarding";
  if (rotation.precalledAt) return "GO TO GATE";
  return "Wartend";
}

function qualityLabel(quality: SimulationForecastSnapshot["quality"]): string {
  if (quality === "STABLE") return "Stabil";
  if (quality === "CHANGING") return "Veränderlich";
  return "Unsicher";
}

function statusLabel(
  status: SimulationForecastSnapshot["status"],
  capturedAt: string,
  precalledAt: string | null,
): string {
  if (precalledAt === capturedAt) return "GO TO GATE erfasst";
  if (status === "DRAFT") return "Wartend";
  if (status === "CALLED") return "Boarding";
  if (status === "IN_FLIGHT") return "Im Flug";
  return "On-Block";
}

function ForecastValue({
  snapshot,
  value,
}: {
  snapshot: SimulationForecastSnapshot;
  value: string;
}) {
  return (
    <span className="sim-history-forecast-value">
      {formatTime(value)}
      {snapshot.quality === "UNCERTAIN" ? <small>nicht freigegeben</small> : null}
    </span>
  );
}

const FORECAST_SERIES = [
  ["predictedBoardingAt", "Boarding (Prognose)", "boarding"],
  ["predictedDepartureAt", "Off-Block (Prognose)", "departure"],
  ["predictedLandingAt", "On-Block (Prognose)", "landing"],
  ["predictedCompletionAt", "Abschluss (Prognose)", "completion"],
] as const;

function GroupForecastChart({
  rotation,
  snapshots,
}: {
  rotation: SimulationRotation;
  snapshots: readonly SimulationForecastSnapshot[];
}) {
  if (snapshots.length === 0) {
    return <div className="sim-history-empty">Für diese Gruppe liegt noch kein Snapshot vor.</div>;
  }
  const width = 1_000;
  const height = 270;
  const paddingX = 48;
  const paddingY = 28;
  const capturedTimes = snapshots.map((snapshot) => Date.parse(snapshot.capturedAt));
  const values = [
    ...snapshots.flatMap((snapshot) =>
      FORECAST_SERIES.map(([field]) => Date.parse(snapshot[field])),
    ),
    ...[rotation.calledAt, rotation.departedAt, rotation.landedAt, rotation.completedAt]
      .filter((value): value is string => value !== null)
      .map(Date.parse),
  ].filter(Number.isFinite);
  const minimumX = Math.min(...capturedTimes);
  const maximumX = Math.max(...capturedTimes);
  const minimumY = Math.min(...values);
  const maximumY = Math.max(...values);
  const x = (value: number) =>
    paddingX +
    ((value - minimumX) / Math.max(TICK_FALLBACK_MS, maximumX - minimumX)) * (width - paddingX * 2);
  const y = (value: number) =>
    height -
    paddingY -
    ((value - minimumY) / Math.max(MINUTE_MS, maximumY - minimumY)) * (height - paddingY * 2);
  const actuals = [
    [rotation.calledAt, "boarding"],
    [rotation.departedAt, "departure"],
    [rotation.landedAt, "landing"],
    [rotation.completedAt, "completion"],
  ] as const;

  return (
    <div className="sim-history-chart-wrap">
      <div className="sim-history-chart-legend" aria-hidden="true">
        {FORECAST_SERIES.map(([, label, className]) => (
          <span data-series={className} key={className}>
            {label}
          </span>
        ))}
        <span data-series="actual">gestrichelt = Ist</span>
      </div>
      <svg
        aria-label="Verlauf sämtlicher Prognosesnapshots"
        className="sim-history-chart"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((position) => (
          <line
            className="sim-history-chart-grid"
            key={position}
            x1={paddingX}
            x2={width - paddingX}
            y1={paddingY + position * (height - paddingY * 2)}
            y2={paddingY + position * (height - paddingY * 2)}
          />
        ))}
        {actuals.map(([actualAt, className]) =>
          actualAt ? (
            <line
              className={`sim-history-chart-actual sim-history-chart-${className}`}
              key={className}
              x1={paddingX}
              x2={width - paddingX}
              y1={y(Date.parse(actualAt))}
              y2={y(Date.parse(actualAt))}
            />
          ) : null,
        )}
        {rotation.precalledAt ? (
          <g>
            <line
              className="sim-history-chart-precall"
              x1={x(Date.parse(rotation.precalledAt))}
              x2={x(Date.parse(rotation.precalledAt))}
              y1={paddingY}
              y2={height - paddingY}
            />
            <text
              className="sim-history-chart-precall-label"
              textAnchor="middle"
              x={x(Date.parse(rotation.precalledAt))}
              y={16}
            >
              GO TO GATE {formatTime(rotation.precalledAt)}
            </text>
          </g>
        ) : null}
        {FORECAST_SERIES.map(([field, , className]) => (
          <polyline
            className={`sim-history-chart-line sim-history-chart-${className}`}
            fill="none"
            key={field}
            points={snapshots
              .map(
                (snapshot) =>
                  `${x(Date.parse(snapshot.capturedAt))},${y(Date.parse(snapshot[field]))}`,
              )
              .join(" ")}
          />
        ))}
        <text x={4} y={paddingY + 4}>
          {formatTime(maximumY)}
        </text>
        <text x={4} y={height - paddingY + 4}>
          {formatTime(minimumY)}
        </text>
        <text x={paddingX} y={height - 5}>
          {formatTime(minimumX)}
        </text>
        <text textAnchor="end" x={width - paddingX} y={height - 5}>
          {formatTime(maximumX)}
        </text>
      </svg>
    </div>
  );
}

const TICK_FALLBACK_MS = 30_000;

const BLOCK_START_TYPES = new Set<SimulationEvent["type"]>([
  "REFUELING_STARTED",
  "PLANNED_PAUSE_STARTED",
  "UNPLANNED_PAUSE_STARTED",
  "TECHNICAL_DEFECT_REPORTED",
  "AIRCRAFT_DAY_OUT",
]);

function eventLabel(type: SimulationEvent["type"]): string {
  const labels: Partial<Record<SimulationEvent["type"], string>> = {
    REFUELING_STARTED: "Tanken",
    PLANNED_PAUSE_STARTED: "Geplante Pause",
    UNPLANNED_PAUSE_STARTED: "Ungeplante Pause",
    TECHNICAL_DEFECT_REPORTED: "Technischer Defekt",
    AIRCRAFT_DAY_OUT: "Tagesausfall",
    AIRCRAFT_RETURN_CONFIRMED: "Rückkehr bestätigt",
  };
  return labels[type] ?? type;
}

interface AircraftBlock {
  start: SimulationEvent;
  end: SimulationEvent | null;
}

function aircraftBlocks(events: readonly SimulationEvent[]): AircraftBlock[] {
  const blocks: AircraftBlock[] = [];
  let pending: SimulationEvent | null = null;
  for (const event of events) {
    if (BLOCK_START_TYPES.has(event.type)) {
      if (pending) blocks.push({ start: pending, end: null });
      pending = event;
    } else if (event.type === "AIRCRAFT_RETURN_CONFIRMED" && pending) {
      blocks.push({ start: pending, end: event });
      pending = null;
    }
  }
  if (pending) blocks.push({ start: pending, end: null });
  return blocks;
}

function AircraftTimeline({
  aircraft,
  rotations,
  blocks,
  startMs,
  endMs,
  onOpenGroup,
}: {
  aircraft: SimulationAircraft;
  rotations: readonly SimulationRotation[];
  blocks: readonly AircraftBlock[];
  startMs: number;
  endMs: number;
  onOpenGroup: (rotationId: string) => void;
}) {
  const span = Math.max(1, endMs - startMs);
  const position = (at: string) =>
    Math.max(0, Math.min(100, ((Date.parse(at) - startMs) / span) * 100));
  return (
    <section
      className="sim-aircraft-history-timeline"
      aria-label={`Tagesverlauf ${aircraft.registration}`}
    >
      <div className="sim-aircraft-history-scale">
        {Array.from({ length: 9 }, (_, index) => {
          const at = startMs + (span / 8) * index;
          return (
            <time key={at} style={{ left: `${(index / 8) * 100}%` }}>
              {formatTime(at)}
            </time>
          );
        })}
      </div>
      <div className="sim-aircraft-history-track">
        {rotations.map((rotation) => {
          if (!rotation.calledAt) return null;
          const endAt = rotation.completedAt ?? new Date(endMs).toISOString();
          const left = position(rotation.calledAt);
          const right = position(endAt);
          const totalMinutes = Math.max(
            0.5,
            (Date.parse(endAt) - Date.parse(rotation.calledAt)) / MINUTE_MS,
          );
          const boarding = rotation.departedAt
            ? (Date.parse(rotation.departedAt) - Date.parse(rotation.calledAt)) / MINUTE_MS
            : totalMinutes;
          const flight =
            rotation.departedAt && rotation.landedAt
              ? (Date.parse(rotation.landedAt) - Date.parse(rotation.departedAt)) / MINUTE_MS
              : 0;
          return (
            <button
              aria-label={`Fluggruppe ${rotation.communicationNumber}`}
              className="sim-aircraft-rotation-block"
              key={rotation.id}
              onClick={() => onOpenGroup(rotation.id)}
              style={{ left: `${left}%`, width: `${Math.max(0.7, right - left)}%` }}
              type="button"
            >
              <b>{rotation.communicationNumber}</b>
              <span
                className="sim-aircraft-phase sim-aircraft-phase--boarding"
                style={{ width: `${Math.min(100, (boarding / totalMinutes) * 100)}%` }}
              />
              <span
                className="sim-aircraft-phase sim-aircraft-phase--flight"
                style={{
                  left: `${Math.min(100, (boarding / totalMinutes) * 100)}%`,
                  width: `${Math.min(100, (flight / totalMinutes) * 100)}%`,
                }}
              />
              <span
                className="sim-aircraft-phase sim-aircraft-phase--ground"
                style={{
                  left: `${Math.min(100, ((boarding + flight) / totalMinutes) * 100)}%`,
                  right: 0,
                }}
              />
            </button>
          );
        })}
        {blocks.map((block) => {
          const left = position(block.start.occurredAt);
          const right = block.end ? position(block.end.occurredAt) : 100;
          return (
            <span
              className="sim-aircraft-incident-block"
              data-event={block.start.type}
              key={block.start.id}
              style={{ left: `${left}%`, width: `${Math.max(0.7, right - left)}%` }}
              title={`${eventLabel(block.start.type)} ab ${formatTime(block.start.occurredAt)}`}
            >
              {eventLabel(block.start.type)}
            </span>
          );
        })}
      </div>
      <div className="sim-aircraft-history-legend">
        <span data-phase="boarding">Boarding / Bindung</span>
        <span data-phase="flight">Flug</span>
        <span data-phase="ground">Turnaround</span>
        <span data-phase="return">Rückkehr bestätigt</span>
      </div>
    </section>
  );
}

export interface SimulationHistoryDialogProps {
  open: boolean;
  result: SimulationResult;
  visibleAt: number;
  initialRotationId: string | null;
  initialAircraftId: string | null;
  onClose: () => void;
  onExport: () => void;
}

export function SimulationHistoryDialog({
  open,
  result,
  visibleAt,
  initialRotationId,
  initialAircraftId,
  onClose,
  onExport,
}: SimulationHistoryDialogProps) {
  const visibleRotations = useMemo(
    () =>
      result.rotations
        .map((rotation) => rotationAt(rotation, visibleAt))
        .filter((rotation): rotation is SimulationRotation => rotation !== null),
    [result.rotations, visibleAt],
  );
  const visibleSnapshots = useMemo(
    () => result.snapshots.filter((snapshot) => Date.parse(snapshot.capturedAt) <= visibleAt),
    [result.snapshots, visibleAt],
  );
  const visibleEvents = useMemo(
    () => result.events.filter((event) => Date.parse(event.occurredAt) <= visibleAt),
    [result.events, visibleAt],
  );
  const defaultRotationId =
    visibleRotations.find((rotation) => rotation.id === initialRotationId)?.id ??
    visibleRotations.filter((rotation) => rotation.completedAt).at(-1)?.id ??
    visibleRotations.at(-1)?.id ??
    null;
  const defaultAircraftId =
    result.aircraft.find((aircraft) => aircraft.id === initialAircraftId)?.id ??
    result.aircraft[0]?.id ??
    null;
  const [tab, setTab] = useState<"groups" | "aircraft">("groups");
  const [selectedRotationId, setSelectedRotationId] = useState<string | null>(defaultRotationId);
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(defaultAircraftId);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedRotationId(defaultRotationId);
    setSelectedAircraftId(defaultAircraftId);
    setTab("groups");
    setQuery("");
  }, [defaultAircraftId, defaultRotationId, open]);

  const snapshotsByRotation = useMemo(() => {
    const index = new Map<string, SimulationForecastSnapshot[]>();
    for (const snapshot of visibleSnapshots) {
      const values = index.get(snapshot.rotationId) ?? [];
      values.push(snapshot);
      index.set(snapshot.rotationId, values);
    }
    return index;
  }, [visibleSnapshots]);
  const selectedRotation =
    visibleRotations.find((rotation) => rotation.id === selectedRotationId) ??
    visibleRotations[0] ??
    null;
  const selectedAircraft =
    result.aircraft.find((aircraft) => aircraft.id === selectedAircraftId) ??
    result.aircraft[0] ??
    null;
  const selectedSnapshots = selectedRotation
    ? (snapshotsByRotation.get(selectedRotation.id) ?? [])
    : [];
  const filteredRotations = visibleRotations.filter((rotation) =>
    `${rotation.communicationNumber} ${rotation.aircraftId ?? ""}`
      .toLocaleLowerCase("de-DE")
      .includes(query.trim().toLocaleLowerCase("de-DE")),
  );
  const aircraftRotations = selectedAircraft
    ? visibleRotations.filter(
        (rotation) => rotation.aircraftId === selectedAircraft.id && rotation.calledAt,
      )
    : [];
  const aircraftEvents = selectedAircraft
    ? visibleEvents.filter((event) => event.aircraftId === selectedAircraft.id)
    : [];
  const blocks = aircraftBlocks(aircraftEvents);
  const operatingMinutes = aircraftRotations.reduce((total, rotation) => {
    if (!rotation.calledAt) return total;
    const until = rotation.completedAt ? Date.parse(rotation.completedAt) : visibleAt;
    return total + Math.max(0, (until - Date.parse(rotation.calledAt)) / MINUTE_MS);
  }, 0);
  const blockedMinutes = blocks.reduce((total, block) => {
    const until = block.end ? Date.parse(block.end.occurredAt) : visibleAt;
    return total + Math.max(0, (until - Date.parse(block.start.occurredAt)) / MINUTE_MS);
  }, 0);
  const elapsedMinutes = Math.max(1, (visibleAt - Date.parse(result.config.startAt)) / MINUTE_MS);
  const utilization = Math.min(100, (operatingMinutes / elapsedMinutes) * 100);

  const openAircraft = (aircraftId: string) => {
    setSelectedAircraftId(aircraftId);
    setTab("aircraft");
  };
  const openGroup = (rotationId: string) => {
    setSelectedRotationId(rotationId);
    setTab("groups");
  };

  return (
    <ModalDialog
      footer={
        <Button onClick={onExport}>
          <Download aria-hidden="true" /> JSON exportieren
        </Button>
      }
      onClose={onClose}
      open={open}
      size="wide"
      title="Verlaufsauswertung"
    >
      <div className="sim-history-dialog">
        <div className="sim-history-tabs" role="tablist">
          <button
            aria-selected={tab === "groups"}
            onClick={() => setTab("groups")}
            role="tab"
            type="button"
          >
            Fluggruppen
          </button>
          <button
            aria-selected={tab === "aircraft"}
            onClick={() => setTab("aircraft")}
            role="tab"
            type="button"
          >
            Flugzeuge
          </button>
        </div>

        {tab === "groups" ? (
          <div className="sim-group-history-layout">
            <aside className="sim-history-rail">
              <h3>Fluggruppen</h3>
              <label className="sim-history-search">
                <Search aria-hidden="true" />
                <span className="visually-hidden">Fluggruppe suchen</span>
                <input
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Fluggruppe suchen"
                  type="search"
                  value={query}
                />
              </label>
              <div className="sim-history-rail-list">
                {filteredRotations.map((rotation) => {
                  const aircraft = result.aircraft.find(
                    (candidate) => candidate.id === rotation.aircraftId,
                  );
                  return (
                    <button
                      aria-current={rotation.id === selectedRotation?.id ? "true" : undefined}
                      key={rotation.id}
                      onClick={() => setSelectedRotationId(rotation.id)}
                      type="button"
                    >
                      <strong>{rotation.communicationNumber}</strong>
                      {rotation.completedAt ? <CheckCircle2 aria-hidden="true" /> : null}
                      <span>{rotationStatus(rotation)}</span>
                      <small>{aircraft?.registration ?? "noch ohne Bindung"}</small>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="sim-group-history-content">
              {selectedRotation ? (
                <>
                  <header className="sim-history-title-row">
                    <div>
                      <h3>Fluggruppe {selectedRotation.communicationNumber}</h3>
                      <span data-status={rotationStatus(selectedRotation)}>
                        {rotationStatus(selectedRotation)}
                      </span>
                    </div>
                    {selectedRotation.aircraftId ? (
                      <button
                        onClick={() => openAircraft(selectedRotation.aircraftId ?? "")}
                        type="button"
                      >
                        <ArrowUpRight aria-hidden="true" />
                        {
                          result.aircraft.find(
                            (aircraft) => aircraft.id === selectedRotation.aircraftId,
                          )?.registration
                        }{" "}
                        öffnen
                      </button>
                    ) : null}
                  </header>

                  <ol className="sim-history-milestones">
                    {[
                      ["GO TO GATE", selectedRotation.precalledAt, "precall"],
                      ["Boarding", selectedRotation.calledAt, "boarding"],
                      ["Off-Block", selectedRotation.departedAt, "departure"],
                      ["On-Block", selectedRotation.landedAt, "landing"],
                      ["Abgeschlossen", selectedRotation.completedAt, "completion"],
                    ].map(([label, value, phase]) => (
                      <li data-complete={value ? "true" : "false"} data-phase={phase} key={label}>
                        <span />
                        <strong>{label}</strong>
                        <time>{formatTime(value ?? null)}</time>
                        {phase === "precall" && value ? (
                          <small>systemseitig · noch ohne Flugzeugbindung</small>
                        ) : null}
                      </li>
                    ))}
                  </ol>

                  <section className="sim-history-section sim-history-chart-section">
                    <h4>Verlauf jeder einzelnen Prognose</h4>
                    <GroupForecastChart rotation={selectedRotation} snapshots={selectedSnapshots} />
                  </section>

                  <section className="sim-history-section sim-history-snapshot-section">
                    <h4>Alle Prognose-Snapshots</h4>
                    <div className="sim-history-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Snapshot</th>
                            <th>Status</th>
                            <th>Qualität</th>
                            <th>Boarding</th>
                            <th>Off-Block</th>
                            <th>On-Block</th>
                            <th>Abschluss</th>
                            <th>Stichprobe</th>
                            <th>Lernwertalter</th>
                            <th>Kapazität</th>
                            <th>Unterdrückungsgrund</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedSnapshots.map((snapshot) => (
                            <tr key={`${snapshot.rotationId}:${snapshot.capturedAt}`}>
                              <td>{formatTime(snapshot.capturedAt)}</td>
                              <td>
                                {statusLabel(
                                  snapshot.status,
                                  snapshot.capturedAt,
                                  selectedRotation.precalledAt,
                                )}
                              </td>
                              <td>
                                <span
                                  className="sim-history-quality"
                                  data-quality={snapshot.quality}
                                >
                                  {qualityLabel(snapshot.quality)}
                                </span>
                              </td>
                              <td>
                                <ForecastValue
                                  snapshot={snapshot}
                                  value={snapshot.predictedBoardingAt}
                                />
                              </td>
                              <td>
                                <ForecastValue
                                  snapshot={snapshot}
                                  value={snapshot.predictedDepartureAt}
                                />
                              </td>
                              <td>
                                <ForecastValue
                                  snapshot={snapshot}
                                  value={snapshot.predictedLandingAt}
                                />
                              </td>
                              <td>
                                <ForecastValue
                                  snapshot={snapshot}
                                  value={snapshot.predictedCompletionAt}
                                />
                              </td>
                              <td>n={snapshot.sampleSize}</td>
                              <td>{snapshot.dataAgeMinutes.toFixed(1)} Min.</td>
                              <td>{snapshot.activeCapacity}</td>
                              <td>
                                {snapshot.uncertaintyReasons.length === 0
                                  ? "–"
                                  : forecastUncertaintyLabel(snapshot.uncertaintyReasons)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              ) : (
                <div className="sim-history-empty">Noch keine Fluggruppe im sichtbaren Lauf.</div>
              )}
            </section>
          </div>
        ) : (
          <div className="sim-aircraft-history-layout">
            <aside className="sim-history-rail">
              <h3>Flugzeuge</h3>
              <div className="sim-history-rail-list">
                {result.aircraft.map((aircraft) => {
                  const rotations = visibleRotations.filter(
                    (rotation) => rotation.aircraftId === aircraft.id,
                  );
                  return (
                    <button
                      aria-current={aircraft.id === selectedAircraft?.id ? "true" : undefined}
                      key={aircraft.id}
                      onClick={() => setSelectedAircraftId(aircraft.id)}
                      type="button"
                    >
                      <strong>{aircraft.registration}</strong>
                      <b>{rotations.filter((rotation) => rotation.completedAt).length}</b>
                      <span>{aircraft.aircraftType}</span>
                      <small>{aircraft.capacity} Sitzplätze · Umläufe</small>
                    </button>
                  );
                })}
              </div>
            </aside>

            {selectedAircraft ? (
              <section className="sim-aircraft-history-content">
                <header className="sim-aircraft-summary">
                  <div>
                    <h3>{selectedAircraft.registration}</h3>
                    <span>
                      {selectedAircraft.aircraftType} · {selectedAircraft.capacity} Sitzplätze
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dd>{aircraftRotations.filter((rotation) => rotation.completedAt).length}</dd>
                      <dt>Umläufe</dt>
                    </div>
                    <div>
                      <dd>{formatDuration(operatingMinutes)}</dd>
                      <dt>Betriebszeit</dt>
                    </div>
                    <div>
                      <dd>{formatDuration(blockedMinutes)}</dd>
                      <dt>gesperrt</dt>
                    </div>
                    <div>
                      <dd>{Math.round(utilization)} %</dd>
                      <dt>Auslastung</dt>
                    </div>
                  </dl>
                </header>
                <p className="sim-aircraft-history-note">
                  <Info aria-hidden="true" />
                  Prognosen vor Boarding gehören zur Fluggruppe; die Flugzeugbindung beginnt erst
                  mit Boarding.
                </p>
                <AircraftTimeline
                  aircraft={selectedAircraft}
                  blocks={blocks}
                  endMs={visibleAt}
                  onOpenGroup={openGroup}
                  rotations={aircraftRotations}
                  startMs={Date.parse(result.config.startAt)}
                />
                <div className="sim-aircraft-history-tables">
                  <section className="sim-history-section">
                    <h4>Realisierte Umläufe</h4>
                    <div className="sim-history-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Gruppe</th>
                            <th>GO TO GATE</th>
                            <th>Boarding / Bindung</th>
                            <th>Off-Block</th>
                            <th>On-Block</th>
                            <th>Abgeschlossen</th>
                            <th>Aktion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aircraftRotations.map((rotation) => (
                            <tr key={rotation.id}>
                              <td>{rotation.communicationNumber}</td>
                              <td>
                                {formatTime(rotation.precalledAt)}
                                {rotation.precalledAt ? <small>vor Bindung</small> : null}
                              </td>
                              <td>{formatTime(rotation.calledAt)}</td>
                              <td>{formatTime(rotation.departedAt)}</td>
                              <td>{formatTime(rotation.landedAt)}</td>
                              <td>{formatTime(rotation.completedAt)}</td>
                              <td>
                                <button onClick={() => openGroup(rotation.id)} type="button">
                                  Gruppe öffnen
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="sim-history-section">
                    <h4>Sperren und Rückkehrereignisse</h4>
                    <div className="sim-history-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Beginn</th>
                            <th>Ende bestätigt</th>
                            <th>Dauer</th>
                            <th>Ursache</th>
                          </tr>
                        </thead>
                        <tbody>
                          {blocks.map((block) => {
                            const duration = block.end
                              ? (Date.parse(block.end.occurredAt) -
                                  Date.parse(block.start.occurredAt)) /
                                MINUTE_MS
                              : null;
                            return (
                              <tr key={block.start.id}>
                                <td>{formatTime(block.start.occurredAt)}</td>
                                <td>{formatTime(block.end?.occurredAt ?? null)}</td>
                                <td>{duration === null ? "offen" : formatDuration(duration)}</td>
                                <td>{eventLabel(block.start.type)}</td>
                              </tr>
                            );
                          })}
                          {aircraftEvents
                            .filter((event) => event.type === "AIRCRAFT_RETURN_CONFIRMED")
                            .map((event) => (
                              <tr key={event.id}>
                                <td>{formatTime(event.occurredAt)}</td>
                                <td>{formatTime(event.occurredAt)}</td>
                                <td>–</td>
                                <td>Rückkehr bestätigt</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
