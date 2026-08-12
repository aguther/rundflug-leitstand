import { ExternalLink, FlaskConical } from "lucide-react";
import { downloadSimulationPlan } from "../../../api";
import { Button } from "../../../design-system/components";
import { useAdminOperationIdentity } from "../../operations/operation-identity";

interface AdminSimulationLauncherProps {
  available: boolean;
  busyActionKey: string | null;
  onMessage: (message: string) => void;
  onRunBusyAction: (key: string, action: () => Promise<void>) => Promise<void>;
}

export function AdminSimulationLauncher({
  available,
  busyActionKey,
  onMessage,
  onRunBusyAction,
}: AdminSimulationLauncherProps) {
  const {
    eventId: EVENT_ID,
    deviceId: ADMIN_DEVICE_ID,
    deviceToken: ADMIN_DEVICE_TOKEN,
  } = useAdminOperationIdentity();
  async function exportSimulationPlan() {
    await downloadSimulationPlan(EVENT_ID, ADMIN_DEVICE_ID, ADMIN_DEVICE_TOKEN);
    onMessage("Stammdaten und offener Betriebsplan wurden für die Simulation exportiert.");
  }

  return (
    <section className="admin-section admin-simulator-launch">
      <div className="admin-simulator-launch-copy">
        <span aria-hidden="true" className="admin-simulator-launch-icon">
          <FlaskConical />
        </span>
        <div>
          <div className="admin-simulator-launch-title">
            <h2>Prognose-Simulator</h2>
            <span>Nur Simulation</span>
          </div>
          <p>
            Stammdaten und offene Planeinträge als lokale Simulationsgrundlage verwenden.{" "}
            {"Tickets, Ist-Verläufe und operative Zustände werden nicht exportiert."}
          </p>
        </div>
      </div>
      <div className="admin-simulator-launch-actions">
        <Button
          busy={busyActionKey === "export-simulation-plan"}
          disabled={!available || busyActionKey !== null}
          onClick={() => void onRunBusyAction("export-simulation-plan", exportSimulationPlan)}
          type="button"
        >
          Simulationsgrundlage exportieren
        </Button>
        <a
          className="admin-simulator-launch-action"
          href="/simulation"
          rel="noopener"
          target="_blank"
        >
          Prognose-Simulator öffnen
          <ExternalLink aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
