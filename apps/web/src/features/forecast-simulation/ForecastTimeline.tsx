import { type FocusEvent, type KeyboardEvent, type MouseEvent, useRef, useState } from "react";
import { TimeDiagramZoomControls } from "../../shared/TimeDiagramZoomControls";
import {
  timeDiagramAxisTickValues,
  useTimeDiagramViewport,
} from "../../shared/time-diagram-viewport";

import {
  forecastUncertaintyLabel,
  type SimulationEvent,
  type SimulationEventType,
  type SimulationForecastSnapshot,
  type SimulationPlannedOperation,
  type SimulationResult,
  type SimulationRotation,
} from "./model";

const MINUTE_MS = 60_000;
const WINDOW_MINUTES = 180;

const timeFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Berlin",
});

function formatTime(value: string | number): string {
  return timeFormatter.format(new Date(value));
}

function statusAt(rotation: SimulationRotation, nowMs: number) {
  if (!rotation.calledAt || Date.parse(rotation.calledAt) > nowMs) return "DRAFT" as const;
  if (!rotation.departedAt || Date.parse(rotation.departedAt) > nowMs) return "CALLED" as const;
  if (!rotation.landedAt || Date.parse(rotation.landedAt) > nowMs) return "IN_FLIGHT" as const;
  if (!rotation.completedAt || Date.parse(rotation.completedAt) > nowMs) return "LANDED" as const;
  return "COMPLETED" as const;
}

function latestSnapshot(
  snapshots: readonly SimulationForecastSnapshot[],
  rotationId: string,
  nowMs: number,
) {
  return snapshots.findLast(
    (snapshot) => snapshot.rotationId === rotationId && Date.parse(snapshot.capturedAt) <= nowMs,
  );
}

function percent(value: number, start: number, end: number): number {
  return ((value - start) / (end - start)) * 100;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function scrollTimelineWithKeyboard(event: KeyboardEvent<HTMLElement>) {
  const container = event.currentTarget;
  const page = Math.max(48, container.clientHeight * 0.8);
  switch (event.key) {
    case "PageDown":
      container.scrollBy({ top: page });
      break;
    case "PageUp":
      container.scrollBy({ top: -page });
      break;
    case "Home":
      container.scrollTo({ top: 0 });
      break;
    case "End":
      container.scrollTo({ top: container.scrollHeight });
      break;
    default:
      return;
  }
  event.preventDefault();
}

const keyboardScrollableRegionProps = {
  onKeyDown: scrollTimelineWithKeyboard,
  tabIndex: 0,
} as const;

function phaseStyle(
  from: number,
  until: number,
  start: number,
  end: number,
  visibleFrom: number,
  visibleUntil: number,
) {
  const boundedStart = Math.max(start, visibleFrom);
  const boundedEnd = Math.min(end, visibleUntil);
  return {
    left: `${clampPercent(percent(Math.max(from, boundedStart), boundedStart, boundedEnd))}%`,
    width: `${Math.max(0.45, clampPercent(percent(Math.min(until, boundedEnd), boundedStart, boundedEnd)) - clampPercent(percent(Math.max(from, boundedStart), boundedStart, boundedEnd)))}%`,
  };
}

const AIRCRAFT_INTERRUPTION_LABELS: Partial<Record<SimulationEventType, string>> = {
  REFUELING_STARTED: "Tanken",
  PLANNED_PAUSE_STARTED: "Geplante Pause",
  UNPLANNED_PAUSE_STARTED: "Ungeplante Pause",
  TECHNICAL_DEFECT_REPORTED: "Defekt",
  AIRCRAFT_DAY_OUT: "Tagesausfall",
  EVENT_INTERRUPTED: "Betrieb unterbrochen",
};

const AIRCRAFT_INTERRUPTION_START_TYPES = new Set<SimulationEventType>([
  "REFUELING_STARTED",
  "PLANNED_PAUSE_STARTED",
  "UNPLANNED_PAUSE_STARTED",
  "TECHNICAL_DEFECT_REPORTED",
  "AIRCRAFT_DAY_OUT",
]);

export interface TimelineInterruption {
  id: string;
  label: string;
  start: number;
  end: number;
  active: boolean;
  tone: "planned" | "service" | "unplanned";
  details: string;
}

function interruptionTone(type: SimulationEventType): TimelineInterruption["tone"] {
  if (type === "PLANNED_PAUSE_STARTED") return "planned";
  if (type === "REFUELING_STARTED") return "service";
  return "unplanned";
}

export function buildTimelineInterruptions(
  events: readonly SimulationEvent[],
  aircraftId: string | null,
  visibleAt: number,
  simulationEnd: number,
): TimelineInterruption[] {
  const startTypes =
    aircraftId === null
      ? new Set<SimulationEventType>(["EVENT_INTERRUPTED"])
      : AIRCRAFT_INTERRUPTION_START_TYPES;
  const endType = aircraftId === null ? "EVENT_RESUMED" : "AIRCRAFT_RETURN_CONFIRMED";
  const visibleEvents = events
    .filter(
      (event) =>
        Date.parse(event.occurredAt) <= visibleAt &&
        event.aircraftId === aircraftId &&
        (startTypes.has(event.type) || event.type === endType),
    )
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const interruptions: TimelineInterruption[] = [];
  let pending: SimulationEvent | null = null;

  for (const event of visibleEvents) {
    if (startTypes.has(event.type)) {
      if (pending) {
        interruptions.push({
          id: pending.id,
          label: AIRCRAFT_INTERRUPTION_LABELS[pending.type] ?? pending.type,
          start: Date.parse(pending.occurredAt),
          end: Date.parse(event.occurredAt),
          active: false,
          tone: interruptionTone(pending.type),
          details: pending.details,
        });
      }
      pending = event;
      continue;
    }
    if (!pending) continue;
    interruptions.push({
      id: pending.id,
      label: AIRCRAFT_INTERRUPTION_LABELS[pending.type] ?? pending.type,
      start: Date.parse(pending.occurredAt),
      end: Date.parse(event.occurredAt),
      active: false,
      tone: interruptionTone(pending.type),
      details: pending.details,
    });
    pending = null;
  }

  if (pending) {
    interruptions.push({
      id: pending.id,
      label: AIRCRAFT_INTERRUPTION_LABELS[pending.type] ?? pending.type,
      start: Date.parse(pending.occurredAt),
      end: Math.min(visibleAt, simulationEnd),
      active: true,
      tone: interruptionTone(pending.type),
      details: pending.details,
    });
  }

  return interruptions;
}

function interruptionTitle(interruption: TimelineInterruption): string {
  const until = interruption.active ? "offen" : formatTime(interruption.end);
  return `${interruption.label} · ${formatTime(interruption.start)}–${until} · ${interruption.details}`;
}

function buildPlannedSegments(input: {
  events: readonly SimulationEvent[];
  plans: readonly SimulationPlannedOperation[];
  simulationEnd: number;
  windowEnd: number;
  windowStart: number;
}) {
  return input.plans.flatMap((plan) => {
    const startEvent = input.events.find(
      (event) =>
        event.type === "PLANNED_OPERATION_STARTED" && event.plannedOperationId === plan.key,
    );
    if (!startEvent) return [];
    const start = Date.parse(startEvent.occurredAt);
    const endEvent = input.events.find(
      (event) =>
        event.type === "PLANNED_OPERATION_ENDED" &&
        event.plannedOperationId === plan.key &&
        Date.parse(event.occurredAt) >= start,
    );
    const end = endEvent ? Date.parse(endEvent.occurredAt) : input.simulationEnd;
    if (start >= input.windowEnd || end <= input.windowStart) return [];
    return [{ plan, start, end }];
  });
}

function isPrecalled(rotation: SimulationRotation, currentMs: number): boolean {
  return rotation.precalledAt !== null && Date.parse(rotation.precalledAt) <= currentMs;
}

function queueRotationLabel(
  rotation: SimulationRotation,
  index: number,
  currentMs: number,
): string {
  if (isPrecalled(rotation, currentMs)) return rotation.gateLabel ?? "Gate";
  const productPrefix = rotation.productCode ? `${rotation.productCode} · ` : "";
  return `${productPrefix}${index + 1}`;
}

function selectedForecastLabel(snapshot: SimulationForecastSnapshot | undefined): string {
  if (!snapshot) return "Noch keine Prognose";
  if (snapshot.forecastState === "UNAVAILABLE") return "Boardingprognose nicht verfügbar";
  const boarding = formatTime(snapshot.predictedBoardingAt);
  if (snapshot.quality !== "UNCERTAIN") return `Prognose Boarding ${boarding}`;
  return `Rohprognose Boarding ${boarding} · nicht freigegeben · ${forecastUncertaintyLabel(snapshot.uncertaintyReasons)}`;
}

function forecastQualityLabel(quality: SimulationForecastSnapshot["quality"] | undefined): string {
  if (!quality) return "nicht verfügbar";
  if (quality === "STABLE") return "stabil";
  if (quality === "CHANGING") return "veränderlich";
  return "unsicher";
}

export function ForecastTimeline({
  currentMs,
  result,
  selectedRotationId,
  onSelectRotation,
}: Readonly<{
  currentMs: number;
  result: SimulationResult;
  selectedRotationId: string | null;
  onSelectRotation: (rotationId: string) => void;
}>) {
  const simulationStart = Date.parse(result.runWindow.startAt);
  const simulationEnd = Date.parse(result.runWindow.endAt);
  const halfWindow = (WINDOW_MINUTES / 2) * MINUTE_MS;
  const windowStart = Math.max(
    simulationStart,
    Math.min(currentMs - halfWindow, simulationEnd - WINDOW_MINUTES * MINUTE_MS),
  );
  const windowEnd = Math.min(simulationEnd, windowStart + WINDOW_MINUTES * MINUTE_MS);
  const {
    changeZoom,
    dragging,
    following,
    onClickCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    reset,
    resumeFollowing,
    setViewportRef,
    viewportWidth,
    visibleDomain,
    zoom,
    zoomLevels,
  } = useTimeDiagramViewport({
    domain: { from: simulationStart, until: simulationEnd },
    followDomain: { from: windowStart, until: windowEnd },
    insets: { left: 112, right: 0 },
    resetKey: result,
  });
  const viewStart = visibleDomain.from;
  const viewEnd = visibleDomain.until;
  const ticks = timeDiagramAxisTickValues({
    domain: visibleDomain,
    pixelWidth: Math.max(320, viewportWidth || 720) - 112,
  });
  const visibleRotations = result.rotations.filter((rotation) => {
    if (!rotation.calledAt || !rotation.completedAt) return false;
    return Date.parse(rotation.calledAt) < viewEnd && Date.parse(rotation.completedAt) > viewStart;
  });
  const queue = result.rotations.filter(
    (rotation) =>
      Date.parse(rotation.createdAt) <= currentMs &&
      (!rotation.calledAt || Date.parse(rotation.calledAt) > currentMs),
  );
  const panelRef = useRef<HTMLElement | null>(null);
  const [tooltip, setTooltip] = useState<{
    left: number;
    rotationId: string;
    top: number;
  } | null>(null);
  const tooltipRotation = tooltip
    ? (result.rotations.find((rotation) => rotation.id === tooltip.rotationId) ?? null)
    : null;
  const tooltipSnapshot = tooltipRotation
    ? latestSnapshot(result.snapshots, tooltipRotation.id, currentMs)
    : undefined;
  const showTooltip = (
    rotationId: string,
    event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>,
  ) => {
    const panelBounds = panelRef.current?.getBoundingClientRect();
    const anchorBounds = event.currentTarget.getBoundingClientRect();
    if (!panelBounds) return;
    const rawLeft = anchorBounds.left - panelBounds.left + anchorBounds.width / 2;
    const left =
      panelBounds.width > 360
        ? Math.min(panelBounds.width - 170, Math.max(170, rawLeft))
        : Math.max(0, rawLeft);
    setTooltip({
      left,
      rotationId,
      top: Math.max(8, anchorBounds.top - panelBounds.top - 8),
    });
  };
  const hideTooltip = (rotationId: string) => {
    setTooltip((current) => (current?.rotationId === rotationId ? null : current));
  };
  const nowPosition = clampPercent(percent(currentMs, viewStart, viewEnd));
  const showNow = currentMs >= viewStart && currentMs <= viewEnd;
  const plannedSegments = buildPlannedSegments({
    events: result.events,
    plans: result.plannedOperations ?? [],
    simulationEnd,
    windowEnd: viewEnd,
    windowStart: viewStart,
  });
  const sharedPlannedSegments = plannedSegments.filter(({ plan }) => plan.scopeType !== "AIRCRAFT");
  const sharedInterruptions = buildTimelineInterruptions(
    result.events,
    null,
    currentMs,
    simulationEnd,
  ).filter(({ start, end }) => start < viewEnd && end >= viewStart);

  return (
    <section className="sim-timeline-panel" aria-label="Simulationszeitachse" ref={panelRef}>
      <header className="sim-timeline-heading">
        <div>
          <strong>Zeitleiste</strong>
          <span>
            {formatTime(viewStart)} – {formatTime(viewEnd)}
          </span>
        </div>
        <fieldset className="sim-timeline-legend">
          <legend className="visually-hidden">Legende</legend>
          <span className="sim-legend-window">Prognosefenster</span>
          <span className="sim-legend-actual">Ist (Ereignis)</span>
          <span className="sim-legend-boarding">Boarding</span>
          <span className="sim-legend-flight">Flug</span>
          <span className="sim-legend-ground">Boden</span>
          <span className="sim-legend-plan">Tagesplan</span>
          <span className="sim-legend-interruption">Unterbrechung / Ausfall</span>
        </fieldset>
      </header>
      <TimeDiagramZoomControls
        following={following}
        onChange={changeZoom}
        onResumeFollowing={resumeFollowing}
        onReset={reset}
        value={zoom}
        visibleSpanMs={visibleDomain.until - visibleDomain.from}
        zoomLevels={zoomLevels}
      />
      <div
        className={`sim-timeline-viewport time-diagram-viewport${zoom > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
        onClickCapture={onClickCapture}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={setViewportRef}
      >
        <div className="sim-timeline-scale">
          {ticks.map((tick) => (
            <time key={tick} style={{ left: `${percent(tick, viewStart, viewEnd)}%` }}>
              {formatTime(tick)}
            </time>
          ))}
        </div>
        <section
          {...keyboardScrollableRegionProps}
          aria-label="Tagesplan und Flugzeuge"
          className="sim-timeline-lanes"
        >
          {showNow ? (
            <div className="sim-now-track">
              <div className="sim-now-line" style={{ left: `${nowPosition}%` }}>
                <time>{formatTime(currentMs)}</time>
              </div>
            </div>
          ) : null}
          {sharedPlannedSegments.length > 0 || sharedInterruptions.length > 0 ? (
            <div className="sim-aircraft-lane sim-plan-lane">
              <div className="sim-aircraft-label">
                <strong>Tagesplan / Betrieb</strong>
                <small>Plan und globale Unterbrechung</small>
              </div>
              <div className="sim-lane-track">
                {sharedPlannedSegments.map(({ plan, start, end }) => (
                  <span
                    className="sim-planned-operation-bar"
                    data-active={start <= currentMs && currentMs < end}
                    key={plan.key}
                    style={{
                      left: `${clampPercent(percent(start, viewStart, viewEnd))}%`,
                      width: `${Math.max(
                        1.2,
                        clampPercent(percent(end, viewStart, viewEnd)) -
                          clampPercent(percent(start, viewStart, viewEnd)),
                      )}%`,
                    }}
                    title={plan.publicNote ? `${plan.kind} · ${plan.publicNote}` : plan.kind}
                  >
                    {plan.kind}
                  </span>
                ))}
                {sharedInterruptions.map((interruption) => (
                  <span
                    className="sim-interruption-bar sim-interruption-bar--shared"
                    data-active={interruption.active}
                    data-tone={interruption.tone}
                    key={interruption.id}
                    style={{
                      left: `${clampPercent(percent(interruption.start, viewStart, viewEnd))}%`,
                      width: `${Math.max(
                        1.2,
                        clampPercent(percent(interruption.end, viewStart, viewEnd)) -
                          clampPercent(percent(interruption.start, viewStart, viewEnd)),
                      )}%`,
                    }}
                    title={interruptionTitle(interruption)}
                  >
                    {interruption.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {result.aircraft.map((aircraft) => {
            const rotations = visibleRotations.filter(
              (rotation) => rotation.aircraftId === aircraft.id,
            );
            const interruptions = buildTimelineInterruptions(
              result.events,
              aircraft.id,
              currentMs,
              simulationEnd,
            ).filter(({ start, end }) => start < viewEnd && end >= viewStart);
            return (
              <div className="sim-aircraft-lane" key={aircraft.id}>
                <div className="sim-aircraft-label">
                  <strong>{aircraft.registration}</strong>
                  <small>{aircraft.aircraftType}</small>
                  <span>Sitzplätze {aircraft.capacity}</span>
                </div>
                <div className="sim-lane-track">
                  {ticks.map((tick) => (
                    <i
                      aria-hidden="true"
                      className="sim-lane-gridline"
                      key={tick}
                      style={{ left: `${percent(tick, viewStart, viewEnd)}%` }}
                    />
                  ))}
                  {plannedSegments
                    .filter(
                      ({ plan }) => plan.scopeType === "AIRCRAFT" && plan.scopeId === aircraft.id,
                    )
                    .map(({ plan, start, end }) => (
                      <span
                        className="sim-planned-operation-bar sim-planned-operation-bar--aircraft"
                        data-active={start <= currentMs && currentMs < end}
                        key={plan.key}
                        style={{
                          left: `${clampPercent(percent(start, viewStart, viewEnd))}%`,
                          width: `${Math.max(
                            1.2,
                            clampPercent(percent(end, viewStart, viewEnd)) -
                              clampPercent(percent(start, viewStart, viewEnd)),
                          )}%`,
                        }}
                        title={plan.publicNote ? `${plan.kind} · ${plan.publicNote}` : plan.kind}
                      >
                        {plan.kind}
                      </span>
                    ))}
                  {rotations.map((rotation) => {
                    const called = Date.parse(rotation.calledAt ?? "");
                    const departed = Date.parse(rotation.departedAt ?? "");
                    const landed = Date.parse(rotation.landedAt ?? "");
                    const completed = Date.parse(rotation.completedAt ?? "");
                    const left = clampPercent(percent(called, viewStart, viewEnd));
                    const right = clampPercent(percent(completed, viewStart, viewEnd));
                    const currentStatus = statusAt(rotation, currentMs);
                    return (
                      <button
                        aria-label={`Fluggruppe ${rotation.communicationNumber}, ${currentStatus}`}
                        aria-describedby={
                          tooltip?.rotationId === rotation.id ? "sim-group-tooltip" : undefined
                        }
                        className="sim-rotation-bar"
                        data-selected={rotation.id === selectedRotationId}
                        key={rotation.id}
                        onBlur={() => hideTooltip(rotation.id)}
                        onClick={() => onSelectRotation(rotation.id)}
                        onFocus={(event) => showTooltip(rotation.id, event)}
                        onMouseEnter={(event) => showTooltip(rotation.id, event)}
                        onMouseLeave={() => hideTooltip(rotation.id)}
                        style={{ left: `${left}%`, width: `${Math.max(1.8, right - left)}%` }}
                        type="button"
                      >
                        <b>{rotation.communicationNumber}</b>
                        <span
                          className="sim-phase sim-phase--boarding"
                          style={phaseStyle(
                            called,
                            departed,
                            called,
                            completed,
                            viewStart,
                            viewEnd,
                          )}
                        />
                        <span
                          className="sim-phase sim-phase--flight"
                          style={phaseStyle(
                            departed,
                            landed,
                            called,
                            completed,
                            viewStart,
                            viewEnd,
                          )}
                        />
                        <span
                          className="sim-phase sim-phase--ground"
                          style={phaseStyle(
                            landed,
                            completed,
                            called,
                            completed,
                            viewStart,
                            viewEnd,
                          )}
                        />
                        {currentMs < completed ? <span className="sim-future-mask" /> : null}
                      </button>
                    );
                  })}
                  {interruptions.map((interruption) => (
                    <span
                      className="sim-interruption-bar"
                      data-active={interruption.active}
                      data-tone={interruption.tone}
                      key={interruption.id}
                      style={{
                        left: `${clampPercent(percent(interruption.start, viewStart, viewEnd))}%`,
                        width: `${Math.max(
                          1.2,
                          clampPercent(percent(interruption.end, viewStart, viewEnd)) -
                            clampPercent(percent(interruption.start, viewStart, viewEnd)),
                        )}%`,
                      }}
                      title={interruptionTitle(interruption)}
                    >
                      {interruption.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>
      <div className="sim-queue-row">
        <div>
          <strong>Warteschlange</strong>
          <small>(Queue)</small>
        </div>
        <div className="sim-queue-list">
          {queue.length === 0 ? (
            <span className="sim-empty-queue">Keine wartenden Gruppen</span>
          ) : null}
          {queue.slice(0, 20).map((rotation, index) => (
            <button
              aria-describedby={
                tooltip?.rotationId === rotation.id ? "sim-group-tooltip" : undefined
              }
              data-precalled={isPrecalled(rotation, currentMs) ? "true" : undefined}
              data-selected={rotation.id === selectedRotationId}
              key={rotation.id}
              onBlur={() => hideTooltip(rotation.id)}
              onClick={() => onSelectRotation(rotation.id)}
              onFocus={(event) => showTooltip(rotation.id, event)}
              onMouseEnter={(event) => showTooltip(rotation.id, event)}
              onMouseLeave={() => hideTooltip(rotation.id)}
              type="button"
            >
              <strong>{rotation.communicationNumber}</strong>
              <small>{queueRotationLabel(rotation, index, currentMs)}</small>
            </button>
          ))}
        </div>
      </div>
      {tooltipRotation && tooltip ? (
        <aside
          className="sim-group-tooltip"
          id="sim-group-tooltip"
          role="tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <strong>Fluggruppe {tooltipRotation.communicationNumber}</strong>
          <span>{selectedForecastLabel(tooltipSnapshot)}</span>
          <span>
            Boarding (Ist){" "}
            {tooltipRotation.calledAt && Date.parse(tooltipRotation.calledAt) <= currentMs
              ? formatTime(tooltipRotation.calledAt)
              : "noch offen"}
          </span>
          <span>
            Qualität{" "}
            {forecastQualityLabel(
              tooltipSnapshot?.forecastState === "UNAVAILABLE"
                ? undefined
                : tooltipSnapshot?.quality,
            )}
          </span>
          {tooltipRotation.precalledAt && Date.parse(tooltipRotation.precalledAt) <= currentMs ? (
            <span>GO TO GATE {formatTime(tooltipRotation.precalledAt)} · systemseitig</span>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
