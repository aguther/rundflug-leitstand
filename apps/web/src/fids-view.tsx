import type { FidsPreferences, PublicBoard } from "@rundflug/contracts";
import { useCallback, useEffect, useState } from "react";
import { getFidsPreferences, getPublicBoard, updateFidsPreferences } from "./api";
import { resolveDisplayBinding } from "./display-context";
import { useAuth } from "./features/auth/AuthContext";
import { FidsDisplay } from "./fids-display";
import { EVENT_ID } from "./operation-workspace";
import {
  isRealtimeStateChange,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  sendRealtimeHeartbeat,
} from "./realtime-heartbeat";

const DEFAULT_FIDS_PREFERENCES: FidsPreferences = {
  visibleRows: 8,
  layout: "SINGLE",
  theme: "SYSTEM",
  version: 0,
};

export function FidsView() {
  const { session, logout } = useAuth();
  const displayBinding = resolveDisplayBinding(
    window.location.search,
    window.localStorage,
    EVENT_ID,
  );
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [preferences, setPreferences] = useState<FidsPreferences>(DEFAULT_FIDS_PREFERENCES);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!EVENT_ID) return;
    let active = true;
    void getFidsPreferences(EVENT_ID)
      .then((next) => {
        if (active) setPreferences(next);
      })
      .catch(() => {
        // The board remains usable with documented defaults; saving reports its own server error.
      });
    return () => {
      active = false;
    };
  }, []);

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
    if (!EVENT_ID) {
      setError("Diese Anzeige ist noch keiner Veranstaltung zugeordnet.");
      return;
    }
    const refresh = () =>
      getPublicBoard(EVENT_ID, displayBinding.gateId)
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
  }, [displayBinding.gateId]);

  const savePreferences = useCallback(
    async (next: Pick<FidsPreferences, "visibleRows" | "layout" | "theme">) => {
      try {
        const confirmed = await updateFidsPreferences(EVENT_ID, {
          commandId: crypto.randomUUID(),
          expectedVersion: preferences.version,
          ...next,
        });
        setPreferences(confirmed);
      } catch (cause) {
        try {
          setPreferences(await getFidsPreferences(EVENT_ID));
        } catch {
          // Keep the last confirmed local version if even the conflict refresh is unavailable.
        }
        throw cause;
      }
    },
    [preferences.version],
  );

  return (
    <FidsDisplay
      accountCode={session?.account.loginCode ?? "DISPLAY"}
      board={board}
      error={error}
      onLogout={logout}
      onSavePreferences={savePreferences}
      preferences={preferences}
    />
  );
}
