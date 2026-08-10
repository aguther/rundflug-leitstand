import type { ReactNode } from "react";
import { ValidationHint } from "../../../admin-ux";
import { Button, ModalDialog } from "../../../design-system/components";
import { FieldLabel } from "../../../operation-workspace";
import type { usePilotEditorState } from "./usePilotEditorState";

interface PilotEditorDialogProps {
  administrator: boolean;
  busy: boolean;
  dirty: boolean;
  editor: ReturnType<typeof usePilotEditorState>;
  footer: ReactNode;
  furtherActions: ReactNode;
  initialFocusSelector: string;
  onClose: () => void;
  onToggle: () => void;
  open: boolean;
  submitAttempted: boolean;
}

export function PilotEditorDialog({
  administrator,
  busy,
  dirty,
  editor,
  footer,
  furtherActions,
  initialFocusSelector,
  onClose,
  onToggle,
  open,
  submitAttempted,
}: PilotEditorDialogProps) {
  return (
    <ModalDialog
      bodyClassName="master-data-editor-body"
      className="master-data-editor-dialog"
      footer={footer}
      footerClassName="master-data-editor-footer"
      initialFocusSelector={initialFocusSelector}
      onClose={onClose}
      open={open}
      size="default"
      title={editor.editorId === "new" ? "Pilotencode anlegen" : "Pilotencode bearbeiten"}
    >
      <div className="parameter-grid compact-editor-grid">
        <div className="field-control">
          <FieldLabel
            htmlFor="pilot-operational-code"
            label="Operativer Pilotencode"
            help="Anonymer technischer Code für die operative Zuordnung; keine Namen oder Lizenzdaten erfassen."
          />
          <input
            id="pilot-operational-code"
            value={editor.code}
            onChange={(event) => editor.setCode(event.target.value)}
          />
          <span className="field-help">Nur technische Codes, keine Namen oder Lizenzdaten.</span>
        </div>
        <div className="field-control">
          <FieldLabel
            htmlFor="pilot-operational-note"
            label="Organisatorische Bemerkung"
            help="Optionaler nicht personenbezogener Hinweis, zum Beispiel Einsatzbereich oder Schicht."
          />
          <input
            id="pilot-operational-note"
            value={editor.note}
            onChange={(event) => editor.setNote(event.target.value)}
            placeholder="Optional · keine personenbezogenen Daten"
          />
        </div>
      </div>
      {editor.editorId !== "new" ? (
        <dl className="master-editor-readonly-summary">
          <div>
            <dt>Pausenstatus</dt>
            <dd>{editor.currentPilot?.paused ? "Pause" : "Einsatzbereit"}</dd>
          </div>
          <div>
            <dt>Aktuelle Fluggruppe</dt>
            <dd>
              {editor.currentPilot?.currentCommunicationNumber
                ? `Fluggruppe ${editor.currentPilot.currentCommunicationNumber}`
                : "Nicht zugeordnet"}
            </dd>
          </div>
        </dl>
      ) : null}
      {submitAttempted && !/^[A-Z0-9-]{2,12}$/.test(editor.code) ? (
        <ValidationHint tone="error">
          Der Pilotencode muss aus 2 bis 12 Großbuchstaben, Ziffern oder Bindestrichen bestehen.
        </ValidationHint>
      ) : null}
      {editor.editorId !== "new" ? (
        <section className="master-editor-status-section">
          <div>
            <h3>Status</h3>
            <p>
              Der Pilotencode ist aktuell {editor.currentPilot?.active ? "aktiv" : "inaktiv"}.
              Statusänderungen werden separat gespeichert und protokolliert.
              {dirty ? " Speichern oder verwerfen Sie zuerst die Formularänderungen." : ""}
            </p>
          </div>
          <Button busy={busy} disabled={!administrator || dirty} onClick={onToggle} type="button">
            {editor.currentPilot?.active ? "Deaktivieren" : "Aktivieren"}
          </Button>
        </section>
      ) : null}
      {furtherActions}
    </ModalDialog>
  );
}
