import type { CommandResult } from "@rundflug/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOperationBoard } from "../../api";
import { createRealtimeRefreshScheduler } from "../../app/realtime-refresh-scheduler";
import {
  type BoardSyncState,
  createBoardSyncCoordinator,
  nextBoardReconnectDelay,
  OPERATION_BOARD_POLL_INTERVAL_MS,
  OPERATION_BOARD_RECONNECT_INITIAL_MS,
  reduceBoardSyncState,
} from "../../board-sync";
import { loadOperationBoard, saveOperationBoard } from "../../offline-store";
import {
  REALTIME_HEARTBEAT_INTERVAL_MS,
  realtimeStateChangeVersion,
  sendRealtimeHeartbeat,
} from "../../realtime-heartbeat";
import type { OperationIdentity } from "./operation-identity";

export function useOperationBoard({ eventId, deviceId, deviceToken }: OperationIdentity) {
  const [state, setState] = useState<BoardSyncState>({
    board: null,
    error: null,
    lastConfirmedAt: null,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [backendConfirmed, setBackendConfirmed] = useState(false);
  const latestVersionRef = useRef(-1);
  const activeRefreshCallersRef = useRef(0);
  const syncCoordinator = useMemo(
    () => createBoardSyncCoordinator(() => getOperationBoard(eventId, deviceId, deviceToken)),
    [deviceId, deviceToken, eventId],
  );
  const refreshAndGet = useCallback(
    async (minimumVersion = 0, forceFollowUp = false) => {
      activeRefreshCallersRef.current += 1;
      setRefreshing(true);
      try {
        const outcome = await syncCoordinator.request(minimumVersion, forceFollowUp);
        setState((current) => reduceBoardSyncState(current, outcome));
        if (outcome.type === "CONFIRMED") {
          latestVersionRef.current = Math.max(
            latestVersionRef.current,
            outcome.board.event.version,
          );
          setBackendConfirmed(true);
          void saveOperationBoard(eventId, deviceId, outcome.board, outcome.confirmedAt);
          return outcome.board;
        }
        return null;
      } finally {
        activeRefreshCallersRef.current -= 1;
        if (activeRefreshCallersRef.current === 0) setRefreshing(false);
      }
    },
    [deviceId, eventId, syncCoordinator],
  );
  const refresh = useCallback(
    async (minimumVersion = 0, forceFollowUp = false): Promise<void> => {
      await refreshAndGet(minimumVersion, forceFollowUp);
    },
    [refreshAndGet],
  );
  const confirmEvent = useCallback((event: CommandResult["event"]) => {
    latestVersionRef.current = Math.max(latestVersionRef.current, event.version);
    const confirmedAt = new Date().toISOString();
    setState((current) => {
      if (!current.board || current.board.event.version >= event.version) return current;
      return {
        board: { ...current.board, event },
        lastConfirmedAt: confirmedAt,
        error: null,
      };
    });
    setBackendConfirmed(true);
  }, []);
  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectDelay = OPERATION_BOARD_RECONNECT_INITIAL_MS;
    const realtimeRefreshScheduler = createRealtimeRefreshScheduler({
      target: "operational",
      refresh: ({ eventVersion, forceFollowUp }) => refresh(eventVersion ?? 0, forceFollowUp),
    });
    const stopHeartbeat = () => {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/control/${encodeURIComponent(eventId)}/live`,
      );
      socket.addEventListener("open", () => {
        reconnectDelay = OPERATION_BOARD_RECONNECT_INITIAL_MS;
        stopHeartbeat();
        heartbeatTimer = window.setInterval(
          () => sendRealtimeHeartbeat(socket),
          REALTIME_HEARTBEAT_INTERVAL_MS,
        );
        void realtimeRefreshScheduler.refreshNow();
      });
      socket.addEventListener("message", (event) => {
        const changedVersion = realtimeStateChangeVersion(event.data);
        if (changedVersion === false) return;
        if (changedVersion !== null && changedVersion <= latestVersionRef.current) return;
        realtimeRefreshScheduler.schedule(changedVersion);
      });
      socket.addEventListener("close", () => {
        stopHeartbeat();
        if (!active) return;
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = nextBoardReconnectDelay(reconnectDelay);
      });
      socket.addEventListener("error", () => socket?.close());
    };
    void loadOperationBoard(eventId, deviceId).then((cached) => {
      if (!active || !cached) return;
      setState((current) =>
        reduceBoardSyncState(current, {
          type: "RESTORED",
          board: cached.board,
          savedAt: cached.savedAt,
        }),
      );
    });
    void realtimeRefreshScheduler.refreshNow();
    connect();
    const timer = window.setInterval(
      () => void realtimeRefreshScheduler.refreshNow(),
      OPERATION_BOARD_POLL_INTERVAL_MS,
    );
    return () => {
      active = false;
      realtimeRefreshScheduler.dispose();
      socket?.close();
      stopHeartbeat();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      window.clearInterval(timer);
    };
  }, [deviceId, eventId, refresh]);
  return { ...state, backendConfirmed, confirmEvent, refresh, refreshAndGet, refreshing };
}
