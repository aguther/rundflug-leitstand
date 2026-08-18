import type { CommandResult, OperationBoard } from "@rundflug/contracts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ApiCommandError, sendCommand } from "../../api";
import type { DispatchRecommendationLeaseController } from "../../dispatch-recommendation-lease";
import {
  callNextRecommendationPayload,
  rotationTicketGroupIds,
} from "./FlightLineViewPresentation";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];
type TurnaroundNextState = "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE";

interface RotationCommandOptions {
  board: OperationBoard | null | undefined;
  busyRotationIdsRef: RefObject<Set<string>>;
  callDeviationReason: string;
  confirmEvent: (event: CommandResult["event"]) => void;
  deviceId: string;
  deviceToken: string;
  dispatchLease: DispatchRecommendationLeaseController;
  eventId: string;
  refresh: (version?: number, force?: boolean) => Promise<unknown>;
  selectedAircraft: Aircraft | null | undefined;
  selectedGroupIds: string[];
  selectedRotation: Rotation | null | undefined;
  setBusyRotationIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  turnaroundNextState: TurnaroundNextState;
}

const actionForState = {
  DRAFT: { command: "CALL_NEXT" },
  CALLED: { command: "MARK_OFF_BLOCK" },
  IN_FLIGHT: { command: "MARK_ON_BLOCK" },
  LANDED: { command: "COMPLETE_TURNAROUND" },
  COMPLETED: null,
} as const;

export function useFlightLineRotationCommands(options: RotationCommandOptions) {
  const {
    board,
    busyRotationIdsRef,
    callDeviationReason,
    confirmEvent,
    deviceId,
    deviceToken,
    dispatchLease,
    eventId,
    refresh,
    selectedAircraft,
    selectedGroupIds,
    selectedRotation,
    setBusyRotationIds,
    setMessage,
    turnaroundNextState,
  } = options;

  async function recoverAdvanceError(reason: unknown) {
    setMessage(reason instanceof Error ? reason.message : "Aktion fehlgeschlagen.");
    if (!(reason instanceof ApiCommandError)) return;
    if (reason.code === "STALE_VERSION") {
      await refresh(reason.currentVersion ?? 0, true);
      setMessage(
        "Der Betriebsstand wurde aktualisiert. Die reservierte Auswahl bleibt bestehen und kann erneut bestätigt werden.",
      );
      return;
    }
    if (
      [
        "DISPATCH_PLAN_STALE",
        "DISPATCH_RECOMMENDATION_LEASE_EXPIRED",
        "DISPATCH_RECOMMENDATION_LEASE_CONFLICT",
        "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
      ].includes(reason.code)
    ) {
      await refresh(reason.currentVersion ?? 0, true);
      dispatchLease.markInvalidated(reason.message);
    }
  }

  async function advance(
    rotationOverride: Rotation | undefined = selectedRotation ?? undefined,
    aircraftOverride: Aircraft | undefined = selectedAircraft ?? undefined,
    nextAircraftState: TurnaroundNextState = turnaroundNextState,
    queueDeviationReasonOverride?: string,
  ): Promise<boolean> {
    const action = rotationOverride ? actionForState[rotationOverride.status] : null;
    if (
      !board ||
      !rotationOverride ||
      !action ||
      busyRotationIdsRef.current.has(rotationOverride.id)
    )
      return false;
    busyRotationIdsRef.current.add(rotationOverride.id);
    setBusyRotationIds(new Set(busyRotationIdsRef.current));
    try {
      const commandBase = {
        commandId: crypto.randomUUID(),
        eventId,
        deviceId,
        expectedVersion: board.event.version,
        observedEventVersion: board.event.version,
        issuedAt: new Date().toISOString(),
      };
      let result: CommandResult;
      if (action.command === "CALL_NEXT") {
        const assignedPilotId = aircraftOverride?.currentPilotId;
        if (!aircraftOverride?.id || !assignedPilotId) {
          throw new Error(
            "Vor Belegung bitte über „Pilot zuweisen“ einen Pilotencode am Flugzeug hinterlegen.",
          );
        }
        const ticketGroupIds = rotationTicketGroupIds(selectedGroupIds, rotationOverride);
        const recommendationPayload = callNextRecommendationPayload(dispatchLease, ticketGroupIds);
        result = await sendCommand(
          {
            ...commandBase,
            type: "CALL_NEXT",
            payload: {
              ticketGroupIds,
              aircraftId: aircraftOverride.id,
              pilotId: assignedPilotId,
              dispatchRecommendation: recommendationPayload?.recommendation,
              dispatchRecommendationLeaseId: recommendationPayload?.leaseId,
              queueDeviationReason:
                (queueDeviationReasonOverride ?? callDeviationReason.trim()) || undefined,
            },
          },
          deviceToken,
        );
      } else {
        const preconditions = [
          {
            aggregateType: "ROTATION" as const,
            aggregateId: rotationOverride.id,
            expectedVersion: rotationOverride.version,
          },
        ];
        result = await sendCommand(
          action.command === "COMPLETE_TURNAROUND"
            ? {
                ...commandBase,
                preconditions,
                type: "COMPLETE_TURNAROUND",
                payload: { rotationId: rotationOverride.id, nextAircraftState },
              }
            : {
                ...commandBase,
                preconditions,
                type: action.command,
                payload: { rotationId: rotationOverride.id },
              },
          deviceToken,
        );
      }
      confirmEvent(result.event);
      if (action.command === "CALL_NEXT") dispatchLease.consume();
      await refresh(result.event.version);
      return true;
    } catch (reason) {
      await recoverAdvanceError(reason);
      return false;
    } finally {
      busyRotationIdsRef.current.delete(rotationOverride.id);
      setBusyRotationIds(new Set(busyRotationIdsRef.current));
    }
  }

  async function setGroupAttendance(ticketGroupId: string, checkedIn: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId,
          deviceId,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_TICKET_GROUP_ATTENDANCE",
          payload: { ticketGroupId, checkedIn },
        },
        deviceToken,
      );
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Anwesenheit konnte nicht geändert werden.",
      );
    }
  }

  async function updateGroupPresence(ticketGroupId: string, presenceAction: "MISSING" | "RESTORE") {
    if (!board) return;
    const reason =
      presenceAction === "MISSING"
        ? (window.prompt("Kurzer Grund für „Nicht da“:")?.trim() ?? "")
        : "";
    if (presenceAction === "MISSING" && reason.length < 3) return;
    try {
      await sendCommand(
        presenceAction === "MISSING"
          ? {
              commandId: crypto.randomUUID(),
              eventId,
              deviceId,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "MARK_TICKET_GROUP_MISSING",
              payload: { ticketGroupId, reason },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId,
              deviceId,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "RESTORE_TICKET_GROUP_TO_QUEUE",
              payload: { ticketGroupId },
            },
        deviceToken,
      );
      await refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Gruppenstatus konnte nicht geändert werden.",
      );
    }
  }

  async function mutateRecall(ticketGroupId: string, recallId?: string) {
    if (!board) return;
    const group = board.queueGroups.find((entry) => entry.id === ticketGroupId);
    if (
      recallId
        ? group?.activeRecall?.id !== recallId
        : !group || group.activeRecall || !["QUEUED", "MISSING"].includes(group.status)
    )
      return;
    try {
      const result = await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId,
          deviceId,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          ...(recallId
            ? { type: "CLEAR_TICKET_GROUP_RECALL" as const, payload: { ticketGroupId, recallId } }
            : { type: "START_TICKET_GROUP_RECALL" as const, payload: { ticketGroupId } }),
        },
        deviceToken,
      );
      confirmEvent(result.event);
      await refresh(result.event.version);
    } catch (reason) {
      const fallbackMessage = recallId
        ? "Nachruf konnte nicht beendet werden."
        : "Nachruf konnte nicht gestartet werden.";
      setMessage(reason instanceof Error ? reason.message : fallbackMessage);
    }
  }

  return {
    advance,
    clearTicketGroupRecall: (ticketGroupId: string, recallId: string) =>
      mutateRecall(ticketGroupId, recallId),
    setGroupAttendance,
    startTicketGroupRecall: (ticketGroupId: string) => mutateRecall(ticketGroupId),
    updateGroupPresence,
  };
}
