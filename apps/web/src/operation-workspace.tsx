// Shared operational state and presentation primitives used by route features.
import { useCallback, useEffect, useState } from "react";
import { getOperationBoard } from "./api";
import {
  type BoardSyncState,
  nextBoardReconnectDelay,
  OPERATION_BOARD_POLL_INTERVAL_MS,
  OPERATION_BOARD_RECONNECT_INITIAL_MS,
  reduceBoardSyncState,
  requestBoardSync,
} from "./board-sync";
import { resolveActiveEvent } from "./event-context";
import { confirmedStateLabel, loadOperationBoard, saveOperationBoard } from "./offline-store";
import {
  isRealtimeStateChange,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  sendRealtimeHeartbeat,
} from "./realtime-heartbeat";

export const EVENT_ID = resolveActiveEvent(
  window.location.search,
  window.localStorage,
  import.meta.env.DEV ? "demo-2026" : "",
);
export const FLIGHT_LINE_ASSIST_MODE = window.location.pathname === "/flight-line/assist";
export const LOCAL_DEVELOPMENT =
  import.meta.env.DEV || ["localhost", "127.0.0.1"].includes(window.location.hostname);
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const publicStatusLabel = {
  WAITING: "Warten",
  PREPARE: "Bitte vorbereiten",
  COME_TO_FLIGHT_LINE: "Bitte zur Flight Line",
  BOARDING: "Boarding",
  IN_FLIGHT: "Flug läuft",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
  SERVICE_PAUSED: "Organisatorischer Betrieb pausiert",
} as const;
export const capacityLabel = {
  AVAILABLE: "Kapazität verfügbar",
  LIMITED: "Nur noch begrenzt verfügbar",
  MANUAL_REVIEW: "Manuelle Prüfung erforderlich",
  SOLD_OUT: "Keine sichere Restkapazität",
} as const;
export const rotationStatusLabel = {
  DRAFT: "Vorbereitung",
  CALLED: "Aufgerufen",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
} as const;
export const predictionQualityLabel = {
  STABLE: "stabil",
  CHANGING: "in Veränderung",
  UNCERTAIN: "unsicher",
} as const;
export const aircraftStateLabel = {
  AVAILABLE: "Verfügbar",
  BOARDING: "Boarding",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet / Deboarding",
  TURNAROUND: "Bodenprozess",
  REFUELING: "Tanken aktuell",
  PAUSED: "Pause",
  INTERRUPTED: "Flugbetrieb unterbrochen",
  INACTIVE: "Kurzfristig inaktiv",
} as const;

export function FieldHelp({ help }: { help: string }) {
  return (
    <span aria-hidden="true" className="field-info" data-help={help} title={help}>
      i
    </span>
  );
}

export function FieldLabel({ label, help }: { label: string; help: string }) {
  return (
    <span className="field-label-with-info">
      <span>{label}</span>
      <FieldHelp help={help} />
    </span>
  );
}
export type WeightClass = "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL";
export type GateDisplayStatus = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
export type TicketDetail = {
  clientId: string;
  weightClass: WeightClass;
  individualWeightKg: number | null;
};
export type TicketReceipt = {
  code: string;
  statusUrl: string;
  qrDataUrl: string;
  eventName: string;
  productName: string;
  gateLabel: string;
  communicationLabel: string;
  position: number;
  groupSize: number;
};
export const weightClassLabel: Record<WeightClass, string> = {
  NOT_CAPTURED: "Nicht erfassen",
  CHILD: "Kind",
  NORMAL: "Normal",
  HEAVY: "Schwer",
  INDIVIDUAL: "Individuell",
};

export function operationalTimeLabel(value: string | null, timeZone: string): string {
  if (!value) return "–";
  return new Date(value).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

export function deviceTokenFor(deviceId: string): string {
  if (LOCAL_DEVELOPMENT && EVENT_ID === "demo-2026") {
    if (deviceId === "cashier-tablet-1") return "demo-cashier-device-token";
    if (deviceId === "flight-line-tablet-1") return "demo-flight-line-device-token";
    if (deviceId === "recovery-flight-lead") return "lead-device-credential";
    return "demo-admin-device-token";
  }
  return "";
}

export function deviceIdForRole(role: string, developmentId: string): string {
  if (LOCAL_DEVELOPMENT && EVENT_ID === "demo-2026") return developmentId;
  return `${role.toLowerCase()}-session`;
}

export const CASHIER_DEVICE_ID = deviceIdForRole("CASHIER", "cashier-tablet-1");
export const FLIGHT_LINE_DEVICE_ID = deviceIdForRole("FLIGHT_DIRECTOR", "recovery-flight-lead");
export const ADMIN_DEVICE_ID = deviceIdForRole("ADMIN", "technical-scaffold");
export const MASTER_DATA_AUDIT_REASON = "Administrative Stammdatenpflege";
export const OPERATIONAL_AUDIT_REASON = "Operative Änderung über Administration";
export const ADMIN_CONFIGURATION_AUDIT_REASON = "Administrative Konfigurationspflege";
export const MASTER_DATA_DELETE_REASON = "Administrative Stammdatenlöschung";
export type MasterDataDeleteTarget = {
  entityType: "GATE" | "RESOURCE_GROUP" | "AIRCRAFT" | "ASSIGNMENT" | "PILOT" | "PRODUCT";
  entityId: string;
  label: string;
  blockers: string[];
};

export function createTicketCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

export function useOperationBoard(deviceId: string) {
  const [state, setState] = useState<BoardSyncState>({
    board: null,
    error: null,
    lastConfirmedAt: null,
  });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const outcome = await requestBoardSync(() =>
        getOperationBoard(EVENT_ID, deviceId, deviceTokenFor(deviceId)),
      );
      setState((current) => reduceBoardSyncState(current, outcome));
      if (outcome.type === "CONFIRMED") {
        void saveOperationBoard(EVENT_ID, deviceId, outcome.board, outcome.confirmedAt);
      }
    } finally {
      setRefreshing(false);
    }
  }, [deviceId]);
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
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/public/events/${encodeURIComponent(EVENT_ID)}/live`,
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
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = nextBoardReconnectDelay(reconnectDelay);
      });
      socket.addEventListener("error", () => socket?.close());
    };
    void loadOperationBoard(EVENT_ID, deviceId).then((cached) => {
      if (!active || !cached) return;
      setState((current) =>
        reduceBoardSyncState(current, {
          type: "RESTORED",
          board: cached.board,
          savedAt: cached.savedAt,
        }),
      );
    });
    void refresh();
    connect();
    const timer = window.setInterval(refresh, OPERATION_BOARD_POLL_INTERVAL_MS);
    return () => {
      active = false;
      socket?.close();
      stopHeartbeat();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      window.clearInterval(timer);
    };
  }, [refresh, deviceId]);
  return { ...state, refresh, refreshing };
}

export function ConnectionNotice({
  error,
  lastConfirmedAt,
}: {
  error: string | null;
  lastConfirmedAt?: string | null;
}) {
  return error ? (
    <div className="connection-warning">
      Möglicherweise veraltet
      {lastConfirmedAt ? ` · ${confirmedStateLabel(lastConfirmedAt)}` : " · kein bestätigter Stand"}
      {` · ${error}`}
    </div>
  ) : null;
}

export function EmergencyNotice({ active }: { active: boolean }) {
  return active ? (
    <div className="emergency-notice">Notfallmodus aktiv · keine Verkäufe oder neuen Aufrufe</div>
  ) : null;
}

export function InterruptionNotice({ active }: { active: boolean }) {
  return active ? (
    <div className="interruption-notice">
      Flugbetrieb unterbrochen · keine Verkäufe oder neuen Aufrufe; laufende Flüge bleiben
      dokumentierbar
    </div>
  ) : null;
}

export function OperationalNotice({ note }: { note: string | null | undefined }) {
  return note ? (
    <div className="operational-notice">
      <strong>Betriebshinweis:</strong> {note}
      <small>Organisatorische Information ohne Sicherheits- oder Freigabewirkung.</small>
    </div>
  ) : null;
}
