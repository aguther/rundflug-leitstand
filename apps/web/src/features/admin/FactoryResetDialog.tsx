import { ValidationHint } from "../../admin-ux";
import { Button } from "../../design-system/components";
import { FieldLabel } from "../../operation-workspace";

export interface FactoryResetDialogProps {
  busy: boolean;
  confirmation: string;
  deleteAllBackups: boolean;
  error: string | null;
  open: boolean;
  pin: string;
  reason: string;
  retainRecoveryBackup: boolean;
  onClose: () => void;
  onConfirmationChange: (value: string) => void;
  onDeleteAllBackupsChange: (value: boolean) => void;
  onPinChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onRetainRecoveryBackupChange: (value: boolean) => void;
  onSubmit: () => void;
}

export function FactoryResetDialog({
  busy,
  confirmation,
  deleteAllBackups,
  error,
  open,
  pin,
  reason,
  retainRecoveryBackup,
  onClose,
  onConfirmationChange,
  onDeleteAllBackupsChange,
  onPinChange,
  onReasonChange,
  onRetainRecoveryBackupChange,
  onSubmit,
}: Readonly<FactoryResetDialogProps>) {
  if (!open) return null;

  const submitDisabled =
    reason.trim().length < 3 || !/^\d{6,12}$/.test(pin) || confirmation !== "WERKSZUSTAND";

  return (
    <div className="modal-backdrop factory-reset-backdrop">
      <form
        aria-labelledby="factory-reset-title"
        aria-modal="true"
        className="confirmation-dialog factory-reset-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        role="dialog"
      >
        <div className="drawer-heading">
          <div>
            <h2 id="factory-reset-title">Werkszustand herstellen</h2>
            <p>Diese Aktion kann nicht rückgängig gemacht werden.</p>
          </div>
          <button aria-label="Werksreset schließen" disabled={busy} onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="factory-delete-summary">
          <strong>Wird gelöscht</strong>
          <ul>
            <li>Alle Tickets, Warteschlangen, Umläufe und Flugdaten</li>
            <li>Alle Stammdaten und Veranstaltungsparameter</li>
            <li>Alle Historien, Protokolle und Sitzungen</li>
            <li>Die Ersteinrichtung</li>
          </ul>
        </div>
        <div className="field-control">
          <FieldLabel
            help="Dokumentiert, warum der vollständige Werksreset ausgeführt wird."
            htmlFor="factory-reset-reason"
            label="Begründung"
          />
          <textarea
            id="factory-reset-reason"
            maxLength={240}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Grund für den Werksreset"
            value={reason}
          />
        </div>
        <div className="field-control">
          <FieldLabel
            help="Bestätigt das angemeldete Administratorkonto erneut. Die PIN wird nicht protokolliert."
            htmlFor="factory-reset-pin"
            label="Aktuelle Administrator-PIN"
          />
          <input
            autoComplete="current-password"
            id="factory-reset-pin"
            inputMode="numeric"
            maxLength={12}
            minLength={6}
            onChange={(event) => onPinChange(event.target.value.replace(/\D/g, ""))}
            type="password"
            value={pin}
          />
        </div>
        <div className="field-control">
          <FieldLabel
            help="Zum Schutz vor versehentlicher Ausführung muss WERKSZUSTAND vollständig eingegeben werden."
            htmlFor="factory-reset-confirmation"
            label="Sicherheitsbestätigung"
          />
          <input
            autoComplete="off"
            id="factory-reset-confirmation"
            onChange={(event) => onConfirmationChange(event.target.value)}
            value={confirmation}
          />
        </div>
        <label className="reset-checkbox">
          <input
            checked={retainRecoveryBackup}
            onChange={(event) => onRetainRecoveryBackupChange(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Wiederherstellungssicherung in R2 behalten</strong>
            <small>Empfohlen – ermöglicht eine spätere Wiederherstellung.</small>
          </span>
        </label>
        <label className="reset-checkbox extra-danger">
          <input
            checked={deleteAllBackups}
            onChange={(event) => onDeleteAllBackupsChange(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Auch alle R2-Sicherungen endgültig löschen</strong>
            <small>Diese Aktion kann nicht rückgängig gemacht werden.</small>
          </span>
        </label>
        <p className="reset-consequence">
          Nach erfolgreichem Reset werden lokale Zugangsdaten entfernt und /setup geöffnet.
        </p>
        {error ? <ValidationHint tone="error">{error}</ValidationHint> : null}
        <div className="dialog-actions">
          <button disabled={busy} onClick={onClose} type="button">
            Abbrechen
          </button>
          <Button
            busy={busy}
            className="danger-action"
            disabled={submitDisabled}
            type="submit"
            variant="danger"
          >
            Alles löschen und neu starten
          </Button>
        </div>
      </form>
    </div>
  );
}
