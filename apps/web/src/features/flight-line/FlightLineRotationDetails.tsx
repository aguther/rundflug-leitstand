import type { OperationBoard } from "@rundflug/contracts";
import { sharedGroupSegmentLabel } from "../../operational-exceptions";
import {
  operationalTimeLabel,
  predictionQualityLabel,
  rotationStatusLabel,
} from "../operations/operation-labels";
import { RotationOvertimeNotice } from "./FlightLineViewPresentation";

type Rotation = OperationBoard["rotations"][number];
type TurnaroundNextState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";

interface FlightLineRotationDetailsProps {
  action: { label: string; command: string } | null;
  callDeviationReason: string;
  event: OperationBoard["event"] | undefined;
  nextAircraftId: string;
  onAbort: () => Promise<void>;
  onAdvance: () => Promise<unknown>;
  onAttendance: (ticketId: string, checkedIn: boolean) => Promise<void>;
  onDefer: () => Promise<unknown>;
  onRevokeCall: () => Promise<void>;
  onSetQueueReason: (reason: string) => void;
  onSetTurnaroundState: (state: TurnaroundNextState) => void;
  queueDeviationReasonRequired: boolean;
  queueReason: string;
  rotations: Rotation[];
  selected: Rotation | null | undefined;
  selectedAircraftHasPilot: boolean;
  turnaroundNextState: TurnaroundNextState;
}

export function FlightLineRotationDetails({
  action,
  callDeviationReason,
  event,
  nextAircraftId,
  onAbort,
  onAdvance,
  onAttendance,
  onDefer,
  onRevokeCall,
  onSetQueueReason,
  onSetTurnaroundState,
  queueDeviationReasonRequired,
  queueReason,
  rotations,
  selected,
  selectedAircraftHasPilot,
  turnaroundNextState,
}: Readonly<FlightLineRotationDetailsProps>) {
  if (!selected) return <p>Noch keine Fluggruppe vorhanden.</p>;
  const timeZone = event?.timeZone ?? "Europe/Berlin";
  const segmentLabel = sharedGroupSegmentLabel(selected, rotations);
  return (
    <>
      <div className={`state-banner state-${selected.status.toLowerCase()}`}>
        <span>Status</span>
        <strong>{rotationStatusLabel[selected.status]}</strong>
      </div>
      <h2>Fluggruppe {selected.communicationLabel}</h2>
      {segmentLabel ? <p className="shared-group-label">{segmentLabel}</p> : null}
      <dl>
        <div>
          <dt>Produkt</dt>
          <dd>{selected.productName}</dd>
        </div>
        <div>
          <dt>Tickets</dt>
          <dd>{selected.ticketCount}</dd>
        </div>
        <div>
          <dt>Geschätzte Passagierzuladung</dt>
          <dd>
            {selected.estimatedPassengerPayloadKg === null
              ? "Nicht vollständig erfasst"
              : `${selected.estimatedPassengerPayloadKg} kg`}
          </dd>
        </div>
        <div>
          <dt>Zurückstellungen</dt>
          <dd>
            {selected.deferralCount}/{event?.maxTicketDeferrals ?? 2}
          </dd>
        </div>
        <div>
          <dt>Flugzeug</dt>
          <dd>
            {selected.aircraftRegistration ??
              (selected.suggestedAircraftRegistration
                ? `Vorschlag ${selected.suggestedAircraftRegistration} · Belegung muss bestätigt werden`
                : "Kein kompatibles Flugzeug verfügbar")}
          </dd>
        </div>
        {selected.status !== "DRAFT" ? (
          <div>
            <dt>Pilotencode</dt>
            <dd>{selected.pilotOperationalCode ?? "Nicht erfasst"}</dd>
          </div>
        ) : null}
      </dl>
      <p className="safety-disclaimer">
        Nur organisatorische Schätzung aus konfigurierten Referenzgewichten. Die Bewertung und
        Entscheidung liegt ausschließlich beim Piloten; keine Sicherheits- oder Freigabewirkung.
      </p>
      <section className="rotation-timeline" aria-labelledby="timeline-title">
        <div>
          <h3 id="timeline-title">Plan · Prognose · Ist</h3>
          <span>
            Prognosequalität:{" "}
            {selected.timeline.predictionQuality
              ? predictionQualityLabel[selected.timeline.predictionQuality]
              : "noch nicht berechnet"}
          </span>
        </div>
        <RotationOvertimeNotice rotation={selected} timeZone={timeZone} />
        <table>
          <thead>
            <tr>
              <th scope="col">Punkt</th>
              <th scope="col">Plan</th>
              <th scope="col">Prognose</th>
              <th scope="col">Ist</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Boarding", "boardingAt"],
                ["Start", "departureAt"],
                ["Landung", "landingAt"],
                ["Abschluss", "completionAt"],
              ] as const
            ).map(([label, field]) => (
              <tr key={field}>
                <th scope="row">{label}</th>
                <td>{operationalTimeLabel(selected.timeline.planned[field], timeZone)}</td>
                <td>{operationalTimeLabel(selected.timeline.predicted[field], timeZone)}</td>
                <td>{operationalTimeLabel(selected.timeline.actual[field], timeZone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="attendance-panel" aria-labelledby="attendance-title">
        <div>
          <h3 id="attendance-title">Anwesenheit (optional)</h3>
          <span>
            {selected.tickets.filter((ticket) => ticket.attendanceStatus === "CHECKED_IN").length}/
            {selected.tickets.length} eingecheckt
          </span>
        </div>
        <div className="attendance-list">
          {selected.tickets.map((ticket, index) => {
            const checkedIn = ticket.attendanceStatus === "CHECKED_IN";
            return (
              <button
                className={checkedIn ? "checked-in" : ""}
                disabled={
                  !(["DRAFT", "CALLED"] as const).includes(selected.status as "DRAFT" | "CALLED")
                }
                key={ticket.id}
                onClick={() => void onAttendance(ticket.id, !checkedIn)}
                type="button"
              >
                Ticket {index + 1} · {checkedIn ? "anwesend" : "offen"}
              </button>
            );
          })}
        </div>
        <small>Der Standardumlauf bleibt auch ohne Einzelabgleich vollständig bedienbar.</small>
      </section>
      {selected.status === "LANDED" ? (
        <div className="landed-warning">
          <p>Gelandet · noch nicht verfügbar</p>
          <label>
            Zustand nach dem Turnaround{" "}
            <select
              onChange={(event) => onSetTurnaroundState(event.target.value as TurnaroundNextState)}
              value={turnaroundNextState}
            >
              <option value="AVAILABLE">Verfügbar</option>
              <option value="REFUELING">Tanken</option>
              <option value="PAUSED">Pause</option>
              <option value="INACTIVE">Nicht verfügbar</option>
            </select>
          </label>
        </div>
      ) : null}
      {selected.status === "DRAFT" || selected.status === "CALLED" ? (
        <div className="correction-controls">
          <label>
            Grund für Queue-Abweichung{" "}
            <input
              value={queueReason}
              onChange={(event) => onSetQueueReason(event.target.value)}
              placeholder="Mindestens 3 Zeichen"
            />
          </label>
          <div className="secondary-actions">
            <button
              disabled={queueReason.trim().length < 3}
              onClick={() => void onDefer()}
              type="button"
            >
              Zurückstellen
            </button>
            {selected.status === "CALLED" ? (
              <button
                disabled={queueReason.trim().length < 3}
                onClick={() => void onAbort()}
                type="button"
              >
                Umlauf abbrechen · Gruppe nach vorn
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {selected.status === "CALLED" &&
      selected.calledAt &&
      Date.now() - Date.parse(selected.calledAt) <= 10_000 ? (
        <button className="undo-action" onClick={() => void onRevokeCall()} type="button">
          Boarding-Aufruf rückgängig
        </button>
      ) : null}
      {action ? (
        <button
          className="primary-action"
          disabled={
            action.command === "CALL_NEXT" &&
            (!nextAircraftId ||
              !selectedAircraftHasPilot ||
              event?.emergencyMode ||
              event?.status !== "ACTIVE" ||
              event?.operationalInterrupted ||
              (queueDeviationReasonRequired && callDeviationReason.trim().length < 3))
          }
          onClick={() => void onAdvance()}
          type="button"
        >
          {action.label}
        </button>
      ) : (
        <div className="completed-state">Umlauf abgeschlossen</div>
      )}
    </>
  );
}
