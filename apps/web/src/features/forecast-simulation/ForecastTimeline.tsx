import type { KeyboardEvent } from "react";

import {
  forecastUncertaintyLabel,
  type SimulationEvent,
  type SimulationEventType,
  type SimulationForecastSnapshot,
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

function phaseStyle(from: number, until: number, start: number, end: number) {
  return {
    left: `${clampPercent(percent(from, start, end))}%`,
    width: `${Math.max(0.45, clampPercent(percent(until, start, end)) - clampPercent(percent(from, start, end)))}%`,
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

export function ForecastTimeline({
  currentMs,
  result,
  selectedRotationId,
  onSelectRotation,
  onShowHistory,
}: Readonly<{
  currentMs: number;
  result: SimulationResult;
  selectedRotationId: string | null;
  onSelectRotation: (rotationId: string) => void;
  onShowHistory: () => void;
}>) {
  const simulationStart = Date.parse(result.runWindow.startAt);
  const simulationEnd = Date.parse(result.runWindow.endAt);
  const halfWindow = (WINDOW_MINUTES / 2) * MINUTE_MS;
  const windowStart = Math.max(
    simulationStart,
    Math.min(currentMs - halfWindow, simulationEnd - WINDOW_MINUTES * MINUTE_MS),
  );
  const windowEnd = Math.min(simulationEnd, windowStart + WINDOW_MINUTES * MINUTE_MS);
  const tickCount = 6;
  const ticks = Array.from(
    { length: tickCount + 1 },
    (_, index) => windowStart + ((windowEnd - windowStart) * index) / tickCount,
  );
  const visibleRotations = result.rotations.filter((rotation) => {
    if (!rotation.calledAt || !rotation.completedAt) return false;
    return (
      Date.parse(rotation.calledAt) < windowEnd && Date.parse(rotation.completedAt) > windowStart
    );
  });
  const queue = result.rotations.filter(
    (rotation) =>
      Date.parse(rotation.createdAt) <= currentMs &&
      (!rotation.calledAt || Date.parse(rotation.calledAt) > currentMs),
  );
  const selected = result.rotations.find((rotation) => rotation.id === selectedRotationId) ?? null;
  const selectedSnapshot = selected
    ? latestSnapshot(result.snapshots, selected.id, currentMs)
    : undefined;
  const nowPosition = clampPercent(percent(currentMs, windowStart, windowEnd));
  const plannedSegments = (result.plannedOperations ?? []).flatMap((plan) => {
    const startEvent = result.events.find(
      (event) =>
        event.type === "PLANNED_OPERATION_STARTED" && event.plannedOperationId === plan.key,
    );
    if (!startEvent) return [];
    const endEvent = result.events.find(
      (event) =>
        event.type === "PLANNED_OPERATION_ENDED" &&
        event.plannedOperationId === plan.key &&
        Date.parse(event.occurredAt) >= Date.parse(startEvent.occurredAt),
    );
    const start = Date.parse(startEvent.occurredAt);
    const end = endEvent ? Date.parse(endEvent.occurredAt) : simulationEnd;
    if (start >= windowEnd || end <= windowStart) return [];
    return [{ plan, start, end }];
  });
  const sharedPlannedSegments = plannedSegments.filter(({ plan }) => plan.scopeType !== "AIRCRAFT");
  const sharedInterruptions = buildTimelineInterruptions(
    result.events,
    null,
    currentMs,
    simulationEnd,
  ).filter(({ start, end }) => start < windowEnd && end >= windowStart);

  return (
    <section className="sim-timeline-panel" aria-label="Simulationszeitachse">
      <header className="sim-timeline-heading">
        <div>
          <strong>Zeitleiste</strong>
          <span>
            {formatTime(windowStart)} – {formatTime(windowEnd)}
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
      <div className="sim-timeline-scale">
        {ticks.map((tick) => (
          <time key={tick} style={{ left: `${percent(tick, windowStart, windowEnd)}%` }}>
            {formatTime(tick)}
          </time>
        ))}
      </div>
      <section
        aria-label="Tagesplan und Flugzeuge"
        className="sim-timeline-lanes"
        onKeyDown={scrollTimelineWithKeyboard}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the overflow region must accept focus for keyboard scrolling.
        tabIndex={0}
      >
        <div className="sim-now-track">
          <div className="sim-now-line" style={{ left: `${nowPosition}%` }}>
            <time>{formatTime(currentMs)}</time>
          </div>
        </div>
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
                    left: `${clampPercent(percent(start, windowStart, windowEnd))}%`,
                    width: `${Math.max(
                      1.2,
                      clampPercent(percent(end, windowStart, windowEnd)) -
                        clampPercent(percent(start, windowStart, windowEnd)),
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
                    left: `${clampPercent(percent(interruption.start, windowStart, windowEnd))}%`,
                    width: `${Math.max(
                      1.2,
                      clampPercent(percent(interruption.end, windowStart, windowEnd)) -
                        clampPercent(percent(interruption.start, windowStart, windowEnd)),
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
          ).filter(({ start, end }) => start < windowEnd && end >= windowStart);
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
                    style={{ left: `${percent(tick, windowStart, windowEnd)}%` }}
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
                        left: `${clampPercent(percent(start, windowStart, windowEnd))}%`,
                        width: `${Math.max(
                          1.2,
                          clampPercent(percent(end, windowStart, windowEnd)) -
                            clampPercent(percent(start, windowStart, windowEnd)),
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
                  const left = clampPercent(percent(called, windowStart, windowEnd));
                  const right = clampPercent(percent(completed, windowStart, windowEnd));
                  const currentStatus = statusAt(rotation, currentMs);
                  return (
                    <button
                      aria-label={`Fluggruppe ${rotation.communicationNumber}, ${currentStatus}`}
                      className="sim-rotation-bar"
                      data-selected={rotation.id === selectedRotationId}
                      key={rotation.id}
                      onClick={() => onSelectRotation(rotation.id)}
                      style={{ left: `${left}%`, width: `${Math.max(1.8, right - left)}%` }}
                      type="button"
                    >
                      <b>{rotation.communicationNumber}</b>
                      <span
                        className="sim-phase sim-phase--boarding"
                        style={phaseStyle(called, departed, called, completed)}
                      />
                      <span
                        className="sim-phase sim-phase--flight"
                        style={phaseStyle(departed, landed, called, completed)}
                      />
                      <span
                        className="sim-phase sim-phase--ground"
                        style={phaseStyle(landed, completed, called, completed)}
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
                      left: `${clampPercent(percent(interruption.start, windowStart, windowEnd))}%`,
                      width: `${Math.max(
                        1.2,
                        clampPercent(percent(interruption.end, windowStart, windowEnd)) -
                          clampPercent(percent(interruption.start, windowStart, windowEnd)),
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
              data-precalled={
                rotation.precalledAt && Date.parse(rotation.precalledAt) <= currentMs
                  ? "true"
                  : undefined
              }
              data-selected={rotation.id === selectedRotationId}
              key={rotation.id}
              onClick={() => onSelectRotation(rotation.id)}
              type="button"
            >
              <strong>{rotation.communicationNumber}</strong>
              <small>
                {rotation.precalledAt && Date.parse(rotation.precalledAt) <= currentMs
                  ? (rotation.gateLabel ?? "Gate")
                  : `${rotation.productCode ?? ""}${rotation.productCode ? " · " : ""}${index + 1}`}
              </small>
            </button>
          ))}
        </div>
      </div>
      <div className="sim-selection-summary">
        {selected ? (
          <>
            <strong>Fluggruppe {selected.communicationNumber}</strong>
            <i>·</i>
            <span>
              {selectedSnapshot?.quality === "UNCERTAIN"
                ? `Rohprognose Boarding ${formatTime(selectedSnapshot.predictedBoardingAt)} · nicht freigegeben · ${forecastUncertaintyLabel(selectedSnapshot.uncertaintyReasons)}`
                : selectedSnapshot
                  ? `Prognose Boarding ${formatTime(selectedSnapshot.predictedBoardingAt)}`
                  : "Noch keine Prognose"}
            </span>
            <i>·</i>
            <span>
              Ist {statusAt(selected, currentMs) === "COMPLETED" ? "abgeschlossen" : "noch offen"}
            </span>
            {selected.precalledAt && Date.parse(selected.precalledAt) <= currentMs ? (
              <>
                <i>·</i>
                <span>GO TO GATE {formatTime(selected.precalledAt)} · systemseitig</span>
              </>
            ) : null}
            <i>·</i>
            <span>
              Qualität{" "}
              {selectedSnapshot?.quality === "STABLE"
                ? "stabil"
                : selectedSnapshot?.quality === "CHANGING"
                  ? "veränderlich"
                  : "unsicher"}
            </span>
          </>
        ) : (
          <span>Fluggruppe auswählen, um Prognose und Ist-Verlauf zu vergleichen.</span>
        )}
        <button disabled={!selected} onClick={onShowHistory} type="button">
          Verlauf anzeigen
        </button>
      </div>
    </section>
  );
}
