import type { RefObject } from "react";
import { ValidationHint } from "../../admin-ux";
import { Button, ModalDialog } from "../../design-system/components";

interface AdminAuthorizationDialogProps {
  busy: boolean;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  mode: "unlock" | "action" | null;
  onClose: () => void;
  onPinChange: (value: string) => void;
  onSubmit: () => void;
  pin: string;
}

export function AdminAuthorizationDialog({
  busy,
  error,
  inputRef,
  mode,
  onClose,
  onPinChange,
  onSubmit,
  pin,
}: AdminAuthorizationDialogProps) {
  if (!mode) return null;

  const unlock = mode === "unlock";
  return (
    <ModalDialog
      description={
        unlock
          ? "Die PIN gilt nur in diesem Browser-Tab und wird nach 15 Minuten Inaktivität verworfen."
          : "Diese einzelne Änderung wird nach erfolgreicher PIN-Prüfung ausgeführt und protokolliert."
      }
      footer={
        <>
          <Button disabled={busy} onClick={onClose} type="button">
            Abbrechen
          </Button>
          <Button
            busy={busy}
            disabled={pin.length < 4}
            form="admin-pin-form"
            type="submit"
            variant="primary"
          >
            {unlock ? "Entsperren" : "Bestätigen"}
          </Button>
        </>
      }
      initialFocusSelector="#admin-pin-input"
      onClose={() => {
        if (!busy) onClose();
      }}
      open
      size="compact"
      title={unlock ? "Bearbeitungsmodus entsperren" : "Änderung bestätigen"}
    >
      <form
        className="admin-pin-form"
        id="admin-pin-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="ds-field admin-pin-field">
          <label htmlFor="admin-pin-input">Administrator-PIN</label>
          <input
            autoComplete="current-password"
            id="admin-pin-input"
            onChange={(event) => onPinChange(event.target.value)}
            ref={inputRef}
            type="password"
            value={pin}
          />
        </div>
        {error ? <ValidationHint tone="error">{error}</ValidationHint> : null}
      </form>
    </ModalDialog>
  );
}
