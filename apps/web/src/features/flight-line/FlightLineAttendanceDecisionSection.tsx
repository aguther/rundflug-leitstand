import type { OperationBoard } from "@rundflug/contracts";

type Rotation = OperationBoard["rotations"][number];

interface FlightLineAttendanceDecisionSectionProps {
  missingTickets: Rotation["tickets"];
  noShowAfterMinutes: number;
  noShowReady: boolean;
  onAttendanceDecision: (decision: "FLY_WITH_PRESENT" | "LEAVE_SEAT_EMPTY") => Promise<void>;
  onDeferTogether: () => Promise<unknown>;
  onMarkNoShow: (ticketId: string) => Promise<void>;
  onMoveGroup: (ticketGroupId: string, targetRotationId: string, reason: string) => Promise<void>;
  presentCount: number;
  replacement: { rotation: Rotation } | null;
  selected: Rotation;
}

export function FlightLineAttendanceDecisionSection({
  missingTickets,
  noShowAfterMinutes,
  noShowReady,
  onAttendanceDecision,
  onDeferTogether,
  onMarkNoShow,
  onMoveGroup,
  presentCount,
  replacement,
  selected,
}: FlightLineAttendanceDecisionSectionProps) {
  if (selected.status !== "CALLED") return null;
  return (
    <section className="attendance-decision">
      <h3>Anwesenheitsentscheidung</h3>
      <strong>
        Anwesend {presentCount} von {selected.tickets.length}
      </strong>
      {!noShowReady ? <p>No-Show ist erst nach {noShowAfterMinutes} Minuten verfügbar.</p> : null}
      {missingTickets.length > 0 && presentCount > 0 ? (
        <div className="disposition-actions">
          <button onClick={() => void onDeferTogether()} type="button">
            Gemeinsam zurückstellen
          </button>
          <button onClick={() => void onAttendanceDecision("FLY_WITH_PRESENT")} type="button">
            Mit {presentCount} Personen fliegen
          </button>
          <button onClick={() => void onAttendanceDecision("LEAVE_SEAT_EMPTY")} type="button">
            Fehlende Plätze leer lassen
          </button>
        </div>
      ) : null}
      {missingTickets.map((ticket, index) => (
        <button
          disabled={!noShowReady}
          key={ticket.id}
          onClick={() => void onMarkNoShow(ticket.id)}
          type="button"
        >
          Fehlendes Ticket {index + 1} als No-Show markieren
        </button>
      ))}
      {replacement ? (
        <div className="replacement-suggestion">
          <strong>Ersatzvorschlag</strong>
          <span>
            {replacement.rotation.communicationLabel} · {replacement.rotation.ticketCount} Ticket
            {replacement.rotation.ticketCount === 1 ? "" : "s"} · vollständig eingecheckt
          </span>
          <button
            onClick={() =>
              void onMoveGroup(
                replacement.rotation.ticketGroupId,
                selected.id,
                "Bestätigter Ersatzvorschlag nach Anwesenheitsabgleich",
              )
            }
            type="button"
          >
            Ersatz übernehmen
          </button>
        </div>
      ) : null}
    </section>
  );
}
