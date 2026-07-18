import type { ReactNode } from "react";
import { Button } from "./Button";

export interface ConfirmationDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
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
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  if (!open) return null;

  return (
    <div className="ds-confirm-backdrop">
      <button
        aria-label={cancelLabel}
        className="ds-confirm-backdrop-dismiss"
        onClick={onCancel}
        type="button"
      />
      <form
        className="ds-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="ds-confirm-actions">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
