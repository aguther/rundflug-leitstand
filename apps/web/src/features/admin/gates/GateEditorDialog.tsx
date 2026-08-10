import type { OperationBoard } from "@rundflug/contracts";
import type { ReactNode } from "react";
import { ValidationHint } from "../../../admin-ux";
import { CheckboxField, ModalDialog, Tabs } from "../../../design-system/components";
import { FieldGroupLabel, FieldLabel } from "../../../operation-workspace";
import type { useGateEditorState } from "./useGateEditorState";

type EditorTab = "general" | "details";

interface GateEditorDialogProps {
  editor: ReturnType<typeof useGateEditorState>;
  footer: ReactNode;
  furtherActions: ReactNode;
  initialFocusSelector: string;
  onClose: () => void;
  onTabChange: (tab: EditorTab) => void;
  open: boolean;
  products: OperationBoard["products"];
  resourceGroups: OperationBoard["resourceGroups"];
  submitAttempted: boolean;
  tab: EditorTab;
}

export function GateEditorDialog({
  editor,
  footer,
  furtherActions,
  initialFocusSelector,
  onClose,
  onTabChange,
  open,
  products,
  resourceGroups,
  submitAttempted,
  tab,
}: GateEditorDialogProps) {
  return (
    <ModalDialog
      bodyClassName="master-data-editor-body"
      className="master-data-editor-dialog"
      footer={footer}
      footerClassName="master-data-editor-footer"
      initialFocusSelector={initialFocusSelector}
      onClose={onClose}
      open={open}
      size="wide"
      title={editor.editorId === "new" ? "Gate anlegen" : "Gate bearbeiten"}
    >
      <div className="master-data-columns">
        <fieldset>
          <legend>Gate</legend>
          <div className="master-data-editor-tabs">
            <Tabs
              idPrefix="master-gate-editor"
              items={[
                { value: "general", label: "Grunddaten" },
                { value: "details", label: "Öffentliche Anzeige" },
              ]}
              label="Gate-Bereiche"
              onChange={onTabChange}
              value={tab}
            />
          </div>
          <div
            aria-labelledby="master-gate-editor-general-tab"
            className="master-data-editor-panel"
            hidden={tab !== "general"}
            id="master-gate-editor-general-panel"
            role="tabpanel"
          >
            <p className="form-introduction">
              Ein Gate ist der sichtbare Treff- oder Ausgabepunkt einer Ressourcengruppe. Für den
              normalen Betrieb genügt eine Bezeichnung; technische Gate-Arten sind nicht
              erforderlich.
            </p>
            <div className="field-control">
              <FieldLabel
                htmlFor="gate-label"
                label="Bezeichnung"
                help="Kurzer, vor Ort eindeutig sichtbarer Name, zum Beispiel Eingang Halle oder Flight Line Nord."
              />
              <input
                id="gate-label"
                value={editor.label}
                onChange={(event) => editor.setLabel(event.target.value)}
              />
            </div>
            <div className="gate-active-field">
              <FieldGroupLabel
                label="Status"
                help="Nur aktive Gates stehen für neue Zuordnungen und öffentliche Anzeigen zur Verfügung."
              />
              <CheckboxField
                checked={editor.active}
                label="Gate ist aktiv"
                onChange={(event) => editor.setActive(event.target.checked)}
              />
            </div>
            <div className="field-control">
              <FieldLabel
                htmlFor="gate-travel-lead-minutes"
                label="Zusätzlicher Wegvorlauf"
                help="Zusätzliche Zeit für den Weg vom Wartebereich zu diesem Gate. Der Wert verschiebt „Bereithalten“ und „Bitte zum Gate“ nach vorne, verändert aber nicht das prognostizierte Boardingzeitfenster."
              />
              <input
                id="gate-travel-lead-minutes"
                max="30"
                min="0"
                onChange={(event) => editor.setTravelLeadMinutes(Number(event.target.value))}
                type="number"
                value={editor.travelLeadMinutes}
              />
            </div>
            <details className="master-editor-further-settings">
              <summary>Weitere Einstellungen</summary>
              <div className="parameter-grid">
                <div className="field-control">
                  <FieldLabel
                    htmlFor="gate-type"
                    label="Technische Gate-Art"
                    help="Kompatibler technischer Schlüssel; für den normalen Ablauf ist Flight Line passend."
                  />
                  <select
                    id="gate-type"
                    onChange={(event) =>
                      editor.setGateType(
                        event.target.value as "FLIGHT_LINE" | "BOARDING" | "DISPLAY_ONLY",
                      )
                    }
                    value={editor.gateType}
                  >
                    <option value="FLIGHT_LINE">Flight Line</option>
                    <option value="BOARDING">Boarding</option>
                    <option value="DISPLAY_ONLY">Nur Anzeige</option>
                  </select>
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="gate-sort-order"
                    label="Reihenfolge"
                    help="Kleinere Werte erscheinen zuerst."
                  />
                  <input
                    id="gate-sort-order"
                    min="0"
                    onChange={(event) => editor.setSortOrder(Number(event.target.value))}
                    type="number"
                    value={editor.sortOrder}
                  />
                </div>
              </div>
            </details>
          </div>
          <section
            aria-labelledby="master-gate-editor-details-tab"
            className="gate-display-filter master-data-editor-panel"
            hidden={tab !== "details"}
            id="master-gate-editor-details-panel"
            role="tabpanel"
          >
            <div>
              <h3 id="gate-display-filter-title">Anzeigefilter</h3>
              <p>
                Leere Auswahl bedeutet: alle Produkte beziehungsweise alle Umlaufstatus anzeigen.
              </p>
            </div>
            <div className="gate-filter-group">
              <strong>
                <FieldGroupLabel
                  label="Produkte"
                  help="Begrenzt die öffentliche Gate-Anzeige auf die ausgewählten Produkte. Die Ressourcenzuordnung bleibt unverändert."
                />
              </strong>
              <div className="gate-filter-options">
                {products.map((product) => (
                  <CheckboxField
                    checked={editor.displayProductIds.includes(product.id)}
                    key={product.id}
                    label={product.name}
                    onChange={() =>
                      editor.setDisplayProductIds((current) =>
                        current.includes(product.id)
                          ? current.filter((id) => id !== product.id)
                          : [...current, product.id],
                      )
                    }
                  />
                ))}
                {products.length === 0 ? (
                  <span className="help-text">Noch keine Produkte angelegt.</span>
                ) : null}
              </div>
            </div>
            <div className="gate-filter-group">
              <strong>
                <FieldGroupLabel
                  label="Umlaufstatus"
                  help="Begrenzt die Anzeige auf die gewählten Phasen. Diese Auswahl löst keine Zustandsänderung aus."
                />
              </strong>
              <div className="gate-filter-options">
                {(
                  [
                    ["DRAFT", "Vorbereitung"],
                    ["CALLED", "Aufgerufen"],
                    ["IN_FLIGHT", "Im Flug"],
                    ["LANDED", "Gelandet"],
                    ["COMPLETED", "Abgeschlossen"],
                  ] as const
                ).map(([status, label]) => (
                  <CheckboxField
                    checked={editor.displayRotationStatuses.includes(status)}
                    key={status}
                    label={label}
                    onChange={() =>
                      editor.setDisplayRotationStatuses((current) =>
                        current.includes(status)
                          ? current.filter((entry) => entry !== status)
                          : [...current, status],
                      )
                    }
                  />
                ))}
              </div>
            </div>
            {editor.editorId !== "new" ? (
              <div className="gate-assignment-summary">
                <strong>Zugeordnete Ressourcengruppen</strong>
                <span>
                  {resourceGroups
                    .filter((group) => group.gateId === editor.editorId)
                    .map((group) => group.name)
                    .join(", ") || "Keine"}
                </span>
                <small>Zuordnungen werden bei der Ressourcengruppe gepflegt.</small>
              </div>
            ) : null}
          </section>
          {submitAttempted && editor.label.trim().length < 2 ? (
            <ValidationHint tone="error">
              Die Gate-Bezeichnung muss mindestens 2 Zeichen lang sein.
            </ValidationHint>
          ) : null}
        </fieldset>
      </div>
      {furtherActions}
    </ModalDialog>
  );
}
