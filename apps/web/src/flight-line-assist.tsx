import type { OperationBoard } from "@rundflug/contracts";
import { useEffect, useState } from "react";
import { BrandMark } from "./design-system/BrandMark";
import { ThemeToggle } from "./design-system/ThemeToggle";
import { useAuth } from "./features/auth/AuthContext";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];

type AssistAction = {
  label: string;
  disabled: boolean;
  run: () => void;
} | null;

type AssistIconName =
  | "aircraft"
  | "available"
  | "chevron"
  | "device"
  | "finish"
  | "gate"
  | "group"
  | "logout"
  | "pause"
  | "refuel"
  | "refresh"
  | "unavailable";

function AssistActionIcon({ name }: { name: AssistIconName }) {
  if (name === "aircraft") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m3.5 13.3 7.1 1.1 3.8 6.1h2l-1.7-6.2 4.1-.7c1.4-.2 2.3-.9 2.3-1.8s-.9-1.6-2.3-1.8l-4.1-.7 1.7-6.2h-2l-3.8 6.1-7.1 1.1-1.8-2.1H.5l1 3.6-1 3.6h1.2z" />
      </svg>
    );
  }
  if (name === "available" || name === "finish") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16.5 8.5" />
      </svg>
    );
  }
  if (name === "refuel") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h7A1.5 1.5 0 0 1 15 4.5V21M4 21h12M7.5 7h5v4h-5zM15 7l3 3v7.5a1.5 1.5 0 0 0 3 0V9l-2-2" />
      </svg>
    );
  }
  if (name === "device") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect height="18" rx="2" width="12" x="6" y="3" />
        <path d="M10 6h4M10 18h4" />
      </svg>
    );
  }
  if (name === "group") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3.5 19c.3-4 2.1-6 5.5-6s5.2 2 5.5 6M14 14c3.3-.8 5.5 1 6 4.2" />
      </svg>
    );
  }
  if (name === "gate") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 21V4h11v17M5 21h14M9 8h3M9 12h3M16 9h3v8h-3" />
      </svg>
    );
  }
  if (name === "refresh") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M18.2 9A7 7 0 0 0 6.3 6.3L4 9M5.8 15A7 7 0 0 0 17.7 17.7L20 15" />
      </svg>
    );
  }
  if (name === "logout") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M14 8V5H5v14h9v-3M11 12h9M17 9l3 3-3 3" />
      </svg>
    );
  }
  if (name === "pause") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 8.5v7M14.5 8.5v7" />
      </svg>
    );
  }
  if (name === "unavailable") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="m5.7 5.7 12.6 12.6" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

function AssistCommandContent({
  icon,
  label,
  trailing = true,
}: {
  icon: AssistIconName;
  label: string;
  trailing?: boolean;
}) {
  return (
    <>
      <span className={`assist-command-icon icon-${icon}`}>
        <AssistActionIcon name={icon} />
      </span>
      <span className="assist-command-label">{label}</span>
      {trailing ? (
        <span className="assist-command-chevron">
          <AssistActionIcon name="chevron" />
        </span>
      ) : null}
    </>
  );
}

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
  const { session, logout } = useAuth();
  const assistClaims = board.assistClaims ?? [];
  const ownServerClaim = assistClaims.find((claim) => claim.deviceId === deviceId);
  const [claimedAircraftId, setClaimedAircraftId] = useState<string | null>(
    ownServerClaim?.aircraftId ?? null,
  );
  const [queueIndex, setQueueIndex] = useState(0);
  const [claimError, setClaimError] = useState<string | null>(null);
  const availableAircraft = aircraft.filter((entry) => {
    const claim = assistClaims.find((candidate) => candidate.aircraftId === entry.id);
    return !claim || claim.deviceId === deviceId || entry.id === claimedAircraftId;
  });
  const claimedAircraft = aircraft.find((entry) => entry.id === claimedAircraftId);
  const normalizedQueueIndex =
    availableAircraft.length === 0 ? 0 : queueIndex % availableAircraft.length;
  const visibleAircraft = availableAircraft.length
    ? [
        ...availableAircraft.slice(normalizedQueueIndex),
        ...availableAircraft.slice(0, normalizedQueueIndex),
      ]
    : [];
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
          <BrandMark />
          <div>
            <strong>Flight Line Assist</strong>
            <small>
              <i /> Verbunden
            </small>
          </div>
        </div>
        <div className="assist-live">
          <i /> Leitstand aktiv
        </div>
        <time>
          <strong>{eventTime(board)}</strong>
          <small>
            {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date())}
          </small>
        </time>
        <div className="assist-header-tools">
          {session && session.account.role !== "FLIGHT_LINE" ? (
            <a href="/flight-line">Supervisor</a>
          ) : null}
          <span className="assist-device">
            <AssistActionIcon name="device" />
            <span>Gerät FL-03</span>
          </span>
          <ThemeToggle />
          <button
            className="assist-logout"
            onClick={() => void logout().then(() => window.location.reload())}
            type="button"
          >
            <AssistActionIcon name="logout" />
            <span>{session?.account.loginCode ?? "Abmelden"}</span>
          </button>
        </div>
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
              <AssistActionIcon name="refresh" />
            </button>
          </div>
          <div className="assist-aircraft-cards">
            {visibleAircraft.slice(0, 4).map((entry) => {
              const rotation = rotationForAircraft(entry, board.rotations, board.products);
              const state = assistState(entry, rotation);
              const claimed = entry.id === claimedAircraftId;
              return (
                <article className={claimed ? "claimed" : ""} key={entry.id}>
                  <div className="assist-aircraft-title">
                    <span aria-hidden="true">
                      <AssistActionIcon name="aircraft" />
                    </span>
                    <strong>{entry.registration}</strong>
                    <small className={claimed ? "busy" : "free"}>
                      {claimed ? "In Arbeit" : "Frei"}
                    </small>
                  </div>
                  <span className={`assist-state state-${state.key}`}>{state.label}</span>
                  <p>
                    <span className="assist-meta-item">
                      <AssistActionIcon name="group" />
                      {rotation?.communicationLabel ?? "Keine Gruppe"} ·{" "}
                      {rotation?.ticketCount ?? 0} Tickets
                    </span>
                    <span className="assist-meta-item">
                      <AssistActionIcon name="gate" />
                      {rotation?.gateLabel ?? entry.resourceGroupName}
                    </span>
                  </p>
                  {!claimed ? (
                    <button className="assist-claim" onClick={() => claim(entry)} type="button">
                      <AssistCommandContent icon="aircraft" label="Übernehmen" trailing={false} />
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
          {availableAircraft.length > 4 ? (
            <button className="assist-more assist-more-desktop" type="button">
              <AssistCommandContent icon="aircraft" label="Weitere anzeigen" />
            </button>
          ) : null}
          {availableAircraft.length > 1 ? (
            <button
              className="assist-more assist-more-phone"
              onClick={() => setQueueIndex((current) => (current + 1) % availableAircraft.length)}
              type="button"
            >
              <AssistCommandContent icon="aircraft" label="Nächstes Flugzeug" />
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
                  <span className="assist-meta-item">
                    <AssistActionIcon name="group" />
                    {activeRotation?.communicationLabel ?? "Keine Gruppe"} ·{" "}
                    {activeRotation?.ticketCount ?? 0} Tickets
                  </span>
                  <span className="assist-meta-item">
                    <AssistActionIcon name="gate" />
                    {activeRotation?.gateLabel ?? activeAircraft.resourceGroupName}
                  </span>
                </p>
              </div>
              <h3>Nächste Aktion wählen</h3>
              <div className="assist-actions">
                {action ? (
                  <button disabled={action.disabled} onClick={action.run} type="button">
                    <AssistCommandContent icon="available" label={action.label} />
                  </button>
                ) : null}
                <button onClick={onAvailable} type="button">
                  <AssistCommandContent icon="available" label="Bereit" />
                </button>
                <button onClick={onRefuel} type="button">
                  <AssistCommandContent icon="refuel" label="Tanken" />
                </button>
                <button className="pause" onClick={onPause} type="button">
                  <AssistCommandContent icon="pause" label="Pause" />
                </button>
                <button className="unavailable" onClick={onUnavailable} type="button">
                  <AssistCommandContent icon="unavailable" label="Nicht verfügbar" />
                </button>
              </div>
              <div className="assist-current-footer">
                <button className="assist-finish" onClick={() => void finishClaim()} type="button">
                  <AssistCommandContent
                    icon="finish"
                    label="Betreuung abschließen"
                    trailing={false}
                  />
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
            <span>
              {rotation.status === "CALLED"
                ? "Boarding"
                : rotation.precalledAt
                  ? "GO TO GATE"
                  : "Wartet"}
            </span>
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
