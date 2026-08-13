import type { OperationBoard } from "@rundflug/contracts";
import type { ReactNode } from "react";
import type { MasterDataCategory } from "../../../admin-ux";
import { ValidationHint } from "../../../admin-ux";
import { Button, CheckboxField, ModalDialog } from "../../../design-system/components";
import { aircraftStateLabel, FieldHelp, FieldLabel } from "../../../operation-workspace";
import type { useAircraftEditorState } from "../aircraft/useAircraftEditorState";
import type { useResourceGroupEditorState } from "../resource-groups/useResourceGroupEditorState";

interface ResourceAircraftEditorDialogProps {
  aircraftEditor: ReturnType<typeof useAircraftEditorState>;
  board: OperationBoard | null;
  category: MasterDataCategory;
  footer: ReactNode;
  furtherActions: ReactNode;
  initialFocusSelector: string;
  onAssignAircraft: (resourceGroupId: string) => void;
  onClose: () => void;
  open: boolean;
  resourceEditor: ReturnType<typeof useResourceGroupEditorState>;
  submitAttempted: boolean;
}

export function ResourceAircraftEditorDialog({
  aircraftEditor,
  board,
  category,
  footer,
  furtherActions,
  initialFocusSelector,
  onAssignAircraft,
  onClose,
  open,
  resourceEditor,
  submitAttempted,
}: Readonly<ResourceAircraftEditorDialogProps>) {
  const resourceGroupSelected = category === "resource-groups";
  const resourceAction = resourceEditor.editorId === "new" ? "anlegen" : "bearbeiten";
  const aircraftAction = aircraftEditor.editorId === "new" ? "anlegen" : "bearbeiten";
  const title = resourceGroupSelected
    ? `Ressourcengruppe ${resourceAction}`
    : `Flugzeug ${aircraftAction}`;
  return (
    <ModalDialog
      bodyClassName="master-data-editor-body"
      className="master-data-editor-dialog"
      footer={footer}
      footerClassName="master-data-editor-footer"
      initialFocusSelector={initialFocusSelector}
      onClose={onClose}
      open={open}
      size={resourceGroupSelected ? "wide" : "default"}
      title={title}
    >
      <div className="resource-master-grid">
        <fieldset hidden={!resourceGroupSelected}>
          <legend>Ressourcengruppe</legend>
          <div className="field-control">
            <FieldLabel
              htmlFor="resource-name"
              label="Bezeichnung"
              help="Lesbarer Name der gemeinsamen operativen Warteschlange."
            />
            <input
              id="resource-name"
              value={resourceEditor.name}
              onChange={(event) => resourceEditor.setName(event.target.value)}
            />
          </div>
          <div className="field-control">
            <FieldLabel
              htmlFor="resource-short-code"
              label="Kurzzeichen"
              help="Eindeutiges Kürzel mit 2 bis 8 Großbuchstaben, Ziffern oder Bindestrichen für kompakte operative Ansichten."
            />
            <input
              autoCapitalize="characters"
              id="resource-short-code"
              maxLength={8}
              placeholder="z. B. PA"
              value={resourceEditor.shortCode}
              onChange={(event) => resourceEditor.setShortCode(event.target.value)}
            />
          </div>
          <div className="field-control">
            <FieldLabel
              htmlFor="resource-gate"
              label="Gate"
              help="Standardmäßiger Treffpunkt für Produkte und Umläufe dieser Ressourcengruppe."
            />
            <select
              id="resource-gate"
              value={resourceEditor.gateId}
              onChange={(event) => resourceEditor.setGateId(event.target.value)}
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
          </div>
          <CheckboxField
            checked={resourceEditor.automaticPrecall}
            className="resource-automatic-precall"
            id="resource-automatic-precall"
            label="Automatischer Voraufruf für diese Gruppe"
            onChange={(event) => resourceEditor.setAutomaticPrecall(event.target.checked)}
            trailing={
              <FieldHelp help="Kann für einzelne Ressourcengruppen abgeschaltet werden. Belegung, Pilot und Boarding bleiben immer manuell bestätigt." />
            }
          />
          <section className="resource-aircraft-selection resource-assignment-summary">
            <h3>Flugzeugzuordnungen</h3>
            <p>
              Zuordnungen werden getrennt historisiert und beim Speichern der Ressourcengruppe nicht
              verändert.
            </p>
            {resourceEditor.editorId !== "new" ? (
              <Button
                onClick={() => onAssignAircraft(resourceEditor.editorId)}
                type="button"
                variant="secondary"
              >
                Flugzeug zuordnen
              </Button>
            ) : (
              <ValidationHint>
                Die Ressourcengruppe zuerst speichern und anschließend Flugzeuge zuordnen.
              </ValidationHint>
            )}
          </section>
          {submitAttempted &&
          (resourceEditor.name.trim().length < 2 ||
            !/^[A-Z0-9-]{2,8}$/.test(resourceEditor.shortCode.trim().toUpperCase()) ||
            !resourceEditor.gateId) ? (
            <ValidationHint tone="error">
              Bezeichnung, gültiges Kurzzeichen und Gate müssen für die Ressourcengruppe angegeben
              werden.
            </ValidationHint>
          ) : null}
        </fieldset>
        <fieldset hidden={resourceGroupSelected}>
          <legend>Flugzeug</legend>
          <div className="field-control">
            <FieldLabel
              htmlFor="aircraft-registration"
              label="Kennzeichen"
              help="Eindeutiges operatives Luftfahrzeugkennzeichen, beispielsweise D-EXYZ."
            />
            <input
              id="aircraft-registration"
              value={aircraftEditor.registration}
              maxLength={16}
              onChange={(event) => aircraftEditor.setRegistration(event.target.value)}
            />
          </div>
          <div className="field-control">
            <FieldLabel
              htmlFor="aircraft-type"
              label="Flugzeugtyp"
              help="Typbezeichnung zur Prüfung gegen kompatible Ressourcengruppen."
            />
            <input
              id="aircraft-type"
              value={aircraftEditor.type}
              onChange={(event) => aircraftEditor.setType(event.target.value)}
            />
          </div>
          <div className="field-control">
            <FieldLabel
              htmlFor="aircraft-seats"
              label="Passagierplätze"
              help="Maximale Ticketanzahl je Umlauf; Besatzungsplätze werden hier nicht eingetragen."
            />
            <input
              id="aircraft-seats"
              type="number"
              min="1"
              max="100"
              value={aircraftEditor.passengerSeats}
              onChange={(event) => aircraftEditor.setPassengerSeats(Number(event.target.value))}
            />
          </div>
          <div className="field-control">
            <FieldLabel
              htmlFor="aircraft-maximum-payload"
              label="Max. Passagierzuladung (kg)"
              help="Optionaler organisatorischer Hinweiswert. Er besitzt keine Freigabe- oder Sicherheitssemantik."
            />
            <input
              id="aircraft-maximum-payload"
              type="number"
              min="1"
              value={aircraftEditor.maximumPassengerPayloadKg}
              onChange={(event) => aircraftEditor.setMaximumPassengerPayloadKg(event.target.value)}
            />
          </div>
          {aircraftEditor.editorId !== "new" ? (
            <dl className="master-editor-readonly-summary">
              <div>
                <dt>Betriebsstatus</dt>
                <dd>
                  {
                    aircraftStateLabel[
                      aircraftEditor.currentAircraft?.operationalState ?? "INACTIVE"
                    ]
                  }
                </dd>
              </div>
              <div>
                <dt>Aktuelle Ressourcengruppe</dt>
                <dd>{aircraftEditor.currentAircraft?.resourceGroupName || "Nicht zugeordnet"}</dd>
              </div>
              <div>
                <dt>Produktspezifische Zeitabweichungen</dt>
                <dd>
                  {board?.aircraftProductTurnaroundOverrides.filter(
                    (entry) => entry.aircraftId === aircraftEditor.editorId,
                  ).length ?? 0}
                </dd>
              </div>
            </dl>
          ) : null}
          {submitAttempted &&
          (aircraftEditor.registration.trim().length < 3 ||
            aircraftEditor.type.trim().length < 2) ? (
            <ValidationHint tone="error">
              Kennzeichen und Flugzeugtyp müssen mindestens 2 Zeichen lang sein.
            </ValidationHint>
          ) : null}
        </fieldset>
      </div>
      {furtherActions}
    </ModalDialog>
  );
}
