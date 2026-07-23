import type { PublicGroupStatus } from "@rundflug/contracts";
import { Bell, Clock3, Info, MapPin, RefreshCw, Ticket, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { getPublicGroupStatus, getPushPublicKey, registerGroupPush, revokeGroupPush } from "./api";
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
import { formatAbsoluteTimeWindow } from "./time-window";

type GroupPart = PublicGroupStatus["parts"][number];

function partWindow(part: GroupPart, timeZone: string): string {
  return formatAbsoluteTimeWindow({
    lowerAt: part.boardingWindowLowerAt,
    upperAt: part.boardingWindowUpperAt,
    timeZone,
    quality: part.predictionQuality,
    phase:
      part.status === "COME_TO_FLIGHT_LINE" || part.status === "BOARDING"
        ? "NOW"
        : ["IN_FLIGHT", "LANDED", "COMPLETED"].includes(part.status)
          ? "FINISHED"
          : "FORECAST",
  });
}

export function GroupStatusView({ code }: { code: string }) {
  const [status, setStatus] = useState<PublicGroupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

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
      getPublicGroupStatus(code, controller.signal)
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

  useEffect(() => {
    navigator.serviceWorker?.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) =>
        setPush(Boolean(subscription) && localStorage.getItem(`group-push:${code}`) === "1"),
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
          await revokeGroupPush(code, existing.endpoint);
          await existing.unsubscribe();
        }
        localStorage.removeItem(`group-push:${code}`);
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
      await registerGroupPush(code, subscription);
      localStorage.setItem(`group-push:${code}`, "1");
      setPush(true);
      setPushMessage("Web-Push ist für diese Gruppe aktiviert.");
    } catch (reason) {
      setPush(false);
      setPushMessage(reason instanceof Error ? reason.message : "Web-Push ist nicht verfügbar.");
    }
  };

  return (
    <Shell publicView title="Gruppenstatus">
      <section className="ticket-status-page group-status-page">
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
                <span>Gruppe {status.bookingGroupLabel}</span>
                <h1>{status.productName}</h1>
                <small>
                  {status.groupSize} Person{status.groupSize === 1 ? "" : "en"}
                </small>
              </div>
            </div>
            <OperationalNotice note={status.operationalNotice} />
            <div className="group-status-parts">
              {status.parts.map((part) => (
                <article className="group-status-part" key={part.partNumber}>
                  <header>
                    <strong>
                      {part.partCount > 1
                        ? `Teilflug ${part.partNumber} von ${part.partCount}`
                        : "Ihr Rundflug"}
                    </strong>
                    <span>
                      <Users aria-hidden="true" />
                      {part.passengerCount} Person{part.passengerCount === 1 ? "" : "en"}
                    </span>
                  </header>
                  <section className="ticket-current-status">
                    <span className="eyebrow">Aktueller Status</span>
                    <strong>{publicStatusLabel[part.status]}</strong>
                    <p>{part.message}</p>
                  </section>
                  <div className="ticket-status-metrics">
                    <div>
                      <MapPin aria-hidden="true" />
                      <span>Gate</span>
                      <strong>{part.gateLabel || "–"}</strong>
                    </div>
                    <div>
                      <Clock3 aria-hidden="true" />
                      <span>Geschätztes Zeitfenster</span>
                      <strong>{partWindow(part, status.timeZone)}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="ticket-updated">
              <Clock3 aria-hidden="true" /> Zuletzt aktualisiert{" "}
              {new Date(status.updatedAt).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: status.timeZone,
              })}
            </div>
            <label className="push-toggle">
              <Bell aria-hidden="true" />
              <span>
                <strong>Benachrichtigungen aktivieren</strong>
                <small>Eine Mitteilung erhalten, wenn sich ein Teilflug ändert.</small>
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
              <Info aria-hidden="true" /> Öffentlicher Gruppenstatus · Datenschutz &amp;
              Privatsphäre
            </a>
          </>
        ) : (
          <p>{error ?? "Status wird geladen …"}</p>
        )}
      </section>
    </Shell>
  );
}
