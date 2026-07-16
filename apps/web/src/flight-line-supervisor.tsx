import type { OperationBoard } from "@rundflug/contracts";
import { useMemo, useState } from "react";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];

type SupervisorAction = {
  label: string;
  disabled: boolean;
  run: () => void;
} | null;

const stages = [
  ["ready", "Bereit"],
  ["gate", "Go to Gate"],
  ["boarding", "Boarding"],
  ["off-block", "Off-Block"],
  ["on-block", "On-Block"],
  ["refueling", "Tanken"],
  ["paused", "Pause"],
  ["unavailable", "Nicht verfügbar"],
] as const;

function stageFor(aircraft: Aircraft, rotation: Rotation | undefined): string {
  if (aircraft.operationalState === "REFUELING") return "refueling";
  if (aircraft.operationalState === "PAUSED") return "paused";
  if (["INTERRUPTED", "INACTIVE"].includes(aircraft.operationalState)) return "unavailable";
  if (rotation?.status === "CALLED" || aircraft.operationalState === "BOARDING") return "boarding";
  if (rotation?.status === "IN_FLIGHT" || aircraft.operationalState === "IN_FLIGHT") {
    return "off-block";
  }
  if (rotation?.status === "LANDED" || aircraft.operationalState === "LANDED") return "on-block";
  return "ready";
}

function stateLabel(aircraft: Aircraft, rotation: Rotation | undefined): string {
  const stage = stageFor(aircraft, rotation);
  return stages.find(([key]) => key === stage)?.[1] ?? "Bereit";
}

function formatTime(value: string | null, timeZone: string): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function suggestedRotationFor(
  aircraft: Aircraft,
  rotations: Rotation[],
  products: OperationBoard["products"],
): Rotation | undefined {
  const assigned = rotations.find(
    (rotation) => rotation.aircraftId === aircraft.id && rotation.status !== "COMPLETED",
  );
  if (assigned) return assigned;
  return rotations.find((rotation) => {
    if (rotation.status !== "DRAFT") return false;
    const product = products.find((entry) => entry.code === rotation.productCode);
    return (
      product?.resourceGroupId === aircraft.resourceGroupId &&
      rotation.ticketCount <= aircraft.passengerSeats
    );
  });
}

export function FlightLineSupervisorConsole({
  board,
  aircraft,
  selectedAircraft,
  selectedRotation,
  aircraftRotations,
  action,
  message,
  nextPilotId,
  onPilotChange,
  onSelectAircraft,
  onSelectRotation,
  onOpenDetails,
  onOpenDisposition,
  onPause,
  onRefuel,
  onUnavailable,
  onAvailable,
  onReleaseAssist,
}: {
  board: OperationBoard;
  aircraft: Aircraft[];
  selectedAircraft: Aircraft | undefined;
  selectedRotation: Rotation | undefined;
  aircraftRotations: Rotation[];
  action: SupervisorAction;
  message: string | null;
  nextPilotId: string;
  onPilotChange: (pilotId: string) => void;
  onSelectAircraft: (aircraftId: string) => void;
  onSelectRotation: (rotationId: string) => void;
  onOpenDetails: () => void;
  onOpenDisposition: () => void;
  onPause: () => void;
  onRefuel: () => void;
  onUnavailable: () => void;
  onAvailable: () => void;
  onReleaseAssist: (aircraftId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [resourceGroupId, setResourceGroupId] = useState("");
  const filteredAircraft = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("de-DE");
    return aircraft.filter((entry) => {
      const matchesResource = !resourceGroupId || entry.resourceGroupId === resourceGroupId;
      const matchesSearch =
        !normalizedSearch ||
        `${entry.registration} ${entry.aircraftType} ${entry.resourceGroupName}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearch);
      return matchesResource && matchesSearch;
    });
  }, [aircraft, resourceGroupId, search]);
  const currentTime = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: board.event.timeZone,
  }).format(new Date());
  const eventDate = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: board.event.timeZone,
  }).format(new Date(`${board.event.eventDate}T12:00:00Z`));

  return (
    <section className="flight-line-console">
      <header className="flight-line-console-header">
        <div className="flight-line-console-brand">
          <span aria-hidden="true">✈</span>
          <div>
            <strong>Flight Line</strong>
            <small>Rundflug-Leitstand</small>
          </div>
        </div>
        <div className="console-live-state">
          <span />
          Leitstand aktiv
        </div>
        <time dateTime={new Date().toISOString()}>
          <strong>{currentTime}</strong>
          <small>{eventDate}</small>
        </time>
        <div className="console-header-context">
          <span>Hinweise</span>
          <strong>{board.event.operationalNote ? "1" : "0"}</strong>
          <span className="console-online">● Online</span>
          <span>Leitstand</span>
        </div>
      </header>

      <aside className="flight-line-console-nav" aria-label="Flight-Line-Bereiche">
        <strong className="active">Flight Line</strong>
        <span>Gruppen</span>
        <span>Gates</span>
        <span>Ressourcen</span>
        <span>Piloten</span>
        <span>Flugzeuge</span>
        <span>Tanken</span>
        <span>Wartung</span>
        <span>Abläufe</span>
        <span>Berichte</span>
        <span>Einstellungen</span>
      </aside>

      <aside className="console-aircraft-list">
        <div className="console-panel-title">
          <div>
            <strong>Flugzeuge</strong>
            <small>{aircraft.length} insgesamt</small>
          </div>
          <label className="console-aircraft-search">
            <span className="visually-hidden">Flugzeug suchen</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Suchen…"
              type="search"
              value={search}
            />
          </label>
        </div>
        <div className="console-aircraft-table-head">
          <span>Flugzeug</span>
          <span>Plätze</span>
          <span>Ressource</span>
          <span>Status</span>
        </div>
        <div className="console-aircraft-rows">
          {filteredAircraft.map((entry) => {
            const rotation = suggestedRotationFor(entry, board.rotations, board.products);
            const selected = entry.id === selectedAircraft?.id;
            return (
              <button
                className={selected ? "selected" : ""}
                key={entry.id}
                onClick={() => onSelectAircraft(entry.id)}
                type="button"
              >
                <span>
                  <strong>{entry.registration}</strong>
                  <small>{entry.aircraftType}</small>
                </span>
                <span>{entry.passengerSeats}</span>
                <span>{entry.resourceGroupName}</span>
                <span className={`console-status status-${stageFor(entry, rotation)}`}>
                  {stateLabel(entry, rotation)}
                </span>
              </button>
            );
          })}
        </div>
        <small className="console-list-count">
          {filteredAircraft.length} von {aircraft.length} Flugzeugen
        </small>
      </aside>

      <main className="flight-line-console-main">
        <div className="console-toolbar">
          <div>
            <strong>Flight Line</strong>
            <small>Überblick über den operativen Status aller Flugzeuge</small>
          </div>
          <div>
            <label className="console-resource-filter">
              <span className="visually-hidden">Ressource filtern</span>
              <select
                onChange={(event) => setResourceGroupId(event.target.value)}
                value={resourceGroupId}
              >
                <option value="">Alle Ressourcen</option>
                {board.resourceGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>+ Aktion</summary>
              <div>
                <button onClick={onPause} type="button">
                  Pause
                </button>
                <button onClick={onRefuel} type="button">
                  Tanken
                </button>
                <button onClick={onUnavailable} type="button">
                  Nicht verfügbar
                </button>
                <button onClick={onAvailable} type="button">
                  Wieder verfügbar
                </button>
              </div>
            </details>
          </div>
        </div>

        <section className="console-status-matrix" aria-label="Flugzeugstatus">
          <div className="console-matrix-head">
            <span>Flugzeug</span>
            <span>Status</span>
            <span>Aktuelle Zuordnung</span>
            {stages.map(([, label]) => (
              <span key={label}>{label}</span>
            ))}
            <span>Aktionen</span>
          </div>
          {filteredAircraft.map((entry) => {
            const rotation = suggestedRotationFor(entry, board.rotations, board.products);
            const assistClaim = (board.assistClaims ?? []).find(
              (claim) => claim.aircraftId === entry.id,
            );
            const currentStage = stageFor(entry, rotation);
            const selected = entry.id === selectedAircraft?.id;
            return (
              <div
                className={selected ? "console-matrix-row selected" : "console-matrix-row"}
                key={entry.id}
              >
                <button
                  className="matrix-aircraft"
                  onClick={() => onSelectAircraft(entry.id)}
                  type="button"
                >
                  <strong>{entry.registration}</strong>
                  <small>{entry.aircraftType}</small>
                </button>
                <span className={`console-status status-${currentStage}`}>
                  {stateLabel(entry, rotation)}
                </span>
                <span className="matrix-assignment">
                  {rotation ? (
                    <>
                      <strong>
                        {rotation.communicationLabel} · {rotation.ticketCount} Tickets
                      </strong>
                      <small>{rotation.gateLabel}</small>
                    </>
                  ) : (
                    "–"
                  )}
                  {assistClaim ? <small>Assist-Gerät betreut</small> : null}
                </span>
                {stages.map(([key, label]) => (
                  <span
                    className={
                      key === currentStage ? `matrix-stage active stage-${key}` : "matrix-stage"
                    }
                    key={key}
                    title={label}
                  />
                ))}
                <button
                  className="matrix-details"
                  onClick={() => {
                    onSelectAircraft(entry.id);
                    onOpenDetails();
                  }}
                  type="button"
                >
                  Details
                </button>
                {selected && rotation ? (
                  <div className="matrix-recommendation">
                    <div>
                      <small>Empfehlung</small>
                      <strong>{rotation.communicationLabel} jetzt aufrufen</strong>
                      <span>
                        Vorgeschlagenes Zeitfenster bis{" "}
                        {formatTime(rotation.timeline.predicted.boardingAt, board.event.timeZone)}
                      </span>
                    </div>
                    <div>
                      <small>Begründung (informativ)</small>
                      <span>Flugzeug und Gruppe passen zur gemeinsamen Ressource.</span>
                    </div>
                    <div>
                      <small>Bestätigung durch Operator erforderlich</small>
                      <span>Keine automatische Zuweisung oder Sicherheitsentscheidung.</span>
                    </div>
                    {action ? (
                      <button
                        className="console-confirm"
                        disabled={action.disabled}
                        onClick={action.run}
                        type="button"
                      >
                        {action.label === "NEXT" ? "Bestätigen" : action.label}
                      </button>
                    ) : null}
                    <button onClick={onOpenDisposition} type="button">
                      Andere Gruppe
                    </button>
                    {assistClaim ? (
                      <button onClick={() => onReleaseAssist(entry.id)} type="button">
                        Assist freigeben
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>

        <div className="console-bottom-grid">
          <section className="console-next-groups">
            <div className="console-panel-title">
              <strong>Nächste Gruppen</strong>
              <small>{aircraftRotations.length} in Warteschlange</small>
            </div>
            <div className="next-group-head">
              <span>Gruppe</span>
              <span>Tickets</span>
              <span>Status</span>
              <span>Erwartetes Fenster</span>
              <span>Hinweis</span>
            </div>
            {aircraftRotations.map((rotation, index) => (
              <button
                className={rotation.id === selectedRotation?.id ? "selected" : ""}
                key={rotation.id}
                onClick={() => onSelectRotation(rotation.id)}
                type="button"
              >
                <strong>{rotation.communicationLabel}</strong>
                <span>{rotation.ticketCount}</span>
                <span>{index === 0 ? "Als Nächstes" : "Wartet"}</span>
                <span>
                  {rotation.predictedLowerMinutes}–{rotation.predictedUpperMinutes} Min.
                </span>
                <span>{rotation.gateLabel}</span>
              </button>
            ))}
            {aircraftRotations.length === 0 ? <p>Keine passende Gruppe wartet derzeit.</p> : null}
            <small>
              Letzte Aktualisierung: {formatTime(board.event.updatedAt, board.event.timeZone)}
            </small>
          </section>

          <section className="console-aircraft-detail">
            <div className="console-panel-title">
              <strong>{selectedAircraft?.registration ?? "Kein Flugzeug"}</strong>
              <small>{selectedAircraft?.aircraftType}</small>
            </div>
            <nav>
              <strong>Vorgeschlagene Zuordnung</strong>
              <span>Flugzeuginfo</span>
              <span>Pilot</span>
              <span>Historie</span>
              <span>Notizen</span>
            </nav>
            {selectedAircraft ? (
              <div className="console-detail-content">
                <dl>
                  <div>
                    <dt>Gruppe</dt>
                    <dd>
                      {selectedRotation
                        ? `${selectedRotation.communicationLabel} · ${selectedRotation.ticketCount} Tickets`
                        : "–"}
                    </dd>
                  </div>
                  <div>
                    <dt>Gate</dt>
                    <dd>
                      {selectedRotation?.gateLabel ??
                        board.resourceGroups.find(
                          (group) => group.id === selectedAircraft.resourceGroupId,
                        )?.gateLabel ??
                        "–"}
                    </dd>
                  </div>
                  <div>
                    <dt>Vorgeschlagene Zeit</dt>
                    <dd>
                      {selectedRotation
                        ? `${selectedRotation.predictedLowerMinutes}–${selectedRotation.predictedUpperMinutes} Min.`
                        : "–"}
                    </dd>
                  </div>
                </dl>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>{stateLabel(selectedAircraft, selectedRotation)}</dd>
                  </div>
                  <div>
                    <dt>Ressource</dt>
                    <dd>{selectedAircraft.resourceGroupName}</dd>
                  </div>
                  <div>
                    <dt>Pilotencode</dt>
                    <dd>
                      {selectedRotation?.status === "DRAFT" ? (
                        <select
                          aria-label="Pilotencode für NEXT"
                          value={nextPilotId}
                          onChange={(event) => onPilotChange(event.target.value)}
                        >
                          <option value="">Pilot wählen</option>
                          {board.pilots
                            .filter((pilot) => pilot.active && !pilot.paused)
                            .map((pilot) => (
                              <option key={pilot.id} value={pilot.id}>
                                {pilot.operationalCode}
                              </option>
                            ))}
                        </select>
                      ) : (
                        (selectedRotation?.pilotOperationalCode ?? "–")
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="console-info-note">
                  <strong>Hinweis</strong>
                  <span>
                    Diese Empfehlung ist informativ. Die finale Entscheidung liegt beim Operator.
                  </span>
                </div>
              </div>
            ) : null}
            {message ? (
              <div className="action-message" role="status">
                {message}
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </section>
  );
}
