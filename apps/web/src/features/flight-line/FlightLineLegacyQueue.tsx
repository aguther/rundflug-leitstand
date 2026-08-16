import type { OperationBoard } from "@rundflug/contracts";
import { formatBookingGroupLabel } from "@rundflug/domain";
import { TicketGroupRecallButton } from "../../flight-line-shared";
import { sharedGroupSegmentLabel } from "../../operational-exceptions";
import { QueueGroupPassengerSummary, queuedSegmentTicketCount } from "./FlightLineViewPresentation";

type Aircraft = OperationBoard["aircraft"][number];
type QueueGroup = OperationBoard["queueGroups"][number];
type Rotation = OperationBoard["rotations"][number];

interface FlightLineLegacyQueueProps {
  aircraft: Aircraft | null | undefined;
  allRotations: Rotation[];
  compatibleGroups: QueueGroup[];
  deviationReason: string;
  deviationReasonRequired: boolean;
  onClearRecall: (ticketGroupId: string, recallId: string) => Promise<void>;
  onGroupAttendance: (ticketGroupId: string, checkedIn: boolean) => Promise<void>;
  onGroupPresence: (ticketGroupId: string, action: "MISSING" | "RESTORE") => Promise<void>;
  onSelectRotation: (rotation: Rotation, openDisposition: boolean) => void;
  onSetDeviationReason: (reason: string) => void;
  onStartRecall: (ticketGroupId: string) => Promise<void>;
  onToggleGroup: (group: QueueGroup, checked: boolean) => void;
  rotations: Rotation[];
  selectedGroupIds: string[];
  selectedProductId: string | null;
  selectedRotation: Rotation | null | undefined;
  selectedSeatCount: number;
  skippedEarlierGroupCount: number;
  timeZone: string;
}

export function FlightLineLegacyQueue({
  aircraft,
  allRotations,
  compatibleGroups,
  deviationReason,
  deviationReasonRequired,
  onClearRecall,
  onGroupAttendance,
  onGroupPresence,
  onSelectRotation,
  onSetDeviationReason,
  onStartRecall,
  onToggleGroup,
  rotations,
  selectedGroupIds,
  selectedProductId,
  selectedRotation,
  selectedSeatCount,
  skippedEarlierGroupCount,
  timeZone,
}: FlightLineLegacyQueueProps) {
  return (
    <>
      {aircraft && compatibleGroups.length > 0 ? (
        <section className="queue-group-selector" aria-labelledby="queue-groups-title">
          <header>
            <div>
              <h2 id="queue-groups-title">Gruppen auswählen</h2>
              <p>Nur vollständige Gruppen werden gemeinsam aufgerufen.</p>
            </div>
            <strong>
              {selectedSeatCount} von {aircraft.passengerSeats} Plätzen
            </strong>
          </header>
          <div className="queue-group-options">
            {compatibleGroups.map((group) => {
              const selected = selectedGroupIds.includes(group.id);
              const productMismatch =
                !selected && selectedProductId !== null && group.productId !== selectedProductId;
              const exceedsCapacity =
                !selected &&
                selectedSeatCount + queuedSegmentTicketCount(group) > aircraft.passengerSeats;
              return (
                <article
                  className={selected ? "queue-group-option selected" : "queue-group-option"}
                  key={group.id}
                >
                  <label>
                    <input
                      aria-label={`${formatBookingGroupLabel(group.productCode, group.communicationNumber)} auswählen`}
                      checked={selected}
                      disabled={group.status === "MISSING" || exceedsCapacity || productMismatch}
                      onChange={(event) => onToggleGroup(group, event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <strong>
                        {formatBookingGroupLabel(group.productCode, group.communicationNumber)}
                      </strong>
                      <QueueGroupPassengerSummary group={group} />
                    </span>
                  </label>
                  <div className="queue-group-actions">
                    <button
                      onClick={() => void onGroupAttendance(group.id, group.status !== "PRESENT")}
                      type="button"
                    >
                      {group.status === "PRESENT" ? "Anwesenheit aufheben" : "Anwesend"}
                    </button>
                    {group.status === "MISSING" ? (
                      <button
                        onClick={() => void onGroupPresence(group.id, "RESTORE")}
                        type="button"
                      >
                        Zurück in Queue
                      </button>
                    ) : (
                      <button
                        className="danger-link-action"
                        onClick={() => void onGroupPresence(group.id, "MISSING")}
                        type="button"
                      >
                        Nicht da
                      </button>
                    )}
                    <TicketGroupRecallButton
                      group={group}
                      onClear={onClearRecall}
                      onStart={onStartRecall}
                      timeZone={timeZone}
                    />
                  </div>
                </article>
              );
            })}
          </div>
          {deviationReasonRequired ? (
            <label className="queue-deviation-reason">
              Grund für das Überspringen früherer Gruppen{" "}
              <input
                maxLength={240}
                onChange={(event) => onSetDeviationReason(event.target.value)}
                placeholder="Mindestens 3 Zeichen"
                value={deviationReason}
              />
              <small>
                {skippedEarlierGroupCount} frühere Ticketgruppe
                {skippedEarlierGroupCount === 1 ? "" : "n"} eines anderen Produkts werden
                übersprungen.
              </small>
            </label>
          ) : null}
        </section>
      ) : null}
      {aircraft ? (
        <>
          {rotations.map((rotation) => {
            const segmentLabel = sharedGroupSegmentLabel(rotation, allRotations);
            return (
              <div className="queue-row-wrap" key={rotation.id}>
                <button
                  className={
                    rotation.id === selectedRotation?.id ? "queue-row selected" : "queue-row"
                  }
                  onClick={() => onSelectRotation(rotation, false)}
                  type="button"
                >
                  <strong>{rotation.communicationLabel}</strong>
                  <span>{rotation.productName}</span>
                  <span>
                    {rotation.ticketCount}/{rotation.usableCapacity} Plätze ·{" "}
                    {rotation.predictedLowerMinutes}–{rotation.predictedUpperMinutes} Min.
                  </span>
                  {segmentLabel ? <small>{segmentLabel}</small> : null}
                </button>
                <button
                  aria-label={`Disposition für ${rotation.communicationLabel}`}
                  className="disposition-trigger"
                  onClick={() => onSelectRotation(rotation, true)}
                  type="button"
                >
                  Disposition
                </button>
              </div>
            );
          })}
          {rotations.length === 0 ? (
            <p>Für dieses Flugzeug ist aktuell keine passende Fluggruppe offen.</p>
          ) : null}
        </>
      ) : (
        <p>Kein aktives Flugzeug verfügbar.</p>
      )}
    </>
  );
}
