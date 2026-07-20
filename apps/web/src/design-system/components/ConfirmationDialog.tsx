import type { ReactNode } from "react";
import { Button } from "./Button";
import { ModalDialog } from "./ModalDialog";

export interface ConfirmationDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Abbrechen",
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  return (
    <ModalDialog
      footer={
        <div className="ds-confirm-actions">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            disabled={confirmDisabled}
            autoFocus={!confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      }
      onClose={onCancel}
      open={open}
      role="alertdialog"
      size="compact"
      title={title}
    >
      <div className="ds-confirm-body">{body}</div>
    </ModalDialog>
  );
}
