import type { OperationBoard } from "@rundflug/contracts";
import type { ComponentProps } from "react";
import { Button, ModalDialog } from "../../design-system/components";
import { FlightDirectorOperationsDialog } from "./FlightDirectorOperationsDialog";

type OperationsProps = ComponentProps<typeof FlightDirectorOperationsDialog>;
type OperationsSection = "operations" | "plan" | "resources";

interface FlightLineWorkspaceDialogsProps {
  aircraftPauseOpen: boolean;
  board: OperationBoard | null | undefined;
  canManageAircraft: boolean;
  onAbortTechnicalRotation: () => Promise<void>;
  onCloseAircraftPause: () => void;
  onCloseOperations: () => void;
  onCloseTechnicalAbort: () => void;
  onSetTechnicalAbortReason: (reason: string) => void;
  onStartAircraftPause: (minutes: 10 | 20 | 30 | null) => void;
  operationsBusy: boolean;
  operationsSection: OperationsSection | null;
  operationsProps: Omit<
    OperationsProps,
    | "aircraft"
    | "busy"
    | "eventId"
    | "eventTimeZone"
    | "onClose"
    | "pilots"
    | "plannedOperations"
    | "recurringOperationalRules"
    | "resourceGroups"
    | "rotations"
    | "section"
  >;
  selectedAircraft: OperationBoard["aircraft"][number] | null | undefined;
  technicalAbortOpen: boolean;
  technicalAbortReason: string;
}

export function FlightLineWorkspaceDialogs({
  aircraftPauseOpen,
  board,
  canManageAircraft,
  onAbortTechnicalRotation,
  onCloseAircraftPause,
  onCloseOperations,
  onCloseTechnicalAbort,
  onSetTechnicalAbortReason,
  onStartAircraftPause,
  operationsBusy,
  operationsSection,
  operationsProps,
  selectedAircraft,
  technicalAbortOpen,
  technicalAbortReason,
}: Readonly<FlightLineWorkspaceDialogsProps>) {
  return (
    <>
      {board ? (
        <FlightDirectorOperationsDialog
          {...operationsProps}
          aircraft={board.aircraft}
          busy={operationsBusy}
          eventId={board.event.eventId}
          eventTimeZone={board.event.timeZone}
          onClose={onCloseOperations}
          pilots={board.pilots}
          plannedOperations={board.plannedOperations}
          recurringOperationalRules={board.recurringOperationalRules}
          resourceGroups={board.resourceGroups}
          rotations={board.rotations}
          section={canManageAircraft ? operationsSection : null}
        />
      ) : null}
      <ModalDialog
        footer={
          <Button onClick={onCloseAircraftPause} type="button" variant="secondary">
            Abbrechen
          </Button>
        }
        onClose={onCloseAircraftPause}
        open={aircraftPauseOpen && Boolean(selectedAircraft)}
        size="compact"
        title={selectedAircraft ? `Pause für ${selectedAircraft.registration}` : "Pause"}
      >
        <div className="aircraft-pause-options">
          {([10, 20, 30] as const).map((minutes) => (
            <Button
              key={minutes}
              onClick={() => onStartAircraftPause(minutes)}
              size="touch"
              type="button"
              variant="primary"
            >
              {minutes} Min.
            </Button>
          ))}
          <Button
            onClick={() => onStartAircraftPause(null)}
            size="touch"
            type="button"
            variant="secondary"
          >
            Dauer unbekannt
          </Button>
        </div>
      </ModalDialog>
      <ModalDialog
        description="Alle Gäste dieses Umlaufs werden mit ihren vollständigen Gruppen ganz vorne in die Warteschlange zurückgestellt. Das Flugzeug wird nicht verfügbar."
        footer={
          <>
            <Button onClick={onCloseTechnicalAbort} type="button" variant="secondary">
              Abbrechen
            </Button>
            <Button
              disabled={technicalAbortReason.trim().length < 3}
              onClick={() => void onAbortTechnicalRotation()}
              type="button"
              variant="danger"
            >
              Abbrechen &amp; nicht verfügbar
            </Button>
          </>
        }
        onClose={onCloseTechnicalAbort}
        open={technicalAbortOpen}
        size="compact"
        title="Umlauf abbrechen?"
      >
        <label className="technical-abort-reason">
          Grund{" "}
          <input
            maxLength={500}
            onChange={(event) => onSetTechnicalAbortReason(event.target.value)}
            placeholder="z. B. technisches Problem beim Run-Up"
            value={technicalAbortReason}
          />
        </label>
      </ModalDialog>
    </>
  );
}
