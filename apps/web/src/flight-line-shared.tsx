import type { OperationBoard } from "@rundflug/contracts";
import { aircraftOperationalStateLabels, rotationStateLabels } from "@rundflug/domain";
import { Clock3, Plane } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ConfirmationDialog, ModalDialog } from "./design-system/components";

export type FlightLineAircraft = OperationBoard["aircraft"][number];
export type FlightLineRotation = OperationBoard["rotations"][number];
export type FlightLineFleetState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";
export type FlightLineStatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export function PilotCapIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M4 14.5c1.8-4.9 4.6-7.4 8-7.4s6.2 2.5 8 7.4" />
      <path d="M3.2 15c2.5 1.2 5.4 1.8 8.8 1.8s6.3-.6 8.8-1.8" />
      <path d="M9.2 7.9 12 4.8l2.8 3.1M12 5v3" />
    </svg>
  );
}

export function operationalRotationForAircraft(
  aircraft: FlightLineAircraft,
  rotations: FlightLineRotation[],
  products: OperationBoard["products"],
): FlightLineRotation | undefined {
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

export function activeRotationForAircraft(
  aircraftId: string,
  rotations: FlightLineRotation[],
): FlightLineRotation | undefined {
  return rotations.find(
    (rotation) => rotation.aircraftId === aircraftId && rotation.status !== "COMPLETED",
  );
}

export function latestRotationForAircraft(
  aircraftId: string,
  rotations: FlightLineRotation[],
): FlightLineRotation | undefined {
  return (
    activeRotationForAircraft(aircraftId, rotations) ??
    rotations.findLast(
      (rotation) => rotation.aircraftId === aircraftId && rotation.status === "COMPLETED",
    )
  );
}

export function rotationHistoryForAircraft(
  aircraftId: string,
  rotations: FlightLineRotation[],
): FlightLineRotation[] {
  return rotations
    .filter((rotation) => rotation.aircraftId === aircraftId && rotation.status === "COMPLETED")
    .slice(-20)
    .reverse();
}

export function visibleAircraftState(
  aircraft: FlightLineAircraft,
  rotation: FlightLineRotation | undefined,
) {
  if (aircraft.operationalState !== "AVAILABLE") return aircraft.operationalState;
  if (rotation?.status === "CALLED") return "BOARDING";
  if (rotation?.status === "IN_FLIGHT") return "IN_FLIGHT";
  if (rotation?.status === "LANDED") return "LANDED";
  return "AVAILABLE";
}

export function aircraftStatusLabel(
  aircraft: FlightLineAircraft,
  rotation: FlightLineRotation | undefined,
): string {
  return aircraftOperationalStateLabels[visibleAircraftState(aircraft, rotation)];
}

export function flightLineStatusTone(status: string): FlightLineStatusTone {
  if (status === "AVAILABLE") return "success";
  if (["BOARDING", "PAUSED"].includes(status)) return "warning";
  if (["INTERRUPTED", "INACTIVE"].includes(status)) return "danger";
  if (["IN_FLIGHT", "LANDED", "REFUELING"].includes(status)) return "info";
  return "neutral";
}

export function formatFlightLineTime(value: string | null | undefined, timeZone: string): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

export function flightLineGroupLabel(productCode: string, communicationNumber: number): string {
  return `${productCode}-${String(communicationNumber).padStart(3, "0")}`;
}

export function rotationGroupLabels(rotation: FlightLineRotation): string {
  const labels = rotation.bookingGroups.map((group) =>
    flightLineGroupLabel(rotation.productCode, group.communicationNumber),
  );
  return labels.length > 0 ? labels.join(", ") : rotation.communicationLabel;
}

export function timelineSummary(
  rotation: FlightLineRotation | undefined,
  timeZone: string,
): string {
  if (!rotation || rotation.status === "DRAFT") return "Bereit für Belegung";
  const timeline = rotation.timeline.actual;
  if (rotation.status === "CALLED") {
    return `Boarding ${formatFlightLineTime(timeline.boardingAt, timeZone)}`;
  }
  if (rotation.status === "IN_FLIGHT") {
    return `Offblock ${formatFlightLineTime(timeline.departureAt, timeZone)}`;
  }
  if (rotation.status === "LANDED") {
    return `Onblock ${formatFlightLineTime(timeline.landingAt, timeZone)}`;
  }
  return `Abschluss ${formatFlightLineTime(timeline.completionAt, timeZone)}`;
}

export function FlightProgress({
  aircraft,
  rotation,
  timeZone,
}: {
  aircraft: FlightLineAircraft;
  rotation: FlightLineRotation | undefined;
  timeZone: string;
}) {
  const status = visibleAircraftState(aircraft, rotation);
  const currentIndex = {
    AVAILABLE: 0,
    BOARDING: 1,
    IN_FLIGHT: 2,
    LANDED: 3,
    TURNAROUND: 4,
    REFUELING: 3,
    PAUSED: 1,
    INTERRUPTED: 1,
    INACTIVE: 1,
  }[status];
  return (
    <span
      aria-label={timelineSummary(rotation, timeZone)}
      className={`flight-director-progress state-${status.toLocaleLowerCase("en-US")}`}
      role="img"
    >
      {["bereit", "boarding", "offblock", "onblock", "abschluss"].map((step, index) => (
        <span
          className={index === currentIndex ? "current" : index < currentIndex ? "done" : ""}
          key={step}
        />
      ))}
    </span>
  );
}

export function nextAircraftStep(
  aircraft: FlightLineAircraft,
  rotation: FlightLineRotation | undefined,
): string {
  if (aircraft.operationalState === "REFUELING") return "Tanken abschließen";
  if (aircraft.operationalState === "PAUSED") return "Pause beenden";
  if (["INTERRUPTED", "INACTIVE"].includes(aircraft.operationalState)) {
    return "Verfügbar setzen";
  }
  if (!rotation || rotation.status === "DRAFT") return "Bereit für Belegung";
  if (rotation.status === "CALLED") return "Offblock markieren";
  if (rotation.status === "IN_FLIGHT") return "Onblock markieren";
  if (rotation.status === "LANDED") return "Umlauf abschließen";
  return "Bereit";
}

export function primaryAircraftActionLabel(
  aircraft: FlightLineAircraft,
  rotation: FlightLineRotation | undefined,
  assignmentLabel = "Belegung zuweisen",
): string {
  if (
    ["REFUELING", "PAUSED", "INTERRUPTED", "INACTIVE", "TURNAROUND"].includes(
      aircraft.operationalState,
    )
  ) {
    return "Verfügbar setzen";
  }
  if (!rotation || rotation.status === "DRAFT") return assignmentLabel;
  if (rotation.status === "CALLED") return "Offblock";
  if (rotation.status === "IN_FLIGHT") return "Onblock";
  if (rotation.status === "LANDED") return "Umlauf abschließen";
  return "Keine Aktion";
}

export function CompactCurrentRotation({
  rotation,
  timeZone,
}: {
  rotation: FlightLineRotation | undefined;
  timeZone: string;
}) {
  if (!rotation) {
    return (
      <div className="flight-director-empty-detail">
        <Plane aria-hidden="true" />
        <span>Für das ausgewählte Flugzeug ist noch kein Umlauf belegt.</span>
      </div>
    );
  }
  return (
    <div className="flight-director-current-content">
      <dl className="flight-director-current-rotation">
        <div>
          <dt>Status</dt>
          <dd>{rotationStateLabels[rotation.status]}</dd>
        </div>
        <div>
          <dt>Buchungsgruppen</dt>
          <dd>{rotationGroupLabels(rotation)}</dd>
        </div>
        <div>
          <dt>Pilot</dt>
          <dd>{rotation.pilotOperationalCode ?? "–"}</dd>
        </div>
      </dl>
      <section className="flight-director-current-timeline" aria-label="Umlaufzeitlinie">
        {[
          ["Boarding", rotation.timeline.actual.boardingAt],
          ["Offblock", rotation.timeline.actual.departureAt],
          ["Onblock", rotation.timeline.actual.landingAt],
          ["Abschluss / Folgestatus", rotation.timeline.actual.completionAt],
        ].map(([label, value]) => (
          <span className={value ? "reached" : ""} key={label}>
            <strong>{label}</strong>
            <i aria-hidden="true" />
            <small>{formatFlightLineTime(value, timeZone)}</small>
          </span>
        ))}
      </section>
    </div>
  );
}

export function CompactHistory({
  history,
  timeZone,
}: {
  history: FlightLineRotation[];
  timeZone: string;
}) {
  return (
    <div className="flight-director-compact-table history">
      <div className="flight-director-compact-head">
        <span>Buchungsgruppen</span>
        <span>Pilot</span>
        <span>Boarding</span>
        <span>Offblock</span>
        <span>Onblock</span>
        <span>Abschluss</span>
      </div>
      {history.length > 0 ? (
        history.map((rotation) => (
          <div key={rotation.id}>
            <strong>{rotationGroupLabels(rotation)}</strong>
            <span>{rotation.pilotOperationalCode ?? "–"}</span>
            <span>{formatFlightLineTime(rotation.timeline.actual.boardingAt, timeZone)}</span>
            <span>{formatFlightLineTime(rotation.timeline.actual.departureAt, timeZone)}</span>
            <span>{formatFlightLineTime(rotation.timeline.actual.landingAt, timeZone)}</span>
            <span>{formatFlightLineTime(rotation.timeline.actual.completionAt, timeZone)}</span>
          </div>
        ))
      ) : (
        <p>
          <Clock3 aria-hidden="true" /> Noch keine abgeschlossenen Flüge.
        </p>
      )}
    </div>
  );
}

export function PilotAssignmentDialogs({
  aircraft,
  board,
  currentRotation,
  onAssignPilot,
  onClose,
  open,
}: {
  aircraft: FlightLineAircraft | undefined;
  board: OperationBoard;
  currentRotation: FlightLineRotation | undefined;
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  onClose: () => void;
  open: boolean;
}) {
  const [pilotId, setPilotId] = useState("");
  const [reassign, setReassign] = useState<{
    pilotId: string;
    code: string;
    registration: string;
  } | null>(null);

  useEffect(() => {
    if (open) setPilotId(aircraft?.currentPilotId ?? "");
  }, [aircraft?.currentPilotId, open]);

  async function submitPilotAssignment() {
    if (!aircraft || !pilotId) return;
    const pilot = board.pilots.find((entry) => entry.id === pilotId);
    if (!pilot) return;
    const otherAircraft = board.aircraft.find(
      (entry) => entry.id !== aircraft.id && entry.currentPilotId === pilotId,
    );
    if (otherAircraft) {
      setReassign({
        pilotId,
        code: pilot.operationalCode,
        registration: otherAircraft.registration,
      });
      return;
    }
    await onAssignPilot(aircraft.id, pilotId, false);
    onClose();
  }

  return (
    <>
      <ModalDialog
        description="Zuweisung oder Änderung nur bis Offblock möglich. Es werden ausschließlich anonyme Codes angezeigt."
        footer={
          <>
            <Button onClick={onClose} type="button">
              Abbrechen
            </Button>
            <Button
              disabled={!pilotId}
              onClick={() => void submitPilotAssignment()}
              type="button"
              variant="primary"
            >
              {pilotId
                ? `Pilot ${board.pilots.find((entry) => entry.id === pilotId)?.operationalCode ?? ""} zuweisen`
                : "Pilot zuweisen"}
            </Button>
          </>
        }
        onClose={onClose}
        open={open}
        title={
          <span className="flight-director-dialog-title">
            <PilotCapIcon /> Pilot zuweisen{aircraft ? ` · ${aircraft.registration}` : ""}
          </span>
        }
      >
        <p className="flight-director-pilot-current">
          Aktuell:{" "}
          <strong>{aircraft?.currentPilotOperationalCode ?? "Kein Pilot zugewiesen"}</strong>
        </p>
        <div className="flight-director-pilot-options" role="radiogroup" aria-label="Pilotencode">
          {board.pilots.map((pilot) => {
            const assignedAircraft = board.aircraft.find(
              (entry) => entry.currentPilotId === pilot.id && entry.id !== aircraft?.id,
            );
            const blockedByRotation =
              pilot.currentRotationId !== null && pilot.currentRotationId !== currentRotation?.id;
            const disabled = !pilot.active || pilot.paused || blockedByRotation;
            return (
              <label className={disabled ? "disabled" : ""} key={pilot.id}>
                <input
                  checked={pilotId === pilot.id}
                  disabled={disabled}
                  name="pilot-code"
                  onChange={() => setPilotId(pilot.id)}
                  type="radio"
                />
                <PilotCapIcon />
                <span>
                  <strong>{pilot.operationalCode}</strong>
                  <small>
                    {!pilot.active
                      ? "Inaktiv"
                      : pilot.paused
                        ? "Pausiert"
                        : blockedByRotation
                          ? "Im aktiven Umlauf"
                          : assignedAircraft
                            ? `Zugewiesen: ${assignedAircraft.registration}`
                            : "Verfügbar"}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
      </ModalDialog>

      <ConfirmationDialog
        body={
          reassign
            ? `${reassign.code} ist ${reassign.registration} zugewiesen. Zu ${aircraft?.registration ?? "diesem Flugzeug"} wechseln? Der andere aktive Umlauf wird nicht verändert.`
            : ""
        }
        confirmLabel="Pilot wechseln"
        onCancel={() => setReassign(null)}
        onConfirm={() => {
          if (!reassign || !aircraft) return;
          void onAssignPilot(aircraft.id, reassign.pilotId, true).then(() => {
            setReassign(null);
            onClose();
          });
        }}
        open={reassign !== null}
        title="Pilotzuweisung wechseln?"
      />
    </>
  );
}
