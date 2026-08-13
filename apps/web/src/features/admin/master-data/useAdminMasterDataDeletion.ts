import type { OperationBoard } from "@rundflug/contracts";
import { useState } from "react";
import { sendCommand } from "../../../api";
import {
  MASTER_DATA_DELETE_REASON,
  type MasterDataDeleteTarget,
} from "../../../operation-workspace";
import { useAdminOperationIdentity } from "../../operations/operation-identity";

type MasterDataEntityType = MasterDataDeleteTarget["entityType"];

interface UseAdminMasterDataDeletionOptions {
  adminModeUnlocked: boolean;
  board: OperationBoard | null | undefined;
  getAdminPin: () => string;
  onClearAdminPin: () => void;
  onEditorOpenChange: (open: boolean) => void;
  onFinishEditor: () => void;
  onMessage: (message: string) => void;
  onRefreshBoard: () => Promise<unknown>;
  onRefreshHistory: () => Promise<unknown>;
}

function countBlocker(count: number, label: string): string[] {
  return count > 0 ? [`${count} ${label}`] : [];
}

export function getMasterDataDeletionBlockers(
  board: OperationBoard | null | undefined,
  entityType: MasterDataEntityType,
  entityId: string,
): string[] {
  if (!board) return ["Der bestätigte Betriebsstand wird noch geladen"];
  switch (entityType) {
    case "GATE":
      return [
        ...countBlocker(
          board.resourceGroups.filter((group) => group.gateId === entityId).length,
          "Ressourcengruppe(n)",
        ),
        ...countBlocker(
          board.products.filter((product) => product.gateId === entityId).length,
          "Produkt(e)",
        ),
        ...countBlocker(
          board.rotations.filter((rotation) => rotation.gateId === entityId).length,
          "Umlauf/Umläufe",
        ),
      ];
    case "RESOURCE_GROUP":
      return [
        ...countBlocker(
          board.products.filter((product) => product.resourceGroupId === entityId).length,
          "Produkt(e)",
        ),
        ...countBlocker(
          board.aircraft.filter((aircraft) => aircraft.resourceGroupId === entityId).length,
          "Flugzeugzuordnung(en)",
        ),
      ];
    case "PRODUCT": {
      const code = board.products.find((product) => product.id === entityId)?.code;
      return countBlocker(
        board.rotations.filter((rotation) => rotation.productCode === code).length,
        "Umlauf/Umläufe",
      );
    }
    case "AIRCRAFT": {
      const assigned = board.aircraft.some(
        (entry) => entry.id === entityId && Boolean(entry.resourceGroupId),
      );
      return [
        ...countBlocker(assigned ? 1 : 0, "Flugzeugzuordnung"),
        ...countBlocker(
          board.rotations.filter((rotation) => rotation.aircraftId === entityId).length,
          "Umlauf/Umläufe",
        ),
      ];
    }
    case "PILOT": {
      const active = board.pilots.some(
        (entry) => entry.id === entityId && Boolean(entry.currentRotationId),
      );
      return [
        ...countBlocker(active ? 1 : 0, "aktiver Umlauf"),
        ...countBlocker(
          board.aircraft.filter((entry) => entry.currentPilotId === entityId).length,
          "Flugzeugbindung(en)",
        ),
      ];
    }
    default:
      return countBlocker(
        board.rotations.filter((rotation) => rotation.aircraftId === entityId).length,
        "Umlauf/Umläufe",
      );
  }
}

export function useAdminMasterDataDeletion({
  adminModeUnlocked,
  board,
  getAdminPin,
  onClearAdminPin,
  onEditorOpenChange,
  onFinishEditor,
  onMessage,
  onRefreshBoard,
  onRefreshHistory,
}: UseAdminMasterDataDeletionOptions) {
  const {
    eventId: EVENT_ID,
    deviceId: ADMIN_DEVICE_ID,
    deviceToken: ADMIN_DEVICE_TOKEN,
  } = useAdminOperationIdentity();
  const [pendingDeletion, setPendingDeletion] = useState<MasterDataDeleteTarget | null>(null);

  function requestDeletion(entityType: MasterDataEntityType, entityId: string, label: string) {
    if (!adminModeUnlocked) onClearAdminPin();
    setPendingDeletion({
      entityType,
      entityId,
      label,
      blockers: getMasterDataDeletionBlockers(board, entityType, entityId),
    });
    onEditorOpenChange(false);
  }

  function cancelDeletion() {
    setPendingDeletion(null);
    onEditorOpenChange(true);
  }

  async function confirmDeletion() {
    const adminPin = getAdminPin();
    if (
      !board ||
      !pendingDeletion ||
      pendingDeletion.blockers.length > 0 ||
      board.event.status !== "PREPARATION" ||
      adminPin.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "DELETE_MASTER_DATA",
          payload: {
            entityType: pendingDeletion.entityType,
            entityId: pendingDeletion.entityId,
            reason: MASTER_DATA_DELETE_REASON,
            adminPin,
          },
        },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage(`${pendingDeletion.label} wurde gelöscht und die Löschung protokolliert.`);
      setPendingDeletion(null);
      onFinishEditor();
      if (!adminModeUnlocked) onClearAdminPin();
      await onRefreshBoard();
      await onRefreshHistory();
    } catch (cause) {
      onMessage(
        cause instanceof Error ? cause.message : "Stammdatensatz konnte nicht gelöscht werden.",
      );
    }
  }

  return {
    cancelDeletion,
    confirmDeletion,
    pendingDeletion,
    requestDeletion,
  };
}
