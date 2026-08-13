import type { AdminEventFlow, OperationBoard } from "@rundflug/contracts";
import { ValidationHint } from "../../../admin-ux";
import { AdminEventFlowChart } from "../AdminEventFlowChart";
import { pushStatusLabel, pushSubscriptionCount } from "./admin-overview-presentation";

export type PushConfigurationStatus = "loading" | "configured" | "missing" | "unavailable";

interface AdminOverviewPanelProps {
  board: OperationBoard;
  eventFlow: AdminEventFlow | null;
  eventFlowError: string | null;
  eventFlowLoading: boolean;
  pushConfigurationStatus: PushConfigurationStatus;
}

export function AdminOverviewPanel({
  board,
  eventFlow,
  eventFlowError,
  eventFlowLoading,
  pushConfigurationStatus,
}: Readonly<AdminOverviewPanelProps>) {
  return (
    <>
      <div>
        <AdminEventFlowChart
          averageWaitMinutes={board.metrics.averageWaitMinutes}
          error={eventFlowError}
          flow={eventFlow}
          loading={eventFlowLoading}
          timeZone={board.event.timeZone}
        />
      </div>
      <section aria-label="Betriebskennzahlen" className="metrics-grid">
        <div>
          <strong>{board.metrics.openTickets}</strong>
          <span>offene Tickets</span>
        </div>
        <div>
          <strong>{board.metrics.activeRotations}</strong>
          <span>aktive Umläufe</span>
        </div>
        <div>
          <strong>{board.metrics.completedRotations}</strong>
          <span>abgeschlossen</span>
        </div>
        <div>
          <strong>{board.metrics.averageBoardingMinutes ?? "–"}</strong>
          <span>Ø Boarding Min.</span>
        </div>
        <div>
          <strong>{board.metrics.averageFlightMinutes ?? "–"}</strong>
          <span>Ø Flug Min.</span>
        </div>
        <div>
          <strong>{board.metrics.averageTurnaroundMinutes ?? "–"}</strong>
          <span>Ø Landung–frei Min.</span>
        </div>
        <div>
          <strong>{board.metrics.averageRotationMinutes ?? "–"}</strong>
          <span>Ø Boarding-Aufruf–frei Min.</span>
        </div>
        <div>
          <strong>{board.metrics.averageWaitMinutes ?? "–"}</strong>
          <span>Ø Verkauf–Boarding-Aufruf Min.</span>
        </div>
        <div>
          <strong>
            {(board.metrics.informationalRevenueCents / 100).toLocaleString("de-DE", {
              style: "currency",
              currency: "EUR",
            })}
          </strong>
          <span>informatorischer Umsatz</span>
        </div>
        <div>
          <strong>{board.metrics.activeDevices}</strong>
          <span>Aktive Sitzungen</span>
        </div>
        <div>
          <strong>
            {pushSubscriptionCount(pushConfigurationStatus, board.metrics.activePushSubscriptions)}
          </strong>
          <span>{pushStatusLabel(pushConfigurationStatus)}</span>
        </div>
      </section>
      {pushConfigurationStatus === "missing" ? (
        <ValidationHint tone="warning">
          <strong>Web-Push ist noch nicht eingerichtet.</strong> VAPID-Secrets mit{" "}
          <code>npm run cloudflare:configure-push</code> setzen und danach auf einem echten
          Besuchergerät testen.
        </ValidationHint>
      ) : null}
    </>
  );
}
