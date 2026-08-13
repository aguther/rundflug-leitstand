import type {
  MasterDataTemplate,
  MasterDataTemplateValidation,
  OperationBoard,
} from "@rundflug/contracts";
import { Trash2 } from "lucide-react";
import type { RefObject } from "react";
import { ValidationHint } from "../../../admin-ux";
import { Button, Field, ModalDialog } from "../../../design-system/components";
import type { MasterDataDeleteTarget } from "../../../operation-workspace";
import { MasterDataDeleteEffects } from "./MasterDataDeleteEffects";

interface MasterDataDeleteDialogProps {
  busy: boolean;
  eventStatus: OperationBoard["event"]["status"] | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  modeUnlocked: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onPinChange: (value: string) => void;
  pin: string;
  target: MasterDataDeleteTarget | null;
}

export function MasterDataDeleteDialog({
  busy,
  eventStatus,
  inputRef,
  modeUnlocked,
  onCancel,
  onConfirm,
  onPinChange,
  pin,
  target,
}: Readonly<MasterDataDeleteDialogProps>) {
  if (!target) return null;

  const preparation = eventStatus === "PREPARATION";
  return (
    <ModalDialog
      bodyClassName="master-delete-dialog-body"
      className="master-delete-dialog"
      closeLabel="Löschen abbrechen"
      description="Diese Aktion entfernt den Datensatz dauerhaft und wird dem angemeldeten Konto zugeordnet und protokolliert."
      footer={
        <>
          <Button data-master-delete-cancel onClick={onCancel} type="button">
            Abbrechen
          </Button>
          <Button
            busy={busy}
            disabled={!preparation || target.blockers.length > 0 || pin.length < 4}
            onClick={onConfirm}
            type="button"
            variant="danger"
          >
            Endgültig löschen
          </Button>
        </>
      }
      initialFocusSelector="[data-master-delete-cancel]"
      onClose={onCancel}
      open
      role="alertdialog"
      size="default"
      title={
        <span className="master-delete-title">
          <Trash2 aria-hidden="true" />
          {target.label} endgültig löschen?
        </span>
      }
    >
      <div className="master-delete-record">
        <strong>{target.label}</strong>
        <span>Administrativer Stammdatensatz</span>
      </div>
      <section aria-labelledby="master-delete-effects">
        <h3 id="master-delete-effects">Auswirkungen</h3>
        <MasterDataDeleteEffects preparation={preparation} target={target} />
      </section>
      {!modeUnlocked ? (
        <div className="ds-field master-delete-pin-field">
          <label htmlFor="master-delete-pin">Administrator-PIN</label>
          <input
            autoComplete="current-password"
            id="master-delete-pin"
            onChange={(event) => onPinChange(event.target.value)}
            ref={inputRef}
            type="password"
            value={pin}
          />
        </div>
      ) : (
        <ValidationHint>
          Der Entwurf bleibt erhalten. Zum Löschen ist weiterhin diese ausdrückliche Bestätigung
          erforderlich.
        </ValidationHint>
      )}
      <p className="master-delete-audit-note">
        Einheitlicher Audit-Grund: Administrative Stammdatenlöschung
      </p>
    </ModalDialog>
  );
}

interface MasterDataTemplateImportDialogProps {
  busy: boolean;
  draft: MasterDataTemplate | null;
  error: string | null;
  fileName: string;
  onClose: () => void;
  onFile: (file: File | null) => void;
  onImport: () => void;
  open: boolean;
  validation: MasterDataTemplateValidation | null;
}

export function MasterDataTemplateImportDialog({
  busy,
  draft,
  error,
  fileName,
  onClose,
  onFile,
  onImport,
  open,
  validation,
}: Readonly<MasterDataTemplateImportDialogProps>) {
  return (
    <ModalDialog
      description="Versionierte Stammdaten werden geprüft und ausschließlich atomar in eine leere Veranstaltung in Vorbereitung importiert."
      footer={
        <>
          <Button disabled={busy} onClick={onClose} type="button">
            Abbrechen
          </Button>
          <Button
            busy={busy}
            disabled={!draft || !validation?.valid || !validation.targetEligible}
            onClick={onImport}
            type="button"
            variant="primary"
          >
            Importieren
          </Button>
        </>
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      open={open}
      size="wide"
      title="Stammdatenvorlage importieren"
    >
      <div className="template-import-dialog">
        <Field
          help="JSON-Datei im Format rundflug-master-data-template, Version 1, höchstens 1 MiB."
          label="Vorlagendatei"
        >
          <input
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </Field>
        {fileName ? <p className="help-text">{fileName}</p> : null}
        {busy ? <output className="help-text">Vorlage wird geprüft …</output> : null}
        {error ? <ValidationHint tone="error">{error}</ValidationHint> : null}
        {validation ? (
          <>
            <div className="template-counts">
              <span className="visually-hidden">Inhalt der Vorlage:</span>
              <span>
                <strong>{validation.counts.gates}</strong> Gates
              </span>
              <span>
                <strong>{validation.counts.resourceGroups}</strong> Gruppen
              </span>
              <span>
                <strong>{validation.counts.aircraft}</strong> Flugzeuge
              </span>
              <span>
                <strong>{validation.counts.assignments}</strong> Zuordnungen
              </span>
              <span>
                <strong>{validation.counts.pilots}</strong> Pilotencodes
              </span>
              <span>
                <strong>{validation.counts.products}</strong> Produkte
              </span>
            </div>
            {!validation.targetEligible ? (
              <ValidationHint tone="error">
                Das Ziel muss leer und im Status Vorbereitung sein. Vorhandene Stammdaten werden
                weder zusammengeführt noch ersetzt.
              </ValidationHint>
            ) : null}
            {validation.errors.map((entry) => (
              <ValidationHint key={`${entry.path}-${entry.message}`} tone="error">
                {entry.path}: {entry.message}
              </ValidationHint>
            ))}
            {validation.warnings.map((warning) => (
              <ValidationHint key={warning} tone="warning">
                {warning}
              </ValidationHint>
            ))}
            {validation.valid && validation.targetEligible ? (
              <ValidationHint>
                Die Vorlage ist gültig. Der Import erzeugt neue veranstaltungsbezogene Kennungen und
                genau einen auditierten Versionssprung.
              </ValidationHint>
            ) : null}
          </>
        ) : null}
      </div>
    </ModalDialog>
  );
}
