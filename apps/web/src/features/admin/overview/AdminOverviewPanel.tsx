import type { AdminEventFlow, OperationBoard } from "@rundflug/contracts";
import { ValidationHint } from "../../../admin-ux";
import { AdminEventFlowChart } from "../AdminEventFlowChart";

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
}: AdminOverviewPanelProps) {
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
            {pushConfigurationStatus === "configured"
              ? board.metrics.activePushSubscriptions
              : pushConfigurationStatus === "loading"
                ? "…"
                : "–"}
          </strong>
          <span>
            {pushConfigurationStatus === "configured"
              ? "Web-Push aktiv"
              : pushConfigurationStatus === "missing"
                ? "Web-Push fehlt"
                : pushConfigurationStatus === "loading"
                  ? "Web-Push wird geprüft"
                  : "Web-Push nicht geprüft"}
          </span>
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
