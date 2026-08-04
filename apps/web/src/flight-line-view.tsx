import type {
  CommandEnvelope,
  CommandResult,
  ForecastHistory,
  OperationBoard,
} from "@rundflug/contracts";
import { formatBookingGroupLabel } from "@rundflug/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiCommandError,
  claimFlightLineAircraft,
  getForecastHistory,
  getResourceDayHistory,
  releaseFlightLineAircraft,
  sendCommand,
} from "./api";
import { AppShell as Shell } from "./app/AppShell";
import { useActionMessageBridge } from "./app/PageNotifications";
import { Button, ModalDialog } from "./design-system/components";
import { useDispatchRecommendationLease } from "./dispatch-recommendation-lease";
import { FlightDirectorOperationsDialog } from "./features/flight-line/FlightDirectorOperationsDialog";
import { FlightLineAssist } from "./flight-line-assist";
import { expectedReviewAtFromPause } from "./flight-line-pause";
import { TicketGroupRecallButton } from "./flight-line-shared";
import { FlightLineSupervisorConsole } from "./flight-line-supervisor";
import {
  aircraftStateLabel,
  ConnectionNotice,
  deviceTokenFor,
  EmergencyNotice,
  EVENT_ID,
  FLIGHT_LINE_ASSIST_MODE,
  FLIGHT_LINE_DEVICE_ID,
  InterruptionNotice,
  OperationalNotice,
  operationalTimeLabel,
  predictionQualityLabel,
  rotationStatusLabel,
  useOperationBoard,
} from "./operation-workspace";
import {
  checkedInCount,
  eligibleMoveTargets,
  replacementSuggestion,
  sharedGroupSegmentLabel,
} from "./operational-exceptions";

const actionForState = {
  DRAFT: { label: "Belegung bestätigen & Boarding starten", command: "CALL_NEXT" },
  CALLED: { label: "Offblock", command: "MARK_OFF_BLOCK" },
  IN_FLIGHT: { label: "Onblock", command: "MARK_ON_BLOCK" },
  LANDED: { label: "Umlauf abschließen", command: "COMPLETE_TURNAROUND" },
  COMPLETED: null,
} as const;

type Rotation = OperationBoard["rotations"][number];
type Aircraft = OperationBoard["aircraft"][number];
type QueueGroup = OperationBoard["queueGroups"][number];
type TurnaroundNextState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";
type UpsertPlannedOperationPayload = Extract<
  CommandEnvelope,
  { type: "UPSERT_PLANNED_OPERATION" }
>["payload"];
type PlannedOperation = OperationBoard["plannedOperations"][number];
type RecurringOperationalRule = OperationBoard["recurringOperationalRules"][number];
type UpsertRecurringOperationalRulePayload = Extract<
  CommandEnvelope,
  { type: "UPSERT_RECURRING_OPERATIONAL_RULE" }
>["payload"];
const FLIGHT_DIRECTOR_AUDIT_REASON = "Operative Entscheidung Flight Director";

function queuedSegmentTicketCount(group: QueueGroup): number {
  return group.nextSegmentTicketCount ?? group.ticketCount;
}

function queuedSegmentPresentCount(group: QueueGroup): number {
  return group.nextSegmentPresentCount ?? group.presentCount;
}

export function FlightLineView() {
  const { board, error, lastConfirmedAt, backendConfirmed, confirmEvent, refresh } =
    useOperationBoard(FLIGHT_LINE_DEVICE_ID);
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);
  const [queueReason, setQueueReason] = useState("");
  const [callDeviationReason, setCallDeviationReason] = useState("");
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [operationsBusy, setOperationsBusy] = useState(false);
  const [filteredResourceGroupId, setFilteredResourceGroupId] = useState("");
  const [nextAircraftId, setNextAircraftId] = useState("");
  const [turnaroundNextState, setTurnaroundNextState] = useState<TurnaroundNextState>("AVAILABLE");
  const [busyRotationIds, setBusyRotationIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyRotationIdsRef = useRef(new Set<string>());
  const [selectedQueueGroupIds, setSelectedQueueGroupIds] = useState<string[]>([]);
  const replaceSelectedQueueGroups = useCallback((ticketGroupIds: string[]) => {
    setSelectedQueueGroupIds([...ticketGroupIds]);
  }, []);
  const dispatchLease = useDispatchRecommendationLease({
    eventId: EVENT_ID,
    deviceId: FLIGHT_LINE_DEVICE_ID,
    deviceToken: deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
    expectedVersion: board?.event.version ?? 0,
    onReserved: replaceSelectedQueueGroups,
  });
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dispositionCapacity, setDispositionCapacity] = useState(1);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [aircraftPauseOpen, setAircraftPauseOpen] = useState(false);
  const [technicalAbort, setTechnicalAbort] = useState<{
    rotationId: string;
    rotationVersion: number;
    aircraftId: string;
    aircraftVersion: number;
  } | null>(null);
  const [technicalAbortReason, setTechnicalAbortReason] = useState("");
  const operationalRotations = board?.rotations.filter(
    (rotation) => rotation.status !== "COMPLETED",
  );
  const operationalAircraft = board?.aircraft ?? [];
  const canManageAircraft = ["FLIGHT_DIRECTOR", "ADMIN"].includes(board?.currentDeviceRole ?? "");
  const selectedOperationalResourceGroup = board?.resourceGroups.find(
    (group) => group.id === filteredResourceGroupId,
  );
  const operationalSummary = board?.event.emergencyMode
    ? "Not-Halt aktiv"
    : board?.event.operationalInterrupted
      ? "Betrieb unterbrochen"
      : board?.event.operationalNote
        ? board.event.operationalNote
        : selectedOperationalResourceGroup?.operationalNote
          ? selectedOperationalResourceGroup.operationalNote
          : "Betrieb normal";
  const operationalSummaryTone = board?.event.emergencyMode
    ? "critical"
    : board?.event.operationalInterrupted
      ? "warning"
      : board?.event.operationalNote || selectedOperationalResourceGroup?.operationalNote
        ? "notice"
        : "normal";
  const claimedAssistAircraftId = board?.assistClaims?.find(
    (claim) => claim.claimedByCurrentOperator,
  )?.aircraftId;
  const selectedAircraft =
    operationalAircraft.find(
      (aircraft) => aircraft.id === (selectedAircraftId ?? claimedAssistAircraftId),
    ) ?? (FLIGHT_LINE_ASSIST_MODE ? undefined : operationalAircraft[0]);
  const aircraftRotations = operationalRotations?.filter((rotation) => {
    if (!selectedAircraft) return false;
    if (rotation.aircraftId) return rotation.aircraftId === selectedAircraft.id;
    const rotationProduct = board?.products.find(
      (productEntry) => productEntry.code === rotation.productCode,
    );
    return (
      rotation.status === "DRAFT" &&
      selectedAircraft.operationalState === "AVAILABLE" &&
      rotationProduct?.resourceGroupId === selectedAircraft.resourceGroupId &&
      rotation.ticketCount <= selectedAircraft.passengerSeats
    );
  });
  const selected =
    aircraftRotations?.find((rotation) => rotation.id === selectedId) ?? aircraftRotations?.[0];
  const action = selected ? actionForState[selected.status] : null;
  const moveTargets = selected ? eligibleMoveTargets(selected, operationalRotations ?? []) : [];
  const presentCount = selected ? checkedInCount(selected) : 0;
  const missingTickets =
    selected?.tickets.filter((ticket) => ticket.attendanceStatus !== "CHECKED_IN") ?? [];
  const replacement = selected ? replacementSuggestion(selected, operationalRotations ?? []) : null;
  const compatibleQueueGroups =
    board?.queueGroups.filter(
      (group) =>
        group.resourceGroupId === selectedAircraft?.resourceGroupId &&
        ["QUEUED", "PRESENT", "MISSING"].includes(group.status),
    ) ?? [];
  const selectedQueueGroups = compatibleQueueGroups.filter((group) =>
    selectedQueueGroupIds.includes(group.id),
  );
  const selectedQueueProductId = selectedQueueGroups[0]?.productId ?? null;
  const earliestSelectedQueueSequence =
    selectedQueueGroups.length > 0
      ? Math.min(...selectedQueueGroups.map((group) => group.queueSequence))
      : null;
  const skippedEarlierProductGroups =
    earliestSelectedQueueSequence === null
      ? []
      : compatibleQueueGroups.filter(
          (group) =>
            group.queueSequence < earliestSelectedQueueSequence &&
            group.productId !== selectedQueueProductId &&
            group.status !== "MISSING",
        );
  const queueDeviationReasonRequired = skippedEarlierProductGroups.length > 0;
  const selectedQueueSeatCount = compatibleQueueGroups
    .filter((group) => selectedQueueGroupIds.includes(group.id))
    .reduce((sum, group) => sum + queuedSegmentTicketCount(group), 0);
  useEffect(() => {
    if (FLIGHT_LINE_ASSIST_MODE) {
      if (claimedAssistAircraftId && selectedAircraftId !== claimedAssistAircraftId) {
        setSelectedAircraftId(claimedAssistAircraftId);
      }
      return;
    }
    if (!selectedAircraftId && operationalAircraft[0]) {
      setSelectedAircraftId(operationalAircraft[0].id);
    }
  }, [claimedAssistAircraftId, operationalAircraft, selectedAircraftId]);
  useEffect(() => {
    if (selected?.status !== "DRAFT") return;
    setNextAircraftId(selectedAircraft?.id ?? selected.suggestedAircraftId ?? "");
  }, [selected?.status, selected?.suggestedAircraftId, selectedAircraft?.id]);
  useEffect(() => {
    setDispositionCapacity(selected?.usableCapacity ?? 1);
    setMoveTargetId("");
    setMoveReason("");
  }, [selected?.usableCapacity]);
  const noShowReady = Boolean(
    selected?.status === "CALLED" &&
      selected.calledAt &&
      board &&
      Date.now() - Date.parse(selected.calledAt) >= board.event.noShowAfterMinutes * 60_000,
  );

  async function advance(
    rotationOverride: Rotation | undefined = selected,
    aircraftOverride: Aircraft | undefined = selectedAircraft,
    nextAircraftState: TurnaroundNextState = turnaroundNextState,
    queueDeviationReasonOverride?: string,
  ): Promise<boolean> {
    const selectedRotation = rotationOverride;
    const selectedAction = selectedRotation ? actionForState[selectedRotation.status] : null;
    if (!board || !selectedRotation || !selectedAction) return false;
    if (busyRotationIdsRef.current.has(selectedRotation.id)) return false;
    busyRotationIdsRef.current.add(selectedRotation.id);
    setBusyRotationIds(new Set(busyRotationIdsRef.current));
    try {
      const commandBase = {
        commandId: crypto.randomUUID(),
        eventId: EVENT_ID,
        deviceId: FLIGHT_LINE_DEVICE_ID,
        expectedVersion: board.event.version,
        observedEventVersion: board.event.version,
        issuedAt: new Date().toISOString(),
      };
      let result: CommandResult;
      if (selectedAction.command === "CALL_NEXT") {
        const assignedPilotId = aircraftOverride?.currentPilotId;
        if (!aircraftOverride?.id || !assignedPilotId) {
          throw new Error(
            "Vor Belegung bitte über „Pilot zuweisen“ einen Pilotencode am Flugzeug hinterlegen.",
          );
        }
        const ticketGroupIds =
          selectedQueueGroupIds.length > 0
            ? selectedQueueGroupIds
            : selectedRotation.bookingGroups.length > 0
              ? selectedRotation.bookingGroups.map((group) => group.id)
              : [selectedRotation.ticketGroupId];
        const reservedRecommendationSelected = Boolean(
          dispatchLease.mode === "RESERVED" &&
            dispatchLease.reservedEventVersion === board.event.version &&
            dispatchLease.lease?.groupIds.length === ticketGroupIds.length &&
            [...(dispatchLease.lease?.groupIds ?? [])]
              .sort()
              .every((groupId, index) => groupId === [...ticketGroupIds].sort()[index]),
        );
        result = await sendCommand(
          {
            ...commandBase,
            type: "CALL_NEXT",
            payload: {
              ticketGroupIds,
              aircraftId: aircraftOverride.id,
              pilotId: assignedPilotId,
              dispatchRecommendation:
                reservedRecommendationSelected && dispatchLease.lease
                  ? {
                      planRevision: dispatchLease.lease.planRevision,
                      batchId: dispatchLease.lease.batchId,
                    }
                  : undefined,
              dispatchRecommendationLeaseId:
                reservedRecommendationSelected && dispatchLease.lease
                  ? dispatchLease.lease.leaseId
                  : undefined,
              queueDeviationReason:
                (queueDeviationReasonOverride ?? callDeviationReason.trim()) || undefined,
            },
          },
          deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
        );
      } else {
        result = await sendCommand(
          selectedAction.command === "COMPLETE_TURNAROUND"
            ? {
                ...commandBase,
                preconditions: [
                  {
                    aggregateType: "ROTATION" as const,
                    aggregateId: selectedRotation.id,
                    expectedVersion: selectedRotation.version,
                  },
                ],
                type: "COMPLETE_TURNAROUND",
                payload: {
                  rotationId: selectedRotation.id,
                  nextAircraftState,
                },
              }
            : {
                ...commandBase,
                preconditions: [
                  {
                    aggregateType: "ROTATION" as const,
                    aggregateId: selectedRotation.id,
                    expectedVersion: selectedRotation.version,
                  },
                ],
                type: selectedAction.command,
                payload: { rotationId: selectedRotation.id },
              },
          deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
        );
      }
      confirmEvent(result.event);
      if (selectedAction.command === "CALL_NEXT") dispatchLease.consume();
      await refresh(result.event.version);
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Aktion fehlgeschlagen.");
      if (
        reason instanceof ApiCommandError &&
        [
          "STALE_VERSION",
          "DISPATCH_PLAN_STALE",
          "DISPATCH_RECOMMENDATION_LEASE_EXPIRED",
          "DISPATCH_RECOMMENDATION_LEASE_CONFLICT",
          "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
        ].includes(reason.code) &&
        aircraftOverride?.id
      ) {
        await dispatchLease.release();
        await refresh(reason.currentVersion ?? 0, true);
        await dispatchLease.reserve(
          aircraftOverride.id,
          reason.currentVersion ?? board.event.version,
        );
        setMessage(
          "Der Belegungsplan wurde aktualisiert. Bitte den neuen Vorschlag erneut bestätigen.",
        );
      }
      return false;
    } finally {
      busyRotationIdsRef.current.delete(selectedRotation.id);
      setBusyRotationIds(new Set(busyRotationIdsRef.current));
    }
  }

  async function setGroupAttendance(ticketGroupId: string, checkedIn: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_TICKET_GROUP_ATTENDANCE",
          payload: { ticketGroupId, checkedIn },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Anwesenheit konnte nicht geändert werden.",
      );
    }
  }

  async function updateGroupPresence(ticketGroupId: string, action: "MISSING" | "RESTORE") {
    if (!board) return;
    const reason =
      action === "MISSING" ? (window.prompt("Kurzer Grund für „Nicht da“:")?.trim() ?? "") : "";
    if (action === "MISSING" && reason.length < 3) return;
    try {
      await sendCommand(
        action === "MISSING"
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: FLIGHT_LINE_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "MARK_TICKET_GROUP_MISSING",
              payload: { ticketGroupId, reason },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: FLIGHT_LINE_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "RESTORE_TICKET_GROUP_TO_QUEUE",
              payload: { ticketGroupId },
            },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Gruppenstatus konnte nicht geändert werden.",
      );
    }
  }

  async function startTicketGroupRecall(ticketGroupId: string) {
    if (!board) return;
    const group = board.queueGroups.find((entry) => entry.id === ticketGroupId);
    if (!group || group.activeRecall || !["QUEUED", "MISSING"].includes(group.status)) return;
    try {
      const result = await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "START_TICKET_GROUP_RECALL",
          payload: { ticketGroupId },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      confirmEvent(result.event);
      await refresh(result.event.version);
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Nachruf konnte nicht gestartet werden.",
      );
    }
  }

  async function clearTicketGroupRecall(ticketGroupId: string, recallId: string) {
    if (!board || !recallId) return;
    const group = board.queueGroups.find((entry) => entry.id === ticketGroupId);
    if (group?.activeRecall?.id !== recallId) return;
    try {
      const result = await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CLEAR_TICKET_GROUP_RECALL",
          payload: { ticketGroupId, recallId },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      confirmEvent(result.event);
      await refresh(result.event.version);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Nachruf konnte nicht beendet werden.");
    }
  }

  async function setFlightLineAircraftState(
    state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INTERRUPTED" | "INACTIVE",
    expectedReviewAt: string | null = null,
    aircraftOverride: Aircraft | undefined = selectedAircraft,
  ) {
    if (!board || !aircraftOverride) return;
    const reasonByState = {
      AVAILABLE: "Flugzeug durch Flight Line wieder verfügbar gemeldet",
      REFUELING: "Tanken durch Flight Line begonnen",
      PAUSED: "Flugzeugpause durch Flight Line begonnen",
      INTERRUPTED: "Flugzeugbetrieb durch Flight Line unterbrochen",
      INACTIVE: "Flugzeug durch Flight Line vorübergehend inaktiv gemeldet",
    } as const;
    try {
      const result = await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          observedEventVersion: board.event.version,
          preconditions: [
            {
              aggregateType: "AIRCRAFT",
              aggregateId: aircraftOverride.id,
              expectedVersion: aircraftOverride.version,
            },
          ],
          issuedAt: new Date().toISOString(),
          type: "SET_AIRCRAFT_OPERATIONAL_STATE",
          payload: {
            aircraftId: aircraftOverride.id,
            state,
            reason: reasonByState[state],
            expectedReviewAt,
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setAircraftPauseOpen(false);
      confirmEvent(result.event);
      await refresh(result.event.version);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugstatus konnte nicht geändert werden.",
      );
    }
  }

  function startAircraftPause(minutes: 10 | 20 | 30 | null) {
    if (!selectedAircraft) return;
    const expectedReviewAt = expectedReviewAtFromPause(minutes);
    return setFlightLineAircraftState("PAUSED", expectedReviewAt);
  }

  function openAircraftPauseDialog(aircraftId?: string) {
    if (aircraftId) setSelectedAircraftId(aircraftId);
    setAircraftPauseOpen(true);
  }

  async function requestAircraftState(
    aircraftId: string,
    state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE",
  ) {
    const aircraftEntry = operationalAircraft.find((entry) => entry.id === aircraftId);
    const rotation = operationalRotations?.find(
      (entry) => entry.aircraftId === aircraftId && ["CALLED", "IN_FLIGHT"].includes(entry.status),
    );
    if (state === "INACTIVE" && rotation && aircraftEntry) {
      setSelectedAircraftId(aircraftId);
      setTechnicalAbort({
        aircraftId,
        aircraftVersion: aircraftEntry.version,
        rotationId: rotation.id,
        rotationVersion: rotation.version,
      });
      setTechnicalAbortReason("");
      return;
    }
    await setFlightLineAircraftState(state, null, aircraftEntry);
  }

  async function assignAircraftPilot(aircraftId: string, pilotId: string, reassign: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "ASSIGN_AIRCRAFT_PILOT",
          payload: { aircraftId, pilotId, reassign },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Pilotzuweisung fehlgeschlagen.";
      setMessage(message);
      throw reason;
    }
  }

  async function triggerEmergency() {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "TRIGGER_EMERGENCY",
          payload: { reason: FLIGHT_DIRECTOR_AUDIT_REASON },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Notfallmodus ausgelöst.");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Notfallkommando fehlgeschlagen.");
    }
  }

  function openOperationsDialog() {
    if (!board || !canManageAircraft) return;
    setOperationsOpen(true);
  }

  async function setEventNotice(note: string): Promise<boolean> {
    if (!board) return false;
    setOperationsBusy(true);
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_OPERATIONAL_NOTE",
          payload: { note: note.trim() },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(
        note.trim()
          ? "Veranstaltungsweiter Betriebshinweis veröffentlicht."
          : "Veranstaltungsweiter Betriebshinweis gelöscht.",
      );
      await refresh();
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Betriebshinweis fehlgeschlagen.");
      return false;
    } finally {
      setOperationsBusy(false);
    }
  }

  async function setResourceNoticeCommand(resourceGroupId: string, note: string): Promise<boolean> {
    if (!board || !resourceGroupId) return false;
    setOperationsBusy(true);
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_RESOURCE_GROUP_NOTICE",
          payload: {
            resourceGroupId,
            note: note.trim(),
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(
        note.trim()
          ? "Hinweis der Ressourcengruppe veröffentlicht."
          : "Hinweis der Ressourcengruppe gelöscht.",
      );
      await refresh();
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Gruppenhinweis fehlgeschlagen.");
      return false;
    } finally {
      setOperationsBusy(false);
    }
  }

  async function setEventInterruption(
    interrupted: boolean,
    plannedOperationId?: string,
    expectedReviewAt: string | null = null,
  ) {
    if (!board) return;
    setOperationsBusy(true);
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_EVENT_INTERRUPTION",
          payload: {
            interrupted,
            reason: FLIGHT_DIRECTOR_AUDIT_REASON,
            expectedReviewAt,
            ...(plannedOperationId ? { plannedOperationId } : {}),
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(interrupted ? "Betrieb unterbrochen." : "Betrieb fortgesetzt.");
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Betriebsstatus konnte nicht geändert werden.",
      );
    } finally {
      setOperationsBusy(false);
    }
  }

  async function setResourceGroupStatus(
    resourceGroupId: string,
    status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED",
    plannedOperationId?: string,
    expectedReviewAt: string | null = null,
  ) {
    if (!board) return;
    setOperationsBusy(true);
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_RESOURCE_GROUP_STATUS",
          payload: {
            resourceGroupId,
            status,
            reason: FLIGHT_DIRECTOR_AUDIT_REASON,
            expectedReviewAt,
            ...(plannedOperationId ? { plannedOperationId } : {}),
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(`Ressourcengruppe auf ${status} gesetzt.`);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Statusänderung fehlgeschlagen.");
    } finally {
      setOperationsBusy(false);
    }
  }

  async function upsertPlannedOperation(payload: UpsertPlannedOperationPayload) {
    if (!board) return;
    setOperationsBusy(true);
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_PLANNED_OPERATION",
          payload,
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Planeintrag gespeichert; der operative Zustand bleibt unverändert.");
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Planeintrag konnte nicht gespeichert werden.",
      );
      throw reason;
    } finally {
      setOperationsBusy(false);
    }
  }

  async function cancelPlannedOperation(plan: PlannedOperation) {
    if (!board) return;
    setOperationsBusy(true);
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CANCEL_PLANNED_OPERATION",
          payload: {
            planId: plan.id,
            planExpectedVersion: plan.version,
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Planeintrag abgesagt; laufende Zustände wurden nicht verändert.");
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Planeintrag konnte nicht abgesagt werden.",
      );
      throw reason;
    } finally {
      setOperationsBusy(false);
    }
  }

  async function upsertRecurringRule(payload: UpsertRecurringOperationalRulePayload) {
    if (!board) return;
    setOperationsBusy(true);
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_RECURRING_OPERATIONAL_RULE",
          payload,
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Wiederkehrende Regel gespeichert.");
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Regel konnte nicht gespeichert werden.",
      );
      throw reason;
    } finally {
      setOperationsBusy(false);
    }
  }

  async function disableRecurringRule(rule: RecurringOperationalRule) {
    if (!board) return;
    setOperationsBusy(true);
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "DISABLE_RECURRING_OPERATIONAL_RULE",
          payload: {
            ruleId: rule.id,
            ruleExpectedVersion: rule.version,
            reason: "Wiederkehrende Tagesregel deaktiviert.",
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Wiederkehrende Regel deaktiviert; offene Planeinträge bleiben bestehen.");
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Regel konnte nicht deaktiviert werden.",
      );
      throw reason;
    } finally {
      setOperationsBusy(false);
    }
  }

  async function confirmPlannedOperation(plan: PlannedOperation, activate: boolean) {
    if (!board) return;
    if (plan.effectMode === "SLOWDOWN") {
      setOperationsBusy(true);
      try {
        await sendCommand(
          {
            commandId: crypto.randomUUID(),
            eventId: EVENT_ID,
            deviceId: FLIGHT_LINE_DEVICE_ID,
            expectedVersion: board.event.version,
            issuedAt: new Date().toISOString(),
            type: "SET_PLANNED_SLOWDOWN_ACTIVE",
            payload: {
              planId: plan.id,
              planExpectedVersion: plan.version,
              active: activate,
            },
          },
          deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
        );
        setMessage(
          activate
            ? `Verzögerter Betrieb mit ${plan.durationMultiplierPercent ?? 150} % gestartet.`
            : "Verzögerter Betrieb beendet.",
        );
        await refresh();
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : "Planbestätigung fehlgeschlagen.");
        throw reason;
      } finally {
        setOperationsBusy(false);
      }
      return;
    }
    const expectedReviewAt = activate
      ? new Date(Date.now() + plan.typicalDurationMinutes * 60_000).toISOString()
      : null;
    if (plan.scopeType === "EVENT") {
      await setEventInterruption(activate, plan.id, expectedReviewAt);
      return;
    }
    if (plan.scopeType === "RESOURCE_GROUP") {
      await setResourceGroupStatus(
        plan.scopeId,
        activate ? (plan.kind === "PAUSE" ? "PAUSED" : "INTERRUPTED") : "ACTIVE",
        plan.id,
        expectedReviewAt,
      );
      return;
    }
    setOperationsBusy(true);
    try {
      await sendCommand(
        plan.scopeType === "AIRCRAFT"
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: FLIGHT_LINE_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "SET_AIRCRAFT_OPERATIONAL_STATE",
              payload: {
                aircraftId: plan.scopeId,
                state: activate
                  ? plan.kind === "REFUELING"
                    ? "REFUELING"
                    : plan.kind === "PAUSE"
                      ? "PAUSED"
                      : "INTERRUPTED"
                  : "AVAILABLE",
                reason: FLIGHT_DIRECTOR_AUDIT_REASON,
                expectedReviewAt,
                plannedOperationId: plan.id,
              },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: FLIGHT_LINE_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "SET_PILOT_PAUSE",
              payload: {
                pilotId: plan.scopeId,
                paused: activate,
                reason: FLIGHT_DIRECTOR_AUDIT_REASON,
                expectedReviewAt,
                plannedOperationId: plan.id,
              },
            },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(
        activate
          ? "Geplante Einschränkung als gestartet bestätigt."
          : "Geplante Einschränkung als beendet bestätigt.",
      );
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Planbestätigung fehlgeschlagen.");
      throw reason;
    } finally {
      setOperationsBusy(false);
    }
  }

  async function mutateQueue(
    type: "DEFER_TICKET_GROUP" | "MARK_NO_SHOW",
    reasonOverride?: string,
    targetRotation = selected,
    targetTicketGroupId?: string,
  ) {
    const effectiveReason = reasonOverride ?? queueReason.trim();
    if (!board || !targetRotation || effectiveReason.length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type,
          payload: {
            ticketGroupId: targetTicketGroupId ?? targetRotation.ticketGroupId,
            reason: effectiveReason,
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setQueueReason("");
      setSelectedId(null);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Queue-Aktion fehlgeschlagen.");
    }
  }

  async function deferTicketGroup(ticketGroupId: string, reason: string) {
    const rotation = board?.rotations.find(
      (entry) =>
        entry.ticketGroupId === ticketGroupId ||
        entry.bookingGroups.some((group) => group.id === ticketGroupId),
    );
    if (rotation) await mutateQueue("DEFER_TICKET_GROUP", reason, rotation, ticketGroupId);
  }

  async function setRotationCapacity() {
    if (!board || !selected || selected.status !== "DRAFT") return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_ROTATION_CAPACITY",
          payload: {
            rotationId: selected.id,
            usableCapacity: dispositionCapacity,
            reason: "Nutzbare Kapazität vor dem Aufruf organisatorisch angepasst",
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Kapazitätsänderung fehlgeschlagen.");
    }
  }

  async function moveTicketGroup(ticketGroupId: string, targetRotationId: string, reason: string) {
    if (!board || reason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "MOVE_TICKET_GROUP",
          payload: { ticketGroupId, targetRotationId, reason: reason.trim() },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMoveReason("");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Verschiebung fehlgeschlagen.");
    }
  }

  async function markTicketNoShow(ticketId: string) {
    if (!board || !selected || !noShowReady) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "MARK_TICKET_NO_SHOW",
          payload: {
            ticketId,
            reason: "Nach Ablauf der No-Show-Frist nicht anwesend",
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No-Show konnte nicht gesetzt werden.");
    }
  }

  async function confirmAttendanceDecision(decision: "FLY_WITH_PRESENT" | "LEAVE_SEAT_EMPTY") {
    if (!board || !selected) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CONFIRM_ATTENDANCE_DECISION",
          payload: { rotationId: selected.id, decision },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setDispositionOpen(false);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Entscheidung nicht gespeichert.");
    }
  }

  async function revokeCall() {
    if (!board || !selected || selected.status !== "CALLED") return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "REVOKE_CALL",
          payload: { rotationId: selected.id },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(
        "Der bestätigte Boarding-Aufruf wurde durch ein Korrekturereignis zurückgenommen.",
      );
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Rücknahme fehlgeschlagen.");
    }
  }

  async function abortRotation() {
    if (!board || !selected || selected.status !== "CALLED" || queueReason.trim().length < 3)
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "ABORT_ROTATION",
          payload: { rotationId: selected.id, reason: queueReason.trim() },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setQueueReason("");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Umlaufabbruch fehlgeschlagen.");
    }
  }

  async function abortTechnicalRotation() {
    if (!board || !technicalAbort || technicalAbortReason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE",
          payload: {
            rotationId: technicalAbort.rotationId,
            expectedRotationVersion: technicalAbort.rotationVersion,
            expectedAircraftVersion: technicalAbort.aircraftVersion,
            reason: technicalAbortReason.trim(),
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setTechnicalAbort(null);
      setTechnicalAbortReason("");
      setSelectedQueueGroupIds([]);
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Technischer Umlaufabbruch fehlgeschlagen.",
      );
    }
  }

  async function setAttendance(ticketId: string, checkedIn: boolean) {
    if (!board || !selected || !["DRAFT", "CALLED"].includes(selected.status)) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_TICKET_ATTENDANCE",
          payload: { ticketId, checkedIn },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Anwesenheitsabgleich fehlgeschlagen.");
    }
  }

  const loadAllForecastHistory = useCallback(async (rotationId: string) => {
    const entries: ForecastHistory["entries"] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const page = await getForecastHistory(
        EVENT_ID,
        FLIGHT_LINE_DEVICE_ID,
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
        { rotationId, limit: 200, offset },
      );
      entries.push(...page.entries);
      total = page.total;
      offset += page.entries.length;
      if (page.entries.length === 0) break;
      if (offset > 100_000 && offset < total) {
        throw new Error("Der Prognoseverlauf überschreitet die abrufbare Tagesmenge.");
      }
    }
    return entries.sort(
      (left, right) =>
        Date.parse(left.capturedAt) - Date.parse(right.capturedAt) ||
        left.snapshotId.localeCompare(right.snapshotId),
    );
  }, []);

  const loadResourceHistory = useCallback(
    (scopeType: "AIRCRAFT" | "PILOT", scopeId: string) =>
      getResourceDayHistory(
        EVENT_ID,
        FLIGHT_LINE_DEVICE_ID,
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
        { scopeType, scopeId },
      ),
    [],
  );

  return (
    <Shell
      className={FLIGHT_LINE_ASSIST_MODE ? "flight-line-shell assist-shell" : "flight-line-shell"}
      connection={{ backendConfirmed, error, lastConfirmedAt }}
      title={FLIGHT_LINE_ASSIST_MODE ? "Flight Line" : "Flight Director"}
      notifications={
        <>
          <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
          <EmergencyNotice active={board?.event.emergencyMode ?? false} />
          <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
          <OperationalNotice note={board?.event.operationalNote} />
        </>
      }
    >
      {board && FLIGHT_LINE_ASSIST_MODE ? (
        <FlightLineAssist
          aircraft={operationalAircraft}
          board={board}
          busyRotationIds={busyRotationIds}
          canAssignPilot={canManageAircraft}
          dispatchLease={dispatchLease}
          onAssignPilot={assignAircraftPilot}
          onClaim={async (aircraftId, expectedTakeoverRevision) => {
            await claimFlightLineAircraft(
              EVENT_ID,
              aircraftId,
              FLIGHT_LINE_DEVICE_ID,
              deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
              expectedTakeoverRevision,
            );
            await refresh();
          }}
          onClaimUnavailable={() => {
            setSelectedAircraftId(null);
            setSelectedId(null);
            setSelectedQueueGroupIds([]);
          }}
          onGroupAttendance={setGroupAttendance}
          onGroupMissing={(ticketGroupId) => updateGroupPresence(ticketGroupId, "MISSING")}
          onGroupRecall={startTicketGroupRecall}
          onGroupRecallClear={clearTicketGroupRecall}
          onGroupRestore={(ticketGroupId) => updateGroupPresence(ticketGroupId, "RESTORE")}
          onGroupDefer={(ticketGroupId) =>
            deferTicketGroup(ticketGroupId, "Gruppe durch Flight Line zurückgestellt")
          }
          onToggleGroup={(ticketGroupId, isSelected) => {
            setSelectedQueueGroupIds((current) =>
              isSelected
                ? [...new Set([...current, ticketGroupId])]
                : current.filter((id) => id !== ticketGroupId),
            );
            if (isSelected) {
              const rotation = aircraftRotations?.find(
                (entry) =>
                  entry.ticketGroupId === ticketGroupId ||
                  entry.bookingGroups.some((group) => group.id === ticketGroupId),
              );
              if (rotation) setSelectedId(rotation.id);
            }
          }}
          onPause={openAircraftPauseDialog}
          onRefresh={refresh}
          onRelease={async (aircraftId) => {
            await releaseFlightLineAircraft(
              EVENT_ID,
              aircraftId,
              FLIGHT_LINE_DEVICE_ID,
              deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
            );
            setSelectedAircraftId(null);
            setSelectedId(null);
            setSelectedQueueGroupIds([]);
            await refresh();
          }}
          onSelectAircraft={(aircraftId) => {
            setSelectedAircraftId(aircraftId);
            setSelectedId(null);
            setSelectedQueueGroupIds([]);
          }}
          onRunRotation={(rotation, nextAircraftState, queueDeviationReason) => {
            const rotationAircraft =
              operationalAircraft.find((entry) => entry.id === rotation.aircraftId) ??
              selectedAircraft;
            return advance(rotation, rotationAircraft, nextAircraftState, queueDeviationReason);
          }}
          onReserveAssignment={(aircraftId) => {
            setSelectedQueueGroupIds([]);
            return dispatchLease.reserve(aircraftId);
          }}
          onSetAircraftState={requestAircraftState}
          selectedQueueGroupIds={selectedQueueGroupIds}
        />
      ) : board ? (
        <FlightLineSupervisorConsole
          aircraft={operationalAircraft}
          board={board}
          busyRotationIds={busyRotationIds}
          canManageOperations={canManageAircraft}
          dispatchLease={dispatchLease}
          operationalSummary={operationalSummary}
          operationalSummaryTone={operationalSummaryTone}
          loadForecastHistory={loadAllForecastHistory}
          loadResourceHistory={loadResourceHistory}
          onOpenOperations={openOperationsDialog}
          onResourceGroupChange={setFilteredResourceGroupId}
          selectedQueueGroupIds={selectedQueueGroupIds}
          onAssignPilot={assignAircraftPilot}
          onConfirmAssignment={(queueDeviationReason) =>
            advance(undefined, undefined, turnaroundNextState, queueDeviationReason)
          }
          onRunRotation={(rotation, nextAircraftState) => {
            const rotationAircraft = operationalAircraft.find(
              (entry) => entry.id === rotation.aircraftId,
            );
            return advance(rotation, rotationAircraft, nextAircraftState);
          }}
          onPauseAircraft={openAircraftPauseDialog}
          onGroupAttendance={setGroupAttendance}
          onGroupMissing={(ticketGroupId) => updateGroupPresence(ticketGroupId, "MISSING")}
          onGroupRecall={startTicketGroupRecall}
          onGroupRecallClear={clearTicketGroupRecall}
          onGroupRestore={(ticketGroupId) => updateGroupPresence(ticketGroupId, "RESTORE")}
          onGroupDefer={(ticketGroupId) =>
            deferTicketGroup(ticketGroupId, "Gruppe durch Flight Director zurückgestellt")
          }
          onSetAircraftState={requestAircraftState}
          onSelectAircraft={(aircraftId) => {
            setSelectedAircraftId(aircraftId);
            setSelectedId(null);
            setSelectedQueueGroupIds([]);
            setDispositionOpen(false);
            setDetailsOpen(false);
          }}
          onReserveAssignment={(aircraftId) => {
            setSelectedQueueGroupIds([]);
            return dispatchLease.reserve(aircraftId);
          }}
          onToggleGroup={(ticketGroupId, isSelected) => {
            setSelectedQueueGroupIds((current) =>
              isSelected
                ? [...new Set([...current, ticketGroupId])]
                : current.filter((id) => id !== ticketGroupId),
            );
          }}
          selectedAircraft={selectedAircraft}
        />
      ) : null}
      <section
        className={`flight-supervisor legacy-flight-line-overlay ${
          dispositionOpen ? "show-disposition" : "show-details"
        }`}
        hidden={FLIGHT_LINE_ASSIST_MODE || (!dispositionOpen && !detailsOpen)}
      >
        <button
          aria-label="Erweiterte Flight-Line-Details schließen"
          className="legacy-overlay-close"
          onClick={() => {
            setDispositionOpen(false);
            setDetailsOpen(false);
          }}
          type="button"
        >
          ×
        </button>
        <nav className="aircraft-selector" aria-label="Flugzeug auswählen">
          <div className="aircraft-selector-heading">
            <strong>Flugzeuge</strong>
            <span>{operationalAircraft.length}</span>
          </div>
          {operationalAircraft.map((aircraft) => {
            const assignedRotation = operationalRotations?.find(
              (rotation) => rotation.aircraftId === aircraft.id,
            );
            return (
              <button
                className={aircraft.id === selectedAircraft?.id ? "selected" : ""}
                key={aircraft.id}
                onClick={() => {
                  setSelectedAircraftId(aircraft.id);
                  setSelectedId(null);
                  setSelectedQueueGroupIds([]);
                  setDispositionOpen(false);
                }}
                type="button"
              >
                <strong>{aircraft.registration}</strong>
                <span>{aircraft.passengerSeats} Plätze</span>
                <small>
                  {assignedRotation
                    ? `${assignedRotation.communicationLabel} · ${rotationStatusLabel[assignedRotation.status]}`
                    : aircraftStateLabel[aircraft.operationalState]}
                </small>
              </button>
            );
          })}
        </nav>
        <section className="flight-workspace">
          <div className="queue-list">
            <h1>
              {selectedAircraft
                ? `Nächste Gruppen für ${selectedAircraft.registration}`
                : "Flugzeuge"}
            </h1>
            {selectedAircraft && compatibleQueueGroups.length > 0 ? (
              <section className="queue-group-selector" aria-labelledby="queue-groups-title">
                <header>
                  <div>
                    <h2 id="queue-groups-title">Gruppen auswählen</h2>
                    <p>Nur vollständige Gruppen werden gemeinsam aufgerufen.</p>
                  </div>
                  <strong>
                    {selectedQueueSeatCount} von {selectedAircraft.passengerSeats} Plätzen
                  </strong>
                </header>
                <div className="queue-group-options">
                  {compatibleQueueGroups.map((group) => {
                    const selectedGroup = selectedQueueGroupIds.includes(group.id);
                    const productMismatch =
                      !selectedGroup &&
                      selectedQueueProductId !== null &&
                      group.productId !== selectedQueueProductId;
                    const exceedsCapacity =
                      !selectedGroup &&
                      selectedQueueSeatCount + queuedSegmentTicketCount(group) >
                        selectedAircraft.passengerSeats;
                    return (
                      <article
                        className={
                          selectedGroup ? "queue-group-option selected" : "queue-group-option"
                        }
                        key={group.id}
                      >
                        <label>
                          <input
                            checked={selectedGroup}
                            disabled={
                              group.status === "MISSING" || exceedsCapacity || productMismatch
                            }
                            onChange={(event) => {
                              setSelectedQueueGroupIds((current) =>
                                event.target.checked
                                  ? [...current, group.id]
                                  : current.filter((id) => id !== group.id),
                              );
                              if (event.target.checked) {
                                const rotation = aircraftRotations?.find(
                                  (entry) =>
                                    entry.ticketGroupId === group.id ||
                                    entry.bookingGroups.some(
                                      (bookingGroup) => bookingGroup.id === group.id,
                                    ),
                                );
                                if (rotation) setSelectedId(rotation.id);
                              } else if (selectedQueueGroupIds.length === 1) {
                                setCallDeviationReason("");
                              }
                            }}
                            type="checkbox"
                          />
                          <span>
                            <strong>
                              {formatBookingGroupLabel(
                                group.productCode,
                                group.communicationNumber,
                              )}
                            </strong>
                            <small>
                              {group.segmentCount && group.segmentCount > 1 ? (
                                <>
                                  {queuedSegmentTicketCount(group)} von {group.ticketCount} Personen
                                  · Teil {group.segmentIndex ?? 1}/{group.segmentCount} ·{" "}
                                </>
                              ) : (
                                <>
                                  {queuedSegmentTicketCount(group)} Person
                                  {queuedSegmentTicketCount(group) === 1 ? "" : "en"} ·{" "}
                                </>
                              )}
                              {queuedSegmentPresentCount(group)}/{queuedSegmentTicketCount(group)}{" "}
                              anwesend
                            </small>
                          </span>
                        </label>
                        <div className="queue-group-actions">
                          <button
                            onClick={() =>
                              void setGroupAttendance(group.id, group.status !== "PRESENT")
                            }
                            type="button"
                          >
                            {group.status === "PRESENT" ? "Anwesenheit aufheben" : "Anwesend"}
                          </button>
                          {group.status === "MISSING" ? (
                            <button
                              onClick={() => void updateGroupPresence(group.id, "RESTORE")}
                              type="button"
                            >
                              Zurück in Queue
                            </button>
                          ) : (
                            <button
                              className="danger-link-action"
                              onClick={() => void updateGroupPresence(group.id, "MISSING")}
                              type="button"
                            >
                              Nicht da
                            </button>
                          )}
                          <TicketGroupRecallButton
                            group={group}
                            onClear={clearTicketGroupRecall}
                            onStart={startTicketGroupRecall}
                            timeZone={board?.event.timeZone ?? "Europe/Berlin"}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
                {queueDeviationReasonRequired ? (
                  <label className="queue-deviation-reason">
                    Grund für das Überspringen früherer Gruppen
                    <input
                      maxLength={240}
                      onChange={(event) => setCallDeviationReason(event.target.value)}
                      placeholder="Mindestens 3 Zeichen"
                      value={callDeviationReason}
                    />
                    <small>
                      {skippedEarlierProductGroups.length} frühere Ticketgruppe
                      {skippedEarlierProductGroups.length === 1 ? "" : "n"} eines anderen Produkts
                      werden übersprungen.
                    </small>
                  </label>
                ) : null}
              </section>
            ) : null}
            {aircraftRotations?.map((rotation) => {
              const segmentLabel = sharedGroupSegmentLabel(rotation, operationalRotations ?? []);
              return (
                <div className="queue-row-wrap" key={rotation.id}>
                  <button
                    className={rotation.id === selected?.id ? "queue-row selected" : "queue-row"}
                    onClick={() => {
                      setSelectedId(rotation.id);
                      setDispositionCapacity(rotation.usableCapacity);
                      setMoveTargetId("");
                      setMoveReason("");
                    }}
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
                    onClick={() => {
                      setSelectedId(rotation.id);
                      setDispositionCapacity(rotation.usableCapacity);
                      setMoveTargetId("");
                      setMoveReason("");
                      setDispositionOpen(true);
                    }}
                    type="button"
                  >
                    Disposition
                  </button>
                </div>
              );
            })}
            {selectedAircraft && aircraftRotations?.length === 0 ? (
              <p>Für dieses Flugzeug ist aktuell keine passende Fluggruppe offen.</p>
            ) : null}
            {!selectedAircraft ? <p>Kein aktives Flugzeug verfügbar.</p> : null}
          </div>
          <div className="rotation-detail">
            {selectedAircraft ? (
              <section className="supervisor-aircraft-summary">
                <div>
                  <span>Ausgewähltes Flugzeug</span>
                  <h1>{selectedAircraft.registration}</h1>
                  <p>
                    {selectedAircraft.aircraftType} · {selectedAircraft.passengerSeats} Plätze ·{" "}
                    {selectedAircraft.resourceGroupName || "Keine Ressourcengruppe"}
                  </p>
                </div>
                <strong
                  className={`aircraft-state state-${selectedAircraft.operationalState.toLowerCase()}`}
                >
                  {aircraftStateLabel[selectedAircraft.operationalState]}
                </strong>
                {selectedAircraft.expectedReviewAt ? (
                  <small>
                    Erwartete Rückkehr{" "}
                    {operationalTimeLabel(
                      selectedAircraft.expectedReviewAt,
                      board?.event.timeZone ?? "Europe/Berlin",
                    )}
                  </small>
                ) : null}
                <div className="supervisor-aircraft-actions">
                  {!canManageAircraft ? (
                    <span>Flottenstatus wird durch die Flight-Line-Leitung gesteuert.</span>
                  ) : selectedAircraft.operationalState === "AVAILABLE" ? (
                    <>
                      <button onClick={() => openAircraftPauseDialog()} type="button">
                        Pause
                      </button>
                      <button
                        onClick={() => void setFlightLineAircraftState("REFUELING")}
                        type="button"
                      >
                        Tanken
                      </button>
                      <button
                        onClick={() => void setFlightLineAircraftState("INACTIVE")}
                        type="button"
                      >
                        Herausnehmen
                      </button>
                    </>
                  ) : ["PAUSED", "REFUELING", "INACTIVE", "INTERRUPTED"].includes(
                      selectedAircraft.operationalState,
                    ) ? (
                    <button
                      className="primary-action"
                      onClick={() => void setFlightLineAircraftState("AVAILABLE")}
                      type="button"
                    >
                      Wieder verfügbar
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}
            {selected ? (
              <>
                <div className={`state-banner state-${selected.status.toLowerCase()}`}>
                  <span>Status</span>
                  <strong>{rotationStatusLabel[selected.status]}</strong>
                </div>
                <h2>Fluggruppe {selected.communicationLabel}</h2>
                {sharedGroupSegmentLabel(selected, operationalRotations ?? []) ? (
                  <p className="shared-group-label">
                    {sharedGroupSegmentLabel(selected, operationalRotations ?? [])}
                  </p>
                ) : null}
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
                      {selected.deferralCount}/{board?.event.maxTicketDeferrals ?? 2}
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
                  Nur organisatorische Schätzung aus konfigurierten Referenzgewichten. Die Bewertung
                  und Entscheidung liegt ausschließlich beim Piloten; keine Sicherheits- oder
                  Freigabewirkung.
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
                  {selected.timeline.extendsBeyondOperationsEnd ? (
                    <p className="rotation-timeline-overtime" role="status">
                      Voraussichtlicher Abschluss nach Betriebsende:{" "}
                      {operationalTimeLabel(
                        selected.timeline.predicted.completionAt,
                        board?.event.timeZone ?? "Europe/Berlin",
                      )}{" "}
                      · +{selected.timeline.overtimeMinutes} Min.
                    </p>
                  ) : null}
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
                          <td>
                            {operationalTimeLabel(
                              selected.timeline.planned[field],
                              board?.event.timeZone ?? "Europe/Berlin",
                            )}
                          </td>
                          <td>
                            {operationalTimeLabel(
                              selected.timeline.predicted[field],
                              board?.event.timeZone ?? "Europe/Berlin",
                            )}
                          </td>
                          <td>
                            {operationalTimeLabel(
                              selected.timeline.actual[field],
                              board?.event.timeZone ?? "Europe/Berlin",
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="attendance-panel" aria-labelledby="attendance-title">
                  <div>
                    <h3 id="attendance-title">Anwesenheit (optional)</h3>
                    <span>
                      {
                        selected.tickets.filter(
                          (ticket) => ticket.attendanceStatus === "CHECKED_IN",
                        ).length
                      }
                      /{selected.tickets.length} eingecheckt
                    </span>
                  </div>
                  <div className="attendance-list">
                    {selected.tickets.map((ticket, index) => {
                      const checkedIn = ticket.attendanceStatus === "CHECKED_IN";
                      return (
                        <button
                          className={checkedIn ? "checked-in" : ""}
                          disabled={!["DRAFT", "CALLED"].includes(selected.status)}
                          key={ticket.id}
                          onClick={() => setAttendance(ticket.id, !checkedIn)}
                          type="button"
                        >
                          Ticket {index + 1} · {checkedIn ? "anwesend" : "offen"}
                        </button>
                      );
                    })}
                  </div>
                  <small>
                    Der Standardumlauf bleibt auch ohne Einzelabgleich vollständig bedienbar.
                  </small>
                </section>
                {selected.status === "LANDED" ? (
                  <div className="landed-warning">
                    <p>Gelandet · noch nicht verfügbar</p>
                    <label>
                      Zustand nach dem Turnaround
                      <select
                        onChange={(event) =>
                          setTurnaroundNextState(event.target.value as typeof turnaroundNextState)
                        }
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
                      Grund für Queue-Abweichung
                      <input
                        value={queueReason}
                        onChange={(event) => setQueueReason(event.target.value)}
                        placeholder="Mindestens 3 Zeichen"
                      />
                    </label>
                    <div className="secondary-actions">
                      <button
                        disabled={queueReason.trim().length < 3}
                        onClick={() => mutateQueue("DEFER_TICKET_GROUP")}
                        type="button"
                      >
                        Zurückstellen
                      </button>
                      {selected.status === "CALLED" ? (
                        <button
                          disabled={queueReason.trim().length < 3}
                          onClick={() => void abortRotation()}
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
                  <button className="undo-action" onClick={revokeCall} type="button">
                    Boarding-Aufruf rückgängig
                  </button>
                ) : null}
                {action ? (
                  <button
                    className="primary-action"
                    disabled={
                      action.command === "CALL_NEXT" &&
                      (!nextAircraftId ||
                        !selectedAircraft?.currentPilotId ||
                        board?.event.emergencyMode ||
                        board?.event.status !== "ACTIVE" ||
                        board?.event.operationalInterrupted ||
                        (queueDeviationReasonRequired && callDeviationReason.trim().length < 3))
                    }
                    onClick={() => void advance()}
                    type="button"
                  >
                    {action.label}
                  </button>
                ) : (
                  <div className="completed-state">Umlauf abgeschlossen</div>
                )}
              </>
            ) : (
              <p>Noch keine Fluggruppe vorhanden.</p>
            )}
          </div>
          {dispositionOpen && selected ? (
            <aside className="disposition-panel" aria-labelledby="disposition-title">
              <div className="disposition-heading">
                <div>
                  <span>Disposition</span>
                  <h2 id="disposition-title">{selected.communicationLabel}</h2>
                </div>
                <button
                  aria-label="Disposition schließen"
                  onClick={() => setDispositionOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <p className="disposition-status">
                {selected.status === "DRAFT" ? "Vor dem Aufruf" : "Aufgerufen"} · ganze Gruppen
                bleiben verbunden
              </p>
              {selected.status === "DRAFT" &&
              ["FLIGHT_DIRECTOR", "ADMIN"].includes(board?.currentDeviceRole ?? "") ? (
                <section>
                  <h3>Nutzbare Plätze</h3>
                  <div className="compact-stepper">
                    <button
                      onClick={() => setDispositionCapacity((value) => Math.max(1, value - 1))}
                      type="button"
                    >
                      −
                    </button>
                    <output>{dispositionCapacity}</output>
                    <button
                      onClick={() =>
                        setDispositionCapacity((value) =>
                          Math.min(selected.baselineCapacity, value + 1),
                        )
                      }
                      type="button"
                    >
                      +
                    </button>
                  </div>
                  <p>
                    Ausgangskapazität {selected.baselineCapacity}.{" "}
                    {dispositionCapacity < selected.ticketCount
                      ? `Die Gruppe ${selected.ticketGroupId.slice(0, 8)} mit ${selected.ticketCount} Tickets rückt gemeinsam an die vorderste passende Position.`
                      : "Keine Buchungsgruppe muss neu eingereiht werden."}
                  </p>
                  <small>Rein organisatorisch · keine Sicherheits- oder Freigabewirkung.</small>
                  <button
                    disabled={dispositionCapacity === selected.usableCapacity}
                    onClick={() => void setRotationCapacity()}
                    type="button"
                  >
                    Kapazität übernehmen
                  </button>
                </section>
              ) : null}
              {["DRAFT", "CALLED"].includes(selected.status) ? (
                <section>
                  <h3>Ganze Gruppe verschieben</h3>
                  <label>
                    Zielumlauf
                    <select
                      value={moveTargetId}
                      onChange={(event) => setMoveTargetId(event.target.value)}
                    >
                      <option value="">Passendes Ziel wählen</option>
                      {moveTargets.map(({ rotation, freeSeats }) => (
                        <option value={rotation.id} key={rotation.id}>
                          {rotation.communicationLabel} · {freeSeats} Plätze frei ·{" "}
                          {rotation.status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Begründung der Abweichung
                    <input
                      value={moveReason}
                      onChange={(event) => setMoveReason(event.target.value)}
                      placeholder="Kurz begründen"
                    />
                  </label>
                  <small>Die gesamte Buchungsgruppe wird verschoben; keine Trennung.</small>
                  <button
                    disabled={!moveTargetId || moveReason.trim().length < 3}
                    onClick={() =>
                      void moveTicketGroup(selected.ticketGroupId, moveTargetId, moveReason)
                    }
                    type="button"
                  >
                    Verschiebung übernehmen
                  </button>
                  {moveTargets.length === 0 ? (
                    <p>Aktuell ist kein passendes Ziel mit genügend Platz vorhanden.</p>
                  ) : null}
                </section>
              ) : null}
              {selected.status === "CALLED" ? (
                <section className="attendance-decision">
                  <h3>Anwesenheitsentscheidung</h3>
                  <strong>
                    Anwesend {presentCount} von {selected.tickets.length}
                  </strong>
                  {!noShowReady ? (
                    <p>
                      No-Show ist erst nach {board?.event.noShowAfterMinutes ?? 10} Minuten
                      verfügbar.
                    </p>
                  ) : null}
                  {missingTickets.length > 0 && presentCount > 0 ? (
                    <div className="disposition-actions">
                      <button
                        onClick={() =>
                          void mutateQueue(
                            "DEFER_TICKET_GROUP",
                            "Aufgerufene Gruppe gemeinsam zurückgestellt",
                          )
                        }
                        type="button"
                      >
                        Gemeinsam zurückstellen
                      </button>
                      <button
                        onClick={() => void confirmAttendanceDecision("FLY_WITH_PRESENT")}
                        type="button"
                      >
                        Mit {presentCount} Personen fliegen
                      </button>
                      <button
                        onClick={() => void confirmAttendanceDecision("LEAVE_SEAT_EMPTY")}
                        type="button"
                      >
                        Fehlende Plätze leer lassen
                      </button>
                    </div>
                  ) : null}
                  {missingTickets.map((ticket, index) => (
                    <button
                      disabled={!noShowReady}
                      key={ticket.id}
                      onClick={() => void markTicketNoShow(ticket.id)}
                      type="button"
                    >
                      Fehlendes Ticket {index + 1} als No-Show markieren
                    </button>
                  ))}
                  {replacement ? (
                    <div className="replacement-suggestion">
                      <strong>Ersatzvorschlag</strong>
                      <span>
                        {replacement.rotation.communicationLabel} ·{" "}
                        {replacement.rotation.ticketCount} Ticket
                        {replacement.rotation.ticketCount === 1 ? "" : "s"} · vollständig
                        eingecheckt
                      </span>
                      <button
                        onClick={() =>
                          void moveTicketGroup(
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
              ) : null}
            </aside>
          ) : null}
        </section>
      </section>
      {board ? (
        <FlightDirectorOperationsDialog
          busy={operationsBusy}
          emergencyMode={board.event.emergencyMode}
          eventId={board.event.eventId}
          eventInterrupted={board.event.operationalInterrupted}
          eventNotice={board.event.operationalNote}
          eventTimeZone={board.event.timeZone}
          aircraft={board.aircraft}
          pilots={board.pilots}
          plannedOperations={board.plannedOperations}
          recurringOperationalRules={board.recurringOperationalRules}
          rotations={board.rotations}
          onCancelPlannedOperation={cancelPlannedOperation}
          onClose={() => setOperationsOpen(false)}
          onConfirmPlannedOperation={confirmPlannedOperation}
          onDisableRecurringRule={disableRecurringRule}
          onPublishEventNotice={setEventNotice}
          onPublishResourceNotice={setResourceNoticeCommand}
          onSetEventInterruption={setEventInterruption}
          onSetResourceGroupStatus={setResourceGroupStatus}
          onTriggerEmergency={triggerEmergency}
          onUpsertPlannedOperation={upsertPlannedOperation}
          onUpsertRecurringRule={upsertRecurringRule}
          open={operationsOpen && canManageAircraft}
          resourceGroups={board.resourceGroups}
        />
      ) : null}
      <ModalDialog
        footer={
          <Button onClick={() => setAircraftPauseOpen(false)} type="button" variant="secondary">
            Abbrechen
          </Button>
        }
        onClose={() => setAircraftPauseOpen(false)}
        open={aircraftPauseOpen && Boolean(selectedAircraft)}
        size="compact"
        title={selectedAircraft ? `Pause für ${selectedAircraft.registration}` : "Pause"}
      >
        <div className="aircraft-pause-options">
          {([10, 20, 30] as const).map((minutes) => (
            <Button
              key={minutes}
              onClick={() => startAircraftPause(minutes)}
              size="touch"
              type="button"
              variant="primary"
            >
              {minutes} Min.
            </Button>
          ))}
          <Button
            onClick={() => startAircraftPause(null)}
            size="touch"
            type="button"
            variant="secondary"
          >
            Dauer unbekannt
          </Button>
        </div>
      </ModalDialog>
      <ModalDialog
        description="Alle Gäste dieses Umlaufs werden mit ihren vollständigen Gruppen ganz vorne in die Warteschlange zurückgestellt. Das Flugzeug wird nicht verfügbar."
        footer={
          <>
            <Button onClick={() => setTechnicalAbort(null)} type="button" variant="secondary">
              Abbrechen
            </Button>
            <Button
              disabled={technicalAbortReason.trim().length < 3}
              onClick={abortTechnicalRotation}
              type="button"
              variant="danger"
            >
              Abbrechen &amp; nicht verfügbar
            </Button>
          </>
        }
        onClose={() => setTechnicalAbort(null)}
        open={technicalAbort !== null}
        size="compact"
        title="Umlauf abbrechen?"
      >
        <label className="technical-abort-reason">
          Grund
          <input
            maxLength={500}
            onChange={(event) => setTechnicalAbortReason(event.target.value)}
            placeholder="z. B. technisches Problem beim Run-Up"
            value={technicalAbortReason}
          />
        </label>
      </ModalDialog>
    </Shell>
  );
}

import "./features/flight-line/flight-line-v12.css";
import "./features/flight-line/flight-line-assist-v15.css";
import "./features/operations-finish-v12.css";
