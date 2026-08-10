import type { OperationBoard } from "@rundflug/contracts";
import { useState } from "react";
import { sendCommand } from "../../../api";
import {
  ADMIN_DEVICE_ID,
  deviceTokenFor,
  EVENT_ID,
  MASTER_DATA_DELETE_REASON,
  type MasterDataDeleteTarget,
} from "../../../operation-workspace";

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

export function getMasterDataDeletionBlockers(
  board: OperationBoard | null | undefined,
  entityType: MasterDataEntityType,
  entityId: string,
): string[] {
  if (!board) return ["Der bestätigte Betriebsstand wird noch geladen"];
  if (entityType === "GATE") {
    const groups = board.resourceGroups.filter((group) => group.gateId === entityId).length;
    const products = board.products.filter((product) => product.gateId === entityId).length;
    const rotations = board.rotations.filter((rotation) => rotation.gateId === entityId).length;
    return [
      ...(groups ? [`${groups} Ressourcengruppe(n)`] : []),
      ...(products ? [`${products} Produkt(e)`] : []),
      ...(rotations ? [`${rotations} Umlauf/Umläufe`] : []),
    ];
  }
  if (entityType === "RESOURCE_GROUP") {
    const products = board.products.filter(
      (product) => product.resourceGroupId === entityId,
    ).length;
    const assignments = board.aircraft.filter(
      (aircraft) => aircraft.resourceGroupId === entityId,
    ).length;
    return [
      ...(products ? [`${products} Produkt(e)`] : []),
      ...(assignments ? [`${assignments} Flugzeugzuordnung(en)`] : []),
    ];
  }
  if (entityType === "PRODUCT") {
    const code = board.products.find((product) => product.id === entityId)?.code;
    const rotations = board.rotations.filter((rotation) => rotation.productCode === code).length;
    return rotations ? [`${rotations} Umlauf/Umläufe`] : [];
  }
  if (entityType === "AIRCRAFT") {
    const aircraft = board.aircraft.find((entry) => entry.id === entityId);
    const rotations = board.rotations.filter((rotation) => rotation.aircraftId === entityId).length;
    return [
      ...(aircraft?.resourceGroupId ? ["1 Flugzeugzuordnung"] : []),
      ...(rotations ? [`${rotations} Umlauf/Umläufe`] : []),
    ];
  }
  if (entityType === "PILOT") {
    const pilot = board.pilots.find((entry) => entry.id === entityId);
    const aircraft = board.aircraft.filter((entry) => entry.currentPilotId === entityId).length;
    return [
      ...(pilot?.currentRotationId ? ["1 aktiver Umlauf"] : []),
      ...(aircraft ? [`${aircraft} Flugzeugbindung(en)`] : []),
    ];
  }
  const rotations = board.rotations.filter((rotation) => rotation.aircraftId === entityId).length;
  return rotations ? [`${rotations} Umlauf/Umläufe`] : [];
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
        deviceTokenFor(ADMIN_DEVICE_ID),
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
