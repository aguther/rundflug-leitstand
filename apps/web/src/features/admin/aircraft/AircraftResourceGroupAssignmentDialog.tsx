import type { OperationBoard } from "@rundflug/contracts";
import { ArrowRight, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ModalDialog, SelectField } from "../../../design-system/components";

export type AircraftResourceGroupAssignmentContext =
  | { mode: "aircraft"; aircraftId: string }
  | { mode: "resource-group"; resourceGroupId: string };

type BoardAircraft = OperationBoard["aircraft"][number];
type BoardResourceGroup = OperationBoard["resourceGroups"][number];

interface AssignmentValidationInput {
  activeRotation: boolean;
  aircraft: BoardAircraft | undefined;
  compatible: boolean;
  targetGroup: BoardResourceGroup | undefined;
}

function assignmentValidationMessage({
  activeRotation,
  aircraft,
  compatible,
  targetGroup,
}: Readonly<AssignmentValidationInput>) {
  if (!aircraft || !targetGroup) {
    return "Flugzeug und Zielgruppe müssen vollständig ausgewählt sein.";
  }
  if (aircraft.resourceGroupId === targetGroup.id) {
    return "Das Flugzeug ist bereits dieser Ressourcengruppe zugeordnet.";
  }
  if (activeRotation) {
    return "Ein aktiver Umlauf sperrt die Zuordnung nach dem aktuell geladenen Stand.";
  }
  if (!compatible) {
    return "Der Flugzeugtyp ist für die Zielgruppe nicht als kompatibel hinterlegt.";
  }
  if (targetGroup.status === "ENDED") {
    return "Eine beendete Ressourcengruppe kann kein Zuordnungsziel sein.";
  }
  return "Die Kombination ist nach dem aktuell geladenen Stand zuordenbar.";
}

export function AircraftResourceGroupAssignmentDialog({
  board,
  context,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  board: OperationBoard;
  context: AircraftResourceGroupAssignmentContext | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (aircraftId: string, resourceGroupId: string) => void;
}>) {
  const fixedAircraftId = context?.mode === "aircraft" ? context.aircraftId : "";
  const fixedResourceGroupId = context?.mode === "resource-group" ? context.resourceGroupId : "";
  const [aircraftId, setAircraftId] = useState(fixedAircraftId);
  const [resourceGroupId, setResourceGroupId] = useState(fixedResourceGroupId);

  useEffect(() => {
    setAircraftId(fixedAircraftId);
    setResourceGroupId(fixedResourceGroupId);
  }, [fixedAircraftId, fixedResourceGroupId]);

  if (!context) return null;
  const aircraft = board.aircraft.find((entry) => entry.id === aircraftId);
  const targetGroup = board.resourceGroups.find((entry) => entry.id === resourceGroupId);
  const activeRotation = board.rotations.some(
    (rotation) =>
      rotation.aircraftId === aircraftId &&
      ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status),
  );
  const compatible = Boolean(
    aircraft &&
      targetGroup &&
      (targetGroup.compatibleAircraftTypes.length === 0 ||
        targetGroup.compatibleAircraftTypes.includes(aircraft.aircraftType)),
  );
  const canSubmit = Boolean(
    aircraft &&
      targetGroup &&
      targetGroup.status !== "ENDED" &&
      aircraft.resourceGroupId !== targetGroup.id &&
      compatible &&
      !activeRotation &&
      !busy,
  );
  const validationMessage = assignmentValidationMessage({
    activeRotation,
    aircraft,
    compatible,
    targetGroup,
  });

  function requestClose() {
    if (!busy) onClose();
  }

  return (
    <ModalDialog
      className="aircraft-assignment-dialog"
      description="Die Auswahl ändert noch nichts. Erst die Bestätigung sendet die historisierte Einzelzuordnung an den Server."
      footer={
        <>
          <Button disabled={busy} onClick={requestClose} type="button" variant="secondary">
            Abbrechen
          </Button>
          <Button
            busy={busy}
            busyLabel="Zuordnung wird bestätigt"
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
      title="Einzelzuordnung Flugzeug–Ressourcengruppe"
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
        <section className="assignment-server-checks" aria-label="Prüfbedingungen">
          <strong>Prüfung vor der Zuordnung</strong>
          <p>{validationMessage}</p>
          <small>
            Beim Bestätigen prüft der Server Version, aktive Umläufe, eindeutige Mitgliedschaft und
            Kompatibilität erneut. Zwischenzeitliche Konflikte können die Zuordnung ablehnen.
          </small>
        </section>
      </div>
    </ModalDialog>
  );
}
