import type { PublicBoard } from "@rundflug/contracts";
import { useEffect, useState } from "react";
import { getPublicBoard } from "./api";
import { FidsDisplay } from "./fids-display";
import { EVENT_ID } from "./operation-workspace";
import {
  isRealtimeStateChange,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  sendRealtimeHeartbeat,
} from "./realtime-heartbeat";

export function FidsView() {
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectDelay = 1_000;
    const stopHeartbeat = () => {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };
    const refresh = () =>
      getPublicBoard(EVENT_ID)
        .then((nextBoard) => {
          if (active) {
            setBoard(nextBoard);
            setError(null);
          }
        })
        .catch((reason) => {
          if (active) {
            setError(reason instanceof Error ? reason.message : "Anzeige nicht verfügbar.");
          }
        });
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/public/events/${encodeURIComponent(EVENT_ID)}/live`,
      );
      socket.addEventListener("open", () => {
        reconnectDelay = 1_000;
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
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
      });
      socket.addEventListener("error", () => socket?.close());
    };
    void refresh();
    connect();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      active = false;
      socket?.close();
      stopHeartbeat();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      window.clearInterval(timer);
    };
  }, []);
  const mode =
    window.location.pathname === "/fids/terminal" ||
    new URLSearchParams(window.location.search).get("style") === "terminal"
      ? "terminal"
      : "standard";
  return <FidsDisplay board={board} error={error} mode={mode} />;
}
