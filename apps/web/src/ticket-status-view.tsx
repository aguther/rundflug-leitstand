import type { PublicTicketStatus } from "@rundflug/contracts";
import { formatBookingGroupLabel } from "@rundflug/domain";
import { useEffect, useState } from "react";
import { getPublicTicketStatus } from "./api";
import { AppShell as Shell } from "./app/AppShell";
import {
  nextBoardReconnectDelay,
  OPERATION_BOARD_POLL_INTERVAL_MS,
  OPERATION_BOARD_RECONNECT_INITIAL_MS,
} from "./board-sync";
import {
  PublicStatusFooter,
  PublicStatusIdentity,
  PublicStatusPart,
} from "./features/public-status/PublicStatusContent";
import { usePublicPush } from "./features/public-status/use-public-push";
import { usePublicStatusManifest } from "./features/public-status/use-public-status-manifest";
import {
  isRealtimeStateChange,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  sendRealtimeHeartbeat,
} from "./realtime-heartbeat";

export function TicketStatusView({ code }: { code: string }) {
  const [status, setStatus] = useState<PublicTicketStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const push = usePublicPush("ticket", code);
  usePublicStatusManifest("ticket", code);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectDelay = OPERATION_BOARD_RECONNECT_INITIAL_MS;
    const controller = new AbortController();
    const stopHeartbeat = () => {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };
    const refresh = () =>
      getPublicTicketStatus(code, controller.signal)
        .then((nextStatus) => {
          if (active) {
            setStatus(nextStatus);
            setError(null);
          }
          return nextStatus;
        })
        .catch((reason) => {
          if (active)
            setError(reason instanceof Error ? reason.message : "Status nicht verfügbar.");
          return null;
        });
    const connect = (eventId: string) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/public/events/${encodeURIComponent(eventId)}/live`,
      );
      socket.addEventListener("open", () => {
        reconnectDelay = OPERATION_BOARD_RECONNECT_INITIAL_MS;
        stopHeartbeat();
        heartbeatTimer = window.setInterval(
          () => sendRealtimeHeartbeat(socket),
          REALTIME_HEARTBEAT_INTERVAL_MS,
        );
        void refresh();
      });
      socket.addEventListener("message", (event) => {
        if (isRealtimeStateChange(event.data)) void refresh();
      });
      socket.addEventListener("close", () => {
        stopHeartbeat();
        if (!active) return;
        reconnectTimer = window.setTimeout(() => connect(eventId), reconnectDelay);
        reconnectDelay = nextBoardReconnectDelay(reconnectDelay);
      });
      socket.addEventListener("error", () => socket?.close());
    };
    void refresh().then((nextStatus) => {
      if (nextStatus && active) connect(nextStatus.eventId);
    });
    const timer = window.setInterval(() => void refresh(), OPERATION_BOARD_POLL_INTERVAL_MS);
    return () => {
      active = false;
      controller.abort();
      socket?.close();
      stopHeartbeat();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      window.clearInterval(timer);
    };
  }, [code]);

  return (
    <Shell
      publicView
      className="public-status-shell"
      {...(status ? { publicEvent: { eventId: status.eventId, eventName: status.eventName } } : {})}
      title="Ticketstatus"
    >
      <section className="public-status-page">
        {status ? (
          <>
            <PublicStatusIdentity
              bookingGroupLabel={formatBookingGroupLabel(
                status.productCode,
                status.communicationNumber,
              )}
              productName={status.productName}
            />
            <div className="public-status-parts">
              <PublicStatusPart
                part={status}
                pauseReason={status.operationalNotice}
                timeZone={status.timeZone}
              />
            </div>
            <PublicStatusFooter
              push={push}
              pushDescription="Mitteilung erhalten, wenn sich Ihr Rundflug ändert."
              timeZone={status.timeZone}
              updatedAt={status.updatedAt}
            />
          </>
        ) : (
          <p className="public-status-loading">{error ?? "Status wird geladen …"}</p>
        )}
      </section>
    </Shell>
  );
}
