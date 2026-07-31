import type { OperationBoard } from "@rundflug/contracts";
import { ArrowRight, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  ConfirmationDialog,
  ModalDialog,
  SelectField,
} from "../../../design-system/components";

export type AircraftResourceGroupAssignmentContext =
  | { mode: "aircraft"; aircraftId: string }
  | { mode: "resource-group"; resourceGroupId: string };

export function AircraftResourceGroupAssignmentDialog({
  board,
  context,
  busy,
  onClose,
  onConfirm,
}: {
  board: OperationBoard;
  context: AircraftResourceGroupAssignmentContext | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (aircraftId: string, resourceGroupId: string) => void;
}) {
  const fixedAircraftId = context?.mode === "aircraft" ? context.aircraftId : "";
  const fixedResourceGroupId = context?.mode === "resource-group" ? context.resourceGroupId : "";
  const [aircraftId, setAircraftId] = useState(fixedAircraftId);
  const [resourceGroupId, setResourceGroupId] = useState(fixedResourceGroupId);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    setAircraftId(fixedAircraftId);
    setResourceGroupId(fixedResourceGroupId);
    setDiscardOpen(false);
  }, [fixedAircraftId, fixedResourceGroupId]);

  if (!context) return null;
  const aircraft = board.aircraft.find((entry) => entry.id === aircraftId);
  const targetGroup = board.resourceGroups.find((entry) => entry.id === resourceGroupId);
  const initialAircraftId = fixedAircraftId;
  const initialResourceGroupId = fixedResourceGroupId;
  const dirty = aircraftId !== initialAircraftId || resourceGroupId !== initialResourceGroupId;
  const canSubmit = Boolean(
    aircraft && targetGroup && aircraft.resourceGroupId !== targetGroup.id && !busy,
  );

  function requestClose() {
    if (dirty) setDiscardOpen(true);
    else onClose();
  }

  return (
    <>
      <ModalDialog
        className="aircraft-assignment-dialog"
        description="Die Änderung wird ab Bestätigung historisiert und serverseitig auf aktive Umläufe und Kompatibilität geprüft."
        footer={
          <>
            <Button disabled={busy} onClick={requestClose} type="button" variant="secondary">
              Abbrechen
            </Button>
            <Button
              busy={busy}
              disabled={!canSubmit}
              onClick={() => onConfirm(aircraftId, resourceGroupId)}
              type="button"
              variant="primary"
            >
              <Link2 aria-hidden="true" /> Zuordnung bestätigen
            </Button>
          </>
        }
        initialFocusSelector={
          context.mode === "aircraft" ? "#assignment-target-group" : "#assignment-target-aircraft"
        }
        onClose={requestClose}
        open
        portal
        size="default"
        title="Flugzeug einer Ressourcengruppe zuordnen"
      >
        <div className="assignment-dialog-fields">
          {context.mode === "resource-group" ? (
            <SelectField
              id="assignment-target-aircraft"
              label="Flugzeug"
              onChange={(event) => {
                const nextAircraftId = event.target.value;
                const nextAircraft = board.aircraft.find((entry) => entry.id === nextAircraftId);
                setAircraftId(nextAircraftId);
                setResourceGroupId(fixedResourceGroupId || nextAircraft?.resourceGroupId || "");
              }}
              value={aircraftId}
            >
              <option value="">Bitte wählen</option>
              {board.aircraft.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.registration}
                </option>
              ))}
            </SelectField>
          ) : (
            <div className="assignment-fixed-value">
              <span>Flugzeug</span>
              <strong>{aircraft?.registration ?? "–"}</strong>
            </div>
          )}
          <section className="assignment-preview" aria-label="Zuordnungsvorschau">
            <div>
              <span>Bisher</span>
              <strong>{aircraft?.resourceGroupName || "Nicht zugeordnet"}</strong>
            </div>
            <ArrowRight aria-hidden="true" />
            <div>
              <span>Neu</span>
              <strong>{targetGroup?.name ?? "Bitte wählen"}</strong>
            </div>
          </section>
          {context.mode === "aircraft" ? (
            <SelectField
              id="assignment-target-group"
              label="Neue Ressourcengruppe"
              onChange={(event) => setResourceGroupId(event.target.value)}
              value={resourceGroupId}
            >
              <option value="">Bitte wählen</option>
              {board.resourceGroups
                .filter((group) => group.status !== "ENDED")
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </SelectField>
          ) : (
            <div className="assignment-fixed-value">
              <span>Zielgruppe</span>
              <strong>{targetGroup?.name ?? "–"}</strong>
            </div>
          )}
          <p className="assignment-effective-note">
            Wirksam ab Bestätigung. Die Anwendung trifft keine flugbetriebliche oder
            sicherheitsbezogene Entscheidung.
          </p>
        </div>
      </ModalDialog>
      <ConfirmationDialog
        body={<p>Die noch nicht bestätigte Auswahl wird verworfen.</p>}
        confirmLabel="Auswahl verwerfen"
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={onClose}
        open={discardOpen}
        portal
        title="Zuordnungsänderung verwerfen?"
      />
    </>
  );
}
