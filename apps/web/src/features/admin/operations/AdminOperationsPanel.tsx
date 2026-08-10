import type { OperationBoard } from "@rundflug/contracts";
import { CheckCircle2, Clock3, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { SetupStep } from "../../../admin-ux";
import {
  Button,
  ConfirmationDialog,
  PageHeader,
  Panel,
  StatusPill,
} from "../../../design-system/components";
import { FieldLabel } from "../../../operation-workspace";
import { OperationsWorkspace } from "./OperationsWorkspace";

type EmergencyAction = "TRIGGER_EMERGENCY" | "CLEAR_EMERGENCY";

interface AdminOperationsPanelProps {
  administrator: boolean;
  board: OperationBoard;
  busyActionKey: string | null;
  completedSetupSteps: number;
  onEmergency: (action: EmergencyAction, reason: string) => Promise<boolean>;
  onOpenSetupStep: (step: SetupStep) => void;
  onRequestAdminAction: (action: () => Promise<void>) => void | Promise<void>;
  onSetEventLifecycle: (status: "ACTIVE" | "CLOSED") => void | Promise<void>;
  setupComplete: boolean;
  setupSteps: SetupStep[];
}

export function AdminOperationsPanel({
  administrator,
  board,
  busyActionKey,
  completedSetupSteps,
  onEmergency,
  onOpenSetupStep,
  onRequestAdminAction,
  onSetEventLifecycle,
  setupComplete,
  setupSteps,
}: AdminOperationsPanelProps) {
  const [emergencyReason, setEmergencyReason] = useState("");
  const [endOperationsConfirmOpen, setEndOperationsConfirmOpen] = useState(false);
  const [pendingEmergencyAction, setPendingEmergencyAction] = useState<EmergencyAction | null>(
    null,
  );
  const eventIsReleased = board.event.status === "ACTIVE" || board.event.status === "CLOSED";

  async function confirmEmergencyAction() {
    const action = pendingEmergencyAction;
    setPendingEmergencyAction(null);
    if (!action) return;
    const execute = async () => {
      if (await onEmergency(action, emergencyReason.trim())) setEmergencyReason("");
    };
    if (action === "CLEAR_EMERGENCY") return onRequestAdminAction(execute);
    return execute();
  }

  return (
    <section
      aria-labelledby="admin-event-step-operations-tab"
      id="admin-event-step-operations-panel"
      role="tabpanel"
    >
      <OperationsWorkspace
        board={board}
        release={
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
            {eventIsReleased ? (
              <>
                <p className="event-release-ready">
                  <CheckCircle2 aria-hidden="true" />{" "}
                  {board.event.status === "ACTIVE"
                    ? "Der Veranstaltungsbetrieb ist freigegeben."
                    : "Der Veranstaltungsbetrieb ist geschlossen."}
                </p>
                {board.event.status === "ACTIVE" ? (
                  <div className="event-release-action">
                    <Button
                      disabled={!administrator}
                      onClick={() => setEndOperationsConfirmOpen(true)}
                      variant="danger"
                    >
                      Betrieb beenden
                    </Button>
                  </div>
                ) : null}
              </>
            ) : !setupComplete ? (
              <>
                <p>
                  Die Veranstaltung ist noch nicht betriebsbereit. Bitte erledige die offenen
                  Punkte, um den Betrieb freizugeben.
                </p>
                <ul className="event-release-missing">
                  {setupSteps
                    .slice(0, 6)
                    .filter((step) => !step.complete)
                    .map((step) => (
                      <li key={step.id}>
                        <Clock3 aria-hidden="true" />
                        <Button
                          onClick={() => onOpenSetupStep(step)}
                          size="compact"
                          variant="ghost"
                        >
                          {step.label} fehlt
                        </Button>
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <p className="event-release-ready">
                <CheckCircle2 aria-hidden="true" /> Alle Einrichtungsschritte sind abgeschlossen.
              </p>
            )}
            {!eventIsReleased ? (
              <div className="event-release-action">
                <Button
                  disabled={!administrator || !setupComplete}
                  onClick={() => onRequestAdminAction(async () => onSetEventLifecycle("ACTIVE"))}
                  variant="primary"
                >
                  <LockKeyhole aria-hidden="true" /> Betrieb freigeben
                </Button>
              </div>
            ) : null}
          </Panel>
        }
        emergency={
          <Panel className="admin-emergency-section" padding="compact">
            <h2>Notfallmodus</h2>
            <p>
              Aktivierung und Aufhebung werden getrennt bestätigt. Versteckte Flotten-, Piloten-,
              Queue- und Hinweissteuerungen gehören nicht zu diesem Admin-Ablauf.
            </p>
            <div className="operations-emergency-action">
              <div className="field-control">
                <FieldLabel
                  htmlFor="emergency-reason"
                  label="Begründung für den Notfallmodus"
                  help="Mindestens drei Zeichen; der Grund wird mit der Zustandsänderung protokolliert."
                />
                <input
                  id="emergency-reason"
                  onChange={(event) => setEmergencyReason(event.target.value)}
                  placeholder="Mindestens 3 Zeichen"
                  value={emergencyReason}
                />
              </div>
              <Button
                busy={
                  busyActionKey ===
                  (board.event.emergencyMode ? "emergency-clear" : "emergency-trigger")
                }
                className="danger-action"
                disabled={
                  emergencyReason.trim().length < 3 ||
                  busyActionKey !== null ||
                  (board.event.emergencyMode && !administrator)
                }
                onClick={() =>
                  setPendingEmergencyAction(
                    board.event.emergencyMode ? "CLEAR_EMERGENCY" : "TRIGGER_EMERGENCY",
                  )
                }
                type="button"
                variant="danger"
              >
                {board.event.emergencyMode ? "Notfallmodus aufheben" : "Not-Halt auslösen"}
              </Button>
            </div>
          </Panel>
        }
      />
      <ConfirmationDialog
        body={
          <p>
            Nach dem Betriebsende sind keine regulären operativen Änderungen mehr möglich. Der
            Vorgang wird protokolliert.
          </p>
        }
        confirmLabel="Betrieb jetzt beenden"
        danger
        onCancel={() => setEndOperationsConfirmOpen(false)}
        onConfirm={() => {
          setEndOperationsConfirmOpen(false);
          return onRequestAdminAction(async () => onSetEventLifecycle("CLOSED"));
        }}
        open={endOperationsConfirmOpen}
        title="Betrieb wirklich beenden?"
      />
      <ConfirmationDialog
        body={
          <p>
            {pendingEmergencyAction === "CLEAR_EMERGENCY"
              ? "Der Notfallmodus wird aufgehoben und die Aufhebung protokolliert."
              : "Der Notfallmodus wird veranstaltungsweit aktiviert und protokolliert."}
          </p>
        }
        confirmLabel={
          pendingEmergencyAction === "CLEAR_EMERGENCY"
            ? "Notfallmodus aufheben"
            : "Not-Halt auslösen"
        }
        danger
        onCancel={() => setPendingEmergencyAction(null)}
        onConfirm={confirmEmergencyAction}
        open={pendingEmergencyAction !== null}
        title={
          pendingEmergencyAction === "CLEAR_EMERGENCY"
            ? "Notfallmodus wirklich aufheben?"
            : "Not-Halt wirklich auslösen?"
        }
      />
    </section>
  );
}
