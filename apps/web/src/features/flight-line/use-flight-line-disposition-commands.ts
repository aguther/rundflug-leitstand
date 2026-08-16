import type { CommandEnvelope, OperationBoard } from "@rundflug/contracts";
import type { Dispatch, SetStateAction } from "react";
import { sendCommand } from "../../api";

type Rotation = OperationBoard["rotations"][number];
type TechnicalAbort = {
  aircraftId: string;
  aircraftVersion: number;
  rotationId: string;
  rotationVersion: number;
};

interface DispositionOptions {
  board: OperationBoard | null | undefined;
  deviceId: string;
  deviceToken: string;
  dispositionCapacity: number;
  eventId: string;
  noShowReady: boolean;
  queueReason: string;
  refresh: () => Promise<unknown>;
  selected: Rotation | null | undefined;
  setDispositionOpen: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setMoveReason: Dispatch<SetStateAction<string>>;
  setQueueReason: Dispatch<SetStateAction<string>>;
  setSelectedGroupIds: Dispatch<SetStateAction<string[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setTechnicalAbort: Dispatch<SetStateAction<TechnicalAbort | null>>;
  setTechnicalAbortReason: Dispatch<SetStateAction<string>>;
  technicalAbort: TechnicalAbort | null;
  technicalAbortReason: string;
}

export function useFlightLineDispositionCommands(options: DispositionOptions) {
  const {
    board,
    deviceId,
    deviceToken,
    dispositionCapacity,
    eventId,
    noShowReady,
    queueReason,
    refresh,
    selected,
    setDispositionOpen,
    setMessage,
    setMoveReason,
    setQueueReason,
    setSelectedGroupIds,
    setSelectedId,
    setTechnicalAbort,
    setTechnicalAbortReason,
    technicalAbort,
    technicalAbortReason,
  } = options;
  const baseCommand = () => ({
    commandId: crypto.randomUUID(),
    eventId,
    deviceId,
    expectedVersion: board?.event.version ?? 0,
    issuedAt: new Date().toISOString(),
  });
  async function execute(command: CommandEnvelope, failure: string, afterSend?: () => void) {
    try {
      await sendCommand(command, deviceToken);
      afterSend?.();
      await refresh();
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : failure);
      return false;
    }
  }

  async function mutateQueue(
    type: "DEFER_TICKET_GROUP" | "MARK_NO_SHOW",
    reasonOverride?: string,
    targetRotation = selected,
    targetTicketGroupId?: string,
  ) {
    const reason = reasonOverride ?? queueReason.trim();
    if (!board || !targetRotation || reason.length < 3) return;
    await execute(
      {
        ...baseCommand(),
        type,
        payload: { ticketGroupId: targetTicketGroupId ?? targetRotation.ticketGroupId, reason },
      },
      "Queue-Aktion fehlgeschlagen.",
      () => {
        setQueueReason("");
        setSelectedId(null);
      },
    );
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
    if (!board || selected?.status !== "DRAFT") return;
    await execute(
      {
        ...baseCommand(),
        type: "SET_ROTATION_CAPACITY",
        payload: {
          rotationId: selected.id,
          usableCapacity: dispositionCapacity,
          reason: "Nutzbare Kapazität vor dem Aufruf organisatorisch angepasst",
        },
      },
      "Kapazitätsänderung fehlgeschlagen.",
    );
  }

  async function moveTicketGroup(ticketGroupId: string, targetRotationId: string, reason: string) {
    if (!board || reason.trim().length < 3) return;
    await execute(
      {
        ...baseCommand(),
        type: "MOVE_TICKET_GROUP",
        payload: { ticketGroupId, targetRotationId, reason: reason.trim() },
      },
      "Verschiebung fehlgeschlagen.",
      () => setMoveReason(""),
    );
  }

  async function markTicketNoShow(ticketId: string) {
    if (!board || !selected || !noShowReady) return;
    await execute(
      {
        ...baseCommand(),
        type: "MARK_TICKET_NO_SHOW",
        payload: { ticketId, reason: "Nach Ablauf der No-Show-Frist nicht anwesend" },
      },
      "No-Show konnte nicht gesetzt werden.",
    );
  }

  async function confirmAttendanceDecision(decision: "FLY_WITH_PRESENT" | "LEAVE_SEAT_EMPTY") {
    if (!board || !selected) return;
    await execute(
      {
        ...baseCommand(),
        type: "CONFIRM_ATTENDANCE_DECISION",
        payload: { rotationId: selected.id, decision },
      },
      "Entscheidung nicht gespeichert.",
      () => setDispositionOpen(false),
    );
  }

  async function revokeCall() {
    if (!board || selected?.status !== "CALLED") return;
    await execute(
      {
        ...baseCommand(),
        type: "REVOKE_CALL",
        payload: { rotationId: selected.id },
      },
      "Rücknahme fehlgeschlagen.",
      () =>
        setMessage(
          "Der bestätigte Boarding-Aufruf wurde durch ein Korrekturereignis zurückgenommen.",
        ),
    );
  }

  async function abortRotation() {
    if (!board || selected?.status !== "CALLED" || queueReason.trim().length < 3) return;
    await execute(
      {
        ...baseCommand(),
        type: "ABORT_ROTATION",
        payload: { rotationId: selected.id, reason: queueReason.trim() },
      },
      "Umlaufabbruch fehlgeschlagen.",
      () => setQueueReason(""),
    );
  }

  async function abortTechnicalRotation() {
    if (!board || !technicalAbort || technicalAbortReason.trim().length < 3) return;
    await execute(
      {
        ...baseCommand(),
        type: "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE",
        payload: {
          rotationId: technicalAbort.rotationId,
          expectedRotationVersion: technicalAbort.rotationVersion,
          expectedAircraftVersion: technicalAbort.aircraftVersion,
          reason: technicalAbortReason.trim(),
        },
      },
      "Technischer Umlaufabbruch fehlgeschlagen.",
      () => {
        setTechnicalAbort(null);
        setTechnicalAbortReason("");
        setSelectedGroupIds([]);
      },
    );
  }

  async function setAttendance(ticketId: string, checkedIn: boolean) {
    if (!board || !selected || !["DRAFT", "CALLED"].includes(selected.status)) return;
    await execute(
      {
        ...baseCommand(),
        type: "SET_TICKET_ATTENDANCE",
        payload: { ticketId, checkedIn },
      },
      "Anwesenheitsabgleich fehlgeschlagen.",
    );
  }

  return {
    abortRotation,
    abortTechnicalRotation,
    confirmAttendanceDecision,
    deferTicketGroup,
    markTicketNoShow,
    moveTicketGroup,
    mutateQueue,
    revokeCall,
    setAttendance,
    setRotationCapacity,
  };
}
