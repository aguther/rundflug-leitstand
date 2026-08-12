import type { OperationBoard } from "@rundflug/contracts";
import { CheckCircle2, Clock3, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import type { SetupStep } from "../../../admin-ux";
import { Button, PageHeader, Panel, StatusPill } from "../../../design-system/components";

interface AdminEventReleasePanelProps {
  administrator: boolean;
  board: OperationBoard;
  completedSetupSteps: number;
  onEndOperations: () => void;
  onOpenSetupStep: (step: SetupStep) => void;
  onReleaseOperations: () => void | Promise<void>;
  setupComplete: boolean;
  setupSteps: SetupStep[];
}

export function AdminEventReleasePanel({
  administrator,
  board,
  completedSetupSteps,
  onEndOperations,
  onOpenSetupStep,
  onReleaseOperations,
  setupComplete,
  setupSteps,
}: Readonly<AdminEventReleasePanelProps>) {
  const eventIsReleased = board.event.status === "ACTIVE" || board.event.status === "CLOSED";
  let releaseDetails: ReactNode;
  if (eventIsReleased) {
    releaseDetails = (
      <>
        <p className="event-release-ready">
          <CheckCircle2 aria-hidden="true" />{" "}
          {board.event.status === "ACTIVE"
            ? "Der Veranstaltungsbetrieb ist freigegeben."
            : "Der Veranstaltungsbetrieb ist geschlossen."}
        </p>
        {board.event.status === "ACTIVE" ? (
          <div className="event-release-action">
            <Button disabled={!administrator} onClick={onEndOperations} variant="danger">
              Betrieb beenden
            </Button>
          </div>
        ) : null}
      </>
    );
  } else if (!setupComplete) {
    releaseDetails = (
      <>
        <p>
          Die Veranstaltung ist noch nicht betriebsbereit. Bitte erledige die offenen Punkte, um den
          Betrieb freizugeben.
        </p>
        <ul className="event-release-missing">
          {setupSteps
            .slice(0, 6)
            .filter((step) => !step.complete)
            .map((step) => (
              <li key={step.id}>
                <Clock3 aria-hidden="true" />
                <Button onClick={() => onOpenSetupStep(step)} size="compact" variant="ghost">
                  {step.label} fehlt
                </Button>
              </li>
            ))}
        </ul>
      </>
    );
  } else {
    releaseDetails = (
      <p className="event-release-ready">
        <CheckCircle2 aria-hidden="true" /> Alle Einrichtungsschritte sind abgeschlossen.
      </p>
    );
  }
  return (
    <Panel className="event-release-v15" padding="compact">
      <PageHeader
        actions={
          <StatusPill tone={eventIsReleased || setupComplete ? "success" : "warning"}>
            {eventIsReleased ? "Freigegeben" : `${completedSetupSteps}/6 erledigt`}
          </StatusPill>
        }
        level={2}
        title="Betriebsfreigabe"
      />
      {releaseDetails}
      {!eventIsReleased ? (
        <div className="event-release-action">
          <Button
            disabled={!administrator || !setupComplete}
            onClick={onReleaseOperations}
            variant="primary"
          >
            <LockKeyhole aria-hidden="true" /> Betrieb freigeben
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
