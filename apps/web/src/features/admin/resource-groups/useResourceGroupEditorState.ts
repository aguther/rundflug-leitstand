import type { OperationBoard } from "@rundflug/contracts";
import { useCallback, useState } from "react";
import { createMasterEditorSnapshot } from "../../../admin-master-editor-state";

type ResourceGroup = OperationBoard["resourceGroups"][number];

export interface ResourceGroupEditorDraft {
  automaticPrecall: boolean;
  editorId: string;
  gateId: string;
  name: string;
  shortCode: string;
}

function snapshotForResourceGroup(draft: ResourceGroupEditorDraft): string {
  return createMasterEditorSnapshot([
    "resource-groups",
    draft.name,
    draft.shortCode,
    draft.gateId,
    draft.automaticPrecall,
  ]);
}

export function useResourceGroupEditorState(board: OperationBoard | null | undefined) {
  const [editorId, setEditorId] = useState("new");
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [gateId, setGateId] = useState("");
  const [automaticPrecall, setAutomaticPrecall] = useState(true);

  const draft: ResourceGroupEditorDraft = {
    automaticPrecall,
    editorId,
    gateId,
    name,
    shortCode,
  };
  const currentGroup: ResourceGroup | undefined = board?.resourceGroups.find(
    (group) => group.id === editorId,
  );
  const snapshot = snapshotForResourceGroup(draft);

  const select = useCallback(
    (id: string): string => {
      const entry = board?.resourceGroups.find((group) => group.id === id);
      const nextDraft: ResourceGroupEditorDraft = {
        automaticPrecall: entry?.automaticPrecallEnabled ?? true,
        editorId: id,
        gateId: entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "",
        name: entry?.name ?? "",
        shortCode: entry?.shortCode ?? "",
      };
      setEditorId(nextDraft.editorId);
      setName(nextDraft.name);
      setShortCode(nextDraft.shortCode);
      setGateId(nextDraft.gateId);
      setAutomaticPrecall(nextDraft.automaticPrecall);
      return snapshotForResourceGroup(nextDraft);
    },
    [board],
  );

  const updateShortCode = useCallback((value: string) => {
    setShortCode(value.toUpperCase().replace(/[^A-Z0-9-]/g, ""));
  }, []);

  return {
    ...draft,
    currentGroup,
    select,
    setAutomaticPrecall,
    setGateId,
    setName,
    setShortCode: updateShortCode,
    snapshot,
  };
}
