import type { OperationBoard } from "@rundflug/contracts";
import { useCallback, useState } from "react";
import { createMasterEditorSnapshot } from "../../../admin-master-editor-state";

type Pilot = OperationBoard["pilots"][number];

export interface PilotEditorDraft {
  code: string;
  editorId: string;
  note: string;
}

function snapshotForPilot(draft: PilotEditorDraft): string {
  return createMasterEditorSnapshot(["pilots", draft.code, draft.note]);
}

export function usePilotEditorState(pilots: OperationBoard["pilots"] | undefined) {
  const [editorId, setEditorId] = useState("new");
  const [code, setCode] = useState("P-01");
  const [note, setNote] = useState("");

  const draft: PilotEditorDraft = { code, editorId, note };
  const currentPilot: Pilot | undefined = pilots?.find((pilot) => pilot.id === editorId);
  const snapshot = snapshotForPilot(draft);

  const select = useCallback(
    (id: string): string => {
      const entry = pilots?.find((pilot) => pilot.id === id);
      const nextDraft: PilotEditorDraft = {
        code: entry?.operationalCode ?? "P-01",
        editorId: id,
        note: entry?.operationalNote ?? "",
      };
      setEditorId(nextDraft.editorId);
      setCode(nextDraft.code);
      setNote(nextDraft.note);
      return snapshotForPilot(nextDraft);
    },
    [pilots],
  );

  const resetAfterSave = useCallback(() => {
    setEditorId("new");
    setCode("P-01");
    setNote("");
  }, []);

  const updateCode = useCallback((value: string) => {
    setCode(value.toUpperCase());
  }, []);

  return {
    ...draft,
    currentPilot,
    resetAfterSave,
    select,
    setCode: updateCode,
    setNote,
    snapshot,
  };
}
