import type { OperationBoard } from "@rundflug/contracts";
import type { ReactNode } from "react";
import type { useProductEditorState } from "./useProductEditorState";

export type ProductEditorTab = "general" | "details";

export interface ProductEditorDialogProps {
  board: OperationBoard | null;
  editor: ReturnType<typeof useProductEditorState>;
  footer: ReactNode;
  furtherActions: ReactNode;
  initialFocusSelector: string;
  onClose: () => void;
  onTabChange: (tab: ProductEditorTab) => void;
  open: boolean;
  resourceGroups: OperationBoard["resourceGroups"];
  submitAttempted: boolean;
  tab: ProductEditorTab;
}
