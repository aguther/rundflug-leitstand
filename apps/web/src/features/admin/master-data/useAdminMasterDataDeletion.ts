import type { OperationBoard } from "@rundflug/contracts";
import { useState } from "react";
import { sendCommand } from "../../../api";
import {
  MASTER_DATA_DELETE_REASON,
  type MasterDataDeleteTarget,
} from "../../../operation-workspace";
import { useAdminOperationIdentity } from "../../operations/operation-identity";
import { getMasterDataDeletionBlockers } from "./master-data-deletion-blockers";

export { getMasterDataDeletionBlockers } from "./master-data-deletion-blockers";

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
