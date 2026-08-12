import type { OperationBoard } from "@rundflug/contracts";
import type { ReactNode } from "react";
import { ModalDialog, Tabs } from "../../../design-system/components";
import { FieldLabel } from "../../../operation-workspace";
import { ProductReferenceRotation } from "../../../product-reference-rotation";
import type { useProductEditorState } from "./useProductEditorState";

type EditorTab = "general" | "details";

interface ProductEditorDialogProps {
  board: OperationBoard | null;
  editor: ReturnType<typeof useProductEditorState>;
  footer: ReactNode;
  furtherActions: ReactNode;
  initialFocusSelector: string;
  onClose: () => void;
  onTabChange: (tab: EditorTab) => void;
  open: boolean;
  resourceGroups: OperationBoard["resourceGroups"];
  submitAttempted: boolean;
  tab: EditorTab;
}

export function ProductEditorDialog({
  board,
  editor,
  footer,
  furtherActions,
  initialFocusSelector,
  onClose,
  onTabChange,
  open,
  resourceGroups,
  submitAttempted,
  tab,
}: Readonly<ProductEditorDialogProps>) {
  const plannedBoardingMinutes = board?.event.plannedBoardingMinutes ?? 8;
  const plannedDeboardingMinutes = board?.event.plannedDeboardingMinutes ?? 5;
  const plannedBufferMinutes = board?.event.plannedBufferMinutes ?? 3;

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
      title={editor.editorId === "new" ? "Produkt anlegen" : "Produkt bearbeiten"}
    >
      <div className="master-data-columns">
        <fieldset>
          <legend>Produkt</legend>
          <div className="master-data-editor-tabs">
            <Tabs
              idPrefix="master-product-editor"
              items={[
                { value: "general", label: "Allgemein" },
                { value: "details", label: "Planung und Zeitmodell" },
              ]}
              label="Produktbereiche"
              onChange={onTabChange}
              value={tab}
            />
          </div>
          <section
            aria-labelledby="master-product-editor-general-tab"
            className="product-editor-section master-data-editor-panel"
            hidden={tab !== "general"}
            id="master-product-editor-general-panel"
            role="tabpanel"
          >
            <h3>Allgemein</h3>
            <div className="parameter-grid">
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-name"
                  label="Bezeichnung"
                  help="Interner und öffentlicher Name des Produkts."
                />
                <input
                  id="product-name"
                  value={editor.name}
                  onChange={(event) => editor.setName(event.target.value)}
                />
                {submitAttempted && editor.name.trim().length < 2 ? (
                  <span className="field-error">Mindestens 2 Zeichen eingeben.</span>
                ) : null}
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-code"
                  label="Kürzel"
                  help="2–12 Großbuchstaben, Ziffern oder Bindestriche; Bestandteil der stabilen Fluggruppenkennung."
                />
                <input
                  id="product-code"
                  value={editor.code}
                  maxLength={12}
                  onChange={(event) => editor.setCode(event.target.value)}
                />
                {submitAttempted && !/^[A-Z0-9-]{2,12}$/.test(editor.code) ? (
                  <span className="field-error">Zum Beispiel PAN20 oder KURZ-10.</span>
                ) : null}
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-price"
                  label="Preis in €"
                  help="Informatorischer Einzelpreis je Ticket. Das System ist keine elektronische Kasse."
                />
                <input
                  id="product-price"
                  inputMode="decimal"
                  value={editor.priceInput}
                  onBlur={editor.normalizePrice}
                  onChange={(event) => editor.setPriceInput(event.target.value)}
                />
                {submitAttempted && editor.priceCents === null ? (
                  <span className="field-error">
                    Eurobetrag mit höchstens zwei Nachkommastellen eingeben.
                  </span>
                ) : null}
              </div>
              <div className="field-control product-description-field">
                <FieldLabel
                  htmlFor="product-description"
                  label="Öffentliche Beschreibung"
                  help="Kurzer Text für Kasse und öffentliche Anzeigen."
                />
                <input
                  id="product-description"
                  value={editor.description}
                  maxLength={240}
                  onChange={(event) => editor.setDescription(event.target.value)}
                />
              </div>
            </div>
          </section>
          <section
            aria-labelledby="master-product-editor-details-tab"
            className="product-editor-section master-data-editor-panel"
            hidden={tab !== "details"}
            id="master-product-editor-details-panel"
            role="tabpanel"
          >
            <h3>Planung und Zeitmodell</h3>
            <div className="parameter-grid">
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-resource-group"
                  label="Ressourcengruppe"
                  help="Ordnet das Produkt genau einer gemeinsamen operativen Queue und Kapazität zu."
                />
                <select
                  id="product-resource-group"
                  value={editor.resourceGroupId}
                  onChange={(event) => editor.setResourceGroupId(event.target.value)}
                >
                  <option value="">Bitte wählen</option>
                  {resourceGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                {submitAttempted && !editor.resourceGroupId ? (
                  <span className="field-error">Eine Ressourcengruppe auswählen.</span>
                ) : null}
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-gate"
                  label="Gate"
                  help="Veröffentlichter Treffpunkt beziehungsweise Abfertigungsort."
                />
                <select
                  id="product-gate"
                  value={editor.gateId}
                  onChange={(event) => editor.setGateId(event.target.value)}
                >
                  <option value="">Bitte wählen</option>
                  {board?.gates
                    .filter((gate) => gate.active)
                    .map((gate) => (
                      <option key={gate.id} value={gate.id}>
                        {gate.label}
                      </option>
                    ))}
                </select>
                {submitAttempted && !editor.gateId ? (
                  <span className="field-error">Ein aktives Gate auswählen.</span>
                ) : null}
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-reference-duration"
                  label="Referenzzeit Offblock–Onblock (Min.)"
                  help="Operative Planzeit vom bestätigten Offblock bis zum bestätigten Onblock. Boarding, Ausstieg und Puffer werden separat berücksichtigt. Trage hier weder die vollständige Umlaufzeit noch ausschließlich die beworbene Flugzeit ein."
                />
                <input
                  id="product-reference-duration"
                  type="number"
                  min="1"
                  max="600"
                  value={editor.referenceDuration}
                  onChange={(event) => editor.setReferenceDuration(Number(event.target.value))}
                />
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-promised-flight-minutes"
                  label="Kommunizierte Flugzeit (Min.)"
                  help="Gegenüber Gästen angegebene beziehungsweise verkaufte Flugzeit. Dieser Wert wird in Produktinformationen verwendet und beeinflusst die operative Prognose nicht."
                />
                <input
                  id="product-promised-flight-minutes"
                  type="number"
                  min="1"
                  max="600"
                  value={editor.promisedFlightMinutes}
                  onChange={(event) => editor.setPromisedFlightMinutes(Number(event.target.value))}
                />
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-boarding-override"
                  label="Boarding (Min.)"
                  help="Leer übernimmt den Veranstaltungswert."
                />
                <input
                  id="product-boarding-override"
                  max="120"
                  min="0"
                  onChange={(event) => editor.setBoardingOverride(event.target.value)}
                  placeholder={`Veranstaltung: ${plannedBoardingMinutes}`}
                  type="number"
                  value={editor.boardingOverride}
                />
                <small>
                  Quelle: {editor.boardingOverride === "" ? "Veranstaltung" : "Produkt"}
                </small>
                <button
                  className="table-action"
                  onClick={() =>
                    editor.setBoardingOverride((current) =>
                      current === "" ? String(plannedBoardingMinutes) : "",
                    )
                  }
                  type="button"
                >
                  {editor.boardingOverride === ""
                    ? "Produktabweichung festlegen"
                    : "Produktabweichung entfernen"}
                </button>
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-deboarding-override"
                  label="Ausstieg (Min.)"
                  help="Leer übernimmt den Veranstaltungswert."
                />
                <input
                  id="product-deboarding-override"
                  max="120"
                  min="0"
                  onChange={(event) => editor.setDeboardingOverride(event.target.value)}
                  placeholder={`Veranstaltung: ${plannedDeboardingMinutes}`}
                  type="number"
                  value={editor.deboardingOverride}
                />
                <small>
                  Quelle: {editor.deboardingOverride === "" ? "Veranstaltung" : "Produkt"}
                </small>
                <button
                  className="table-action"
                  onClick={() =>
                    editor.setDeboardingOverride((current) =>
                      current === "" ? String(plannedDeboardingMinutes) : "",
                    )
                  }
                  type="button"
                >
                  {editor.deboardingOverride === ""
                    ? "Produktabweichung festlegen"
                    : "Produktabweichung entfernen"}
                </button>
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="product-buffer-override"
                  label="Puffer (Min.)"
                  help="Leer übernimmt den Veranstaltungswert."
                />
                <input
                  id="product-buffer-override"
                  max="120"
                  min="0"
                  onChange={(event) => editor.setBufferOverride(event.target.value)}
                  placeholder={`Veranstaltung: ${plannedBufferMinutes}`}
                  type="number"
                  value={editor.bufferOverride}
                />
                <small>Quelle: {editor.bufferOverride === "" ? "Veranstaltung" : "Produkt"}</small>
                <button
                  className="table-action"
                  onClick={() =>
                    editor.setBufferOverride((current) =>
                      current === "" ? String(plannedBufferMinutes) : "",
                    )
                  }
                  type="button"
                >
                  {editor.bufferOverride === ""
                    ? "Produktabweichung festlegen"
                    : "Produktabweichung entfernen"}
                </button>
              </div>
              <ProductReferenceRotation
                boardingMinutes={
                  editor.boardingOverride === ""
                    ? plannedBoardingMinutes
                    : Number(editor.boardingOverride)
                }
                bufferMinutes={
                  editor.bufferOverride === ""
                    ? plannedBufferMinutes
                    : Number(editor.bufferOverride)
                }
                deboardingMinutes={
                  editor.deboardingOverride === ""
                    ? plannedDeboardingMinutes
                    : Number(editor.deboardingOverride)
                }
                offBlockToOnBlockMinutes={editor.referenceDuration}
              />
            </div>
          </section>
        </fieldset>
      </div>
      {furtherActions}
    </ModalDialog>
  );
}
