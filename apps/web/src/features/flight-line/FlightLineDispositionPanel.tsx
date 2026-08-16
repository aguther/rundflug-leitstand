import type { OperationBoard } from "@rundflug/contracts";
import { FlightLineAttendanceDecisionSection } from "./FlightLineAttendanceDecisionSection";

type Rotation = OperationBoard["rotations"][number];
type MoveTarget = { rotation: Rotation; freeSeats: number };

interface FlightLineDispositionPanelProps {
  capacity: number;
  canManage: boolean;
  missingTickets: Rotation["tickets"];
  moveReason: string;
  moveTargetId: string;
  moveTargets: MoveTarget[];
  noShowReady: boolean;
  noShowAfterMinutes: number;
  onAttendanceDecision: (decision: "FLY_WITH_PRESENT" | "LEAVE_SEAT_EMPTY") => Promise<void>;
  onCapacityChange: (capacity: number) => void;
  onClose: () => void;
  onDeferTogether: () => Promise<unknown>;
  onMarkNoShow: (ticketId: string) => Promise<void>;
  onMoveGroup: (ticketGroupId: string, targetRotationId: string, reason: string) => Promise<void>;
  onMoveReasonChange: (reason: string) => void;
  onMoveTargetChange: (rotationId: string) => void;
  onSetCapacity: () => Promise<void>;
  presentCount: number;
  replacement: { rotation: Rotation } | null;
  selected: Rotation;
}

export function FlightLineDispositionPanel({
  capacity,
  canManage,
  missingTickets,
  moveReason,
  moveTargetId,
  moveTargets,
  noShowReady,
  noShowAfterMinutes,
  onAttendanceDecision,
  onCapacityChange,
  onClose,
  onDeferTogether,
  onMarkNoShow,
  onMoveGroup,
  onMoveReasonChange,
  onMoveTargetChange,
  onSetCapacity,
  presentCount,
  replacement,
  selected,
}: Readonly<FlightLineDispositionPanelProps>) {
  return (
    <aside className="disposition-panel" aria-labelledby="disposition-title">
      <div className="disposition-heading">
        <div>
          <span>Disposition</span>
          <h2 id="disposition-title">{selected.communicationLabel}</h2>
        </div>
        <button aria-label="Disposition schließen" onClick={onClose} type="button">
          ×
        </button>
      </div>
      <p className="disposition-status">
        {selected.status === "DRAFT" ? "Vor dem Aufruf" : "Aufgerufen"} · ganze Gruppen bleiben
        verbunden
      </p>
      {selected.status === "DRAFT" && canManage ? (
        <section>
          <h3>Nutzbare Plätze</h3>
          <div className="compact-stepper">
            <button onClick={() => onCapacityChange(Math.max(1, capacity - 1))} type="button">
              −
            </button>
            <output>{capacity}</output>
            <button
              onClick={() => onCapacityChange(Math.min(selected.baselineCapacity, capacity + 1))}
              type="button"
            >
              +
            </button>
          </div>
          <p>
            Ausgangskapazität {selected.baselineCapacity}.{" "}
            {capacity < selected.ticketCount
              ? `Die Gruppe ${selected.ticketGroupId.slice(0, 8)} mit ${selected.ticketCount} Tickets rückt gemeinsam an die vorderste passende Position.`
              : "Keine Buchungsgruppe muss neu eingereiht werden."}
          </p>
          <small>Rein organisatorisch · keine Sicherheits- oder Freigabewirkung.</small>
          <button
            disabled={capacity === selected.usableCapacity}
            onClick={() => void onSetCapacity()}
            type="button"
          >
            Kapazität übernehmen
          </button>
        </section>
      ) : null}
      {selected.status === "DRAFT" || selected.status === "CALLED" ? (
        <section>
          <h3>Ganze Gruppe verschieben</h3>
          <label>
            Zielumlauf{" "}
            <select
              value={moveTargetId}
              onChange={(event) => onMoveTargetChange(event.target.value)}
            >
              <option value="">Passendes Ziel wählen</option>
              {moveTargets.map(({ rotation, freeSeats }) => (
                <option value={rotation.id} key={rotation.id}>
                  {rotation.communicationLabel} · {freeSeats} Plätze frei · {rotation.status}
                </option>
              ))}
            </select>
          </label>
          <label>
            Begründung der Abweichung{" "}
            <input
              value={moveReason}
              onChange={(event) => onMoveReasonChange(event.target.value)}
              placeholder="Kurz begründen"
            />
          </label>
          <small>Die gesamte Buchungsgruppe wird verschoben; keine Trennung.</small>
          <button
            disabled={!moveTargetId || moveReason.trim().length < 3}
            onClick={() => void onMoveGroup(selected.ticketGroupId, moveTargetId, moveReason)}
            type="button"
          >
            Verschiebung übernehmen
          </button>
          {moveTargets.length === 0 ? (
            <p>Aktuell ist kein passendes Ziel mit genügend Platz vorhanden.</p>
          ) : null}
        </section>
      ) : null}
      <FlightLineAttendanceDecisionSection
        missingTickets={missingTickets}
        noShowAfterMinutes={noShowAfterMinutes}
        noShowReady={noShowReady}
        onAttendanceDecision={onAttendanceDecision}
        onDeferTogether={onDeferTogether}
        onMarkNoShow={onMarkNoShow}
        onMoveGroup={onMoveGroup}
        presentCount={presentCount}
        replacement={replacement}
        selected={selected}
      />
    </aside>
  );
}
