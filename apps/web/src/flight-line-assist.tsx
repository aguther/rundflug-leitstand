import type { OperationBoard } from "@rundflug/contracts";
import { useEffect, useState } from "react";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];

type AssistAction = {
  label: string;
  disabled: boolean;
  run: () => void;
} | null;

function rotationForAircraft(
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

function assistState(aircraft: Aircraft, rotation: Rotation | undefined) {
  if (aircraft.operationalState === "REFUELING") return { key: "refueling", label: "Tanken" };
  if (aircraft.operationalState === "PAUSED") return { key: "paused", label: "Pause" };
  if (["INACTIVE", "INTERRUPTED"].includes(aircraft.operationalState)) {
    return { key: "unavailable", label: "Nicht verfügbar" };
  }
  if (rotation?.status === "IN_FLIGHT" || aircraft.operationalState === "IN_FLIGHT") {
    return { key: "in-flight", label: "Im Flug" };
  }
  if (rotation?.status === "LANDED" || aircraft.operationalState === "LANDED") {
    return { key: "on-block", label: "On-Block" };
  }
  if (rotation?.status === "CALLED" || aircraft.operationalState === "BOARDING") {
    return { key: "boarding", label: "Boarding" };
  }
  return { key: "ready", label: "Bereit" };
}

function eventTime(board: OperationBoard): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: board.event.timeZone,
  }).format(new Date());
}

export function FlightLineAssist({
  board,
  aircraft,
  selectedAircraft,
  selectedRotation,
  action,
  message,
  onSelectAircraft,
  onPause,
  onRefuel,
  onUnavailable,
  onAvailable,
  deviceId,
  onClaim,
  onRelease,
}: {
  board: OperationBoard;
  aircraft: Aircraft[];
  selectedAircraft: Aircraft | undefined;
  selectedRotation: Rotation | undefined;
  action: AssistAction;
  message: string | null;
  onSelectAircraft: (aircraftId: string) => void;
  onPause: () => void;
  onRefuel: () => void;
  onUnavailable: () => void;
  onAvailable: () => void;
  deviceId: string;
  onClaim: (aircraftId: string) => Promise<void>;
  onRelease: (aircraftId: string) => Promise<void>;
}) {
  const assistClaims = board.assistClaims ?? [];
  const ownServerClaim = assistClaims.find((claim) => claim.deviceId === deviceId);
  const [claimedAircraftId, setClaimedAircraftId] = useState<string | null>(
    ownServerClaim?.aircraftId ?? null,
  );
  const [claimError, setClaimError] = useState<string | null>(null);
  const availableAircraft = aircraft.filter((entry) => {
    const claim = assistClaims.find((candidate) => candidate.aircraftId === entry.id);
    return !claim || claim.deviceId === deviceId || entry.id === claimedAircraftId;
  });
  const claimedAircraft = aircraft.find((entry) => entry.id === claimedAircraftId);
  const activeAircraft = claimedAircraft ?? selectedAircraft;
  const activeRotation = activeAircraft
    ? rotationForAircraft(activeAircraft, board.rotations, board.products)
    : selectedRotation;
  const activeState = activeAircraft ? assistState(activeAircraft, activeRotation) : null;
  const waitingGroups = board.rotations
    .filter((rotation) => ["DRAFT", "CALLED"].includes(rotation.status))
    .slice(0, 3);

  useEffect(() => {
    if (!claimedAircraftId && ownServerClaim) setClaimedAircraftId(ownServerClaim.aircraftId);
  }, [claimedAircraftId, ownServerClaim]);

  useEffect(() => {
    if (!claimedAircraftId) return;
    const renewal = window.setInterval(() => {
      void onClaim(claimedAircraftId).catch(() => setClaimedAircraftId(null));
    }, 25_000);
    return () => window.clearInterval(renewal);
  }, [claimedAircraftId, onClaim]);

  async function claim(entry: Aircraft) {
    try {
      await onClaim(entry.id);
      setClaimedAircraftId(entry.id);
      setClaimError(null);
      onSelectAircraft(entry.id);
    } catch (cause) {
      setClaimError(
        cause instanceof Error ? cause.message : "Betreuung konnte nicht übernommen werden.",
      );
    }
  }

  async function finishClaim() {
    if (!claimedAircraftId) return;
    try {
      await onRelease(claimedAircraftId);
      setClaimedAircraftId(null);
      setClaimError(null);
    } catch (cause) {
      setClaimError(
        cause instanceof Error ? cause.message : "Betreuung konnte nicht beendet werden.",
      );
    }
  }

  return (
    <section className="flight-assist">
      <header className="assist-header">
        <div className="assist-brand">
          <span aria-hidden="true">✈</span>
          <div>
            <strong>Flight Line Assist</strong>
            <small>
              <i /> Verbunden
            </small>
          </div>
        </div>
        <div className="assist-live">
          <span>●</span> Leitstand aktiv
        </div>
        <time>
          <strong>{eventTime(board)}</strong>
          <small>
            {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date())}
          </small>
        </time>
        <span className="assist-device">▣ Gerät FL-03</span>
      </header>

      {message || claimError ? <p className="assist-message">{claimError ?? message}</p> : null}

      <div className="assist-main-grid">
        <section className="assist-pick-list">
          <div className="assist-section-heading">
            <div>
              <h1>Jetzt betreuen</h1>
              <p>Unübernommene oder dringende Flugzeuge</p>
            </div>
            <button
              aria-label="Ansicht aktualisieren"
              onClick={() => window.location.reload()}
              type="button"
            >
              ↻
            </button>
          </div>
          <div className="assist-aircraft-cards">
            {availableAircraft.slice(0, 4).map((entry) => {
              const rotation = rotationForAircraft(entry, board.rotations, board.products);
              const state = assistState(entry, rotation);
              const claimed = entry.id === claimedAircraftId;
              return (
                <article className={claimed ? "claimed" : ""} key={entry.id}>
                  <div className="assist-aircraft-title">
                    <span aria-hidden="true">✈</span>
                    <strong>{entry.registration}</strong>
                    <small className={claimed ? "busy" : "free"}>
                      {claimed ? "In Arbeit" : "Frei"}
                    </small>
                  </div>
                  <span className={`assist-state state-${state.key}`}>{state.label}</span>
                  <p>
                    {rotation?.communicationLabel ?? "Keine Gruppe"} · {rotation?.ticketCount ?? 0}{" "}
                    Tickets
                    <span>{rotation?.gateLabel ?? entry.resourceGroupName}</span>
                  </p>
                  {!claimed ? (
                    <button className="assist-claim" onClick={() => claim(entry)} type="button">
                      Übernehmen
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
          {availableAircraft.length > 4 ? (
            <button className="assist-more" type="button">
              Weitere anzeigen
            </button>
          ) : null}
        </section>

        <section className={claimedAircraftId ? "assist-current has-claim" : "assist-current"}>
          <div className="assist-section-heading">
            <div>
              <h2>Betreutes Flugzeug</h2>
              <p>Deine aktuelle Betreuung auf diesem Gerät</p>
            </div>
          </div>
          {activeAircraft ? (
            <>
              <div className="assist-current-summary">
                <strong>{activeAircraft.registration}</strong>
                <span className={`assist-state state-${activeState?.key}`}>
                  {activeState?.label}
                </span>
                <p>
                  {activeRotation?.communicationLabel ?? "Keine Gruppe"} ·{" "}
                  {activeRotation?.ticketCount ?? 0} Tickets
                  <span>{activeRotation?.gateLabel ?? activeAircraft.resourceGroupName}</span>
                </p>
              </div>
              <h3>Nächste Aktion wählen</h3>
              <div className="assist-actions">
                {action ? (
                  <button disabled={action.disabled} onClick={action.run} type="button">
                    <span>✓</span>{" "}
                    {action.label === "NEXT" ? "Go to Gate bestätigen" : action.label}
                  </button>
                ) : null}
                <button onClick={onAvailable} type="button">
                  <span>✓</span> Bereit
                </button>
                <button onClick={onRefuel} type="button">
                  <span>▣</span> Tanken
                </button>
                <button className="pause" onClick={onPause} type="button">
                  <span>Ⅱ</span> Pause
                </button>
                <button className="unavailable" onClick={onUnavailable} type="button">
                  <span>⊘</span> Nicht verfügbar
                </button>
              </div>
              <div className="assist-current-footer">
                <button className="assist-finish" onClick={() => void finishClaim()} type="button">
                  ✓ Betreuung abschließen
                </button>
              </div>
            </>
          ) : (
            <p className="assist-empty">Ein Flugzeug auswählen und übernehmen.</p>
          )}
        </section>
      </div>

      <section className="assist-gate-groups">
        <div className="assist-section-heading">
          <div>
            <h2>Am Gate</h2>
            <p>Gruppenübersicht</p>
          </div>
        </div>
        {waitingGroups.map((rotation) => (
          <div key={rotation.id}>
            <strong>{rotation.communicationLabel}</strong>
            <span>{rotation.status === "CALLED" ? "Aufgerufen" : "Wartet"}</span>
            <span>
              {rotation.ticketCount} / {rotation.ticketCount} Tickets vor Ort
            </span>
            <span>{rotation.gateLabel}</span>
            <button type="button">Gruppe nachrufen</button>
          </div>
        ))}
        {waitingGroups.length === 0 ? <p>Aktuell wartet keine Gruppe am Gate.</p> : null}
      </section>
    </section>
  );
}
