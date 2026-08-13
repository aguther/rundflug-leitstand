import { useCallback, useRef, useState } from "react";
import { hasMasterEditorChanges } from "../../../admin-master-editor-state";
import type { MasterDataCategory } from "../../../admin-ux";
import { masterEditorForCategory } from "./master-editor-category";

interface MasterEditorAdapter {
  select: (id: string) => string;
  snapshot: string;
}

interface MasterEditorAdapters {
  aircraft: MasterEditorAdapter;
  gates: MasterEditorAdapter;
  pilots: MasterEditorAdapter;
  products: MasterEditorAdapter;
  resourceGroups: MasterEditorAdapter;
}

interface UseAdminMasterEditorStateOptions {
  category: MasterDataCategory;
  editors: MasterEditorAdapters;
}

export function useAdminMasterEditorState({ category, editors }: UseAdminMasterEditorStateOptions) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"general" | "details">("general");
  const [discardChangesOpen, setDiscardChangesOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const initialSnapshotRef = useRef<string | null>(null);
  const currentEditor = masterEditorForCategory(category, editors);
  const dirty = open && hasMasterEditorChanges(initialSnapshotRef.current, currentEditor.snapshot);

  function select(editor: MasterEditorAdapter, id: string, resetTab: boolean) {
    initialSnapshotRef.current = editor.select(id);
    setSubmitAttempted(false);
    if (resetTab) setTab("general");
    setOpen(true);
  }

  function selectAircraft(id: string) {
    select(editors.aircraft, id, false);
  }

  function selectGate(id: string) {
    select(editors.gates, id, true);
  }

  function selectPilot(id: string) {
    select(editors.pilots, id, false);
  }

  function selectProduct(id: string) {
    select(editors.products, id, true);
  }

  function selectResourceGroup(id: string) {
    select(editors.resourceGroups, id, false);
  }

  function startNewEntry() {
    if (category === "gates") selectGate("new");
    if (category === "resource-groups") selectResourceGroup("new");
    if (category === "aircraft" || category === "assignments") selectAircraft("new");
    if (category === "pilots") selectPilot("new");
    if (category === "products") selectProduct("new");
  }

  const finish = useCallback(() => {
    initialSnapshotRef.current = null;
    setDiscardChangesOpen(false);
    setSubmitAttempted(false);
    setOpen(false);
  }, []);

  function requestClose() {
    if (dirty) {
      setOpen(false);
      setDiscardChangesOpen(true);
      return;
    }
    finish();
  }

  function continueEditing() {
    setDiscardChangesOpen(false);
    setOpen(true);
  }

  return {
    continueEditing,
    dirty,
    discardChanges: finish,
    discardChangesOpen,
    finish,
    open,
    requestClose,
    resetForStepChange: finish,
    selectAircraft,
    selectGate,
    selectPilot,
    selectProduct,
    selectResourceGroup,
    setOpen,
    setSubmitAttempted,
    setTab,
    startNewEntry,
    submitAttempted,
    tab,
  };
}
