import { type ReactNode, useState } from "react";
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
  confirmBusy?: boolean;
  onConfirm: () => void | Promise<void>;
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
  confirmBusy = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const effectiveBusy = confirmBusy || internalBusy;
  const confirm = () => {
    const result = onConfirm();
    if (result && typeof result.then === "function") {
      setInternalBusy(true);
      void result.then(
        () => setInternalBusy(false),
        () => setInternalBusy(false),
      );
    }
    return result;
  };
  return (
    <ModalDialog
      footer={
        <div className="ds-confirm-actions">
          <Button type="button" variant="secondary" disabled={effectiveBusy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            disabled={confirmDisabled}
            busy={effectiveBusy}
            busyLabel={`${confirmLabel} wird ausgeführt`}
            autoFocus={!confirmDisabled && !effectiveBusy}
            onClick={confirm}
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
