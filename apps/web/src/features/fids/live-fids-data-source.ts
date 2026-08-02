import {
  getFidsBoard,
  getFidsFilterOptions,
  getFidsPreferences,
  updateFidsPreferences,
} from "../../api";
import {
  isRealtimeStateChange,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  sendRealtimeHeartbeat,
} from "../../realtime-heartbeat";
import type { FidsDataSource } from "./fids-data-source";

export function createLiveFidsDataSource(eventId: string, target: Window = window): FidsDataSource {
  return {
    kind: "live",
    initialConnection: { connected: false, label: "OFFLINE", tone: "offline" },
    loadPreferences: () => getFidsPreferences(eventId),
    loadFilterOptions: () => getFidsFilterOptions(eventId),
    loadBoard: ({ page, lowerPage, signal }) => getFidsBoard(eventId, { page, lowerPage }, signal),
    savePreferences: (preferences, expectedVersion) =>
      updateFidsPreferences(eventId, {
        ...preferences,
        commandId: crypto.randomUUID(),
        expectedVersion,
      }),
    subscribe: (refresh, connectionChanged) => {
      let active = true;
      let socket: WebSocket | null = null;
      let reconnectTimer: number | null = null;
      let heartbeatTimer: number | null = null;
      let reconnectDelay = 1_000;
      const stopHeartbeat = () => {
        if (heartbeatTimer !== null) target.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      };
      const connect = () => {
        const protocol = target.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(
          `${protocol}//${target.location.host}/api/control/${encodeURIComponent(eventId)}/live`,
        );
        socket.addEventListener("open", () => {
          reconnectDelay = 1_000;
          stopHeartbeat();
          connectionChanged({ connected: true, label: "VERBUNDEN", tone: "connected" });
          heartbeatTimer = target.setInterval(
            () => sendRealtimeHeartbeat(socket),
            REALTIME_HEARTBEAT_INTERVAL_MS,
          );
          refresh();
        });
        socket.addEventListener("message", (event) => {
          if (isRealtimeStateChange(event.data)) refresh();
        });
        socket.addEventListener("close", () => {
          stopHeartbeat();
          connectionChanged({ connected: false, label: "OFFLINE", tone: "offline" });
          if (!active) return;
          reconnectTimer = target.setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
        });
        socket.addEventListener("error", () => socket?.close());
      };
      connect();
      const pollingTimer = target.setInterval(refresh, 15_000);
      return () => {
        active = false;
        socket?.close();
        stopHeartbeat();
        if (reconnectTimer !== null) target.clearTimeout(reconnectTimer);
        target.clearInterval(pollingTimer);
      };
    },
  };
}
