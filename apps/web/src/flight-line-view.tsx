import type { OperationBoard } from "@rundflug/contracts";
import { useEffect, useState } from "react";
import { ValidationHint } from "./admin-ux";
import { claimFlightLineAircraft, releaseFlightLineAircraft, sendCommand } from "./api";
import { AppShell as Shell } from "./app/AppShell";
import { useActionMessageBridge } from "./app/PageNotifications";
import { FlightLineAssist } from "./flight-line-assist";
import { expectedReviewAtFromPause } from "./flight-line-pause";
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

function queuedSegmentTicketCount(group: QueueGroup): number {
  return group.nextSegmentTicketCount ?? group.ticketCount;
}

function queuedSegmentPresentCount(group: QueueGroup): number {
  return group.nextSegmentPresentCount ?? group.presentCount;
}

export function FlightLineView() {
  const { board, error, lastConfirmedAt, refresh } = useOperationBoard(FLIGHT_LINE_DEVICE_ID);
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);
  const [queueReason, setQueueReason] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [nextAircraftId, setNextAircraftId] = useState("");
  const [turnaroundNextState, setTurnaroundNextState] = useState<
    "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE"
  >("AVAILABLE");
  const [selectedQueueGroupIds, setSelectedQueueGroupIds] = useState<string[]>([]);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dispositionCapacity, setDispositionCapacity] = useState(1);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [aircraftPauseOpen, setAircraftPauseOpen] = useState(false);
  const [aircraftPauseMinutes, setAircraftPauseMinutes] = useState("");
  const [aircraftPauseUnknown, setAircraftPauseUnknown] = useState(false);
  const operationalRotations = board?.rotations.filter(
    (rotation) => rotation.status !== "COMPLETED",
  );
  const operationalAircraft = board?.aircraft ?? [];
  const canManageAircraft = ["FLIGHT_DIRECTOR", "ADMIN"].includes(board?.currentDeviceRole ?? "");
  const claimedAssistAircraftId = board?.assistClaims?.find(
    (claim) => claim.claimedByCurrentSession,
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
  ) {
    const selectedRotation = rotationOverride;
    const selectedAction = selectedRotation ? actionForState[selectedRotation.status] : null;
    if (!board || !selectedRotation || !selectedAction) return;
    try {
      const commandBase = {
        commandId: crypto.randomUUID(),
        eventId: EVENT_ID,
        deviceId: FLIGHT_LINE_DEVICE_ID,
        expectedVersion: board.event.version,
        issuedAt: new Date().toISOString(),
      };
      if (selectedAction.command === "CALL_NEXT") {
        const assignedPilotId = aircraftOverride?.currentPilotId;
        if (!aircraftOverride?.id || !assignedPilotId) {
          throw new Error(
            "Vor Belegung bitte über „Pilot zuweisen“ einen Pilotencode am Flugzeug hinterlegen.",
          );
        }
        await sendCommand(
          {
            ...commandBase,
            type: "CALL_NEXT",
            payload: {
              ticketGroupIds:
                selectedQueueGroupIds.length > 0
                  ? selectedQueueGroupIds
                  : selectedRotation.bookingGroups.length > 0
                    ? selectedRotation.bookingGroups.map((group) => group.id)
                    : [selectedRotation.ticketGroupId],
              aircraftId: aircraftOverride.id,
              pilotId: assignedPilotId,
            },
          },
          deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
        );
      } else {
        await sendCommand(
          selectedAction.command === "COMPLETE_TURNAROUND"
            ? {
                ...commandBase,
                type: "COMPLETE_TURNAROUND",
                payload: {
                  rotationId: selectedRotation.id,
                  nextAircraftState: turnaroundNextState,
                },
              }
            : {
                ...commandBase,
                type: selectedAction.command,
                payload: { rotationId: selectedRotation.id },
              },
          deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
        );
      }
      setMessage(`${selectedAction.label} bestätigt.`);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Aktion fehlgeschlagen.");
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
      setMessage(
        checkedIn ? "Gruppe als anwesend markiert." : "Anwesenheit der Gruppe aufgehoben.",
      );
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Anwesenheit konnte nicht geändert werden.",
      );
    }
  }

  async function updateGroupPresence(ticketGroupId: string, action: "MISSING" | "RECALL") {
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
              type: "RECALL_TICKET_GROUP",
              payload: { ticketGroupId },
            },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(action === "MISSING" ? "Gruppe als nicht da markiert." : "Gruppe nachgerufen.");
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Gruppenstatus konnte nicht geändert werden.",
      );
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
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
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
      setMessage(
        state === "AVAILABLE"
          ? `${aircraftOverride.registration} ist wieder verfügbar.`
          : `${aircraftOverride.registration}: ${aircraftStateLabel[state]}.`,
      );
      setAircraftPauseOpen(false);
      await refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugstatus konnte nicht geändert werden.",
      );
    }
  }

  function startAircraftPause() {
    if (!selectedAircraft) return;
    const expectedReviewAt = expectedReviewAtFromPause(aircraftPauseMinutes, aircraftPauseUnknown);
    void setFlightLineAircraftState("PAUSED", expectedReviewAt);
  }

  function openAircraftPauseDialog(aircraftId?: string) {
    if (aircraftId) setSelectedAircraftId(aircraftId);
    setAircraftPauseMinutes("");
    setAircraftPauseUnknown(false);
    setAircraftPauseOpen(true);
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
      const aircraftEntry = board.aircraft.find((entry) => entry.id === aircraftId);
      const pilot = board.pilots.find((entry) => entry.id === pilotId);
      setMessage(
        `${pilot?.operationalCode ?? "Pilotencode"} wurde ${aircraftEntry?.registration ?? "dem Flugzeug"} zugewiesen.`,
      );
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Pilotzuweisung fehlgeschlagen.";
      setMessage(message);
      throw reason;
    }
  }

  async function triggerEmergency() {
    if (!board || emergencyReason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "TRIGGER_EMERGENCY",
          payload: { reason: emergencyReason.trim() },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Notfallmodus ausgelöst.");
      setEmergencyReason("");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Notfallkommando fehlgeschlagen.");
    }
  }

  async function mutateQueue(
    type: "DEFER_TICKET_GROUP" | "MARK_NO_SHOW",
    reasonOverride?: string,
    targetRotation = selected,
  ) {
    const effectiveReason = reasonOverride ?? queueReason.trim();
    if (!board || !targetRotation || effectiveReason.length < 3) return;
    const movesToClarification =
      type === "DEFER_TICKET_GROUP" &&
      targetRotation.deferralCount + 1 >= board.event.maxTicketDeferrals;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type,
          payload: { ticketGroupId: targetRotation.ticketGroupId, reason: effectiveReason },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(
        type === "MARK_NO_SHOW"
          ? "No-Show protokolliert."
          : movesToClarification
            ? "Höchstzahl erreicht · Fluggruppe zur Klärung an die Kasse gegeben."
            : "Fluggruppe zurückgestellt.",
      );
      setQueueReason("");
      setSelectedId(null);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Queue-Aktion fehlgeschlagen.");
    }
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
      setMessage("Nutzbare Kapazität übernommen; betroffene Gruppen wurden gemeinsam neu gereiht.");
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
      setMessage("Die gesamte Buchungsgruppe wurde verschoben und protokolliert.");
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
      setMessage("Das fehlende anonyme Ticket wurde als No-Show protokolliert.");
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
      setMessage(
        decision === "FLY_WITH_PRESENT"
          ? `Entscheidung für ${presentCount} anwesende Tickets dokumentiert.`
          : "Entscheidung für freie Plätze dokumentiert.",
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
      setMessage("Umlauf abgebrochen; die Gruppe steht wieder vorn in ihrer Produkt-Queue.");
      setQueueReason("");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Umlaufabbruch fehlgeschlagen.");
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
      setMessage(checkedIn ? "Ticket als anwesend markiert." : "Anwesenheit zurückgenommen.");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Anwesenheitsabgleich fehlgeschlagen.");
    }
  }

  return (
    <Shell
      className={FLIGHT_LINE_ASSIST_MODE ? "flight-line-shell assist-shell" : "flight-line-shell"}
      title={FLIGHT_LINE_ASSIST_MODE ? "Flight Line Assist" : "Flight Line"}
      notifications={
        <>
          <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
          <EmergencyNotice active={board?.event.emergencyMode ?? false} />
          <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
          <OperationalNotice note={board?.event.operationalNote} />
        </>
      }
    >
      {!FLIGHT_LINE_ASSIST_MODE &&
      board?.currentDeviceRole === "FLIGHT_DIRECTOR" &&
      !board.event.emergencyMode ? (
        <details className="emergency-control">
          <summary>Not-Halt</summary>
          <div className="emergency-control-body">
            <label>
              <span id="flight-line-emergency-title">Begründung</span>
              <input
                value={emergencyReason}
                onChange={(event) => setEmergencyReason(event.target.value)}
                placeholder="Grund eingeben"
              />
            </label>
            <button
              className="danger-action"
              disabled={emergencyReason.trim().length < 3}
              onClick={triggerEmergency}
              type="button"
            >
              Not-Halt auslösen
            </button>
          </div>
        </details>
      ) : null}
      {board && FLIGHT_LINE_ASSIST_MODE ? (
        <FlightLineAssist
          aircraft={operationalAircraft}
          board={board}
          canAssignPilot={canManageAircraft}
          onAssignPilot={assignAircraftPilot}
          onClaim={async (aircraftId) => {
            await claimFlightLineAircraft(
              EVENT_ID,
              aircraftId,
              FLIGHT_LINE_DEVICE_ID,
              deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
            );
            await refresh();
          }}
          onClaimUnavailable={() => {
            setSelectedAircraftId(null);
            setSelectedId(null);
            setSelectedQueueGroupIds([]);
          }}
          onGroupAttendance={(ticketGroupId, checkedIn) =>
            void setGroupAttendance(ticketGroupId, checkedIn)
          }
          onGroupMissing={(ticketGroupId) => void updateGroupPresence(ticketGroupId, "MISSING")}
          onGroupRecall={(ticketGroupId) => void updateGroupPresence(ticketGroupId, "RECALL")}
          onGroupDefer={(ticketGroupId) => {
            const rotation = aircraftRotations?.find(
              (entry) =>
                entry.ticketGroupId === ticketGroupId ||
                entry.bookingGroups.some((group) => group.id === ticketGroupId),
            );
            if (rotation) {
              void mutateQueue(
                "DEFER_TICKET_GROUP",
                "Gruppe durch Flight Line Assist zurückgestellt",
                rotation,
              );
            }
          }}
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
          onRunRotation={(rotation) => {
            const rotationAircraft = operationalAircraft.find(
              (entry) => entry.id === selectedAircraft?.id,
            );
            void advance(rotation, rotationAircraft);
          }}
          onSetAircraftState={(aircraftId, state) => {
            const aircraftEntry = operationalAircraft.find((entry) => entry.id === aircraftId);
            void setFlightLineAircraftState(state, null, aircraftEntry);
          }}
          selectedQueueGroupIds={selectedQueueGroupIds}
          turnaroundNextState={turnaroundNextState}
          onTurnaroundNextStateChange={setTurnaroundNextState}
        />
      ) : board ? (
        <FlightLineSupervisorConsole
          aircraft={operationalAircraft}
          board={board}
          selectedQueueGroupIds={selectedQueueGroupIds}
          onAssignPilot={assignAircraftPilot}
          onConfirmAssignment={() => void advance()}
          onRunRotation={(rotation) => {
            const rotationAircraft = operationalAircraft.find(
              (entry) => entry.id === rotation.aircraftId,
            );
            void advance(rotation, rotationAircraft);
          }}
          onPauseAircraft={openAircraftPauseDialog}
          onGroupAttendance={(ticketGroupId, checkedIn) =>
            void setGroupAttendance(ticketGroupId, checkedIn)
          }
          onGroupMissing={(ticketGroupId) => void updateGroupPresence(ticketGroupId, "MISSING")}
          onGroupRecall={(ticketGroupId) => void updateGroupPresence(ticketGroupId, "RECALL")}
          onSetAircraftState={(aircraftId, state) => {
            const aircraftEntry = operationalAircraft.find((entry) => entry.id === aircraftId);
            void setFlightLineAircraftState(state, null, aircraftEntry);
          }}
          onSelectAircraft={(aircraftId) => {
            setSelectedAircraftId(aircraftId);
            setSelectedId(null);
            setSelectedQueueGroupIds([]);
            setDispositionOpen(false);
            setDetailsOpen(false);
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
                            disabled={group.status === "MISSING" || exceedsCapacity}
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
                              }
                            }}
                            type="checkbox"
                          />
                          <span>
                            <strong>
                              {group.productCode}-
                              {String(group.communicationNumber).padStart(3, "0")}
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
                          <button
                            className="danger-link-action"
                            onClick={() => void updateGroupPresence(group.id, "MISSING")}
                            type="button"
                          >
                            Nicht da
                          </button>
                          <button
                            onClick={() => void updateGroupPresence(group.id, "RECALL")}
                            type="button"
                          >
                            Nachrufen{group.recallCount > 0 ? ` (${group.recallCount})` : ""}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
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
                        board?.event.operationalInterrupted)
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
      {aircraftPauseOpen && selectedAircraft ? (
        <div className="modal-backdrop">
          <form
            aria-labelledby="aircraft-pause-title"
            aria-modal="true"
            className="confirmation-dialog aircraft-pause-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              startAircraftPause();
            }}
            role="dialog"
          >
            <div className="drawer-heading">
              <div>
                <h2 id="aircraft-pause-title">Pause für {selectedAircraft.registration}</h2>
                <p>Die Dauer verbessert nur die Wartezeitprognose.</p>
              </div>
              <button
                aria-label="Pausendialog schließen"
                onClick={() => setAircraftPauseOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <fieldset disabled={aircraftPauseUnknown}>
              <legend>Geschätzte Dauer (optional)</legend>
              <div className="pause-duration-presets">
                {[10, 20, 30].map((minutes) => (
                  <button
                    className={aircraftPauseMinutes === String(minutes) ? "selected" : ""}
                    key={minutes}
                    onClick={() => setAircraftPauseMinutes(String(minutes))}
                    type="button"
                  >
                    {minutes} Min.
                  </button>
                ))}
              </div>
              <label>
                Andere Dauer
                <input
                  min={1}
                  onChange={(event) => setAircraftPauseMinutes(event.target.value)}
                  placeholder="Minuten"
                  type="number"
                  value={aircraftPauseMinutes}
                />
              </label>
            </fieldset>
            <label className="checkbox-label">
              <input
                checked={aircraftPauseUnknown}
                onChange={(event) => setAircraftPauseUnknown(event.target.checked)}
                type="checkbox"
              />
              Dauer noch unbekannt
            </label>
            <ValidationHint>
              Das Flugzeug wird nicht automatisch freigegeben. „Wieder verfügbar“ bleibt eine
              bewusste Bestätigung der Flight Line.
            </ValidationHint>
            <div className="dialog-actions">
              <button onClick={() => setAircraftPauseOpen(false)} type="button">
                Abbrechen
              </button>
              <button
                className="pause-primary-action"
                disabled={
                  !aircraftPauseUnknown &&
                  (!Number.isFinite(Number(aircraftPauseMinutes)) ||
                    Number(aircraftPauseMinutes) < 1)
                }
                type="submit"
              >
                Pause starten
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </Shell>
  );
}
