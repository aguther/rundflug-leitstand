import type { OperationBoard } from "@rundflug/contracts";
import { aircraftOperationalStateLabels, formatBookingGroupLabel } from "@rundflug/domain";
import {
  Bell,
  CheckCircle2,
  CircleCheck,
  CircleX,
  Clock3,
  Coffee,
  Fuel,
  type LucideIcon,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  RotateCcw,
  Tickets,
  TicketsPlane,
  User,
  UserCheck,
  UserPen,
  UserRoundX,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ConfirmationDialog, IconButton, ModalDialog } from "./design-system/components";

export type FlightLineAircraft = OperationBoard["aircraft"][number];
export type FlightLineRotation = OperationBoard["rotations"][number];
export type FlightLineQueueGroup = OperationBoard["queueGroups"][number];
export type FlightLineFleetState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";
export type FlightLineStatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export const PilotIcon = User;
export const PilotChangeIcon = UserPen;

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

export function flightLineStateClass(status: string): string {
  return `flight-line-state-${status.toLocaleLowerCase("en-US")}`;
}

export function formatFlightLineTime(value: string | null | undefined, timeZone: string): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

export function rotationGroupLabels(rotation: FlightLineRotation): string {
  const labels = rotation.bookingGroups.map((group) =>
    formatBookingGroupLabel(rotation.productCode, group.communicationNumber),
  );
  return labels.length > 0 ? labels.join(", ") : "";
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

export type FlightProgressStepKey =
  | "boarding"
  | "offblock"
  | "onblock"
  | "available"
  | "unavailable";

export type FlightProgressIconName =
  | "circle-check"
  | "tickets-plane"
  | "plane-takeoff"
  | "plane-landing"
  | "circle-x"
  | "fuel"
  | "coffee";

export interface FlightProgressStep {
  key: FlightProgressStepKey;
  label: string;
  icon: FlightProgressIconName;
  time: string | null | undefined;
  reached: boolean;
  current: boolean;
  connectorReached: boolean;
}

export function flightProgressIconForStep(
  key: FlightProgressStepKey,
  status: string,
): FlightProgressIconName {
  if (key === "available") return "circle-check";
  if (key === "boarding") return "tickets-plane";
  if (key === "offblock") return "plane-takeoff";
  if (key === "onblock") return "plane-landing";
  if (status === "REFUELING") return "fuel";
  if (status === "PAUSED") return "coffee";
  return "circle-x";
}

const flightProgressIcons = {
  "circle-check": CircleCheck,
  "tickets-plane": TicketsPlane,
  "plane-takeoff": PlaneTakeoff,
  "plane-landing": PlaneLanding,
  "circle-x": CircleX,
  fuel: Fuel,
  coffee: Coffee,
} as const;

const historyColumns: Array<{ label: string; Icon: LucideIcon }> = [
  { label: "Buchungsgruppen", Icon: Tickets },
  { label: "Pilot", Icon: User },
  { label: "Boarding", Icon: TicketsPlane },
  { label: "Off-Block", Icon: PlaneTakeoff },
  { label: "On-Block", Icon: PlaneLanding },
  { label: "Abschluss", Icon: CircleCheck },
];

export function CurrentAircraftStateMarker({
  aircraft,
  rotation,
  timeZone,
}: {
  aircraft: FlightLineAircraft;
  rotation: FlightLineRotation | undefined;
  timeZone: string;
}) {
  const status = visibleAircraftState(aircraft, rotation);
  const currentStep = flightProgressSteps(aircraft, rotation).find((step) => step.current);
  if (!currentStep) return null;

  const CurrentIcon = flightProgressIcons[currentStep.icon];
  const formattedTime = currentStep.time ? formatFlightLineTime(currentStep.time, timeZone) : "";
  const accessibleLabel = formattedTime
    ? `${currentStep.label} · ${formattedTime}`
    : currentStep.label;

  return (
    <div
      aria-label={accessibleLabel}
      className={`flight-director-current-state-marker state-${status.toLocaleLowerCase("en-US")}`}
      data-icon={currentStep.icon}
      role="img"
      title={accessibleLabel}
    >
      <span className="flight-director-progress-node" aria-hidden="true">
        <CurrentIcon />
      </span>
      <small>{formattedTime}</small>
    </div>
  );
}

export function flightProgressSteps(
  aircraft: FlightLineAircraft,
  rotation: FlightLineRotation | undefined,
): FlightProgressStep[] {
  const status = visibleAircraftState(aircraft, rotation);
  const timeline = rotation?.timeline.actual;
  const unavailable = ["REFUELING", "PAUSED", "INTERRUPTED", "INACTIVE"].includes(status);
  const current: FlightProgressStepKey | null = unavailable
    ? "unavailable"
    : status === "BOARDING"
      ? "boarding"
      : status === "IN_FLIGHT"
        ? "offblock"
        : status === "LANDED"
          ? "onblock"
          : status === "AVAILABLE"
            ? "available"
            : null;
  const availableReached =
    status === "AVAILABLE" &&
    (!rotation || rotation.status === "DRAFT" || rotation.status === "COMPLETED");
  const reached = {
    boarding: Boolean(timeline?.boardingAt),
    offblock: Boolean(timeline?.departureAt),
    onblock: Boolean(timeline?.landingAt),
    available: availableReached,
    unavailable,
  } as const;
  const steps: Array<
    Omit<FlightProgressStep, "current" | "connectorReached" | "icon"> & {
      key: FlightProgressStepKey;
    }
  > = [
    {
      key: "available",
      label: "Verfügbar",
      time: availableReached ? aircraft.operationalStateChangedAt : null,
      reached: reached.available,
    },
    { key: "boarding", label: "Boarding", time: timeline?.boardingAt, reached: reached.boarding },
    { key: "offblock", label: "Off-Block", time: timeline?.departureAt, reached: reached.offblock },
    { key: "onblock", label: "On-Block", time: timeline?.landingAt, reached: reached.onblock },
    {
      key: "unavailable",
      label: status === "REFUELING" ? "Tanken" : status === "PAUSED" ? "Pause" : "Nicht verfügbar",
      time: unavailable ? aircraft.operationalStateChangedAt : null,
      reached: reached.unavailable,
    },
  ];
  return steps.map((step, index) => ({
    ...step,
    icon: flightProgressIconForStep(step.key, status),
    current: current === step.key,
    connectorReached:
      (step.key === "boarding" || step.key === "offblock") &&
      step.reached &&
      Boolean(steps[index + 1]?.reached),
  }));
}

export function FlightProgress({
  aircraft,
  rotation,
  timeZone,
  variant = "compact",
}: {
  aircraft: FlightLineAircraft;
  rotation: FlightLineRotation | undefined;
  timeZone: string;
  variant?: "compact" | "detailed";
}) {
  const status = visibleAircraftState(aircraft, rotation);
  const steps = flightProgressSteps(aircraft, rotation);
  return (
    <ol
      aria-label={`Ist-Zeitlinie · ${aircraftStatusLabel(aircraft, rotation)} seit ${formatFlightLineTime(
        aircraft.operationalStateChangedAt,
        timeZone,
      )}`}
      className={`flight-director-progress flight-director-progress--${variant} state-${status.toLocaleLowerCase("en-US")}`}
    >
      {steps.map((step) => {
        const StepIcon = flightProgressIcons[step.icon];
        return (
          <li
            aria-current={step.current ? "step" : undefined}
            aria-label={`${step.label}: ${step.time ? formatFlightLineTime(step.time, timeZone) : step.current ? "aktuell" : step.reached ? "erreicht" : "ausstehend"}`}
            className={`${step.reached ? "reached" : ""} ${step.current ? "current" : ""} ${step.connectorReached ? "connector-reached" : ""}`.trim()}
            data-icon={step.icon}
            data-step={step.key}
            key={step.key}
          >
            <span className="flight-director-progress-node" aria-hidden="true">
              <StepIcon />
            </span>
            <small>{step.time ? formatFlightLineTime(step.time, timeZone) : ""}</small>
          </li>
        );
      })}
    </ol>
  );
}

function queuedSegmentTicketCount(group: FlightLineQueueGroup): number {
  return group.nextSegmentTicketCount ?? group.ticketCount;
}

function queuedSegmentPresentCount(group: FlightLineQueueGroup): number {
  return group.nextSegmentPresentCount ?? group.presentCount;
}

function AssignmentQueueRow({
  group,
  selected,
  selectedSeats,
  capacity,
  onToggle,
  onAttendance,
  onMissing,
  onRecall,
  onDefer,
}: {
  group: FlightLineQueueGroup;
  selected: boolean;
  selectedSeats: number;
  capacity: number;
  onToggle: (ticketGroupId: string, selected: boolean) => void;
  onAttendance: (ticketGroupId: string, checkedIn: boolean) => void | Promise<void>;
  onMissing: (ticketGroupId: string) => void | Promise<void>;
  onRecall: (ticketGroupId: string) => void | Promise<void>;
  onDefer?: ((ticketGroupId: string) => void | Promise<void>) | undefined;
}) {
  const segmentTicketCount = queuedSegmentTicketCount(group);
  const segmentPresentCount = queuedSegmentPresentCount(group);
  const exceedsCapacity = !selected && selectedSeats + segmentTicketCount > capacity;
  const communicationLabel = formatBookingGroupLabel(group.productCode, group.communicationNumber);
  return (
    <div
      className={`${selected ? "flight-director-queue-row selected" : "flight-director-queue-row"}${onDefer ? " has-defer" : ""}`}
    >
      <label>
        <input
          checked={selected}
          disabled={group.status === "MISSING" || exceedsCapacity}
          onChange={(event) => onToggle(group.id, event.target.checked)}
          type="checkbox"
        />
        <strong>{communicationLabel}</strong>
      </label>
      <div className="flight-director-queue-actions">
        <IconButton
          aria-pressed={group.status === "PRESENT"}
          className="flight-director-attendance-action"
          label={
            group.status === "PRESENT"
              ? `Anwesenheit für ${communicationLabel} aufheben`
              : `${communicationLabel} anwesend`
          }
          onClick={() => onAttendance(group.id, group.status !== "PRESENT")}
          size="touch"
          type="button"
        >
          <CheckCircle2 aria-hidden="true" />
        </IconButton>
        <IconButton
          className="flight-director-missing-action"
          label={`${communicationLabel} nicht da`}
          onClick={() => onMissing(group.id)}
          size="touch"
          type="button"
        >
          <UserRoundX aria-hidden="true" />
        </IconButton>
        <IconButton
          label={`${communicationLabel} nachrufen`}
          onClick={() => onRecall(group.id)}
          size="touch"
          type="button"
        >
          <Bell aria-hidden="true" />
        </IconButton>
        {onDefer ? (
          <IconButton
            label={`${communicationLabel} zurückstellen`}
            onClick={() => onDefer(group.id)}
            size="touch"
            type="button"
          >
            <RotateCcw aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      <span>
        {group.segmentCount && group.segmentCount > 1 ? (
          <>
            {segmentTicketCount} von {group.ticketCount} Personen · Teil {group.segmentIndex ?? 1}/
            {group.segmentCount}
          </>
        ) : (
          <>
            {segmentTicketCount} Person{segmentTicketCount === 1 ? "" : "en"}
          </>
        )}
      </span>
      <span>
        {segmentPresentCount}/{segmentTicketCount} anwesend
      </span>
    </div>
  );
}

export function BookingGroupAssignmentDialog({
  aircraft,
  groups,
  selectedQueueGroupIds,
  confirmDisabled,
  open,
  onClose,
  onConfirm,
  onToggle,
  onAttendance,
  onMissing,
  onRecall,
  onDefer,
}: {
  aircraft: FlightLineAircraft | undefined;
  groups: FlightLineQueueGroup[];
  selectedQueueGroupIds: string[];
  confirmDisabled: boolean;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onToggle: (ticketGroupId: string, selected: boolean) => void;
  onAttendance: (ticketGroupId: string, checkedIn: boolean) => void | Promise<void>;
  onMissing: (ticketGroupId: string) => void | Promise<void>;
  onRecall: (ticketGroupId: string) => void | Promise<void>;
  onDefer?: (ticketGroupId: string) => void | Promise<void>;
}) {
  const selectedGroups = groups.filter((group) => selectedQueueGroupIds.includes(group.id));
  const selectedSeats = selectedGroups.reduce(
    (total, group) => total + queuedSegmentTicketCount(group),
    0,
  );
  const capacity = aircraft?.passengerSeats ?? 0;
  const capacityExceeded = selectedSeats > capacity;
  return (
    <ModalDialog
      description={
        aircraft
          ? `${aircraft.registration} · ${aircraft.passengerSeats} Plätze · Gruppen bleiben vollständig zusammen.`
          : undefined
      }
      footer={
        <>
          <Button onClick={onClose} type="button" variant="secondary">
            Abbrechen
          </Button>
          <Button
            disabled={confirmDisabled || selectedSeats === 0 || capacityExceeded}
            onClick={onConfirm}
            type="button"
            variant="primary"
          >
            <CheckCircle2 aria-hidden="true" /> Belegung bestätigen & Boarding starten
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      size="wide"
      title="Buchungsgruppen zuweisen"
    >
      <div className="flight-director-assignment-dialog">
        <section className="flight-director-queue">
          {groups.length > 0 ? (
            groups.map((group) => (
              <AssignmentQueueRow
                capacity={capacity}
                group={group}
                key={group.id}
                onAttendance={onAttendance}
                onDefer={onDefer}
                onMissing={onMissing}
                onRecall={onRecall}
                onToggle={onToggle}
                selected={selectedQueueGroupIds.includes(group.id)}
                selectedSeats={selectedSeats}
              />
            ))
          ) : (
            <p>Keine passende Buchungsgruppe in der Warteschlange.</p>
          )}
        </section>
        <aside className="flight-director-selection">
          <div>
            <span>Ausgewählt</span>
            {selectedGroups.length > 0 ? (
              selectedGroups.map((group) => (
                <strong key={group.id}>
                  {formatBookingGroupLabel(group.productCode, group.communicationNumber)}
                  <small>
                    {queuedSegmentTicketCount(group)}
                    {group.segmentCount && group.segmentCount > 1
                      ? ` von ${group.ticketCount} · Teil ${group.segmentIndex ?? 1}/${group.segmentCount}`
                      : ""}{" "}
                    Pers.
                  </small>
                </strong>
              ))
            ) : (
              <small>Noch keine Gruppe gewählt</small>
            )}
          </div>
          <div className="flight-director-selection-total">
            <span>Gesamt</span>
            <strong>
              {selectedSeats} von {capacity} Plätzen
            </strong>
          </div>
          {capacityExceeded ? (
            <p className="flight-director-dialog-warning">
              Die Auswahl überschreitet die Kapazität.
            </p>
          ) : null}
          {!aircraft?.currentPilotId ? (
            <p className="flight-director-dialog-warning">
              Vor Belegung bitte über „Pilot zuweisen“ einen Pilotencode am Flugzeug hinterlegen.
            </p>
          ) : null}
        </aside>
      </div>
    </ModalDialog>
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

export function primaryAircraftActionPresentation(
  aircraft: FlightLineAircraft,
  rotation: FlightLineRotation | undefined,
) {
  if (
    ["REFUELING", "PAUSED", "INTERRUPTED", "INACTIVE", "TURNAROUND"].includes(
      aircraft.operationalState,
    )
  ) {
    return { Icon: CircleCheck, shortLabel: "Verfügbar setzen" };
  }
  if (!rotation || rotation.status === "DRAFT") {
    return { Icon: UserCheck, shortLabel: "Boarding starten" };
  }
  if (rotation.status === "CALLED") return { Icon: PlaneTakeoff, shortLabel: "Off-Block" };
  if (rotation.status === "IN_FLIGHT") return { Icon: PlaneLanding, shortLabel: "On-Block" };
  if (rotation.status === "LANDED") {
    return { Icon: CircleCheck, shortLabel: "Umlauf abschließen" };
  }
  return { Icon: CircleCheck, shortLabel: "Keine Aktion" };
}

export function CompactCurrentRotation({
  aircraft,
  rotation,
  timeZone,
}: {
  aircraft: FlightLineAircraft | undefined;
  rotation: FlightLineRotation | undefined;
  timeZone: string;
}) {
  if (!aircraft) {
    return (
      <div className="flight-director-empty-detail">
        <Plane aria-hidden="true" />
        <span>Kein Flugzeug ausgewählt.</span>
      </div>
    );
  }
  const bookingGroupLabels = rotation ? rotationGroupLabels(rotation) : "";
  return (
    <div className="flight-director-current-content">
      <dl className="flight-director-current-rotation is-booking-groups-only">
        <div>
          <dt>Buchungsgruppen</dt>
          <dd title={bookingGroupLabels || undefined}>{bookingGroupLabels}</dd>
        </div>
      </dl>
      <section className="flight-director-current-timeline" aria-label="Umlaufzeitlinie">
        <FlightProgress
          aircraft={aircraft}
          rotation={rotation}
          timeZone={timeZone}
          variant="detailed"
        />
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
        {historyColumns.map(({ label, Icon }) => (
          <span className="flight-director-column-icon" key={label} title={label}>
            <Icon aria-hidden="true" />
            <span className="visually-hidden">{label}</span>
          </span>
        ))}
      </div>
      {history.length > 0 ? (
        history.map((rotation) => (
          <div key={rotation.id}>
            <strong>
              <HistoryCellIcon Icon={Tickets} label="Buchungsgruppen" />
              <span>{rotationGroupLabels(rotation)}</span>
            </strong>
            <span>
              <HistoryCellIcon Icon={User} label="Pilot" />
              <span>{rotation.pilotOperationalCode ?? "–"}</span>
            </span>
            <span>
              <HistoryCellIcon Icon={TicketsPlane} label="Boarding" />
              <span>{formatFlightLineTime(rotation.timeline.actual.boardingAt, timeZone)}</span>
            </span>
            <span>
              <HistoryCellIcon Icon={PlaneTakeoff} label="Off-Block" />
              <span>{formatFlightLineTime(rotation.timeline.actual.departureAt, timeZone)}</span>
            </span>
            <span>
              <HistoryCellIcon Icon={PlaneLanding} label="On-Block" />
              <span>{formatFlightLineTime(rotation.timeline.actual.landingAt, timeZone)}</span>
            </span>
            <span>
              <HistoryCellIcon Icon={CircleCheck} label="Abschluss" />
              <span>{formatFlightLineTime(rotation.timeline.actual.completionAt, timeZone)}</span>
            </span>
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

function HistoryCellIcon({ Icon, label }: { Icon: LucideIcon; label: string }) {
  return (
    <span className="flight-director-history-cell-icon" title={label}>
      <Icon aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
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
              onClick={submitPilotAssignment}
              type="button"
              variant="primary"
            >
              Pilot zuweisen
            </Button>
          </>
        }
        onClose={onClose}
        open={open}
        title={
          <span className="flight-director-dialog-title">
            <PilotChangeIcon /> Pilot zuweisen{aircraft ? ` · ${aircraft.registration}` : ""}
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
                <PilotIcon />
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
        onConfirm={async () => {
          if (!reassign || !aircraft) return;
          await onAssignPilot(aircraft.id, reassign.pilotId, true);
          setReassign(null);
          onClose();
        }}
        open={reassign !== null}
        title="Pilotzuweisung wechseln?"
      />
    </>
  );
}
