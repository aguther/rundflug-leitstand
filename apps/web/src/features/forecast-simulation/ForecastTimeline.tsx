import {
  forecastUncertaintyLabel,
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
  return timeFormatter.format(typeof value === "number" ? new Date(value) : new Date(value));
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
  return snapshots
    .filter(
      (snapshot) => snapshot.rotationId === rotationId && Date.parse(snapshot.capturedAt) <= nowMs,
    )
    .at(-1);
}

function percent(value: number, start: number, end: number): number {
  return ((value - start) / (end - start)) * 100;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function phaseStyle(from: number, until: number, start: number, end: number) {
  return {
    left: `${clampPercent(percent(from, start, end))}%`,
    width: `${Math.max(0.45, clampPercent(percent(until, start, end)) - clampPercent(percent(from, start, end)))}%`,
  };
}

export function ForecastTimeline({
  currentMs,
  result,
  selectedRotationId,
  onSelectRotation,
  onShowHistory,
}: {
  currentMs: number;
  result: SimulationResult;
  selectedRotationId: string | null;
  onSelectRotation: (rotationId: string) => void;
  onShowHistory: () => void;
}) {
  const simulationStart = Date.parse(result.config.startAt);
  const simulationEnd = Date.parse(result.config.endAt);
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
        </fieldset>
      </header>
      <div className="sim-timeline-scale">
        {ticks.map((tick) => (
          <time key={tick} style={{ left: `${percent(tick, windowStart, windowEnd)}%` }}>
            {formatTime(tick)}
          </time>
        ))}
      </div>
      <div className="sim-timeline-lanes">
        <div className="sim-now-track">
          <div className="sim-now-line" style={{ left: `${nowPosition}%` }}>
            <time>{formatTime(currentMs)}</time>
          </div>
        </div>
        {result.aircraft.map((aircraft) => {
          const rotations = visibleRotations.filter(
            (rotation) => rotation.aircraftId === aircraft.id,
          );
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
              </div>
            </div>
          );
        })}
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
                  ? "Gate"
                  : index + 1}
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
