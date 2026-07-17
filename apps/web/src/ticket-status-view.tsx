import type { PublicTicketStatus } from "@rundflug/contracts";
import { useEffect, useState } from "react";
import {
  getPublicTicketStatus,
  getPushPublicKey,
  registerTicketPush,
  revokeTicketPush,
} from "./api";
import { AppShell as Shell } from "./app/AppShell";
import {
  nextBoardReconnectDelay,
  OPERATION_BOARD_POLL_INTERVAL_MS,
  OPERATION_BOARD_RECONNECT_INITIAL_MS,
} from "./board-sync";
import { OperationalNotice, publicStatusLabel } from "./operation-workspace";
import {
  isRealtimeStateChange,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  sendRealtimeHeartbeat,
} from "./realtime-heartbeat";

export function TicketStatusView({ code }: { code: string }) {
  const [status, setStatus] = useState<PublicTicketStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectDelay = OPERATION_BOARD_RECONNECT_INITIAL_MS;
    const stopHeartbeat = () => {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };
    const controller = new AbortController();
    const refresh = () =>
      getPublicTicketStatus(code, controller.signal)
        .then((nextStatus) => {
          if (active) setStatus(nextStatus);
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
  useEffect(() => {
    navigator.serviceWorker?.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) =>
        setPush(
          Boolean(subscription) && window.localStorage.getItem(`ticket-push:${code}`) === "1",
        ),
      )
      .catch(() => undefined);
  }, [code]);

  const changePush = async (enabled: boolean) => {
    setPushMessage(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Web-Push wird von diesem Browser nicht unterstützt.");
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!enabled) {
        if (existing) {
          await revokeTicketPush(code, existing.endpoint);
          await existing.unsubscribe();
        }
        window.localStorage.removeItem(`ticket-push:${code}`);
        setPush(false);
        setPushMessage("Web-Push wurde deaktiviert; das Push-Ziel wird gelöscht.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Benachrichtigungen wurden nicht freigegeben.");
      const publicKey = await getPushPublicKey();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        }));
      await registerTicketPush(code, subscription);
      window.localStorage.setItem(`ticket-push:${code}`, "1");
      setPush(true);
      setPushMessage("Web-Push ist für dieses Ticket aktiviert.");
    } catch (reason) {
      setPush(false);
      setPushMessage(reason instanceof Error ? reason.message : "Web-Push ist nicht verfügbar.");
    }
  };
  return (
    <Shell title="Ticketstatus">
      <section className="ticket-status-page">
        <span className="eyebrow">Ihr Ticketcode</span>
        <code>{code}</code>
        {status ? (
          <>
            <h1>
              {status.productCode} · {status.productName}
            </h1>
            {status.publicDescription ? <p>{status.publicDescription}</p> : null}
            <p>Gate: {status.gateLabel}</p>
            <div className="public-status">
              <span>Fluggruppe {status.communicationNumber}</span>
              <strong>{publicStatusLabel[status.status]}</strong>
            </div>
            <p>{status.message}</p>
            <OperationalNotice note={status.operationalNotice} />
            {status.predictionQuality === "UNCERTAIN" ? (
              <div className="uncertainty">Betrieb verzögert – bitte Status erneut prüfen</div>
            ) : (
              <div className="time-window">
                Zeitfenster {status.waitLowerMinutes}–{status.waitUpperMinutes} Minuten
              </div>
            )}
            <label className="push-toggle">
              <span>
                <strong>Web-Push</strong>
                <small>Freiwillige Status-Updates für dieses Ticket</small>
              </span>
              <input
                type="checkbox"
                checked={push}
                onChange={(event) => void changePush(event.target.checked)}
              />
            </label>
            {pushMessage ? (
              <p className="push-message" role="status">
                {pushMessage}
              </p>
            ) : null}
            <a className="privacy-link" href="/datenschutz">
              Datenschutz &amp; Privatsphäre
            </a>
          </>
        ) : (
          <p>{error ?? "Status wird geladen …"}</p>
        )}
      </section>
    </Shell>
  );
}
