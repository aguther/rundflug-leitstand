import type { PublicTicketStatus } from "@rundflug/contracts";
import { formatBookingGroupLabel } from "@rundflug/domain";
import { Bell, Check, Clock3, Info, MapPin, RefreshCw, Ticket, Users } from "lucide-react";
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
  const progressStates = ["WAITING", "COME_TO_FLIGHT_LINE", "BOARDING", "IN_FLIGHT"] as const;
  const progressIndex = status
    ? Math.max(
        0,
        progressStates.indexOf(
          status.status === "PREPARE"
            ? "WAITING"
            : status.status === "LANDED" || status.status === "COMPLETED"
              ? "IN_FLIGHT"
              : status.status === "SERVICE_PAUSED"
                ? "WAITING"
                : status.status,
        ),
      )
    : 0;
  return (
    <Shell publicView title="Ticketstatus">
      <section className="ticket-status-page">
        {status ? (
          <>
            <header className="ticket-live-header">
              <span>
                <RefreshCw aria-hidden="true" />
                <strong>Live</strong>
              </span>
              <small>Verbindung stabil</small>
            </header>
            <div className="ticket-identity">
              <Ticket aria-hidden="true" />
              <div>
                <span>
                  Gruppe {formatBookingGroupLabel(status.productCode, status.communicationNumber)}
                </span>
                <h1>{status.productName}</h1>
                <code>{code}</code>
              </div>
            </div>
            <section className="ticket-current-status">
              <span className="eyebrow">Aktueller Status</span>
              <strong>{publicStatusLabel[status.status]}</strong>
              <p>{status.message}</p>
            </section>
            <section className="ticket-gate-callout">
              <MapPin aria-hidden="true" />
              <div>
                <strong>Gate {status.gateLabel}</strong>
                <span>
                  {status.status === "COME_TO_FLIGHT_LINE" || status.status === "BOARDING"
                    ? "Bitte jetzt zum Gate"
                    : "Gate für Ihren Rundflug"}
                </span>
              </div>
            </section>
            <OperationalNotice note={status.operationalNotice} />
            <div className="ticket-status-metrics">
              <div>
                <Clock3 aria-hidden="true" />
                <span>Geschätztes Zeitfenster</span>
                <strong>
                  {status.predictionQuality === "UNCERTAIN"
                    ? "Wird aktualisiert"
                    : `${status.waitLowerMinutes}–${status.waitUpperMinutes} Min.`}
                </strong>
              </div>
              <div>
                <Users aria-hidden="true" />
                <span>Position in der Warteschlange</span>
                <strong>{status.queuePosition ?? "–"}</strong>
              </div>
            </div>
            <section className="ticket-progress" aria-label="Statusübersicht">
              {[
                ["Warten", "WAITING"],
                ["Bitte zum Gate", "COME_TO_FLIGHT_LINE"],
                ["Boarding", "BOARDING"],
                ["Abgeflogen", "IN_FLIGHT"],
              ].map(([label, state], index) => (
                <div
                  className={
                    index < progressIndex ? "done" : index === progressIndex ? "current" : ""
                  }
                  key={state}
                >
                  <span>{index < progressIndex ? <Check aria-hidden="true" /> : index + 1}</span>
                  <strong>{label}</strong>
                  <small>
                    {index < progressIndex
                      ? "Erledigt"
                      : index === progressIndex
                        ? "Aktuell"
                        : "Ausstehend"}
                  </small>
                </div>
              ))}
            </section>
            <div className="ticket-updated">
              <Clock3 aria-hidden="true" /> Zuletzt aktualisiert{" "}
              {new Date(status.updatedAt).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <label className="push-toggle">
              <Bell aria-hidden="true" />
              <span>
                <strong>Benachrichtigungen aktivieren</strong>
                <small>Eine Mitteilung erhalten, wenn sich der Status ändert.</small>
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
              <Info aria-hidden="true" /> Öffentlicher Ticketstatus · Datenschutz &amp; Privatsphäre
            </a>
          </>
        ) : (
          <p>{error ?? "Status wird geladen …"}</p>
        )}
      </section>
    </Shell>
  );
}
