import type { OperationBoard } from "@rundflug/contracts";
import type { MasterDataDeleteTarget } from "../../../operation-workspace";

type MasterDataEntityType = MasterDataDeleteTarget["entityType"];

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
