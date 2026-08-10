import type { OperationBoard } from "@rundflug/contracts";
import { useCallback, useState } from "react";
import { createMasterEditorSnapshot } from "../../../admin-master-editor-state";

type Gate = OperationBoard["gates"][number];
type GateType = Gate["gateType"];
type RotationStatus = Gate["displayFilter"]["rotationStatuses"][number];

export interface GateEditorDraft {
  active: boolean;
  displayProductIds: string[];
  displayRotationStatuses: RotationStatus[];
  editorId: string;
  gateType: GateType;
  label: string;
  sortOrder: number;
  travelLeadMinutes: number;
}

function snapshotForGate(draft: GateEditorDraft): string {
  return createMasterEditorSnapshot([
    "gates",
    draft.label,
    draft.gateType,
    draft.active,
    draft.sortOrder,
    draft.travelLeadMinutes,
    draft.displayProductIds,
    draft.displayRotationStatuses,
  ]);
}

export function useGateEditorState(gates: OperationBoard["gates"] | undefined) {
  const [editorId, setEditorId] = useState("new");
  const [label, setLabel] = useState("");
  const [gateType, setGateType] = useState<GateType>("FLIGHT_LINE");
  const [active, setActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(10);
  const [travelLeadMinutes, setTravelLeadMinutes] = useState(0);
  const [displayProductIds, setDisplayProductIds] = useState<string[]>([]);
  const [displayRotationStatuses, setDisplayRotationStatuses] = useState<RotationStatus[]>([]);

  const draft: GateEditorDraft = {
    active,
    displayProductIds,
    displayRotationStatuses,
    editorId,
    gateType,
    label,
    sortOrder,
    travelLeadMinutes,
  };
  const displayFilter = {
    productIds: displayProductIds,
    rotationStatuses: displayRotationStatuses,
  };
  const snapshot = snapshotForGate(draft);

  const select = useCallback(
    (id: string): string => {
      const entry = gates?.find((gate) => gate.id === id);
      const nextDraft: GateEditorDraft = {
        active: entry?.active ?? true,
        displayProductIds: entry?.displayFilter.productIds ?? [],
        displayRotationStatuses: entry?.displayFilter.rotationStatuses ?? [],
        editorId: id,
        gateType: entry?.gateType ?? "FLIGHT_LINE",
        label: entry?.label ?? "",
        sortOrder: entry?.sortOrder ?? 10,
        travelLeadMinutes: entry?.travelLeadMinutes ?? 0,
      };
      setEditorId(nextDraft.editorId);
      setLabel(nextDraft.label);
      setGateType(nextDraft.gateType);
      setActive(nextDraft.active);
      setSortOrder(nextDraft.sortOrder);
      setTravelLeadMinutes(nextDraft.travelLeadMinutes);
      setDisplayProductIds(nextDraft.displayProductIds);
      setDisplayRotationStatuses(nextDraft.displayRotationStatuses);
      return snapshotForGate(nextDraft);
    },
    [gates],
  );

  const resetAfterSave = useCallback(() => {
    setEditorId("new");
    setLabel("");
    setTravelLeadMinutes(0);
  }, []);

  return {
    ...draft,
    displayFilter,
    resetAfterSave,
    select,
    setActive,
    setDisplayProductIds,
    setDisplayRotationStatuses,
    setGateType,
    setLabel,
    setSortOrder,
    setTravelLeadMinutes,
    snapshot,
  };
}
