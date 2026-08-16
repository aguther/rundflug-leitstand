import type { OperationBoard } from "@rundflug/contracts";
import type { Dispatch, SetStateAction } from "react";
import { sendCommand } from "../../api";

const AUDIT_REASON = "Operative Entscheidung Flight Director";
type OperationsSection = "operations" | "plan" | "resources";

interface FlightDirectorOperationsOptions {
  board: OperationBoard | null | undefined;
  canManageAircraft: boolean;
  deviceId: string;
  deviceToken: string;
  eventId: string;
  refresh: () => Promise<unknown>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setOperationsBusy: Dispatch<SetStateAction<boolean>>;
  setOperationsSection: Dispatch<SetStateAction<OperationsSection | null>>;
}

export function useFlightDirectorOperations(options: FlightDirectorOperationsOptions) {
  const {
    board,
    canManageAircraft,
    deviceId,
    deviceToken,
    eventId,
    refresh,
    setMessage,
    setOperationsBusy,
    setOperationsSection,
  } = options;
  const baseCommand = () => ({
    commandId: crypto.randomUUID(),
    eventId,
    deviceId,
    expectedVersion: board?.event.version ?? 0,
    issuedAt: new Date().toISOString(),
  });

  async function runBusyCommand(
    command: Parameters<typeof sendCommand>[0],
    success: string,
    failure: string,
  ) {
    setOperationsBusy(true);
    try {
      await sendCommand(command, deviceToken);
      setMessage(success);
      await refresh();
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : failure);
      return false;
    } finally {
      setOperationsBusy(false);
    }
  }

  async function triggerEmergency() {
    if (!board) return;
    try {
      await sendCommand(
        { ...baseCommand(), type: "TRIGGER_EMERGENCY", payload: { reason: AUDIT_REASON } },
        deviceToken,
      );
      setMessage("Notfallmodus ausgelöst.");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Notfallkommando fehlgeschlagen.");
    }
  }

  function openOperationsDialog(section: OperationsSection) {
    if (board && canManageAircraft) setOperationsSection(section);
  }

  async function setEventNotice(note: string): Promise<boolean> {
    if (!board) return false;
    return runBusyCommand(
      { ...baseCommand(), type: "SET_OPERATIONAL_NOTE", payload: { note: note.trim() } },
      note.trim()
        ? "Veranstaltungsweiter Betriebshinweis veröffentlicht."
        : "Veranstaltungsweiter Betriebshinweis gelöscht.",
      "Betriebshinweis fehlgeschlagen.",
    );
  }

  async function setResourceNoticeCommand(resourceGroupId: string, note: string): Promise<boolean> {
    if (!board || !resourceGroupId) return false;
    return runBusyCommand(
      {
        ...baseCommand(),
        type: "SET_RESOURCE_GROUP_NOTICE",
        payload: { resourceGroupId, note: note.trim() },
      },
      note.trim()
        ? "Hinweis der Ressourcengruppe veröffentlicht."
        : "Hinweis der Ressourcengruppe gelöscht.",
      "Gruppenhinweis fehlgeschlagen.",
    );
  }

  async function setEventInterruption(
    interrupted: boolean,
    plannedOperationId?: string,
    expectedReviewAt: string | null = null,
  ) {
    if (!board) return;
    await runBusyCommand(
      {
        ...baseCommand(),
        type: "SET_EVENT_INTERRUPTION",
        payload: {
          interrupted,
          reason: AUDIT_REASON,
          expectedReviewAt,
          ...(plannedOperationId ? { plannedOperationId } : {}),
        },
      },
      interrupted ? "Betrieb unterbrochen." : "Betrieb fortgesetzt.",
      "Betriebsstatus konnte nicht geändert werden.",
    );
  }

  async function setResourceGroupStatus(
    resourceGroupId: string,
    status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED",
    plannedOperationId?: string,
    expectedReviewAt: string | null = null,
  ) {
    if (!board) return;
    await runBusyCommand(
      {
        ...baseCommand(),
        type: "SET_RESOURCE_GROUP_STATUS",
        payload: {
          resourceGroupId,
          status,
          reason: AUDIT_REASON,
          expectedReviewAt,
          ...(plannedOperationId ? { plannedOperationId } : {}),
        },
      },
      `Ressourcengruppe auf ${status} gesetzt.`,
      "Statusänderung fehlgeschlagen.",
    );
  }

  return {
    openOperationsDialog,
    setEventInterruption,
    setEventNotice,
    setResourceGroupStatus,
    setResourceNoticeCommand,
    triggerEmergency,
  };
}
