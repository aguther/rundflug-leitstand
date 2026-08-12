import type { OperationBoard } from "@rundflug/contracts";
import {
  aircraftOperationalStateLabels,
  formatBookingGroupLabel,
  formatBookingGroupPartLabel,
} from "@rundflug/domain";
import {
  Bell,
  BellOff,
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
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button, ConfirmationDialog, IconButton, ModalDialog } from "./design-system/components";
import {
  type DispatchRecommendationLeaseController,
  dispatchLeaseRemainingSeconds,
  formatDispatchLeaseCountdown,
} from "./dispatch-recommendation-lease";
import { compareTechnicalStrings } from "./technical-order";

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

export function rotationBookingGroupLabel(
  rotation: FlightLineRotation,
  group: FlightLineRotation["bookingGroups"][number],
): string {
  return formatBookingGroupPartLabel(rotation.productCode, group.communicationNumber, group);
}

export function rotationGroupLabelList(rotation: FlightLineRotation): string[] {
  return rotation.bookingGroups.map((group) => rotationBookingGroupLabel(rotation, group));
}

export function rotationGroupLabels(rotation: FlightLineRotation): string {
  const labels = rotationGroupLabelList(rotation);
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
}: Readonly<{
  aircraft: FlightLineAircraft;
  rotation: FlightLineRotation | undefined;
  timeZone: string;
}>) {
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
}: Readonly<{
  aircraft: FlightLineAircraft;
  rotation: FlightLineRotation | undefined;
  timeZone: string;
  variant?: "compact" | "detailed";
}>) {
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

export function TicketGroupRecallButton({
  group,
  disabled = false,
  timeZone,
  onStart,
  onClear,
}: Readonly<{
  group: FlightLineQueueGroup;
  disabled?: boolean;
  timeZone: string;
  onStart: (ticketGroupId: string) => void | Promise<void>;
  onClear: (ticketGroupId: string, recallId: string) => void | Promise<void>;
}>) {
  const activeRecall = group.activeRecall;
  const eligibleToStart = ["QUEUED", "MISSING"].includes(group.status);
  if (!activeRecall && !eligibleToStart) return null;
  const communicationLabel = formatBookingGroupLabel(group.productCode, group.communicationNumber);
  const label = activeRecall
    ? `${communicationLabel} · Nachruf aktiv seit ${formatFlightLineTime(activeRecall.startedAt, timeZone)} · Nachruf ${activeRecall.sequence} · erneut klicken zum Beenden`
    : `${communicationLabel} nachrufen`;
  return (
    <IconButton
      aria-pressed={Boolean(activeRecall)}
      busyLabel={
        activeRecall
          ? `${communicationLabel} Nachruf wird beendet`
          : `${communicationLabel} Nachruf wird gestartet`
      }
      className={`ticket-group-recall-action${activeRecall ? " is-active" : ""}`}
      disabled={disabled}
      label={label}
      onClick={() => (activeRecall ? onClear(group.id, activeRecall.id) : onStart(group.id))}
      size="touch"
      type="button"
    >
      {activeRecall ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
    </IconButton>
  );
}

function AssignmentQueueRow({
  group,
  selected,
  selectedSeats,
  capacity,
  onToggle,
  onRecall,
  onRecallClear,
  onDefer,
  productMismatch,
  disabled,
  timeZone,
}: Readonly<{
  group: FlightLineQueueGroup;
  selected: boolean;
  selectedSeats: number;
  capacity: number;
  onToggle: (ticketGroupId: string, selected: boolean) => void;
  onRecall: (ticketGroupId: string) => void | Promise<void>;
  onRecallClear: (ticketGroupId: string, recallId: string) => void | Promise<void>;
  onDefer?: ((ticketGroupId: string) => void | Promise<void>) | undefined;
  productMismatch: boolean;
  disabled: boolean;
  timeZone: string;
}>) {
  const segmentTicketCount = queuedSegmentTicketCount(group);
  const exceedsCapacity = !selected && selectedSeats + segmentTicketCount > capacity;
  const communicationLabel = formatBookingGroupLabel(group.productCode, group.communicationNumber);
  const isPresent = group.status === "PRESENT";
  const recallAvailable = Boolean(
    group.activeRecall || ["QUEUED", "MISSING"].includes(group.status),
  );
  return (
    <div
      className={`flight-director-queue-row${selected ? " selected" : ""}${isPresent ? " is-present" : ""}${onDefer ? " has-defer" : ""}`}
    >
      <label className="flight-director-queue-group">
        <input
          checked={selected}
          disabled={disabled || group.status === "MISSING" || exceedsCapacity || productMismatch}
          onChange={(event) => onToggle(group.id, event.target.checked)}
          type="checkbox"
        />
        <span className="flight-director-queue-identity">
          <strong>{communicationLabel}</strong>
          {group.dispatchReservation === "OTHER" ? (
            <small className="flight-director-reservation-note">Anderweitig reserviert</small>
          ) : isPresent ? (
            <small className="flight-director-present-note">Anwesend</small>
          ) : null}
        </span>
      </label>
      <div className="flight-director-queue-persons">
        <span>
          {segmentTicketCount} Person{segmentTicketCount === 1 ? "" : "en"}
        </span>
        {group.segmentCount && group.segmentCount > 1 ? (
          <small>
            {segmentTicketCount} von {group.ticketCount} · Teil {group.segmentIndex ?? 1}/
            {group.segmentCount}
          </small>
        ) : null}
      </div>
      <div className="flight-director-queue-call">
        <small className="flight-director-queue-call-title">Aufruf</small>
        <span className={group.precalledAt ? "is-gate-call" : undefined}>
          {group.precalledAt ? "GO TO GATE" : "Noch nicht"}
        </span>
        <small>
          {group.precalledAt ? `${formatFlightLineTime(group.precalledAt, timeZone)} Uhr` : "—"}
        </small>
      </div>
      <div className="flight-director-queue-actions">
        {recallAvailable ? (
          <span className="flight-director-queue-action">
            <TicketGroupRecallButton
              disabled={disabled}
              group={group}
              onClear={onRecallClear}
              onStart={onRecall}
              timeZone={timeZone}
            />
            <small>Nachruf</small>
          </span>
        ) : null}
        {onDefer ? (
          <span className="flight-director-queue-action">
            <IconButton
              disabled={disabled}
              label={`${communicationLabel} zurückstellen`}
              onClick={() => onDefer(group.id)}
              size="touch"
              type="button"
            >
              <RotateCcw aria-hidden="true" />
            </IconButton>
            <small>Zurückstellen</small>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function BookingGroupAssignmentDialog({
  aircraft,
  dispatchLease,
  groups,
  selectedQueueGroupIds,
  confirmDisabled,
  open,
  onClose,
  onConfirm,
  onToggle,
  onRecall,
  onRecallClear,
  onDefer,
  onReserveRecommendation,
  timeZone,
  headerActions,
}: Readonly<{
  aircraft: FlightLineAircraft | undefined;
  dispatchLease: DispatchRecommendationLeaseController;
  groups: FlightLineQueueGroup[];
  selectedQueueGroupIds: string[];
  confirmDisabled: boolean;
  open: boolean;
  onClose: () => void;
  onConfirm: (queueDeviationReason?: string) => void | Promise<void>;
  onToggle: (ticketGroupId: string, selected: boolean) => void | Promise<void>;
  onRecall: (ticketGroupId: string) => void | Promise<void>;
  onRecallClear: (ticketGroupId: string, recallId: string) => void | Promise<void>;
  onDefer?: (ticketGroupId: string) => void | Promise<void>;
  onReserveRecommendation: () => void | Promise<void>;
  timeZone: string;
  headerActions?: ReactNode;
}>) {
  const [queueDeviationReason, setQueueDeviationReason] = useState("");
  const [leaseRemainingSeconds, setLeaseRemainingSeconds] = useState(0);
  const [queueMutationPending, setQueueMutationPending] = useState(false);
  const [recommendationReloadPending, setRecommendationReloadPending] = useState(false);
  const dispatchRecommendation = dispatchLease.lease;
  const selectedGroups = groups.filter((group) => selectedQueueGroupIds.includes(group.id));
  const selectedSeats = selectedGroups.reduce(
    (total, group) => total + queuedSegmentTicketCount(group),
    0,
  );
  const capacity = aircraft?.passengerSeats ?? 0;
  const capacityExceeded = selectedSeats > capacity;
  const selectedProductId = selectedGroups[0]?.productId ?? null;
  const mixedProductSelection = selectedGroups.some(
    (group) => group.productId !== selectedProductId,
  );
  const earliestSelectedQueueSequence =
    selectedGroups.length > 0
      ? Math.min(...selectedGroups.map((group) => group.queueSequence))
      : null;
  const skippedEarlierProductGroups =
    earliestSelectedQueueSequence === null
      ? []
      : groups.filter(
          (group) =>
            group.status !== "MISSING" &&
            group.queueSequence < earliestSelectedQueueSequence &&
            group.productId !== selectedProductId,
        );
  const overridesOtherReservation = selectedGroups.some(
    (group) => group.dispatchReservation === "OTHER",
  );
  const sortedSelectedQueueGroupIds = [...selectedQueueGroupIds].sort(compareTechnicalStrings);
  const recommendationIsCurrent = dispatchLease.mode === "RESERVED";
  const recommendationMatchesSelection = Boolean(
    recommendationIsCurrent &&
      dispatchRecommendation &&
      dispatchRecommendation.groupIds.length === selectedQueueGroupIds.length &&
      [...dispatchRecommendation.groupIds]
        .sort(compareTechnicalStrings)
        .every((groupId, index) => groupId === sortedSelectedQueueGroupIds[index]),
  );
  const queueDeviationReasonRequired =
    overridesOtherReservation ||
    (skippedEarlierProductGroups.length > 0 && !recommendationMatchesSelection);
  const recommendationContainsGateCall = Boolean(
    dispatchRecommendation?.groupIds.some(
      (groupId) => groups.find((group) => group.id === groupId)?.precalledAt,
    ),
  );
  const protectsMaximumWait =
    dispatchRecommendation?.decisionReasons.includes("MUST_SERVE_MAX_WAIT") ?? false;
  const protectsConfirmedOvertakes =
    dispatchRecommendation?.decisionReasons.includes("MUST_SERVE_MAX_OVERTAKES") ?? false;
  const recommendationReason =
    dispatchRecommendation?.decisionReasons.includes("HARD_COMMITMENT") ||
    recommendationContainsGateCall
      ? "Bereits aufgerufene Gruppen haben Vorrang."
      : protectsMaximumWait && protectsConfirmedOvertakes
        ? "Maximale Wartezeit und Überholschutz haben Vorrang."
        : protectsMaximumWait
          ? "Lange Wartezeit hat Vorrang."
          : protectsConfirmedOvertakes
            ? "Diese Gruppe darf nicht weiter überholt werden."
            : dispatchRecommendation?.decisionReasons.includes("PRODUCT_FAIRNESS")
              ? "Faire Verteilung zwischen den Produkten hat Vorrang."
              : dispatchRecommendation?.decisionReasons.includes("CAPACITY_OPTIMIZED")
                ? "Faire Queue-Reihenfolge mit bestmöglicher Sitzplatzauslastung."
                : "Queue-Reihenfolge und verfügbare Kapazität bestimmen diese Belegung.";
  useEffect(() => {
    if (!open || !queueDeviationReasonRequired) setQueueDeviationReason("");
  }, [open, queueDeviationReasonRequired]);
  useEffect(() => {
    if (
      !open ||
      !recommendationIsCurrent ||
      dispatchLease.mode !== "RESERVED" ||
      !dispatchLease.lease
    ) {
      setLeaseRemainingSeconds(0);
      return;
    }
    const updateRemainingTime = () => {
      const remaining = dispatchLeaseRemainingSeconds(
        dispatchLease.lease?.expiresAt ?? "",
        dispatchLease.serverClockOffsetMs,
        Date.now(),
      );
      setLeaseRemainingSeconds(remaining);
      if (remaining === 0) dispatchLease.markExpired();
    };
    updateRemainingTime();
    const interval = window.setInterval(updateRemainingTime, 250);
    return () => window.clearInterval(interval);
  }, [
    dispatchLease.lease,
    dispatchLease.markExpired,
    dispatchLease.mode,
    dispatchLease.serverClockOffsetMs,
    open,
    recommendationIsCurrent,
  ]);
  const reservationBlocksConfirmation = dispatchLease.mode !== "MANUAL" && !recommendationIsCurrent;
  const leaseBusy = dispatchLease.mode === "ACQUIRING" || dispatchLease.mode === "REFRESHING";
  const recommendationReloadBusy = recommendationReloadPending || leaseBusy;
  const queueInteractionPending = queueMutationPending || recommendationReloadBusy;

  async function runQueueMutation(action: () => void | Promise<void>) {
    if (queueInteractionPending) return;
    setQueueMutationPending(true);
    try {
      await action();
    } finally {
      setQueueMutationPending(false);
    }
  }

  async function reloadRecommendation() {
    if (queueInteractionPending) return;
    setRecommendationReloadPending(true);
    try {
      await onReserveRecommendation();
    } finally {
      setRecommendationReloadPending(false);
    }
  }
  return (
    <ModalDialog
      description={
        aircraft
          ? `${aircraft.registration} · ${aircraft.passengerSeats} Plätze · Gruppen bleiben vollständig zusammen.`
          : undefined
      }
      footer={
        <div className="flight-director-assignment-footer-content">
          <div className="flight-director-assignment-summary" aria-live="polite">
            <span>Auswahl</span>
            <strong>
              {selectedSeats} von {capacity} Plätzen ausgewählt
            </strong>
            <small>
              {selectedGroups.length > 0
                ? selectedGroups
                    .map((group) =>
                      formatBookingGroupLabel(group.productCode, group.communicationNumber),
                    )
                    .join(", ")
                : "Noch keine Gruppe gewählt"}
            </small>
          </div>
          <div className="flight-director-assignment-guidance">
            {queueDeviationReasonRequired ? (
              <label className="flight-director-deviation-reason">
                <span>Grund für manuelle Abweichung</span>
                <input
                  maxLength={240}
                  onChange={(event) => setQueueDeviationReason(event.target.value)}
                  placeholder="Mindestens 3 Zeichen"
                  value={queueDeviationReason}
                />
              </label>
            ) : capacityExceeded ? (
              <small className="is-warning">Die Auswahl überschreitet die Kapazität.</small>
            ) : !aircraft?.currentPilotId ? (
              <small className="is-warning">Vor dem Boarding einen Piloten zuweisen.</small>
            ) : recommendationMatchesSelection ? (
              <small>Aktuelle Empfehlung ausgewählt.</small>
            ) : (
              <small>Eine manuelle Belegung ist mit Abweichungsgrund jederzeit möglich.</small>
            )}
          </div>
          <div className="flight-director-assignment-footer-actions">
            <Button
              className="flight-director-assignment-cancel"
              onClick={onClose}
              type="button"
              variant="secondary"
            >
              Abbrechen
            </Button>
            <Button
              disabled={
                confirmDisabled ||
                queueInteractionPending ||
                reservationBlocksConfirmation ||
                selectedSeats === 0 ||
                capacityExceeded ||
                mixedProductSelection ||
                (queueDeviationReasonRequired && queueDeviationReason.trim().length < 3)
              }
              onClick={() => onConfirm(queueDeviationReason.trim() || undefined)}
              type="button"
              variant="primary"
            >
              <CheckCircle2 aria-hidden="true" /> Belegung bestätigen & Boarding starten
            </Button>
          </div>
        </div>
      }
      footerClassName="flight-director-assignment-modal-footer"
      headerActions={headerActions}
      bodyClassName="flight-director-assignment-modal-body"
      className="flight-director-assignment-modal"
      onClose={onClose}
      open={open}
      size="wide"
      title="Buchungsgruppen zuweisen"
    >
      <div className="flight-director-assignment-dialog">
        <section className="flight-director-queue">
          <div className="flight-director-dispatch-slot">
            <div className="flight-director-dispatch-content">
              {["EXPIRED", "INVALIDATED", "ERROR"].includes(dispatchLease.mode) ? (
                <div className="flight-director-dispatch-reservation is-expired" role="alert">
                  <span>
                    {dispatchLease.mode === "EXPIRED"
                      ? "Die Vorschlagsreservierung ist abgelaufen."
                      : dispatchLease.error}
                  </span>
                </div>
              ) : dispatchLease.mode === "MANUAL" ? (
                <div className="flight-director-dispatch-reservation is-manual" role="status">
                  Manuelle Belegung – nicht reserviert
                </div>
              ) : dispatchRecommendation ? (
                <div
                  className={`flight-director-dispatch-recommendation${dispatchLease.mode === "REFRESHING" ? " is-refreshing" : ""}`}
                >
                  <div className="flight-director-dispatch-summary">
                    <span>Empfehlung · Umlauf {dispatchRecommendation.dispatchOrder}</span>
                  </div>
                  <div className="flight-director-dispatch-countdown">
                    <Clock3 aria-hidden="true" />
                    {recommendationIsCurrent ? (
                      <strong>
                        <span className={leaseRemainingSeconds <= 30 ? "is-expiring" : undefined}>
                          Reserviert {formatDispatchLeaseCountdown(leaseRemainingSeconds)}
                        </span>
                      </strong>
                    ) : (
                      <strong aria-live="polite">Vorschlag wird geladen …</strong>
                    )}
                  </div>
                  <div className="flight-director-dispatch-occupancy">
                    <strong>
                      {dispatchRecommendation.occupiedSeats} von{" "}
                      {dispatchRecommendation.occupiedSeats + dispatchRecommendation.availableSeats}{" "}
                      Plätzen
                    </strong>
                  </div>
                  <div className="flight-director-dispatch-reason">
                    <span>{recommendationReason}</span>
                    {skippedEarlierProductGroups.length > 0 ? (
                      <small>
                        {skippedEarlierProductGroups.length} frühere Gruppe
                        {skippedEarlierProductGroups.length === 1 ? " wird" : "n werden"} fair
                        eingeordnet.
                      </small>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flight-director-dispatch-reservation is-loading" role="status">
                  <Clock3 aria-hidden="true" />
                  <span>Vorschlag wird geladen …</span>
                </div>
              )}
            </div>
            <div className="flight-director-dispatch-action">
              <IconButton
                busy={recommendationReloadBusy}
                busyLabel="Vorschlag wird geladen"
                disabled={queueInteractionPending}
                label="Aktuellsten Vorschlag laden"
                onClick={reloadRecommendation}
                size="touch"
                type="button"
              >
                <RotateCcw aria-hidden="true" />
              </IconButton>
            </div>
          </div>
          <div className="flight-director-queue-head" aria-hidden="true">
            <span>Gruppe</span>
            <span>Personen</span>
            <span>Aufruf</span>
            <span>Aktionen</span>
          </div>
          <div className="flight-director-queue-scroll" aria-busy={queueInteractionPending}>
            {groups.length > 0 ? (
              groups.map((group) => (
                <AssignmentQueueRow
                  capacity={capacity}
                  disabled={queueInteractionPending}
                  group={group}
                  key={group.id}
                  onDefer={
                    onDefer
                      ? (ticketGroupId) => runQueueMutation(() => onDefer(ticketGroupId))
                      : undefined
                  }
                  onRecall={(ticketGroupId) => runQueueMutation(() => onRecall(ticketGroupId))}
                  onRecallClear={(ticketGroupId, recallId) =>
                    runQueueMutation(() => onRecallClear(ticketGroupId, recallId))
                  }
                  onToggle={(ticketGroupId, selected) =>
                    runQueueMutation(async () => {
                      if (
                        [
                          "IDLE",
                          "RESERVED",
                          "ACQUIRING",
                          "REFRESHING",
                          "EXPIRED",
                          "ERROR",
                        ].includes(dispatchLease.mode)
                      ) {
                        await dispatchLease.switchToManual();
                      }
                      await onToggle(ticketGroupId, selected);
                    })
                  }
                  productMismatch={
                    !selectedQueueGroupIds.includes(group.id) &&
                    selectedProductId !== null &&
                    group.productId !== selectedProductId
                  }
                  selected={selectedQueueGroupIds.includes(group.id)}
                  selectedSeats={selectedSeats}
                  timeZone={timeZone}
                />
              ))
            ) : (
              <p>Keine passende Buchungsgruppe in der Warteschlange.</p>
            )}
          </div>
        </section>
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
}: Readonly<{
  aircraft: FlightLineAircraft | undefined;
  rotation: FlightLineRotation | undefined;
  timeZone: string;
}>) {
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
}: Readonly<{
  history: FlightLineRotation[];
  timeZone: string;
}>) {
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

function HistoryCellIcon({ Icon, label }: Readonly<{ Icon: LucideIcon; label: string }>) {
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
}: Readonly<{
  aircraft: FlightLineAircraft | undefined;
  board: OperationBoard;
  currentRotation: FlightLineRotation | undefined;
  onAssignPilot: (aircraftId: string, pilotId: string, reassign: boolean) => Promise<void>;
  onClose: () => void;
  open: boolean;
}>) {
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
