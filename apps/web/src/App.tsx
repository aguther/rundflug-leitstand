import type {
  AuditHistory,
  EventCatalogEntry,
  ForecastHistory,
  OperationalHistory,
  OperationBoard,
  PublicBoard,
  PublicTicketStatus,
  TicketSearchResult,
} from "@rundflug/contracts";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  manifestCorrectionCandidates,
  manifestCorrectionTargets,
} from "./admin-manifest-correction";
import {
  type AdminArea,
  AdminNavigation,
  type MasterDataCategory,
  MasterDataNavigation,
  SetupProgress,
  type SetupStep,
  ValidationHint,
} from "./admin-ux";
import type { PairedDeviceSummary } from "./api";
import {
  bootstrapSystem,
  cloneEvent,
  downloadDailyPdf,
  downloadDailyReport,
  downloadTicketRawData,
  factoryReset,
  getAuditHistory,
  getDeviceContext,
  getEventCatalog,
  getForecastHistory,
  getOperationalHistory,
  getOperationBoard,
  getPairedDevices,
  getPublicBoard,
  getPublicTicketStatus,
  getPushConfiguration,
  getPushPublicKey,
  getSetupStatus,
  recoverAdminDevice,
  registerTicketPush,
  revokeTicketPush,
  searchTickets,
  sendCommand,
  verifyAdminPin,
} from "./api";
import {
  type BoardSyncState,
  isDeviceAuthorizationError,
  nextBoardReconnectDelay,
  OPERATION_BOARD_POLL_INTERVAL_MS,
  OPERATION_BOARD_RECONNECT_INITIAL_MS,
  reduceBoardSyncState,
  requestBoardSync,
} from "./board-sync";
import { requiresChildCompanionWarning } from "./cashier-guidance";
import {
  deviceCredentialCandidates,
  deviceCredentialToken,
  deviceIdForOperationalView,
  rememberDeviceCredential,
} from "./device-credentials";
import { rememberActiveEvent, resolveActiveEvent } from "./event-context";
import {
  eventDateInTimeZone,
  eventLocalDateTimeToIso,
  formatEventLocalDateTime,
} from "./event-time";
import { expectedReviewAtFromPause } from "./flight-line-pause";
import { FlightLineSupervisorConsole } from "./flight-line-supervisor";
import { LocalizedDateInput, LocalizedDateTimeInput } from "./localized-date-input";
import {
  appendCashierDraftRevision,
  cashierDraftQueueKey,
  latestCashierDraft,
  readCashierDraftQueue,
  writeCashierDraftQueue,
} from "./offline-drafts";
import {
  clearOfflineOperationBoards,
  confirmedStateLabel,
  loadOperationBoard,
  saveOperationBoard,
} from "./offline-store";
import {
  checkedInCount,
  eligibleMoveTargets,
  oversizeSplitPreview,
  replacementSuggestion,
  sharedGroupSegmentLabel,
} from "./operational-exceptions";
import {
  formatEuroInput,
  parseEuroToCents,
  productPositionOptions,
  setWeightCaptureMode,
  toggleWeightClass,
  weightCaptureEnabled,
  weightClassesForChildCompanion,
} from "./product-editor";
import {
  isRealtimeStateChange,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  sendRealtimeHeartbeat,
} from "./realtime-heartbeat";
import { setupValidationMessages } from "./setup-validation";

const EVENT_ID = resolveActiveEvent(window.location.search, window.localStorage);
const KIOSK_MODE = new URLSearchParams(window.location.search).get("kiosk") === "1";
const LOCAL_DEVELOPMENT =
  import.meta.env.DEV || ["localhost", "127.0.0.1"].includes(window.location.hostname);
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const publicStatusLabel = {
  WAITING: "Warten",
  PREPARE: "Bitte vorbereiten",
  COME_TO_FLIGHT_LINE: "Bitte zur Flight Line",
  BOARDING: "Boarding",
  IN_FLIGHT: "Flug läuft",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
  SERVICE_PAUSED: "Organisatorischer Betrieb pausiert",
} as const;
const capacityLabel = {
  AVAILABLE: "Kapazität verfügbar",
  LIMITED: "Nur noch begrenzt verfügbar",
  MANUAL_REVIEW: "Manuelle Prüfung erforderlich",
  SOLD_OUT: "Keine sichere Restkapazität",
} as const;
const rotationStatusLabel = {
  DRAFT: "Vorbereitung",
  CALLED: "Aufgerufen",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
} as const;
const predictionQualityLabel = {
  STABLE: "stabil",
  CHANGING: "in Veränderung",
  UNCERTAIN: "unsicher",
} as const;
const aircraftStateLabel = {
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

function FieldHelp({ label, help }: { label: string; help: string }) {
  return (
    <details className="field-info">
      <summary aria-label={`Information zu ${label}`} tabIndex={-1} title={help}>
        i
      </summary>
      <span role="note">{help}</span>
    </details>
  );
}

function FieldLabel({ label, help }: { label: string; help: string }) {
  return (
    <span className="field-label-with-info">
      <span>{label}</span>
      <FieldHelp label={label} help={help} />
    </span>
  );
}
type WeightClass = "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL";
type GateDisplayStatus = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
const attemptedDeviceCredentialRecoveries = new Set<string>();
type TicketDetail = {
  clientId: string;
  weightClass: WeightClass;
  individualWeightKg: number | null;
};
type TicketReceipt = { code: string; statusUrl: string; qrDataUrl: string };
const weightClassLabel: Record<WeightClass, string> = {
  NOT_CAPTURED: "Nicht erfassen",
  CHILD: "Kind",
  NORMAL: "Normal",
  HEAVY: "Schwer",
  INDIVIDUAL: "Individuell",
};

function operationalTimeLabel(value: string | null, timeZone: string): string {
  if (!value) return "–";
  return new Date(value).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function deviceRoleFor(deviceId: string): string | null {
  for (const role of [
    "ADMIN",
    "CASHIER",
    "FLIGHT_LINE",
    "FLIGHT_LINE_LEAD",
    "FLIGHT_DIRECTOR",
    "DISPLAY",
  ]) {
    if (window.localStorage.getItem(`device-id:${role}`) === deviceId) return role;
  }
  return null;
}

function deviceTokenFor(deviceId: string): string {
  const pairedToken = deviceCredentialToken(window.localStorage, deviceRoleFor(deviceId), deviceId);
  if (pairedToken) return pairedToken;
  if (LOCAL_DEVELOPMENT && EVENT_ID === "demo-2026") {
    if (deviceId === "cashier-tablet-1") return "demo-cashier-device-token";
    if (deviceId === "flight-line-tablet-1") return "demo-flight-line-device-token";
    if (deviceId === "recovery-flight-lead") return "lead-device-credential";
    return "demo-admin-device-token";
  }
  return "";
}

function deviceIdForRole(role: string, developmentId: string): string {
  if (LOCAL_DEVELOPMENT && EVENT_ID === "demo-2026") return developmentId;
  const pairedDeviceId =
    role === "CASHIER" || role === "FLIGHT_LINE"
      ? deviceIdForOperationalView(window.localStorage, role)
      : role === "FLIGHT_LINE_LEAD"
        ? (window.localStorage.getItem("device-id:FLIGHT_LINE_LEAD") ??
          deviceIdForOperationalView(window.localStorage, "FLIGHT_LINE"))
        : window.localStorage.getItem(`device-id:${role}`);
  if (pairedDeviceId) return pairedDeviceId;
  return `unpaired-${role.toLowerCase()}`;
}

const CASHIER_DEVICE_ID = deviceIdForRole("CASHIER", "cashier-tablet-1");
const FLIGHT_LINE_DEVICE_ID = deviceIdForRole("FLIGHT_LINE_LEAD", "recovery-flight-lead");
const ADMIN_DEVICE_ID = deviceIdForRole("ADMIN", "technical-scaffold");
const MASTER_DATA_AUDIT_REASON = "Administrative Stammdatenpflege";
const OPERATIONAL_AUDIT_REASON = "Operative Änderung über Administration";
const ADMIN_CONFIGURATION_AUDIT_REASON = "Administrative Konfigurationspflege";
const MASTER_DATA_DELETE_REASON = "Administrative Stammdatenlöschung";
type MasterDataDeleteTarget = {
  entityType: "GATE" | "RESOURCE_GROUP" | "AIRCRAFT" | "ASSIGNMENT" | "PILOT" | "PRODUCT";
  entityId: string;
  label: string;
  blockers: string[];
};

function createTicketCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

function createDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256HexBrowser(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function useConnectivity(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function useOperationBoard(deviceId: string) {
  const [state, setState] = useState<BoardSyncState>({
    board: null,
    error: null,
    lastConfirmedAt: null,
  });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      let deviceToken = deviceTokenFor(deviceId);
      let outcome = await requestBoardSync(() =>
        getOperationBoard(EVENT_ID, deviceId, deviceToken),
      );
      if (
        outcome.type === "UNAVAILABLE" &&
        outcome.message.includes("(403)") &&
        !attemptedDeviceCredentialRecoveries.has(deviceId)
      ) {
        attemptedDeviceCredentialRecoveries.add(deviceId);
        const role = deviceRoleFor(deviceId);
        for (const candidate of deviceCredentialCandidates(window.localStorage, role, deviceId)) {
          try {
            const context = await getDeviceContext(deviceId, candidate);
            if (role && context.role !== role) continue;
            rememberDeviceCredential(window.localStorage, context.role, deviceId, candidate);
            deviceToken = candidate;
            if (context.eventId !== EVENT_ID) {
              rememberActiveEvent(window.localStorage, context.eventId);
              const target = new URL(window.location.href);
              target.searchParams.set("event", context.eventId);
              window.location.replace(target);
              return;
            }
            outcome = await requestBoardSync(() =>
              getOperationBoard(EVENT_ID, deviceId, deviceToken),
            );
            if (outcome.type === "CONFIRMED") break;
          } catch {
            // Try the next credential kept in this browser. Tokens are never logged or persisted anew
            // unless the server confirms the device/role combination.
          }
        }
      }
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

function Shell({
  title,
  children,
  kiosk = false,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  kiosk?: boolean;
  className?: string;
}) {
  const online = useConnectivity();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = window.localStorage.getItem("ui-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("ui-theme", theme);
  }, [theme]);
  return (
    <main className={`${kiosk ? "app-shell kiosk-shell" : "app-shell"} ${className}`.trim()}>
      <header className="app-header">
        <div>
          <svg aria-hidden="true" className="app-brand-mark" viewBox="0 0 24 24">
            <path d="m3 13 7-2.5L14 3l2 1-1.5 6 5.5-2 1 1.5-6 4.5-1 6-2-1-1-4-5 2-1-1.5 4-3.5Z" />
          </svg>
          <strong>Rundflug-Leitstand</strong>
          <span>{title}</span>
        </div>
        <nav aria-label="Ansichten">
          <a href="/kasse">Kasse</a>
          <a href="/flight-line">Flight Line</a>
          <a href="/fids">FIDS</a>
          <a href="/admin">Administration</a>
        </nav>
        <button
          aria-label={theme === "dark" ? "Helles Erscheinungsbild" : "Dunkles Erscheinungsbild"}
          className="theme-toggle"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          title={theme === "dark" ? "Helles Erscheinungsbild" : "Dunkles Erscheinungsbild"}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            {theme === "dark" ? (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </>
            ) : (
              <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
            )}
          </svg>
        </button>
      </header>
      {!online ? (
        <div className="connection-warning">
          Offline · letzter bestätigter Stand bleibt sichtbar; operative Aktionen sind gesperrt.
        </div>
      ) : null}
      {children}
      <footer>Keine flugbetriebliche oder sicherheitsrelevante Freigabewirkung.</footer>
    </main>
  );
}

function ConnectionNotice({
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

function EmergencyNotice({ active }: { active: boolean }) {
  return active ? (
    <div className="emergency-notice">Notfallmodus aktiv · keine Verkäufe oder neuen Aufrufe</div>
  ) : null;
}

function InterruptionNotice({ active }: { active: boolean }) {
  return active ? (
    <div className="interruption-notice">
      Flugbetrieb unterbrochen · keine Verkäufe oder neuen Aufrufe; laufende Flüge bleiben
      dokumentierbar
    </div>
  ) : null;
}

function OperationalNotice({ note }: { note: string | null | undefined }) {
  return note ? (
    <div className="operational-notice">
      <strong>Betriebshinweis:</strong> {note}
      <small>Organisatorische Information ohne Sicherheits- oder Freigabewirkung.</small>
    </div>
  ) : null;
}

function CashierView() {
  const { board, error, lastConfirmedAt, refresh } = useOperationBoard(CASHIER_DEVICE_ID);
  const online = useConnectivity();
  const serverConfirmed = online && error === null;
  const draftQueueKey = cashierDraftQueueKey(EVENT_ID, CASHIER_DEVICE_ID);
  const initialDraftQueue = readCashierDraftQueue(localStorage, draftQueueKey);
  const initialDraft = latestCashierDraft(initialDraftQueue);
  const [productId, setProductId] = useState(() => {
    return initialDraft?.productId ?? "panorama-20";
  });
  const [size, setSize] = useState(() => {
    return initialDraft?.size ?? 1;
  });
  const [pendingDraftCount, setPendingDraftCount] = useState(initialDraftQueue.length);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<TicketReceipt[]>([]);
  const [ticketCodeMode, setTicketCodeMode] = useState<"GENERATED" | "PREPRINTED">("GENERATED");
  const [preprintedCodes, setPreprintedCodes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [lastTicketGroupId, setLastTicketGroupId] = useState<string | null>(null);
  const [lastProductId, setLastProductId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [correctionPin, setCorrectionPin] = useState("");
  const [rebookProductId, setRebookProductId] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketSearchResults, setTicketSearchResults] = useState<TicketSearchResult[]>([]);
  const [correctionTargetLabel, setCorrectionTargetLabel] = useState("Letzter Verkauf");
  const [ticketDetails, setTicketDetails] = useState<TicketDetail[]>([]);
  const [oversizeSplitAcknowledged, setOversizeSplitAcknowledged] = useState(false);
  const product = board?.products.find((entry) => entry.id === productId) ?? board?.products[0];
  const splitPreview = oversizeSplitPreview(size, product?.referenceCapacity ?? size);
  const productAircraft =
    board?.aircraft.filter((aircraft) => aircraft.resourceGroupId === product?.resourceGroupId) ??
    [];
  const fittingAircraft = productAircraft.filter((aircraft) => aircraft.passengerSeats >= size);
  const limitedLargeAircraft =
    !splitPreview.required &&
    fittingAircraft.length > 0 &&
    fittingAircraft.length < productAircraft.length;
  const childCompanionWarning = requiresChildCompanionWarning(
    product?.childCompanionRequired ?? false,
    ticketDetails.map((detail) => detail.weightClass),
  );
  useEffect(() => {
    if (serverConfirmed && pendingDraftCount === 0) return;
    const queue = appendCashierDraftRevision(readCashierDraftQueue(localStorage, draftQueueKey), {
      productId,
      size,
    });
    writeCashierDraftQueue(localStorage, draftQueueKey, queue);
    setPendingDraftCount(queue.length);
  }, [draftQueueKey, pendingDraftCount, productId, serverConfirmed, size]);
  useEffect(() => {
    const allowed = product?.weightClasses ?? ["NOT_CAPTURED"];
    const fallback = allowed[0] ?? "NOT_CAPTURED";
    setTicketDetails((current) =>
      Array.from({ length: size }, (_, index) => {
        const existing = current[index];
        if (existing && allowed.includes(existing.weightClass)) return existing;
        return {
          clientId: crypto.randomUUID(),
          weightClass: fallback,
          individualWeightKg: fallback === "INDIVIDUAL" ? 80 : null,
        };
      }),
    );
  }, [product?.weightClasses, size]);
  async function sell() {
    if (!board || !product || busy) return;
    const codes =
      ticketCodeMode === "GENERATED"
        ? Array.from({ length: size }, createTicketCode)
        : preprintedCodes
            .toUpperCase()
            .split(/[\s,;]+/)
            .map((code) => code.trim())
            .filter(Boolean);
    if (
      codes.length !== size ||
      new Set(codes).size !== codes.length ||
      codes.some((code) => !/^[A-Z2-9]{12,32}$/.test(code))
    ) {
      setMessage(
        `Für die Gruppe werden ${size} eindeutige vorgedruckte Codes mit jeweils 12–32 Zeichen benötigt.`,
      );
      return;
    }
    setBusy(true);
    try {
      const saleResult = await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: CASHIER_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SELL_TICKET_GROUP",
          payload: {
            productId: product.id,
            publicTicketCodes: codes,
            ticketDetails,
            standby: false,
            paymentStatus: "INFORMATIONAL_ONLY",
            paymentMethod: null,
            oversizeSplitAcknowledged,
          },
        },
        deviceTokenFor(CASHIER_DEVICE_ID),
      );
      setReceipt(
        await Promise.all(
          codes.map(async (code) => {
            const statusUrl = `${window.location.origin}/ticket/${encodeURIComponent(code)}`;
            return {
              code,
              statusUrl,
              qrDataUrl: await QRCode.toDataURL(statusUrl, {
                errorCorrectionLevel: "M",
                margin: 2,
                width: 280,
              }),
            };
          }),
        ),
      );
      setPreprintedCodes("");
      setLastTicketGroupId(saleResult.aggregate?.id ?? null);
      setLastProductId(product.id);
      setCorrectionTargetLabel("Letzter Verkauf");
      setMessage(`${codes.length} Ticket${codes.length === 1 ? "" : "s"} verkauft.`);
      writeCashierDraftQueue(localStorage, draftQueueKey, []);
      setPendingDraftCount(0);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Verkauf fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelLastSale() {
    if (!board || !lastTicketGroupId || cancelReason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: CASHIER_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CANCEL_TICKET_GROUP",
          payload: {
            ticketGroupId: lastTicketGroupId,
            reason: cancelReason.trim(),
            adminPin: correctionPin,
          },
        },
        deviceTokenFor(CASHIER_DEVICE_ID),
      );
      setMessage("Verkauf storniert und protokolliert.");
      setReceipt([]);
      setLastTicketGroupId(null);
      setLastProductId(null);
      setCancelReason("");
      setCorrectionPin("");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Storno fehlgeschlagen.");
    }
  }

  async function rebookLastSale() {
    if (!board || !lastTicketGroupId || !rebookProductId || cancelReason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: CASHIER_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "REBOOK_TICKET_GROUP",
          payload: {
            ticketGroupId: lastTicketGroupId,
            newProductId: rebookProductId,
            reason: cancelReason.trim(),
            adminPin: correctionPin,
          },
        },
        deviceTokenFor(CASHIER_DEVICE_ID),
      );
      setMessage("Tickets umgebucht und in die neue Queue eingereiht.");
      setCancelReason("");
      setCorrectionPin("");
      setRebookProductId("");
      setLastProductId(rebookProductId);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Umbuchung fehlgeschlagen.");
    }
  }

  async function runTicketSearch() {
    if (ticketSearch.trim().length < 2) return;
    try {
      const response = await searchTickets(
        EVENT_ID,
        CASHIER_DEVICE_ID,
        deviceTokenFor(CASHIER_DEVICE_ID),
        ticketSearch.trim(),
      );
      setTicketSearchResults(response.results);
      setMessage(
        response.results.length === 0
          ? "Kein passendes Ticket gefunden."
          : `${response.results.length} Buchungsgruppe${response.results.length === 1 ? "" : "n"} gefunden.`,
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Ticketsuche fehlgeschlagen.");
    }
  }

  function selectSearchResult(result: TicketSearchResult) {
    setLastTicketGroupId(result.ticketGroupId);
    setLastProductId(result.productId);
    setCorrectionTargetLabel(
      result.communicationLabels.join(" / ") || `Gruppe ${result.ticketGroupId.slice(0, 8)}`,
    );
    setReceipt([]);
    setMessage(
      `${result.productName} · ${result.groupSize} Ticket${result.groupSize === 1 ? "" : "s"} ausgewählt.`,
    );
  }

  return (
    <Shell title="Kasse">
      <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
      {pendingDraftCount > 0 ? (
        <div className="connection-warning" role="status">
          {serverConfirmed
            ? "Offline-Entwurf wiederhergestellt · aktuellen Stand prüfen und Verkauf bewusst bestätigen."
            : "Entwurf lokal gespeichert · noch nicht bestätigt · ohne operative Wirkung."}
        </div>
      ) : null}
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
      <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
      <OperationalNotice note={board?.event.operationalNote} />
      <section className="cashier-workspace">
        <div className="product-strip">
          {board?.products.map((entry) => (
            <button
              className={entry.id === product?.id ? "product-option selected" : "product-option"}
              key={entry.id}
              onClick={() => {
                setProductId(entry.id);
                setOversizeSplitAcknowledged(false);
              }}
              type="button"
            >
              <span className="product-option-heading">
                <strong>{entry.name}</strong>
                <small>
                  {entry.resourceGroupStatus === "ACTIVE" ? "Verkauf aktiv" : "Gesperrt"}
                </small>
              </span>
              <span className="product-wait">
                {entry.estimatedWaitLowerMinutes}–{entry.estimatedWaitUpperMinutes} Min.
              </span>
              <span>{entry.resourceGroupOpenTickets} Tickets in der Queue</span>
              {entry.resourceGroupOperationalNote ? (
                <span>Betriebshinweis: {entry.resourceGroupOperationalNote}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="sale-editor">
          <section className="group-size" aria-labelledby="group-title">
            <h1 id="group-title">Gruppengröße</h1>
            <div className="stepper">
              <button
                type="button"
                onClick={() => {
                  setSize((value) => Math.max(1, value - 1));
                  setOversizeSplitAcknowledged(false);
                }}
              >
                −
              </button>
              <output>{size}</output>
              <button
                type="button"
                onClick={() => {
                  setSize((value) => Math.min(12, value + 1));
                  setOversizeSplitAcknowledged(false);
                }}
              >
                +
              </button>
            </div>
            {product && splitPreview.required ? (
              <div className="oversize-split-notice" role="status">
                <div>
                  <strong>Aufteilung erforderlich</strong>
                  <span>
                    {size} Tickets passen nicht gemeinsam in einen Umlauf mit{" "}
                    {product.referenceCapacity} Plätzen. Vorgesehen:{" "}
                    {splitPreview.slotSizes.join(" + ")} in {splitPreview.slotSizes.length}{" "}
                    aufeinanderfolgenden Fluggruppen.
                  </span>
                  <small>
                    Die gemeinsam verkaufte Buchungsgruppe bleibt vollständig verbunden.
                  </small>
                </div>
                <label>
                  <input
                    checked={oversizeSplitAcknowledged}
                    onChange={(event) => setOversizeSplitAcknowledged(event.target.checked)}
                    type="checkbox"
                  />
                  Aufteilung verstanden
                </label>
              </div>
            ) : null}
            {limitedLargeAircraft ? (
              <div className="capacity-fit-notice" role="status">
                <strong>Gemeinsamer Flug möglich</strong>
                <span>
                  {fittingAircraft.length} von {productAircraft.length} Flugzeug
                  {productAircraft.length === 1 ? "" : "en"} passen für diese Gruppe. Dadurch kann
                  die Wartezeit etwas länger sein.
                </span>
              </div>
            ) : null}
            <p className="privacy-note">Anonymer Verkauf – keine Namen und Telefonnummern.</p>
            <label className="ticket-code-mode">
              Ticket-Ausgabe
              <select
                value={ticketCodeMode}
                onChange={(event) =>
                  setTicketCodeMode(event.target.value as "GENERATED" | "PREPRINTED")
                }
              >
                <option value="GENERATED">QR-Tickets erzeugen</option>
                <option value="PREPRINTED">Vorgedruckte Codes scannen</option>
              </select>
            </label>
            {ticketCodeMode === "PREPRINTED" ? (
              <label className="preprinted-code-input">
                Codes · einer pro Ticket
                <textarea
                  rows={Math.min(6, Math.max(2, size))}
                  value={preprintedCodes}
                  onChange={(event) => setPreprintedCodes(event.target.value)}
                  placeholder="QR-Code scannen oder eingeben"
                />
              </label>
            ) : null}
            {product &&
            (product.weightClasses.length > 1 || product.weightClasses[0] !== "NOT_CAPTURED") ? (
              <div className="weight-class-list">
                <h2>Gewichtsklassen</h2>
                {ticketDetails.map((detail, index) => (
                  <div className="weight-class-row" key={detail.clientId}>
                    <label>
                      Ticket {index + 1}
                      <select
                        value={detail.weightClass}
                        onChange={(event) => {
                          const weightClass = event.target.value as WeightClass;
                          setTicketDetails((current) =>
                            current.map((entry, detailIndex) =>
                              detailIndex === index
                                ? {
                                    ...entry,
                                    weightClass,
                                    individualWeightKg: weightClass === "INDIVIDUAL" ? 80 : null,
                                  }
                                : entry,
                            ),
                          );
                        }}
                      >
                        {product.weightClasses.map((weightClass) => (
                          <option value={weightClass} key={weightClass}>
                            {weightClassLabel[weightClass]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {detail.weightClass === "INDIVIDUAL" ? (
                      <label>
                        kg
                        <input
                          type="number"
                          min="15"
                          max="250"
                          value={detail.individualWeightKg ?? ""}
                          onChange={(event) =>
                            setTicketDetails((current) =>
                              current.map((entry, detailIndex) =>
                                detailIndex === index
                                  ? { ...entry, individualWeightKg: Number(event.target.value) }
                                  : entry,
                              ),
                            )
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                ))}
                {childCompanionWarning ? (
                  <div className="child-companion-warning" role="alert">
                    <strong>Begleitung prüfen</strong>
                    <span>
                      In dieser Gruppe ist ein Kind erfasst, aber keine erwachsene Begleitperson.
                    </span>
                    <small>Organisatorischer Hinweis ohne flugbetriebliche Freigabewirkung.</small>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
          {receipt.length > 0 || message || lastTicketGroupId ? (
            <section className="ticket-preview">
              {receipt.length > 0 ? <h2>QR-Tickets</h2> : null}
              {receipt.length > 0 ? (
                <div className="receipt-list">
                  {receipt.map((ticket) => (
                    <article key={ticket.code} className="ticket-receipt">
                      <img src={ticket.qrDataUrl} alt={`QR-Ticket ${ticket.code}`} />
                      <code>{ticket.code}</code>
                      <span>QR-Code öffnet den anonymen Ticketstatus.</span>
                    </article>
                  ))}
                  <button className="print-tickets" type="button" onClick={() => window.print()}>
                    QR-Tickets drucken
                  </button>
                </div>
              ) : null}
              {message ? (
                <div className="action-message" role="status">
                  {message}
                </div>
              ) : null}
              {lastTicketGroupId ? (
                <details className="correction-controls">
                  <summary>Verkauf korrigieren</summary>
                  <label>
                    Stornogrund
                    <input
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      placeholder="Mindestens 3 Zeichen"
                    />
                  </label>
                  <label>
                    Administrator-PIN für Storno/Umbuchung
                    <input
                      type="password"
                      value={correctionPin}
                      onChange={(event) => setCorrectionPin(event.target.value)}
                    />
                  </label>
                  <button
                    disabled={cancelReason.trim().length < 3 || correctionPin.length < 4}
                    onClick={cancelLastSale}
                    type="button"
                  >
                    {correctionTargetLabel} stornieren
                  </button>
                  <label>
                    Umbuchen auf
                    <select
                      value={rebookProductId}
                      onChange={(event) => setRebookProductId(event.target.value)}
                    >
                      <option value="">Zielprodukt wählen</option>
                      {board?.products
                        .filter((entry) => entry.id !== lastProductId)
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    disabled={
                      !rebookProductId || cancelReason.trim().length < 3 || correctionPin.length < 4
                    }
                    onClick={rebookLastSale}
                    type="button"
                  >
                    Tickets umbuchen
                  </button>
                </details>
              ) : null}
            </section>
          ) : null}
        </div>
        <details className="ticket-search">
          <summary id="ticket-search-title">Bestehenden Verkauf suchen oder bearbeiten</summary>
          <p>Ticket-/QR-Code, Gruppen-ID oder Fluggruppenkennung eingeben.</p>
          <div className="ticket-search-input">
            <input
              aria-label="Suchbegriff"
              value={ticketSearch}
              onChange={(event) => setTicketSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runTicketSearch();
              }}
              placeholder="z. B. PAN20-042"
            />
            <button
              type="button"
              onClick={() => void runTicketSearch()}
              disabled={ticketSearch.trim().length < 2}
            >
              Suchen
            </button>
          </div>
          {ticketSearchResults.length > 0 ? (
            <div className="ticket-search-results">
              {ticketSearchResults.map((result) => (
                <button
                  type="button"
                  key={result.ticketGroupId}
                  onClick={() => selectSearchResult(result)}
                >
                  <strong>{result.communicationLabels.join(" / ") || result.productCode}</strong>
                  <span>
                    {result.productName} · {result.groupSize} Ticket
                    {result.groupSize === 1 ? "" : "s"}
                  </span>
                  <span>Status: {result.groupStatus}</span>
                </button>
              ))}
            </div>
          ) : null}
        </details>
        <button
          className="primary-action"
          disabled={
            !serverConfirmed ||
            !board ||
            !product?.saleEnabled ||
            product.resourceGroupStatus !== "ACTIVE" ||
            !product.saleRecommended ||
            product.remainingSellableSeats < size ||
            board.event.emergencyMode ||
            board.event.operationalInterrupted ||
            ticketDetails.length !== size ||
            (splitPreview.required && !oversizeSplitAcknowledged) ||
            ticketDetails.some(
              (detail) =>
                detail.weightClass === "INDIVIDUAL" &&
                ((detail.individualWeightKg ?? 0) < 15 || (detail.individualWeightKg ?? 0) > 250),
            ) ||
            busy
          }
          onClick={sell}
          type="button"
        >
          {busy
            ? "Wird bestätigt …"
            : splitPreview.required && !oversizeSplitAcknowledged
              ? "Aufteilung bestätigen"
              : `Verkauf bestätigen · ${size} Ticket${size === 1 ? "" : "s"}`}
        </button>
      </section>
    </Shell>
  );
}

const actionForState = {
  DRAFT: { label: "NEXT", command: "CALL_NEXT" },
  CALLED: { label: "IM FLUG", command: "MARK_IN_FLIGHT" },
  IN_FLIGHT: { label: "GELANDET", command: "MARK_LANDED" },
  LANDED: { label: "VERFÜGBAR", command: "MARK_COMPLETED" },
  COMPLETED: null,
} as const;

function FlightLineView() {
  const { board, error, lastConfirmedAt, refresh } = useOperationBoard(FLIGHT_LINE_DEVICE_ID);
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [queueReason, setQueueReason] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [nextAircraftId, setNextAircraftId] = useState("");
  const [nextPilotId, setNextPilotId] = useState("");
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dispositionCapacity, setDispositionCapacity] = useState(1);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [aircraftPauseOpen, setAircraftPauseOpen] = useState(false);
  const [aircraftPauseMinutes, setAircraftPauseMinutes] = useState("20");
  const [aircraftPauseUnknown, setAircraftPauseUnknown] = useState(false);
  const operationalRotations = board?.rotations.filter(
    (rotation) => rotation.status !== "COMPLETED",
  );
  const operationalAircraft = board?.aircraft ?? [];
  const canManageAircraft = ["FLIGHT_LINE_LEAD", "FLIGHT_DIRECTOR", "ADMIN"].includes(
    board?.currentDeviceRole ?? "",
  );
  const selectedAircraft =
    operationalAircraft.find((aircraft) => aircraft.id === selectedAircraftId) ??
    operationalAircraft[0];
  const aircraftRotations = operationalRotations?.filter((rotation) => {
    if (!selectedAircraft) return false;
    if (rotation.aircraftId) return rotation.aircraftId === selectedAircraft.id;
    const rotationProduct = board?.products.find(
      (productEntry) => productEntry.code === rotation.productCode,
    );
    return (
      rotation.status === "DRAFT" &&
      selectedAircraft.operationalState === "AVAILABLE" &&
      rotationProduct?.resourceGroupId === selectedAircraft.resourceGroupId &&
      rotation.ticketCount <= selectedAircraft.passengerSeats
    );
  });
  const selected =
    aircraftRotations?.find((rotation) => rotation.id === selectedId) ?? aircraftRotations?.[0];
  const action = selected ? actionForState[selected.status] : null;
  const moveTargets = selected ? eligibleMoveTargets(selected, operationalRotations ?? []) : [];
  const presentCount = selected ? checkedInCount(selected) : 0;
  const missingTickets =
    selected?.tickets.filter((ticket) => ticket.attendanceStatus !== "CHECKED_IN") ?? [];
  const replacement = selected ? replacementSuggestion(selected, operationalRotations ?? []) : null;
  useEffect(() => {
    if (!selectedAircraftId && operationalAircraft[0]) {
      setSelectedAircraftId(operationalAircraft[0].id);
    }
  }, [operationalAircraft, selectedAircraftId]);
  useEffect(() => {
    if (selected?.status !== "DRAFT") return;
    setNextAircraftId(selectedAircraft?.id ?? selected.suggestedAircraftId ?? "");
    setNextPilotId(selected.suggestedPilotId ?? "");
  }, [
    selected?.status,
    selected?.suggestedAircraftId,
    selected?.suggestedPilotId,
    selectedAircraft?.id,
  ]);
  useEffect(() => {
    setDispositionCapacity(selected?.usableCapacity ?? 1);
    setMoveTargetId("");
    setMoveReason("");
  }, [selected?.usableCapacity]);
  const noShowReady = Boolean(
    selected?.status === "CALLED" &&
      selected.calledAt &&
      board &&
      Date.now() - Date.parse(selected.calledAt) >= board.event.noShowAfterMinutes * 60_000,
  );

  async function advance() {
    if (!board || !selected || !action) return;
    try {
      const commandBase = {
        commandId: crypto.randomUUID(),
        eventId: EVENT_ID,
        deviceId: FLIGHT_LINE_DEVICE_ID,
        expectedVersion: board.event.version,
        issuedAt: new Date().toISOString(),
      };
      if (action.command === "CALL_NEXT") {
        await sendCommand(
          {
            ...commandBase,
            type: "CALL_NEXT",
            payload: {
              rotationId: selected.id,
              aircraftId: nextAircraftId,
              pilotId: nextPilotId,
            },
          },
          deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
        );
      } else {
        await sendCommand(
          { ...commandBase, type: action.command, payload: { rotationId: selected.id } },
          deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
        );
      }
      setMessage(`${action.label} bestätigt.`);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Aktion fehlgeschlagen.");
    }
  }

  async function setFlightLineAircraftState(
    state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INTERRUPTED" | "INACTIVE",
    expectedReviewAt: string | null = null,
  ) {
    if (!board || !selectedAircraft) return;
    const reasonByState = {
      AVAILABLE: "Flugzeug durch Flight Line wieder verfügbar gemeldet",
      REFUELING: "Tanken durch Flight Line begonnen",
      PAUSED: "Flugzeugpause durch Flight Line begonnen",
      INTERRUPTED: "Flugzeugbetrieb durch Flight Line unterbrochen",
      INACTIVE: "Flugzeug durch Flight Line vorübergehend inaktiv gemeldet",
    } as const;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_AIRCRAFT_OPERATIONAL_STATE",
          payload: {
            aircraftId: selectedAircraft.id,
            state,
            reason: reasonByState[state],
            expectedReviewAt,
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(
        state === "AVAILABLE"
          ? `${selectedAircraft.registration} ist wieder verfügbar.`
          : `${selectedAircraft.registration}: ${aircraftStateLabel[state]}.`,
      );
      setAircraftPauseOpen(false);
      await refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugstatus konnte nicht geändert werden.",
      );
    }
  }

  function startAircraftPause() {
    if (!selectedAircraft) return;
    const expectedReviewAt = expectedReviewAtFromPause(aircraftPauseMinutes, aircraftPauseUnknown);
    void setFlightLineAircraftState("PAUSED", expectedReviewAt);
  }

  async function triggerEmergency() {
    if (!board || emergencyReason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "TRIGGER_EMERGENCY",
          payload: { reason: emergencyReason.trim() },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Notfallmodus ausgelöst.");
      setEmergencyReason("");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Notfallkommando fehlgeschlagen.");
    }
  }

  async function mutateQueue(type: "DEFER_TICKET_GROUP" | "MARK_NO_SHOW", reasonOverride?: string) {
    const effectiveReason = reasonOverride ?? queueReason.trim();
    if (!board || !selected || effectiveReason.length < 3) return;
    const movesToClarification =
      type === "DEFER_TICKET_GROUP" && selected.deferralCount + 1 >= board.event.maxTicketDeferrals;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type,
          payload: { ticketGroupId: selected.ticketGroupId, reason: effectiveReason },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(
        type === "MARK_NO_SHOW"
          ? "No-Show protokolliert."
          : movesToClarification
            ? "Höchstzahl erreicht · Fluggruppe zur Klärung an die Kasse gegeben."
            : "Fluggruppe zurückgestellt.",
      );
      setQueueReason("");
      setSelectedId(null);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Queue-Aktion fehlgeschlagen.");
    }
  }

  async function setRotationCapacity() {
    if (!board || !selected || selected.status !== "DRAFT") return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_ROTATION_CAPACITY",
          payload: {
            rotationId: selected.id,
            usableCapacity: dispositionCapacity,
            reason: "Nutzbare Kapazität vor dem Aufruf organisatorisch angepasst",
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Nutzbare Kapazität übernommen; betroffene Gruppen wurden gemeinsam neu gereiht.");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Kapazitätsänderung fehlgeschlagen.");
    }
  }

  async function moveTicketGroup(ticketGroupId: string, targetRotationId: string, reason: string) {
    if (!board || reason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "MOVE_TICKET_GROUP",
          payload: { ticketGroupId, targetRotationId, reason: reason.trim() },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Die gesamte Buchungsgruppe wurde verschoben und protokolliert.");
      setMoveReason("");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Verschiebung fehlgeschlagen.");
    }
  }

  async function markTicketNoShow(ticketId: string) {
    if (!board || !selected || !noShowReady) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "MARK_TICKET_NO_SHOW",
          payload: {
            ticketId,
            reason: "Nach Ablauf der No-Show-Frist nicht anwesend",
          },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Das fehlende anonyme Ticket wurde als No-Show protokolliert.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No-Show konnte nicht gesetzt werden.");
    }
  }

  async function confirmAttendanceDecision(decision: "FLY_WITH_PRESENT" | "LEAVE_SEAT_EMPTY") {
    if (!board || !selected) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CONFIRM_ATTENDANCE_DECISION",
          payload: { rotationId: selected.id, decision },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(
        decision === "FLY_WITH_PRESENT"
          ? `Entscheidung für ${presentCount} anwesende Tickets dokumentiert.`
          : "Entscheidung für freie Plätze dokumentiert.",
      );
      setDispositionOpen(false);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Entscheidung nicht gespeichert.");
    }
  }

  async function revokeCall() {
    if (!board || !selected || selected.status !== "CALLED") return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "REVOKE_CALL",
          payload: { rotationId: selected.id },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("NEXT wurde durch ein Korrekturereignis zurückgenommen.");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Rücknahme fehlgeschlagen.");
    }
  }

  async function abortRotation() {
    if (!board || !selected || selected.status !== "CALLED" || queueReason.trim().length < 3)
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "ABORT_ROTATION",
          payload: { rotationId: selected.id, reason: queueReason.trim() },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage("Umlauf abgebrochen; die Gruppe steht wieder vorn in ihrer Produkt-Queue.");
      setQueueReason("");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Umlaufabbruch fehlgeschlagen.");
    }
  }

  async function setAttendance(ticketId: string, checkedIn: boolean) {
    if (!board || !selected || !["DRAFT", "CALLED"].includes(selected.status)) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: FLIGHT_LINE_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_TICKET_ATTENDANCE",
          payload: { ticketId, checkedIn },
        },
        deviceTokenFor(FLIGHT_LINE_DEVICE_ID),
      );
      setMessage(checkedIn ? "Ticket als anwesend markiert." : "Anwesenheit zurückgenommen.");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Anwesenheitsabgleich fehlgeschlagen.");
    }
  }

  return (
    <Shell className="flight-line-shell" title="Flight Line">
      <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
      <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
      <OperationalNotice note={board?.event.operationalNote} />
      {board?.currentDeviceRole === "FLIGHT_LINE_LEAD" && !board.event.emergencyMode ? (
        <details className="emergency-control">
          <summary>Not-Halt</summary>
          <div className="emergency-control-body">
            <label>
              <span id="flight-line-emergency-title">Begründung</span>
              <input
                value={emergencyReason}
                onChange={(event) => setEmergencyReason(event.target.value)}
                placeholder="Grund eingeben"
              />
            </label>
            <button
              className="danger-action"
              disabled={emergencyReason.trim().length < 3}
              onClick={triggerEmergency}
              type="button"
            >
              Not-Halt auslösen
            </button>
          </div>
        </details>
      ) : null}
      {board ? (
        <FlightLineSupervisorConsole
          action={
            action
              ? {
                  label: action.label,
                  disabled:
                    action.command === "CALL_NEXT" &&
                    (!nextAircraftId ||
                      !nextPilotId ||
                      board.event.emergencyMode ||
                      board.event.status !== "ACTIVE" ||
                      board.event.operationalInterrupted),
                  run: () => void advance(),
                }
              : null
          }
          aircraft={operationalAircraft}
          aircraftRotations={aircraftRotations ?? []}
          board={board}
          message={message}
          nextPilotId={nextPilotId}
          onAvailable={() => void setFlightLineAircraftState("AVAILABLE")}
          onOpenDetails={() => setDetailsOpen(true)}
          onOpenDisposition={() => setDispositionOpen(true)}
          onPause={() => setAircraftPauseOpen(true)}
          onPilotChange={setNextPilotId}
          onRefuel={() => void setFlightLineAircraftState("REFUELING")}
          onSelectAircraft={(aircraftId) => {
            setSelectedAircraftId(aircraftId);
            setSelectedId(null);
            setDispositionOpen(false);
            setDetailsOpen(false);
          }}
          onSelectRotation={(rotationId) => {
            const rotation = aircraftRotations?.find((entry) => entry.id === rotationId);
            setSelectedId(rotationId);
            if (rotation) setDispositionCapacity(rotation.usableCapacity);
            setMoveTargetId("");
            setMoveReason("");
          }}
          onUnavailable={() => void setFlightLineAircraftState("INACTIVE")}
          selectedAircraft={selectedAircraft}
          selectedRotation={selected}
        />
      ) : null}
      <section
        className={`flight-supervisor legacy-flight-line-overlay ${
          dispositionOpen ? "show-disposition" : "show-details"
        }`}
        hidden={!dispositionOpen && !detailsOpen}
      >
        <button
          aria-label="Erweiterte Flight-Line-Details schließen"
          className="legacy-overlay-close"
          onClick={() => {
            setDispositionOpen(false);
            setDetailsOpen(false);
          }}
          type="button"
        >
          ×
        </button>
        <nav className="aircraft-selector" aria-label="Flugzeug auswählen">
          <div className="aircraft-selector-heading">
            <strong>Flugzeuge</strong>
            <span>{operationalAircraft.length}</span>
          </div>
          {operationalAircraft.map((aircraft) => {
            const assignedRotation = operationalRotations?.find(
              (rotation) => rotation.aircraftId === aircraft.id,
            );
            return (
              <button
                className={aircraft.id === selectedAircraft?.id ? "selected" : ""}
                key={aircraft.id}
                onClick={() => {
                  setSelectedAircraftId(aircraft.id);
                  setSelectedId(null);
                  setDispositionOpen(false);
                }}
                type="button"
              >
                <strong>{aircraft.registration}</strong>
                <span>{aircraft.passengerSeats} Plätze</span>
                <small>
                  {assignedRotation
                    ? `${assignedRotation.communicationLabel} · ${rotationStatusLabel[assignedRotation.status]}`
                    : aircraftStateLabel[aircraft.operationalState]}
                </small>
              </button>
            );
          })}
        </nav>
        <section className="flight-workspace">
          <div className="queue-list">
            <h1>
              {selectedAircraft
                ? `Nächste Gruppen für ${selectedAircraft.registration}`
                : "Flugzeuge"}
            </h1>
            {aircraftRotations?.map((rotation) => {
              const segmentLabel = sharedGroupSegmentLabel(rotation, operationalRotations ?? []);
              return (
                <div className="queue-row-wrap" key={rotation.id}>
                  <button
                    className={rotation.id === selected?.id ? "queue-row selected" : "queue-row"}
                    onClick={() => {
                      setSelectedId(rotation.id);
                      setDispositionCapacity(rotation.usableCapacity);
                      setMoveTargetId("");
                      setMoveReason("");
                    }}
                    type="button"
                  >
                    <strong>{rotation.communicationLabel}</strong>
                    <span>{rotation.productName}</span>
                    <span>
                      {rotation.ticketCount}/{rotation.usableCapacity} Plätze ·{" "}
                      {rotation.predictedLowerMinutes}–{rotation.predictedUpperMinutes} Min.
                    </span>
                    {segmentLabel ? <small>{segmentLabel}</small> : null}
                  </button>
                  <button
                    aria-label={`Disposition für ${rotation.communicationLabel}`}
                    className="disposition-trigger"
                    onClick={() => {
                      setSelectedId(rotation.id);
                      setDispositionCapacity(rotation.usableCapacity);
                      setMoveTargetId("");
                      setMoveReason("");
                      setDispositionOpen(true);
                    }}
                    type="button"
                  >
                    Disposition
                  </button>
                </div>
              );
            })}
            {selectedAircraft && aircraftRotations?.length === 0 ? (
              <p>Für dieses Flugzeug ist aktuell keine passende Fluggruppe offen.</p>
            ) : null}
            {!selectedAircraft ? <p>Kein aktives Flugzeug verfügbar.</p> : null}
          </div>
          <div className="rotation-detail">
            {selectedAircraft ? (
              <section className="supervisor-aircraft-summary">
                <div>
                  <span>Ausgewähltes Flugzeug</span>
                  <h1>{selectedAircraft.registration}</h1>
                  <p>
                    {selectedAircraft.aircraftType} · {selectedAircraft.passengerSeats} Plätze ·{" "}
                    {selectedAircraft.resourceGroupName || "Keine Ressourcengruppe"}
                  </p>
                </div>
                <strong
                  className={`aircraft-state state-${selectedAircraft.operationalState.toLowerCase()}`}
                >
                  {aircraftStateLabel[selectedAircraft.operationalState]}
                </strong>
                {selectedAircraft.expectedReviewAt ? (
                  <small>
                    Erwartete Rückkehr{" "}
                    {operationalTimeLabel(
                      selectedAircraft.expectedReviewAt,
                      board?.event.timeZone ?? "Europe/Berlin",
                    )}
                  </small>
                ) : null}
                <div className="supervisor-aircraft-actions">
                  {!canManageAircraft ? (
                    <span>Flottenstatus wird durch die Flight-Line-Leitung gesteuert.</span>
                  ) : selectedAircraft.operationalState === "AVAILABLE" ? (
                    <>
                      <button onClick={() => setAircraftPauseOpen(true)} type="button">
                        Pause
                      </button>
                      <button
                        onClick={() => void setFlightLineAircraftState("REFUELING")}
                        type="button"
                      >
                        Tanken
                      </button>
                      <button
                        onClick={() => void setFlightLineAircraftState("INACTIVE")}
                        type="button"
                      >
                        Herausnehmen
                      </button>
                    </>
                  ) : ["PAUSED", "REFUELING", "INACTIVE", "INTERRUPTED"].includes(
                      selectedAircraft.operationalState,
                    ) ? (
                    <button
                      className="primary-action"
                      onClick={() => void setFlightLineAircraftState("AVAILABLE")}
                      type="button"
                    >
                      Wieder verfügbar
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}
            {selected ? (
              <>
                <div className={`state-banner state-${selected.status.toLowerCase()}`}>
                  <span>Status</span>
                  <strong>{rotationStatusLabel[selected.status]}</strong>
                </div>
                <h2>Fluggruppe {selected.communicationLabel}</h2>
                {sharedGroupSegmentLabel(selected, operationalRotations ?? []) ? (
                  <p className="shared-group-label">
                    {sharedGroupSegmentLabel(selected, operationalRotations ?? [])}
                  </p>
                ) : null}
                <dl>
                  <div>
                    <dt>Produkt</dt>
                    <dd>{selected.productName}</dd>
                  </div>
                  <div>
                    <dt>Tickets</dt>
                    <dd>{selected.ticketCount}</dd>
                  </div>
                  <div>
                    <dt>Geschätzte Passagierzuladung</dt>
                    <dd>
                      {selected.estimatedPassengerPayloadKg === null
                        ? "Nicht vollständig erfasst"
                        : `${selected.estimatedPassengerPayloadKg} kg`}
                    </dd>
                  </div>
                  <div>
                    <dt>Zurückstellungen</dt>
                    <dd>
                      {selected.deferralCount}/{board?.event.maxTicketDeferrals ?? 2}
                    </dd>
                  </div>
                  <div>
                    <dt>Flugzeug</dt>
                    <dd>
                      {selected.aircraftRegistration ??
                        (selected.suggestedAircraftRegistration
                          ? `Vorschlag ${selected.suggestedAircraftRegistration} · Bestätigung mit NEXT`
                          : "Kein kompatibles Flugzeug verfügbar")}
                    </dd>
                  </div>
                  {selected.status !== "DRAFT" ? (
                    <div>
                      <dt>Pilotencode</dt>
                      <dd>{selected.pilotOperationalCode ?? "Nicht erfasst"}</dd>
                    </div>
                  ) : null}
                </dl>
                {selected.status === "DRAFT" ? (
                  <details className="pilot-assignment">
                    <summary>
                      Pilotzuordnung · {selected.suggestedPilotOperationalCode ?? "noch offen"}
                    </summary>
                    <label>
                      Anonymer Pilotencode
                      <select
                        aria-label="Pilotencode für NEXT"
                        value={nextPilotId}
                        onChange={(event) => setNextPilotId(event.target.value)}
                      >
                        <option value="">Pilotencode wählen</option>
                        {board?.pilots
                          .filter(
                            (pilot) =>
                              pilot.active &&
                              !pilot.paused &&
                              (!pilot.currentRotationId || pilot.currentRotationId === selected.id),
                          )
                          .map((pilot) => (
                            <option value={pilot.id} key={pilot.id}>
                              {pilot.operationalCode}
                              {pilot.id === selected.suggestedPilotId ? " · Vorschlag" : ""}
                            </option>
                          ))}
                      </select>
                    </label>
                  </details>
                ) : null}
                <p className="safety-disclaimer">
                  Nur organisatorische Schätzung aus konfigurierten Referenzgewichten. Die Bewertung
                  und Entscheidung liegt ausschließlich beim Piloten; keine Sicherheits- oder
                  Freigabewirkung.
                </p>
                <section className="rotation-timeline" aria-labelledby="timeline-title">
                  <div>
                    <h3 id="timeline-title">Plan · Prognose · Ist</h3>
                    <span>
                      Prognosequalität:{" "}
                      {selected.timeline.predictionQuality
                        ? predictionQualityLabel[selected.timeline.predictionQuality]
                        : "noch nicht berechnet"}
                    </span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Punkt</th>
                        <th scope="col">Plan</th>
                        <th scope="col">Prognose</th>
                        <th scope="col">Ist</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["Boarding", "boardingAt"],
                          ["Start", "departureAt"],
                          ["Landung", "landingAt"],
                          ["Abschluss", "completionAt"],
                        ] as const
                      ).map(([label, field]) => (
                        <tr key={field}>
                          <th scope="row">{label}</th>
                          <td>
                            {operationalTimeLabel(
                              selected.timeline.planned[field],
                              board?.event.timeZone ?? "Europe/Berlin",
                            )}
                          </td>
                          <td>
                            {operationalTimeLabel(
                              selected.timeline.predicted[field],
                              board?.event.timeZone ?? "Europe/Berlin",
                            )}
                          </td>
                          <td>
                            {operationalTimeLabel(
                              selected.timeline.actual[field],
                              board?.event.timeZone ?? "Europe/Berlin",
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="attendance-panel" aria-labelledby="attendance-title">
                  <div>
                    <h3 id="attendance-title">Anwesenheit (optional)</h3>
                    <span>
                      {
                        selected.tickets.filter(
                          (ticket) => ticket.attendanceStatus === "CHECKED_IN",
                        ).length
                      }
                      /{selected.tickets.length} eingecheckt
                    </span>
                  </div>
                  <div className="attendance-list">
                    {selected.tickets.map((ticket, index) => {
                      const checkedIn = ticket.attendanceStatus === "CHECKED_IN";
                      return (
                        <button
                          className={checkedIn ? "checked-in" : ""}
                          disabled={!["DRAFT", "CALLED"].includes(selected.status)}
                          key={ticket.id}
                          onClick={() => setAttendance(ticket.id, !checkedIn)}
                          type="button"
                        >
                          Ticket {index + 1} · {checkedIn ? "anwesend" : "offen"}
                        </button>
                      );
                    })}
                  </div>
                  <small>
                    Der Standardumlauf bleibt auch ohne Einzelabgleich vollständig bedienbar.
                  </small>
                </section>
                {selected.status === "LANDED" ? (
                  <p className="landed-warning">Gelandet · noch nicht verfügbar</p>
                ) : null}
                {selected.status === "DRAFT" || selected.status === "CALLED" ? (
                  <div className="correction-controls">
                    <label>
                      Grund für Queue-Abweichung
                      <input
                        value={queueReason}
                        onChange={(event) => setQueueReason(event.target.value)}
                        placeholder="Mindestens 3 Zeichen"
                      />
                    </label>
                    <div className="secondary-actions">
                      <button
                        disabled={queueReason.trim().length < 3}
                        onClick={() => mutateQueue("DEFER_TICKET_GROUP")}
                        type="button"
                      >
                        Zurückstellen
                      </button>
                      {selected.status === "CALLED" ? (
                        <button
                          disabled={queueReason.trim().length < 3}
                          onClick={() => void abortRotation()}
                          type="button"
                        >
                          Umlauf abbrechen · Gruppe nach vorn
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {message ? (
                  <div className="action-message" role="status">
                    {message}
                  </div>
                ) : null}
                {selected.status === "CALLED" &&
                selected.calledAt &&
                Date.now() - Date.parse(selected.calledAt) <= 10_000 ? (
                  <button className="undo-action" onClick={revokeCall} type="button">
                    NEXT rückgängig
                  </button>
                ) : null}
                {action ? (
                  <button
                    className="primary-action"
                    disabled={
                      action.command === "CALL_NEXT" &&
                      (!nextAircraftId ||
                        !nextPilotId ||
                        board?.event.emergencyMode ||
                        board?.event.status !== "ACTIVE" ||
                        board?.event.operationalInterrupted)
                    }
                    onClick={advance}
                    type="button"
                  >
                    {action.label}
                  </button>
                ) : (
                  <div className="completed-state">Umlauf abgeschlossen</div>
                )}
              </>
            ) : (
              <p>Noch keine Fluggruppe vorhanden.</p>
            )}
          </div>
          {dispositionOpen && selected ? (
            <aside className="disposition-panel" aria-labelledby="disposition-title">
              <div className="disposition-heading">
                <div>
                  <span>Disposition</span>
                  <h2 id="disposition-title">{selected.communicationLabel}</h2>
                </div>
                <button
                  aria-label="Disposition schließen"
                  onClick={() => setDispositionOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <p className="disposition-status">
                {selected.status === "DRAFT" ? "Vor dem Aufruf" : "Aufgerufen"} · ganze Gruppen
                bleiben verbunden
              </p>
              {selected.status === "DRAFT" &&
              ["FLIGHT_LINE_LEAD", "ADMIN"].includes(board?.currentDeviceRole ?? "") ? (
                <section>
                  <h3>Nutzbare Plätze</h3>
                  <div className="compact-stepper">
                    <button
                      onClick={() => setDispositionCapacity((value) => Math.max(1, value - 1))}
                      type="button"
                    >
                      −
                    </button>
                    <output>{dispositionCapacity}</output>
                    <button
                      onClick={() =>
                        setDispositionCapacity((value) =>
                          Math.min(selected.baselineCapacity, value + 1),
                        )
                      }
                      type="button"
                    >
                      +
                    </button>
                  </div>
                  <p>
                    Ausgangskapazität {selected.baselineCapacity}.{" "}
                    {dispositionCapacity < selected.ticketCount
                      ? `Die Gruppe ${selected.ticketGroupId.slice(0, 8)} mit ${selected.ticketCount} Tickets rückt gemeinsam an die vorderste passende Position.`
                      : "Keine Buchungsgruppe muss neu eingereiht werden."}
                  </p>
                  <small>Rein organisatorisch · keine Sicherheits- oder Freigabewirkung.</small>
                  <button
                    disabled={dispositionCapacity === selected.usableCapacity}
                    onClick={() => void setRotationCapacity()}
                    type="button"
                  >
                    Kapazität übernehmen
                  </button>
                </section>
              ) : null}
              {["DRAFT", "CALLED"].includes(selected.status) ? (
                <section>
                  <h3>Ganze Gruppe verschieben</h3>
                  <label>
                    Zielumlauf
                    <select
                      value={moveTargetId}
                      onChange={(event) => setMoveTargetId(event.target.value)}
                    >
                      <option value="">Passendes Ziel wählen</option>
                      {moveTargets.map(({ rotation, freeSeats }) => (
                        <option value={rotation.id} key={rotation.id}>
                          {rotation.communicationLabel} · {freeSeats} Plätze frei ·{" "}
                          {rotation.status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Begründung der Abweichung
                    <input
                      value={moveReason}
                      onChange={(event) => setMoveReason(event.target.value)}
                      placeholder="Kurz begründen"
                    />
                  </label>
                  <small>Die gesamte Buchungsgruppe wird verschoben; keine Trennung.</small>
                  <button
                    disabled={!moveTargetId || moveReason.trim().length < 3}
                    onClick={() =>
                      void moveTicketGroup(selected.ticketGroupId, moveTargetId, moveReason)
                    }
                    type="button"
                  >
                    Verschiebung übernehmen
                  </button>
                  {moveTargets.length === 0 ? (
                    <p>Aktuell ist kein passendes Ziel mit genügend Platz vorhanden.</p>
                  ) : null}
                </section>
              ) : null}
              {selected.status === "CALLED" ? (
                <section className="attendance-decision">
                  <h3>Anwesenheitsentscheidung</h3>
                  <strong>
                    Anwesend {presentCount} von {selected.tickets.length}
                  </strong>
                  {!noShowReady ? (
                    <p>
                      No-Show ist erst nach {board?.event.noShowAfterMinutes ?? 10} Minuten
                      verfügbar.
                    </p>
                  ) : null}
                  {missingTickets.length > 0 && presentCount > 0 ? (
                    <div className="disposition-actions">
                      <button
                        onClick={() =>
                          void mutateQueue(
                            "DEFER_TICKET_GROUP",
                            "Aufgerufene Gruppe gemeinsam zurückgestellt",
                          )
                        }
                        type="button"
                      >
                        Gemeinsam zurückstellen
                      </button>
                      <button
                        onClick={() => void confirmAttendanceDecision("FLY_WITH_PRESENT")}
                        type="button"
                      >
                        Mit {presentCount} Personen fliegen
                      </button>
                      <button
                        onClick={() => void confirmAttendanceDecision("LEAVE_SEAT_EMPTY")}
                        type="button"
                      >
                        Fehlende Plätze leer lassen
                      </button>
                    </div>
                  ) : null}
                  {missingTickets.map((ticket, index) => (
                    <button
                      disabled={!noShowReady}
                      key={ticket.id}
                      onClick={() => void markTicketNoShow(ticket.id)}
                      type="button"
                    >
                      Fehlendes Ticket {index + 1} als No-Show markieren
                    </button>
                  ))}
                  {replacement ? (
                    <div className="replacement-suggestion">
                      <strong>Ersatzvorschlag</strong>
                      <span>
                        {replacement.rotation.communicationLabel} ·{" "}
                        {replacement.rotation.ticketCount} Ticket
                        {replacement.rotation.ticketCount === 1 ? "" : "s"} · vollständig
                        eingecheckt
                      </span>
                      <button
                        onClick={() =>
                          void moveTicketGroup(
                            replacement.rotation.ticketGroupId,
                            selected.id,
                            "Bestätigter Ersatzvorschlag nach Anwesenheitsabgleich",
                          )
                        }
                        type="button"
                      >
                        Ersatz übernehmen
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </aside>
          ) : null}
        </section>
      </section>
      {aircraftPauseOpen && selectedAircraft ? (
        <div className="modal-backdrop">
          <form
            aria-labelledby="aircraft-pause-title"
            aria-modal="true"
            className="confirmation-dialog aircraft-pause-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              startAircraftPause();
            }}
            role="dialog"
          >
            <div className="drawer-heading">
              <div>
                <h2 id="aircraft-pause-title">Pause für {selectedAircraft.registration}</h2>
                <p>Die Dauer verbessert nur die Wartezeitprognose.</p>
              </div>
              <button
                aria-label="Pausendialog schließen"
                onClick={() => setAircraftPauseOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <fieldset disabled={aircraftPauseUnknown}>
              <legend>Geschätzte Dauer (optional)</legend>
              <div className="pause-duration-presets">
                {[10, 20, 30].map((minutes) => (
                  <button
                    className={aircraftPauseMinutes === String(minutes) ? "selected" : ""}
                    key={minutes}
                    onClick={() => setAircraftPauseMinutes(String(minutes))}
                    type="button"
                  >
                    {minutes} Min.
                  </button>
                ))}
              </div>
              <label>
                Andere Dauer
                <input
                  min={1}
                  onChange={(event) => setAircraftPauseMinutes(event.target.value)}
                  type="number"
                  value={aircraftPauseMinutes}
                />
              </label>
            </fieldset>
            <label className="checkbox-label">
              <input
                checked={aircraftPauseUnknown}
                onChange={(event) => setAircraftPauseUnknown(event.target.checked)}
                type="checkbox"
              />
              Dauer noch unbekannt
            </label>
            <ValidationHint>
              Das Flugzeug wird nicht automatisch freigegeben. „Wieder verfügbar“ bleibt eine
              bewusste Bestätigung der Flight Line.
            </ValidationHint>
            <div className="dialog-actions">
              <button onClick={() => setAircraftPauseOpen(false)} type="button">
                Abbrechen
              </button>
              <button
                className="pause-primary-action"
                disabled={
                  !aircraftPauseUnknown &&
                  (!Number.isFinite(Number(aircraftPauseMinutes)) ||
                    Number(aircraftPauseMinutes) < 1)
                }
                type="submit"
              >
                Pause starten
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </Shell>
  );
}

function TicketStatusView({ code }: { code: string }) {
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

function PrivacyView() {
  return (
    <Shell title="Datenschutz">
      <section className="privacy-page">
        <span className="eyebrow">Datensparsame V1</span>
        <h1>Privatsphäre ohne Gastkonto</h1>
        <p>
          Der Rundflug-Leitstand erfasst keine Namen und keine Telefonnummern. Der Ticketstatus ist
          ausschließlich über einen zufälligen Ticketcode erreichbar.
        </p>
        <h2>Web-Push ist freiwillig</h2>
        <p>
          Erst nach Ihrer aktiven Zustimmung speichert das System die pseudonyme Push-Adresse Ihres
          Browsers, die technischen Push-Schlüssel, den Einwilligungszeitpunkt und die Zuordnung zum
          Ticket. Die Daten dienen nur den Statushinweisen für dieses Ticket.
        </p>
        <p>
          Die Push-Daten werden bei Deaktivierung widerrufen und automatisch nach der für die
          Veranstaltung festgelegten Frist gelöscht, standardmäßig sieben Tage nach
          Veranstaltungsende. Der operative Ticket- und Auditbestand bleibt davon getrennt.
        </p>
        <a className="privacy-link" href="/">
          Zurück zum Leitstand
        </a>
      </section>
    </Shell>
  );
}

function PairDeviceView() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const deviceId = params.get("device") ?? "";
  const token = params.get("token") ?? "";
  const role = params.get("role") ?? "";
  const eventId = params.get("event") ?? "";
  const roleTargets: Record<string, string> = {
    CASHIER: "/",
    FLIGHT_LINE: "/flight-line",
    FLIGHT_LINE_LEAD: "/flight-line",
    FLIGHT_DIRECTOR: "/admin",
    ADMIN: "/admin",
    DISPLAY: "/fids?kiosk=1",
  };
  const valid =
    /^[0-9a-f-]{36}$/i.test(deviceId) &&
    /^[A-Za-z0-9_-]{40,64}$/.test(token) &&
    eventId.trim().length > 0 &&
    role in roleTargets;
  const activate = () => {
    if (!valid) return;
    const viewRole =
      role === "FLIGHT_LINE_LEAD" ? "FLIGHT_LINE" : role === "FLIGHT_DIRECTOR" ? "ADMIN" : role;
    rememberDeviceCredential(window.localStorage, viewRole, deviceId, token);
    rememberActiveEvent(window.localStorage, eventId);
    window.history.replaceState(null, "", "/pair");
    window.location.assign(roleTargets[role] ?? "/");
  };
  return (
    <Shell title="Gerätekopplung">
      <section className="pair-device-page">
        <span className="eyebrow">Anonyme Geräteidentität</span>
        <h1>Gerät koppeln</h1>
        {valid ? (
          <>
            <p>
              Dieses Gerät erhält für den Veranstaltungstag die feste Rolle <strong>{role}</strong>.
              Es wird kein persönliches Helferkonto angelegt.
            </p>
            <button className="primary-action" onClick={activate} type="button">
              Kopplung bestätigen
            </button>
          </>
        ) : (
          <p>
            Der Kopplungslink ist ungültig. Bitte in der Administration einen neuen QR-Code
            erzeugen.
          </p>
        )}
      </section>
    </Shell>
  );
}

function SetupView() {
  const [status, setStatus] = useState<{
    setupRequired: boolean;
    setupConfigured: boolean;
  } | null>(null);
  const [eventId, setEventId] = useState(`rundflug-${new Date().getFullYear()}`);
  const [name, setName] = useState(`Rundflug ${new Date().getFullYear()}`);
  const [eventDate, setEventDate] = useState(eventDateInTimeZone(new Date(), "Europe/Berlin"));
  const [aerodrome, setAerodrome] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getSetupStatus()
      .then(setStatus)
      .catch((cause) =>
        setMessage(cause instanceof Error ? cause.message : "Einrichtungsstatus nicht verfügbar."),
      );
  }, []);

  async function submitSetup() {
    if (busy) return;
    const validationMessages = setupValidationMessages({
      eventId,
      name,
      eventDate,
      aerodrome,
      setupCode,
      adminPin,
    });
    if (validationMessages.length > 0) {
      setMessage(validationMessages.join(" "));
      return;
    }
    setBusy(true);
    try {
      const adminDeviceId = crypto.randomUUID();
      const token = createDeviceToken();
      const result = await bootstrapSystem({
        setupCode,
        adminPin,
        eventId: eventId.trim(),
        name: name.trim(),
        eventDate,
        aerodrome: aerodrome.trim(),
        timeZone: "Europe/Berlin",
        adminDeviceId,
        adminCredentialHash: await sha256HexBrowser(token),
      });
      rememberDeviceCredential(window.localStorage, "ADMIN", result.adminDeviceId, token);
      rememberActiveEvent(window.localStorage, result.eventId);
      window.location.assign(`/admin?event=${encodeURIComponent(result.eventId)}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Ersteinrichtung fehlgeschlagen.");
      setBusy(false);
    }
  }

  const setupAvailable = status?.setupRequired === true && status.setupConfigured;
  return (
    <Shell title="Ersteinrichtung">
      <section className="setup-page">
        <span className="eyebrow">Einmaliger Systemstart</span>
        <h1>Rundflug-Leitstand einrichten</h1>
        {status && !status.setupRequired ? (
          <>
            <p>Die Ersteinrichtung ist bereits abgeschlossen.</p>
            <a className="privacy-link" href="/admin">
              Zur Administration
            </a>
          </>
        ) : (
          <>
            <p>
              Legt die erste Veranstaltung und dieses anonyme Administrationsgerät an. Es werden
              keine Personen- oder Gastnamen erfasst.
            </p>
            {status && !status.setupConfigured ? (
              <p className="connection-warning">
                Cloudflare-Secrets für Einrichtungscode und Administrator-PIN fehlen noch.
              </p>
            ) : null}
            <div className="setup-grid">
              <label>
                Technische Veranstaltungs-ID
                <input
                  value={eventId}
                  onChange={(event) => setEventId(event.target.value.toLowerCase())}
                  aria-describedby="event-id-help"
                />
                <small id="event-id-help">Kleinbuchstaben, Ziffern und Bindestriche</small>
              </label>
              <label>
                Bezeichnung
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <LocalizedDateInput label="Datum" value={eventDate} onChange={setEventDate} />
              <label>
                Flugplatz
                <input
                  value={aerodrome}
                  onChange={(event) => setAerodrome(event.target.value)}
                  placeholder="z. B. EDXX"
                />
              </label>
              <label>
                Einmaliger Einrichtungscode
                <input
                  type="password"
                  value={setupCode}
                  onChange={(event) => setSetupCode(event.target.value)}
                  autoComplete="off"
                />
                <small>Mindestens 16 Zeichen; exakt wie im Terminal eingegeben</small>
              </label>
              <label>
                Administrator-PIN
                <input
                  type="password"
                  inputMode="numeric"
                  value={adminPin}
                  onChange={(event) => setAdminPin(event.target.value)}
                  autoComplete="off"
                />
                <small>Mindestens 4 Zeichen</small>
              </label>
            </div>
            <button
              className="primary-action"
              type="button"
              disabled={!setupAvailable || busy}
              onClick={() => void submitSetup()}
            >
              {busy ? "Einrichtung läuft …" : "System einmalig einrichten"}
            </button>
          </>
        )}
        {message ? (
          <p className="action-message" role="status">
            {message}
          </p>
        ) : null}
      </section>
    </Shell>
  );
}

function FidsView() {
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
  return (
    <Shell title="FIDS" kiosk={KIOSK_MODE}>
      <ConnectionNotice error={error} />
      <section className="fids-board">
        <h1>Rundflug-Leitstand – FIDS</h1>
        <div className="fids-header">
          <span>Produkt</span>
          <span>Gruppe / Tickets</span>
          <span>Status</span>
          <span>Gate</span>
          <span>Flugzeug</span>
          <span>Zeitfenster</span>
        </div>
        {board?.emergencyMode ? (
          <div className="uncertainty">Der Rundflugbetrieb ist derzeit unterbrochen.</div>
        ) : null}
        {board?.operationalInterrupted ? (
          <div className="uncertainty">
            Flugbetrieb organisatorisch unterbrochen – Zeitfenster ausgesetzt.
          </div>
        ) : null}
        <OperationalNotice note={board?.operationalNotice} />
        {board?.groups.map((group) => (
          <div key={group.communicationNumber}>
            <div className="fids-row">
              <strong>
                {group.productCode} · {group.productName}
              </strong>
              <span className="fids-group" data-label="Gruppe / Tickets">
                <b>
                  {group.productCode}-{String(group.communicationNumber).padStart(3, "0")}
                </b>
                <small>{group.ticketLabels.join(" · ")}</small>
              </span>
              <span
                className={`status-chip status-${group.status.toLowerCase()}`}
                data-label="Status"
              >
                {publicStatusLabel[group.status]}
              </span>
              <span data-label="Gate">{group.gateLabel}</span>
              <span data-label="Flugzeug">{group.aircraftRegistration ?? "Zuweisung offen"}</span>
              <span data-label="Zeitfenster">
                {group.waitLowerMinutes}–{group.waitUpperMinutes} Min.
              </span>
            </div>
            <OperationalNotice note={group.operationalNotice} />
          </div>
        ))}
        {board && board.fleet.length > 0 ? (
          <section className="fleet-status" aria-label="Flottenstatus">
            <strong>Flotte</strong>
            {board.fleet.map((aircraft) => (
              <span key={aircraft.registration}>
                {aircraft.registration} · {aircraftStateLabel[aircraft.status]}
                {aircraft.refuelPlanned ? " · Tanken vorgemerkt" : ""}
              </span>
            ))}
          </section>
        ) : null}
        <p>Zeiten sind typische Bereiche und nicht garantiert.</p>
      </section>
    </Shell>
  );
}

function AdminView() {
  const { board, error, lastConfirmedAt, refresh, refreshing } = useOperationBoard(ADMIN_DEVICE_ID);
  const [adminArea, setAdminArea] = useState<AdminArea>("master-data");
  const [masterDataCategory, setMasterDataCategory] =
    useState<MasterDataCategory>("resource-groups");
  const [reason, setReason] = useState("");
  const [adminPin, setAdminPinState] = useState("");
  const adminPinRef = useRef("");
  const setAdminPin = useCallback((value: string) => {
    adminPinRef.current = value;
    setAdminPinState(value);
  }, []);
  const [adminModeUnlocked, setAdminModeUnlocked] = useState(false);
  const [adminPinDialog, setAdminPinDialog] = useState<"unlock" | "action" | "recover" | null>(
    null,
  );
  const [adminPinError, setAdminPinError] = useState<string | null>(null);
  const [adminPinBusy, setAdminPinBusy] = useState(false);
  const pendingAdminActionRef = useRef<(() => Promise<void>) | null>(null);
  const adminPinInputRef = useRef<HTMLInputElement>(null);
  const [masterEditorOpen, setMasterEditorOpen] = useState(false);
  const initialMasterSelectionRef = useRef(false);
  const [masterSubmitAttempted, setMasterSubmitAttempted] = useState(false);
  const [masterSearch, setMasterSearch] = useState("");
  const [pendingMasterDelete, setPendingMasterDelete] = useState<MasterDataDeleteTarget | null>(
    null,
  );
  const [saleClosesAt, setSaleClosesAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [history, setHistory] = useState<AuditHistory>({ entries: [] });
  const [historyView, setHistoryView] = useState<"OPERATIONS" | "FORECASTS" | "AUDIT">(
    "OPERATIONS",
  );
  const [operationalHistory, setOperationalHistory] = useState<OperationalHistory>({
    entries: [],
    total: 0,
    limit: 50,
    offset: 0,
  });
  const [forecastHistory, setForecastHistory] = useState<ForecastHistory>({
    entries: [],
    total: 0,
    limit: 50,
    offset: 0,
  });
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyEventType, setHistoryEventType] = useState("");
  const [historyAggregateType, setHistoryAggregateType] = useState("");
  const [historyAggregateId, setHistoryAggregateId] = useState("");
  const [historySince, setHistorySince] = useState("");
  const [historyUntil, setHistoryUntil] = useState("");
  const [historyTicketStatus, setHistoryTicketStatus] = useState("");
  const [historyAircraftId, setHistoryAircraftId] = useState("");
  const [historyPilotId, setHistoryPilotId] = useState("");
  const [historyProductId, setHistoryProductId] = useState("");
  const [historyResourceGroupId, setHistoryResourceGroupId] = useState("");
  const [historyCommunicationNumber, setHistoryCommunicationNumber] = useState("");
  const [historyTicketId, setHistoryTicketId] = useState("");
  const [historyTicketGroupId, setHistoryTicketGroupId] = useState("");
  const [historyRotationId, setHistoryRotationId] = useState("");
  const [devices, setDevices] = useState<PairedDeviceSummary[]>([]);
  const [deviceLabel, setDeviceLabel] = useState("Kasse 2");
  const [deviceRole, setDeviceRole] = useState<
    "CASHIER" | "FLIGHT_LINE" | "FLIGHT_LINE_LEAD" | "FLIGHT_DIRECTOR" | "ADMIN" | "DISPLAY"
  >("CASHIER");
  const [pairingQr, setPairingQr] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [pilotCode, setPilotCode] = useState("P-01");
  const [pilotNote, setPilotNote] = useState("");
  const [pilotEditorId, setPilotEditorId] = useState("new");
  const [refuelThreshold, setRefuelThreshold] = useState(5);
  const [operationalNotice, setOperationalNotice] = useState("");
  const [eventSettingsInitialized, setEventSettingsInitialized] = useState(false);
  const [saleOpensAt, setSaleOpensAt] = useState("");
  const [operationsEndAt, setOperationsEndAt] = useState("");
  const [noShowAfterMinutes, setNoShowAfterMinutes] = useState(10);
  const [maxTicketDeferrals, setMaxTicketDeferrals] = useState(2);
  const [notificationLeadMinutes, setNotificationLeadMinutes] = useState(15);
  const [childReferenceWeightKg, setChildReferenceWeightKg] = useState(35);
  const [normalReferenceWeightKg, setNormalReferenceWeightKg] = useState(80);
  const [heavyReferenceWeightKg, setHeavyReferenceWeightKg] = useState(110);
  const [plannedBoardingMinutes, setPlannedBoardingMinutes] = useState(8);
  const [plannedDeboardingMinutes, setPlannedDeboardingMinutes] = useState(5);
  const [plannedBufferMinutes, setPlannedBufferMinutes] = useState(3);
  const [pushConfigurationStatus, setPushConfigurationStatus] = useState<
    "loading" | "configured" | "missing" | "unavailable"
  >("loading");
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), 6_000);
    return () => window.clearTimeout(timeout);
  }, [message]);
  useEffect(() => {
    const controller = new AbortController();
    void getPushConfiguration(controller.signal)
      .then((configuration) =>
        setPushConfigurationStatus(configuration.configured ? "configured" : "missing"),
      )
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setPushConfigurationStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (board) {
      setSetupRequired(false);
      return;
    }
    void getSetupStatus()
      .then((result) => setSetupRequired(result.setupRequired))
      .catch(() => setSetupRequired(false));
  }, [board]);
  const [productEditorId, setProductEditorId] = useState("new");
  const [productName, setProductName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productResourceGroupId, setProductResourceGroupId] = useState("");
  const [productGateId, setProductGateId] = useState("");
  const [productPriceInput, setProductPriceInput] = useState("0,00 €");
  const [productReferenceDuration, setProductReferenceDuration] = useState(20);
  const [productChildCompanion, setProductChildCompanion] = useState(false);
  const [productWeightClasses, setProductWeightClasses] = useState<string[]>(["NOT_CAPTURED"]);
  const [productSortOrder, setProductSortOrder] = useState(10);
  const [gateEditorId, setGateEditorId] = useState("new");
  const [gateLabel, setGateLabel] = useState("");
  const [gateType, setGateType] = useState<"FLIGHT_LINE" | "BOARDING" | "DISPLAY_ONLY">(
    "FLIGHT_LINE",
  );
  const [gateActive, setGateActive] = useState(true);
  const [gateSortOrder, setGateSortOrder] = useState(10);
  const [gateDisplayProductIds, setGateDisplayProductIds] = useState<string[]>([]);
  const [gateDisplayRotationStatuses, setGateDisplayRotationStatuses] = useState<
    GateDisplayStatus[]
  >([]);
  const [manifestTicketGroupId, setManifestTicketGroupId] = useState("");
  const [manifestTargetRotationId, setManifestTargetRotationId] = useState("");
  const [manifestCorrectionReason, setManifestCorrectionReason] = useState("");
  const [resourceEditorId, setResourceEditorId] = useState("new");
  const [resourceName, setResourceName] = useState("");
  const [resourceGateId, setResourceGateId] = useState("");
  const [resourcePlannedMinutes, setResourcePlannedMinutes] = useState(30);
  const [resourceAircraftIds, setResourceAircraftIds] = useState<string[]>([]);
  const [aircraftEditorId, setAircraftEditorId] = useState("new");
  const [aircraftRegistration, setAircraftRegistration] = useState("");
  const [aircraftType, setAircraftType] = useState("");
  const [aircraftSeats, setAircraftSeats] = useState(4);
  const [aircraftMaximumPayload, setAircraftMaximumPayload] = useState("");
  const [assignmentAircraftId, setAssignmentAircraftId] = useState("");
  const [assignmentResourceGroupId, setAssignmentResourceGroupId] = useState("");
  const [events, setEvents] = useState<EventCatalogEntry[]>([]);
  const [newEventId, setNewEventId] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventAerodrome, setNewEventAerodrome] = useState("");
  const [restartMode, setRestartMode] = useState<"KEEP_MASTER_DATA" | "EMPTY">("KEEP_MASTER_DATA");
  const [restartConfirmation, setRestartConfirmation] = useState("");
  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const [factoryResetBusy, setFactoryResetBusy] = useState(false);
  const [factoryResetError, setFactoryResetError] = useState<string | null>(null);
  const [factoryResetReason, setFactoryResetReason] = useState("");
  const [factoryResetPin, setFactoryResetPin] = useState("");
  const [factoryResetConfirmation, setFactoryResetConfirmation] = useState("");
  const [retainRecoveryBackup, setRetainRecoveryBackup] = useState(true);
  const [deleteAllBackups, setDeleteAllBackups] = useState(false);
  const [factoryResetCommandId, setFactoryResetCommandId] = useState(() => crypto.randomUUID());
  const resourceGroups = board?.resourceGroups ?? [];
  const isAdministrator = board?.currentDeviceRole === "ADMIN";
  const deviceAuthorizationRejected = isDeviceAuthorizationError(error);
  const productPriceCents = parseEuroToCents(productPriceInput);
  const manifestCandidates = manifestCorrectionCandidates(board?.rotations ?? []);
  const selectedManifestCandidate = manifestCandidates.find(
    (candidate) => candidate.ticketGroupId === manifestTicketGroupId,
  );
  const manifestTargets = manifestCorrectionTargets(
    board?.rotations ?? [],
    selectedManifestCandidate,
  );

  useEffect(() => {
    if (initialMasterSelectionRef.current || adminArea !== "master-data" || !board) return;
    initialMasterSelectionRef.current = true;
    const entry = board.resourceGroups[0];
    setResourceEditorId(entry?.id ?? "new");
    setResourceName(entry?.name ?? "");
    setResourceGateId(entry?.gateId ?? board.gates.find((gate) => gate.active)?.id ?? "");
    setResourcePlannedMinutes(entry?.plannedRotationMinutes ?? 30);
    setResourceAircraftIds(entry?.activeAircraftIds ?? []);
  }, [adminArea, board]);

  useEffect(() => {
    if (!adminPinDialog && (!pendingMasterDelete || adminModeUnlocked)) return;
    const frame = window.requestAnimationFrame(() => adminPinInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [adminModeUnlocked, adminPinDialog, pendingMasterDelete]);

  useEffect(() => {
    if (!adminModeUnlocked || !isAdministrator) return;
    let timeout = window.setTimeout(() => undefined, 0);
    const lockAfterInactivity = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(
        () => {
          setAdminModeUnlocked(false);
          setAdminPin("");
          setMessage("Bearbeitungsmodus wurde nach 15 Minuten Inaktivität gesperrt.");
        },
        15 * 60 * 1000,
      );
    };
    const activityEvents = ["pointerdown", "keydown"] as const;
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, lockAfterInactivity);
    });
    lockAfterInactivity();
    return () => {
      window.clearTimeout(timeout);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, lockAfterInactivity);
      });
    };
  }, [adminModeUnlocked, isAdministrator, setAdminPin]);

  useEffect(() => {
    if (isAdministrator) return;
    setAdminModeUnlocked(false);
    setAdminPin("");
  }, [isAdministrator, setAdminPin]);
  const refreshHistory = useCallback(async () => {
    try {
      const timeZone = board?.event.timeZone ?? "Europe/Berlin";
      setHistory(
        await getAuditHistory(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID), {
          eventType: historyEventType,
          aggregateType: historyAggregateType,
          aggregateId: historyAggregateId,
          ...(historySince ? { since: eventLocalDateTimeToIso(historySince, timeZone) } : {}),
          ...(historyUntil ? { until: eventLocalDateTimeToIso(historyUntil, timeZone) } : {}),
        }),
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Historie nicht verfügbar.");
    }
  }, [
    board?.event.timeZone,
    historyAggregateId,
    historyAggregateType,
    historyEventType,
    historySince,
    historyUntil,
  ]);
  const refreshDetailedHistory = useCallback(
    async (requestedOffset: number) => {
      try {
        const timeZone = board?.event.timeZone ?? "Europe/Berlin";
        const shared = {
          ...(historySince ? { since: eventLocalDateTimeToIso(historySince, timeZone) } : {}),
          ...(historyUntil ? { until: eventLocalDateTimeToIso(historyUntil, timeZone) } : {}),
          ...(historyAircraftId ? { aircraftId: historyAircraftId } : {}),
          ...(historyPilotId ? { pilotId: historyPilotId } : {}),
          ...(historyRotationId ? { rotationId: historyRotationId.trim() } : {}),
          limit: 50,
          offset: requestedOffset,
        };
        if (historyView === "FORECASTS") {
          setForecastHistory(
            await getForecastHistory(
              EVENT_ID,
              ADMIN_DEVICE_ID,
              deviceTokenFor(ADMIN_DEVICE_ID),
              shared,
            ),
          );
        } else if (historyView === "OPERATIONS") {
          setOperationalHistory(
            await getOperationalHistory(
              EVENT_ID,
              ADMIN_DEVICE_ID,
              deviceTokenFor(ADMIN_DEVICE_ID),
              {
                ...shared,
                ...(historyTicketStatus
                  ? {
                      ticketStatus:
                        historyTicketStatus as OperationalHistory["entries"][number]["ticketStatus"],
                    }
                  : {}),
                ...(historyProductId ? { productId: historyProductId } : {}),
                ...(historyResourceGroupId ? { resourceGroupId: historyResourceGroupId } : {}),
                ...(historyCommunicationNumber
                  ? { communicationNumber: Number(historyCommunicationNumber) }
                  : {}),
                ...(historyTicketId ? { ticketId: historyTicketId.trim() } : {}),
                ...(historyTicketGroupId ? { ticketGroupId: historyTicketGroupId.trim() } : {}),
              },
            ),
          );
        }
        setHistoryOffset(requestedOffset);
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : "Verlauf nicht verfügbar.");
      }
    },
    [
      board?.event.timeZone,
      historyAircraftId,
      historyCommunicationNumber,
      historyPilotId,
      historyProductId,
      historyResourceGroupId,
      historyRotationId,
      historySince,
      historyTicketGroupId,
      historyTicketId,
      historyTicketStatus,
      historyUntil,
      historyView,
    ],
  );
  const refreshDevices = useCallback(async () => {
    try {
      setDevices(
        await getPairedDevices(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID)),
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Geräteübersicht nicht verfügbar.");
    }
  }, []);
  useEffect(() => {
    void refreshHistory();
    if (historyView !== "AUDIT") void refreshDetailedHistory(0);
    if (isAdministrator) void refreshDevices();
  }, [historyView, isAdministrator, refreshDevices, refreshDetailedHistory, refreshHistory]);
  useEffect(() => {
    if (!board || eventSettingsInitialized) return;
    setSaleOpensAt(formatEventLocalDateTime(board.event.saleOpensAt, board.event.timeZone));
    setOperationsEndAt(formatEventLocalDateTime(board.event.operationsEndAt, board.event.timeZone));
    setNoShowAfterMinutes(board.event.noShowAfterMinutes);
    setMaxTicketDeferrals(board.event.maxTicketDeferrals);
    setNotificationLeadMinutes(board.event.notificationLeadMinutes);
    setChildReferenceWeightKg(board.event.referenceWeightsKg.child);
    setNormalReferenceWeightKg(board.event.referenceWeightsKg.normal);
    setHeavyReferenceWeightKg(board.event.referenceWeightsKg.heavy);
    setPlannedBoardingMinutes(board.event.plannedBoardingMinutes);
    setPlannedDeboardingMinutes(board.event.plannedDeboardingMinutes);
    setPlannedBufferMinutes(board.event.plannedBufferMinutes);
    setEventSettingsInitialized(true);
  }, [board, eventSettingsInitialized]);

  const refreshEvents = useCallback(async () => {
    if (!isAdministrator) return;
    try {
      setEvents(
        (await getEventCatalog(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID))).events,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Veranstaltungen nicht verfügbar.");
    }
  }, [isAdministrator]);
  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);

  async function createEventFromTemplate() {
    try {
      const adminToken = deviceTokenFor(ADMIN_DEVICE_ID);
      const result = await cloneEvent(EVENT_ID, ADMIN_DEVICE_ID, adminToken, {
        commandId: crypto.randomUUID(),
        expectedSourceVersion: board?.event.version ?? 0,
        eventId: newEventId,
        name: newEventName,
        eventDate: newEventDate,
        aerodrome: newEventAerodrome,
        timeZone: board?.event.timeZone ?? "Europe/Berlin",
        restartMode,
      });
      rememberDeviceCredential(window.localStorage, "ADMIN", result.adminDeviceId, adminToken);
      rememberActiveEvent(window.localStorage, result.eventId);
      window.location.assign(`/admin?event=${encodeURIComponent(result.eventId)}`);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Veranstaltung konnte nicht angelegt werden.",
      );
    }
  }

  function lockAdminMode(messageText = "Bearbeitungsmodus gesperrt.") {
    setAdminModeUnlocked(false);
    setAdminPin("");
    setAdminPinDialog(null);
    pendingAdminActionRef.current = null;
    setMessage(messageText);
  }

  function closeAdminPinDialog() {
    if (adminPinBusy) return;
    setAdminPinDialog(null);
    setAdminPinError(null);
    setAdminPin("");
    pendingAdminActionRef.current = null;
  }

  function requestAdminAction(action: () => Promise<void>) {
    if (!isAdministrator) {
      setMessage("Für diese Änderung wird ein Administrationsgerät benötigt.");
      return;
    }
    if (adminModeUnlocked && adminPinRef.current.length >= 4) {
      void action();
      return;
    }
    pendingAdminActionRef.current = action;
    setAdminPin("");
    setAdminPinError(null);
    setAdminPinDialog("action");
  }

  function requestAdminModeUnlock() {
    if (!isAdministrator) {
      setMessage("Der Bearbeitungsmodus ist nur auf einem Administrationsgerät verfügbar.");
      return;
    }
    pendingAdminActionRef.current = null;
    setAdminPin("");
    setAdminPinError(null);
    setAdminPinDialog("unlock");
  }

  function requestAdminDeviceRecovery() {
    pendingAdminActionRef.current = null;
    setAdminPin("");
    setAdminPinError(null);
    setAdminPinDialog("recover");
  }

  async function confirmAdminPinDialog() {
    if (!adminPinDialog || adminPinBusy || adminPin.length < 4) return;
    setAdminPinBusy(true);
    setAdminPinError(null);
    try {
      if (adminPinDialog === "recover") {
        const recoveredDeviceId = ADMIN_DEVICE_ID.startsWith("unpaired-")
          ? crypto.randomUUID()
          : ADMIN_DEVICE_ID;
        const token = createDeviceToken();
        const result = await recoverAdminDevice(
          EVENT_ID,
          recoveredDeviceId,
          adminPin,
          await sha256HexBrowser(token),
        );
        rememberDeviceCredential(window.localStorage, "ADMIN", result.adminDeviceId, token);
        rememberActiveEvent(window.localStorage, result.eventId);
        setAdminPinDialog(null);
        setAdminPin("");
        window.location.reload();
        return;
      }
      await verifyAdminPin(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID), adminPin);
      if (adminPinDialog === "unlock") {
        setAdminModeUnlocked(true);
        setAdminPinDialog(null);
        setMessage("Bearbeitungsmodus aktiv. Mehrere Änderungen können gespeichert werden.");
        return;
      }
      const action = pendingAdminActionRef.current;
      pendingAdminActionRef.current = null;
      setAdminPinDialog(null);
      if (action) await action();
      setAdminPin("");
    } catch (cause) {
      setAdminPinError(
        cause instanceof Error ? cause.message : "Administrator-PIN konnte nicht geprüft werden.",
      );
      window.requestAnimationFrame(() => adminPinInputRef.current?.select());
    } finally {
      setAdminPinBusy(false);
    }
  }

  async function setEventLifecycle(status: "PREPARATION" | "ACTIVE" | "CLOSED" | "ARCHIVED") {
    if (!board || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_EVENT_LIFECYCLE",
          payload: {
            status,
            reason: ADMIN_CONFIGURATION_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(`Veranstaltungsstatus auf ${status} gesetzt und protokolliert.`);
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshEvents();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Statusänderung fehlgeschlagen.");
    }
  }

  async function pairDevice() {
    if (!board || deviceLabel.trim().length < 2 || adminPinRef.current.length < 4) return;
    const pairedDeviceId = crypto.randomUUID();
    const token = createDeviceToken();
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "PAIR_DEVICE",
          payload: {
            pairedDeviceId,
            label: deviceLabel.trim(),
            role: deviceRole,
            credentialHash: await sha256HexBrowser(token),
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      const params = new URLSearchParams({
        device: pairedDeviceId,
        token,
        role: deviceRole,
        event: EVENT_ID,
      });
      const url = `${window.location.origin}/pair#${params.toString()}`;
      setPairingUrl(url);
      setPairingQr(
        await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 320 }),
      );
      setMessage("Kopplung erstellt. QR-Code nur am vorgesehenen Gerät scannen.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshDevices();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Gerätekopplung fehlgeschlagen.");
    }
  }

  async function saveEventParameters() {
    if (!board || !operationsEndAt || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CONFIGURE_EVENT_PARAMETERS",
          payload: {
            saleOpensAt: saleOpensAt
              ? eventLocalDateTimeToIso(saleOpensAt, board.event.timeZone)
              : null,
            operationsEndAt: eventLocalDateTimeToIso(operationsEndAt, board.event.timeZone),
            noShowAfterMinutes,
            maxTicketDeferrals,
            notificationLeadMinutes,
            childReferenceWeightKg,
            normalReferenceWeightKg,
            heavyReferenceWeightKg,
            plannedBoardingMinutes,
            plannedDeboardingMinutes,
            plannedBufferMinutes,
            reason: ADMIN_CONFIGURATION_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Veranstaltungsparameter wurden protokolliert aktualisiert.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Parameter konnten nicht gespeichert werden.",
      );
    }
  }

  function selectProductForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setProductEditorId(id);
    const entry = board?.products.find((product) => product.id === id);
    setProductName(entry?.name ?? "");
    setProductCode(entry?.code ?? "");
    setProductDescription(entry?.publicDescription ?? "");
    setProductResourceGroupId(entry?.resourceGroupId ?? resourceGroups[0]?.id ?? "");
    setProductGateId(entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "");
    setProductPriceInput(formatEuroInput(entry?.priceCents ?? 0));
    setProductReferenceDuration(entry?.referenceDurationMinutes ?? 20);
    setProductChildCompanion(entry?.childCompanionRequired ?? false);
    setProductWeightClasses(entry?.weightClasses ?? ["NOT_CAPTURED"]);
    setProductSortOrder(entry?.sortOrder ?? 10);
  }

  function selectGateForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setGateEditorId(id);
    const entry = board?.gates.find((gate) => gate.id === id);
    setGateLabel(entry?.label ?? "");
    setGateType(entry?.gateType ?? "FLIGHT_LINE");
    setGateActive(entry?.active ?? true);
    setGateSortOrder(entry?.sortOrder ?? 10);
    setGateDisplayProductIds(entry?.displayFilter.productIds ?? []);
    setGateDisplayRotationStatuses(entry?.displayFilter.rotationStatuses ?? []);
  }

  async function saveGate() {
    if (!board || gateLabel.trim().length < 2 || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_GATE",
          payload: {
            gateId: gateEditorId === "new" ? crypto.randomUUID() : gateEditorId,
            label: gateLabel.trim(),
            gateType,
            active: gateActive,
            sortOrder: gateSortOrder,
            displayFilter: {
              productIds: gateDisplayProductIds,
              rotationStatuses: gateDisplayRotationStatuses,
            },
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Gate-Stammdaten wurden protokolliert gespeichert.");
      if (!adminModeUnlocked) setAdminPin("");
      setMasterEditorOpen(false);
      setGateEditorId("new");
      setGateLabel("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Gate konnte nicht gespeichert werden.");
    }
  }

  async function correctRotationManifest() {
    if (
      !board ||
      !manifestTicketGroupId ||
      !manifestTargetRotationId ||
      manifestCorrectionReason.trim().length < 10 ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CORRECT_ROTATION_MANIFEST",
          payload: {
            ticketGroupId: manifestTicketGroupId,
            targetRotationId: manifestTargetRotationId,
            reason: manifestCorrectionReason.trim(),
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setManifestTicketGroupId("");
      setManifestTargetRotationId("");
      setManifestCorrectionReason("");
      setMessage("Dokumentierte Besetzung wurde als Admin-Korrektur vollständig auditiert.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Manifestkorrektur konnte nicht gespeichert werden.",
      );
    }
  }

  async function saveProduct() {
    if (
      !board ||
      !productResourceGroupId ||
      !productGateId ||
      productWeightClasses.length === 0 ||
      productPriceCents === null ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_PRODUCT",
          payload: {
            productId: productEditorId === "new" ? crypto.randomUUID() : productEditorId,
            resourceGroupId: productResourceGroupId,
            gateId: productGateId,
            name: productName.trim(),
            code: productCode.trim().toUpperCase(),
            publicDescription: productDescription.trim(),
            priceCents: productPriceCents,
            referenceCapacity:
              resourceGroups.find((group) => group.id === productResourceGroupId)
                ?.referenceCapacity ?? 1,
            referenceDurationMinutes: productReferenceDuration,
            childCompanionRequired: productChildCompanion,
            weightClasses: productWeightClasses as Array<
              "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
            >,
            sortOrder: productSortOrder,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Produktstammdaten wurden protokolliert gespeichert.");
      if (!adminModeUnlocked) setAdminPin("");
      selectProductForEditing("new");
      setMasterEditorOpen(false);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Produkt konnte nicht gespeichert werden.",
      );
    }
  }

  function selectResourceForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setResourceEditorId(id);
    const entry = resourceGroups.find((group) => group.id === id);
    setResourceName(entry?.name ?? "");
    setResourceGateId(entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "");
    setResourcePlannedMinutes(entry?.plannedRotationMinutes ?? 30);
    setResourceAircraftIds(entry?.activeAircraftIds ?? []);
  }

  function selectAircraftForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setAircraftEditorId(id);
    const entry = board?.aircraft.find((aircraft) => aircraft.id === id);
    setAircraftRegistration(entry?.registration ?? "");
    setAircraftType(entry?.aircraftType ?? "");
    setAircraftSeats(entry?.passengerSeats ?? 4);
    setAircraftMaximumPayload(entry?.maximumPassengerPayloadKg?.toString() ?? "");
  }

  async function saveResourceGroup() {
    if (
      !board ||
      !resourceGateId ||
      resourceName.trim().length < 2 ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      const resourceGroupId = resourceEditorId === "new" ? crypto.randomUUID() : resourceEditorId;
      const selectedSeats =
        board.aircraft
          .filter((aircraft) => resourceAircraftIds.includes(aircraft.id))
          .map((aircraft) => aircraft.passengerSeats) ?? [];
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_RESOURCE_GROUP",
          payload: {
            resourceGroupId,
            name: resourceName.trim(),
            gateId: resourceGateId,
            referenceCapacity: Math.max(1, ...selectedSeats),
            plannedRotationMinutes: resourcePlannedMinutes,
            compatibleAircraftTypes: [],
            aircraftIds: resourceAircraftIds,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Ressourcengruppe und zugeordnete Flugzeuge wurden protokolliert gespeichert.");
      if (!adminModeUnlocked) setAdminPin("");
      selectResourceForEditing("new");
      setMasterEditorOpen(false);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Ressourcengruppe konnte nicht gespeichert werden.",
      );
    }
  }

  async function saveAircraft() {
    if (
      !board ||
      aircraftRegistration.trim().length < 3 ||
      aircraftType.trim().length < 2 ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_AIRCRAFT",
          payload: {
            aircraftId: aircraftEditorId === "new" ? crypto.randomUUID() : aircraftEditorId,
            registration: aircraftRegistration.trim().toUpperCase(),
            aircraftType: aircraftType.trim(),
            passengerSeats: aircraftSeats,
            maximumPassengerPayloadKg: aircraftMaximumPayload
              ? Number(aircraftMaximumPayload)
              : null,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Flugzeugstammdaten wurden protokolliert gespeichert.");
      if (!adminModeUnlocked) setAdminPin("");
      selectAircraftForEditing("new");
      setMasterEditorOpen(false);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeug konnte nicht gespeichert werden.",
      );
    }
  }

  async function assignAircraft() {
    if (
      !board ||
      !assignmentAircraftId ||
      !assignmentResourceGroupId ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "ASSIGN_AIRCRAFT_RESOURCE_GROUP",
          payload: {
            aircraftId: assignmentAircraftId,
            resourceGroupId: assignmentResourceGroupId,
            effectiveAt: new Date().toISOString(),
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        "Flugzeugzuordnung wurde historisiert geändert; Queue und Prognose werden neu berechnet.",
      );
      if (!adminModeUnlocked) setAdminPin("");
      setMasterEditorOpen(false);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugzuordnung konnte nicht geändert werden.",
      );
    }
  }

  async function revokeDevice(device: PairedDeviceSummary) {
    if (!board || reason.trim().length < 3 || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "REVOKE_DEVICE",
          payload: {
            pairedDeviceId: device.id,
            adminPin: adminPinRef.current,
            reason: reason.trim(),
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Gerätekopplung wurde sofort widerrufen.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshDevices();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Widerruf fehlgeschlagen.");
    }
  }

  async function emergency(type: "TRIGGER_EMERGENCY" | "CLEAR_EMERGENCY") {
    if (
      !board ||
      reason.trim().length < 3 ||
      (type === "CLEAR_EMERGENCY" && adminPinRef.current.length < 4)
    )
      return;
    try {
      await sendCommand(
        type === "TRIGGER_EMERGENCY"
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type,
              payload: { reason: reason.trim() },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type,
              payload: { reason: reason.trim(), adminPin: adminPinRef.current },
            },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        type === "TRIGGER_EMERGENCY" ? "Notfallmodus ausgelöst." : "Notfallmodus aufgehoben.",
      );
      setReason("");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Notfallkommando fehlgeschlagen.");
    }
  }

  async function setResourceStatus(
    resourceGroupId: string,
    status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED",
  ) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_RESOURCE_GROUP_STATUS",
          payload: {
            resourceGroupId,
            status,
            reason: OPERATIONAL_AUDIT_REASON,
            expectedReviewAt: null,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(`Ressourcengruppe auf ${status} gesetzt.`);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Statusänderung fehlgeschlagen.");
    }
  }

  async function setNotice(resourceGroupId?: string) {
    if (!board) return;
    try {
      await sendCommand(
        resourceGroupId
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "SET_RESOURCE_GROUP_NOTICE",
              payload: { resourceGroupId, note: operationalNotice.trim() },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "SET_OPERATIONAL_NOTE",
              payload: { note: operationalNotice.trim() },
            },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Betriebshinweis wurde veröffentlicht und auditiert.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Betriebshinweis fehlgeschlagen.");
    }
  }

  async function setEventInterruption(interrupted: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_EVENT_INTERRUPTION",
          payload: {
            interrupted,
            reason: OPERATIONAL_AUDIT_REASON,
            expectedReviewAt: null,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        interrupted ? "Flugbetrieb organisatorisch unterbrochen." : "Flugbetrieb fortgesetzt.",
      );
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Betriebsstatus konnte nicht geändert werden.",
      );
    }
  }

  async function configureProductSales(
    product: OperationBoard["products"][number],
    saleEnabled: boolean,
    useEnteredClosingTime = false,
  ) {
    if (!board || adminPinRef.current.length < 4) return;
    try {
      const configuredClosing =
        useEnteredClosingTime && saleClosesAt
          ? eventLocalDateTimeToIso(saleClosesAt, board.event.timeZone)
          : product.saleClosesAt;
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CONFIGURE_PRODUCT_SALES",
          payload: {
            productId: product.id,
            saleEnabled,
            saleClosesAt: configuredClosing,
            warningThreshold: product.capacityWarningThreshold,
            criticalThreshold: product.capacityCriticalThreshold,
            reason: OPERATIONAL_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Verkaufssteuerung wurde protokolliert aktualisiert.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Verkaufssteuerung fehlgeschlagen.");
    }
  }

  async function setAircraftState(
    aircraftId: string,
    state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INTERRUPTED" | "INACTIVE",
  ) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_AIRCRAFT_OPERATIONAL_STATE",
          payload: {
            aircraftId,
            state,
            reason: OPERATIONAL_AUDIT_REASON,
            expectedReviewAt: null,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Flugzeugstatus wurde organisatorisch aktualisiert und protokolliert.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugstatus konnte nicht geändert werden.",
      );
    }
  }

  async function scheduleRefuel(aircraftId: string, planned: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SCHEDULE_AIRCRAFT_REFUEL",
          payload: { aircraftId, planned, reason: OPERATIONAL_AUDIT_REASON },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(planned ? "Tanken wurde unverbindlich vorgemerkt." : "Tankvormerkung aufgehoben.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Tankvormerkung fehlgeschlagen.");
    }
  }

  async function configureRefuelThreshold(aircraftId: string) {
    if (!board || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD",
          payload: {
            aircraftId,
            reminderThreshold: refuelThreshold,
            reason: OPERATIONAL_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Organisatorische Tank-Erinnerungsschwelle wurde aktualisiert.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Erinnerungsschwelle fehlgeschlagen.");
    }
  }

  async function upsertPilot(
    pilotId: string,
    operationalCode: string,
    operationalNote: string,
    active: boolean,
  ) {
    if (!board || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_PILOT",
          payload: {
            pilotId,
            operationalCode: operationalCode.trim().toUpperCase(),
            operationalNote: operationalNote.trim(),
            active,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Anonymer operativer Pilotencode wurde aktualisiert.");
      if (!adminModeUnlocked) setAdminPin("");
      setPilotEditorId("new");
      setPilotCode("P-01");
      setPilotNote("");
      setMasterEditorOpen(false);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Pilotencode konnte nicht geändert werden.",
      );
    }
  }

  function selectPilotForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setPilotEditorId(id);
    const entry = board?.pilots.find((pilot) => pilot.id === id);
    setPilotCode(entry?.operationalCode ?? "P-01");
    setPilotNote(entry?.operationalNote ?? "");
  }

  async function setPilotPause(pilotId: string, paused: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_PILOT_PAUSE",
          payload: {
            pilotId,
            paused,
            reason: OPERATIONAL_AUDIT_REASON,
            expectedReviewAt: null,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(paused ? "Anonyme Pilotenpause gestartet." : "Anonyme Pilotenpause beendet.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Pilotenpause fehlgeschlagen.");
    }
  }

  async function exportDailyReport() {
    try {
      await downloadDailyReport(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
      setMessage("Tagesbericht wurde erzeugt.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Tagesbericht fehlgeschlagen.");
    }
  }

  async function exportDailyPdf() {
    try {
      await downloadDailyPdf(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
      setMessage("PDF-Tagesbericht wurde erzeugt.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "PDF-Tagesbericht fehlgeschlagen.");
    }
  }

  async function exportRawData() {
    try {
      await downloadTicketRawData(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
      setMessage("Ticket-Rohdaten wurden exportiert.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Rohdatenexport fehlgeschlagen.");
    }
  }

  function requestMasterSave(
    action:
      | "gate"
      | "resource-group"
      | "aircraft"
      | "assignment"
      | "pilot"
      | "pilot-toggle"
      | "product",
    valid: boolean,
  ) {
    setMasterSubmitAttempted(true);
    if (!isAdministrator) {
      setMessage("Für Stammdatenänderungen wird ein Administrationsgerät benötigt.");
      return;
    }
    if (!valid) return;
    requestAdminAction(async () => {
      if (action === "gate") await saveGate();
      if (action === "resource-group") await saveResourceGroup();
      if (action === "aircraft") await saveAircraft();
      if (action === "assignment") await assignAircraft();
      if (action === "product") await saveProduct();
      if (action === "pilot") {
        const existing = board?.pilots.find((pilot) => pilot.id === pilotEditorId);
        await upsertPilot(
          pilotEditorId === "new" ? crypto.randomUUID() : pilotEditorId,
          pilotCode,
          pilotNote,
          existing?.active ?? true,
        );
      }
      if (action === "pilot-toggle") {
        const existing = board?.pilots.find((pilot) => pilot.id === pilotEditorId);
        if (existing) {
          await upsertPilot(
            existing.id,
            existing.operationalCode,
            existing.operationalNote,
            !existing.active,
          );
        }
      }
    });
  }

  function requestProductSave() {
    setMasterSubmitAttempted(true);
    const invalidFieldId =
      productName.trim().length < 2
        ? "product-name"
        : !/^[A-Z0-9-]{2,12}$/.test(productCode)
          ? "product-code"
          : productPriceCents === null
            ? "product-price"
            : !productResourceGroupId
              ? "product-resource-group"
              : !productGateId
                ? "product-gate"
                : productWeightClasses.length === 0
                  ? "product-weight-capture"
                  : productChildCompanion && !productWeightClasses.includes("CHILD")
                    ? "product-child-companion"
                    : null;
    if (invalidFieldId) {
      window.requestAnimationFrame(() => document.getElementById(invalidFieldId)?.focus());
      return;
    }
    requestMasterSave("product", true);
  }

  function openFactoryReset() {
    setFactoryResetCommandId(crypto.randomUUID());
    setFactoryResetError(null);
    setMessage(null);
    setFactoryResetReason("");
    setFactoryResetPin("");
    setFactoryResetConfirmation("");
    setRetainRecoveryBackup(true);
    setDeleteAllBackups(false);
    setFactoryResetOpen(true);
  }

  async function performFactoryReset() {
    if (
      factoryResetBusy ||
      factoryResetReason.trim().length < 3 ||
      factoryResetPin.length < 4 ||
      factoryResetConfirmation !== "WERKSZUSTAND"
    )
      return;
    setFactoryResetBusy(true);
    setFactoryResetError(null);
    try {
      const result = await factoryReset(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        {
          commandId: factoryResetCommandId,
          eventId: EVENT_ID,
          reason: factoryResetReason.trim(),
          adminPin: factoryResetPin,
          confirmation: "WERKSZUSTAND",
          retainRecoveryBackup,
          deleteAllBackups,
        },
      );
      if (result.resetComplete) {
        await clearOfflineOperationBoards();
        try {
          // `ready` remains pending forever when this browser has no active PWA registration
          // (for example during the initial local setup). Reset cleanup must never block the
          // mandatory redirect back to /setup.
          const registration = await navigator.serviceWorker?.getRegistration();
          const subscription = await registration?.pushManager.getSubscription();
          await subscription?.unsubscribe();
        } catch {
          // Der Serverzustand ist bereits gelöscht; lokale Push-Bereinigung ist best effort.
        }
        window.localStorage.clear();
        window.location.replace("/setup");
      }
    } catch (cause) {
      setFactoryResetError(
        cause instanceof Error ? cause.message : "Werkszustand konnte nicht hergestellt werden.",
      );
      setFactoryResetBusy(false);
    }
  }

  const setupSteps: SetupStep[] = [
    {
      id: "parameters",
      label: "Parameter",
      complete: Boolean(board?.event.saleOpensAt && board.event.operationsEndAt),
      area: "setup",
    },
    {
      id: "gates",
      label: "Gates",
      complete: Boolean(board?.gates.some((gate) => gate.active)),
      area: "master-data",
      category: "gates",
    },
    {
      id: "aircraft",
      label: "Flugzeuge",
      complete: Boolean(board?.aircraft.length),
      area: "master-data",
      category: "aircraft",
    },
    {
      id: "resource-groups",
      label: "Ressourcengruppen",
      complete: Boolean(
        board?.resourceGroups.length &&
          board.resourceGroups.every((group) => group.activeAircraftIds.length > 0),
      ),
      area: "master-data",
      category: "resource-groups",
    },
    {
      id: "pilots",
      label: "Piloten",
      complete: Boolean(board?.pilots.some((pilot) => pilot.active)),
      area: "master-data",
      category: "pilots",
    },
    {
      id: "products",
      label: "Produkte",
      complete: Boolean(board?.products.length),
      area: "master-data",
      category: "products",
    },
    {
      id: "activation",
      label: "Betriebsfreigabe",
      complete: Boolean(board && board.event.status !== "PREPARATION"),
      area: "setup",
    },
  ];
  const adminAreaCopy: Record<AdminArea, { title: string; description: string }> = {
    overview: {
      title: "Übersicht",
      description: "Betriebsstatus, Kennzahlen und offene organisatorische Aufgaben.",
    },
    setup: {
      title: "Einrichtung",
      description: "Das System Schritt für Schritt für den Rundflugbetrieb vorbereiten.",
    },
    "master-data": {
      title: "Stammdaten",
      description: "Ressourcen für den Flugtag verwalten.",
    },
    evaluation: {
      title: "Auswertung",
      description: "Verläufe, Berichte und seltene administrative Sonderfälle prüfen.",
    },
    backup: {
      title: "Sicherung & Reset",
      description: "Daten gezielt bereinigen oder das System vollständig neu einrichten.",
    },
  };

  function openSetupStep(step: SetupStep) {
    setAdminArea(step.area);
    if (step.category) setMasterDataCategory(step.category);
  }

  function startNewMasterDataEntry() {
    if (masterDataCategory === "gates") selectGateForEditing("new");
    if (masterDataCategory === "resource-groups") selectResourceForEditing("new");
    if (masterDataCategory === "aircraft") selectAircraftForEditing("new");
    if (masterDataCategory === "assignments") {
      setAssignmentAircraftId(board?.aircraft[0]?.id ?? "");
      setAssignmentResourceGroupId(board?.aircraft[0]?.resourceGroupId ?? "");
      setMasterSubmitAttempted(false);
      setMasterEditorOpen(true);
    }
    if (masterDataCategory === "pilots") selectPilotForEditing("new");
    if (masterDataCategory === "products") selectProductForEditing("new");
  }

  function masterDataDeletionBlockers(
    entityType: MasterDataDeleteTarget["entityType"],
    entityId: string,
  ): string[] {
    if (!board) return ["Der bestätigte Betriebsstand wird noch geladen"];
    if (entityType === "GATE") {
      const groups = resourceGroups.filter((group) => group.gateId === entityId).length;
      const products = board.products.filter((product) => product.gateId === entityId).length;
      const rotations = board.rotations.filter((rotation) => rotation.gateId === entityId).length;
      return [
        ...(groups ? [`${groups} Ressourcengruppe(n)`] : []),
        ...(products ? [`${products} Produkt(e)`] : []),
        ...(rotations ? [`${rotations} Umlauf/Umläufe`] : []),
      ];
    }
    if (entityType === "RESOURCE_GROUP") {
      const products = board.products.filter(
        (product) => product.resourceGroupId === entityId,
      ).length;
      const assignments = board.aircraft.filter(
        (aircraft) => aircraft.resourceGroupId === entityId,
      ).length;
      return [
        ...(products ? [`${products} Produkt(e)`] : []),
        ...(assignments ? [`${assignments} Flugzeugzuordnung(en)`] : []),
      ];
    }
    if (entityType === "PRODUCT") {
      const code = board.products.find((product) => product.id === entityId)?.code;
      const rotations = board.rotations.filter((rotation) => rotation.productCode === code).length;
      return rotations ? [`${rotations} Umlauf/Umläufe`] : [];
    }
    if (entityType === "AIRCRAFT") {
      const aircraft = board.aircraft.find((entry) => entry.id === entityId);
      const rotations = board.rotations.filter(
        (rotation) => rotation.aircraftId === entityId,
      ).length;
      return [
        ...(aircraft?.resourceGroupId ? ["1 Flugzeugzuordnung"] : []),
        ...(rotations ? [`${rotations} Umlauf/Umläufe`] : []),
      ];
    }
    if (entityType === "PILOT") {
      const pilot = board.pilots.find((entry) => entry.id === entityId);
      const aircraft = board.aircraft.filter((entry) => entry.currentPilotId === entityId).length;
      return [
        ...(pilot?.currentRotationId ? ["1 aktiver Umlauf"] : []),
        ...(aircraft ? [`${aircraft} Flugzeugbindung(en)`] : []),
      ];
    }
    const rotations = board.rotations.filter((rotation) => rotation.aircraftId === entityId).length;
    return rotations ? [`${rotations} Umlauf/Umläufe`] : [];
  }

  function requestMasterDelete(
    entityType: MasterDataDeleteTarget["entityType"],
    entityId: string,
    label: string,
  ) {
    if (!adminModeUnlocked) setAdminPin("");
    setPendingMasterDelete({
      entityType,
      entityId,
      label,
      blockers: masterDataDeletionBlockers(entityType, entityId),
    });
  }

  async function confirmMasterDelete() {
    if (
      !board ||
      !pendingMasterDelete ||
      pendingMasterDelete.blockers.length > 0 ||
      board.event.status !== "PREPARATION" ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "DELETE_MASTER_DATA",
          payload: {
            entityType: pendingMasterDelete.entityType,
            entityId: pendingMasterDelete.entityId,
            reason: MASTER_DATA_DELETE_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(`${pendingMasterDelete.label} wurde gelöscht und die Löschung protokolliert.`);
      setPendingMasterDelete(null);
      setMasterEditorOpen(false);
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Stammdatensatz konnte nicht gelöscht werden.",
      );
    }
  }

  const masterDataCounts: Record<MasterDataCategory, number> = {
    gates: board?.gates.length ?? 0,
    "resource-groups": resourceGroups.length,
    aircraft: board?.aircraft.length ?? 0,
    assignments: board?.aircraft.filter((aircraft) => aircraft.resourceGroupId).length ?? 0,
    pilots: board?.pilots.length ?? 0,
    products: board?.products.length ?? 0,
  };
  const normalizedMasterSearch = masterSearch.trim().toLocaleLowerCase("de-DE");
  const visibleGates = (board?.gates ?? []).filter((gate) =>
    `${gate.label} ${gate.gateType}`.toLocaleLowerCase("de-DE").includes(normalizedMasterSearch),
  );
  const visibleResourceGroups = resourceGroups.filter((group) =>
    `${group.name} ${group.gateLabel}`.toLocaleLowerCase("de-DE").includes(normalizedMasterSearch),
  );
  const visibleAircraft = (board?.aircraft ?? []).filter((aircraft) =>
    `${aircraft.registration} ${aircraft.aircraftType} ${aircraft.resourceGroupName}`
      .toLocaleLowerCase("de-DE")
      .includes(normalizedMasterSearch),
  );
  const visiblePilots = (board?.pilots ?? []).filter((pilot) =>
    `${pilot.operationalCode} ${pilot.operationalNote}`
      .toLocaleLowerCase("de-DE")
      .includes(normalizedMasterSearch),
  );
  const visibleProducts = (board?.products ?? []).filter((product) =>
    `${product.code} ${product.name} ${product.resourceGroupName} ${product.gateLabel}`
      .toLocaleLowerCase("de-DE")
      .includes(normalizedMasterSearch),
  );
  const selectedResourceAircraft = (board?.aircraft ?? []).filter((aircraft) =>
    resourceAircraftIds.includes(aircraft.id),
  );
  const selectedResourceCapacity = selectedResourceAircraft.reduce(
    (maximum, aircraft) => Math.max(maximum, aircraft.passengerSeats),
    0,
  );
  const productPositionChoices = productPositionOptions(board?.products ?? [], productEditorId);
  const masterDataSingularLabel: Record<MasterDataCategory, string> = {
    gates: "Gate",
    "resource-groups": "Ressourcengruppe",
    aircraft: "Flugzeug",
    assignments: "Zuordnung",
    pilots: "Pilotencode",
    products: "Produkt",
  };
  const masterDataSectionLabel: Record<MasterDataCategory, string> = {
    gates: "Gates",
    "resource-groups": "Ressourcengruppen",
    aircraft: "Flugzeuge",
    assignments: "Zuordnungen",
    pilots: "Pilotencodes",
    products: "Produkte",
  };

  return (
    <Shell className="admin-shell" title="Administration">
      <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
      {setupRequired ? (
        <div className="connection-warning" role="status">
          Dieses System ist noch nicht eingerichtet. <a href="/setup">Ersteinrichtung öffnen</a>
        </div>
      ) : null}
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
      <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
      <OperationalNotice note={board?.event.operationalNote} />
      <section className="admin-layout">
        <AdminNavigation activeArea={adminArea} onChange={setAdminArea} />
        <div
          className={`admin-workspace ${adminArea === "master-data" ? `master-data-active ${masterEditorOpen ? "editor-open" : "editor-closed"}` : ""}`}
        >
          {adminArea !== "master-data" ? (
            <header className="admin-page-header">
              <div>
                <h1>{adminAreaCopy[adminArea].title}</h1>
                <p>{adminAreaCopy[adminArea].description}</p>
              </div>
              <span className={`event-phase ${board?.event.status.toLowerCase() ?? "unknown"}`}>
                {board?.event.status === "ACTIVE"
                  ? "Betrieb aktiv"
                  : board?.event.status === "PREPARATION"
                    ? "Betrieb noch nicht freigegeben"
                    : board?.event.status === "CLOSED"
                      ? "Betrieb geschlossen"
                      : error
                        ? "Stand nicht verfügbar"
                        : "Stand wird geladen"}
              </span>
            </header>
          ) : null}
          {adminArea === "setup" ? (
            <SetupProgress onSelect={openSetupStep} steps={setupSteps} />
          ) : null}
          {board?.currentDeviceRole === "FLIGHT_DIRECTOR" ? (
            <div className="readonly-banner">Flugleitungsansicht · primär lesend</div>
          ) : null}
          {board ? (
            <>
              <section
                aria-label="Betriebskennzahlen"
                className="metrics-grid"
                hidden={adminArea !== "overview"}
              >
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
                  <span>Ø NEXT–frei Min.</span>
                </div>
                <div>
                  <strong>{board.metrics.averageWaitMinutes ?? "–"}</strong>
                  <span>Ø Verkauf–NEXT Min.</span>
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
                  <span>Geräte online</span>
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
              {adminArea === "overview" && pushConfigurationStatus === "missing" ? (
                <ValidationHint tone="warning">
                  <strong>Web-Push ist noch nicht eingerichtet.</strong> VAPID-Secrets mit{" "}
                  <code>npm run cloudflare:configure-push</code> setzen und danach auf einem echten
                  Besuchergerät testen.
                </ValidationHint>
              ) : null}
            </>
          ) : null}
          <section
            className={`admin-edit-context admin-mode-bar ${adminModeUnlocked ? "unlocked" : "locked"}`}
          >
            <div>
              <strong>
                {adminModeUnlocked ? "Bearbeitungsmodus aktiv" : "Administration gesperrt"}
              </strong>
              <span>
                {adminModeUnlocked
                  ? "Mehrere Änderungen sind möglich. Jede Änderung wird weiterhin einzeln protokolliert."
                  : "Änderungen fragen die PIN einzeln ab oder können für diese Arbeitssitzung entsperrt werden."}
              </span>
            </div>
            {isAdministrator ? (
              <button
                className="secondary-action"
                onClick={() => (adminModeUnlocked ? lockAdminMode() : requestAdminModeUnlock())}
                type="button"
              >
                {adminModeUnlocked ? "Bearbeitungsmodus sperren" : "Bearbeitungsmodus entsperren"}
              </button>
            ) : (
              <div className="secondary-actions admin-recovery-actions">
                <button
                  aria-busy={refreshing}
                  className="secondary-action"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                  type="button"
                >
                  {refreshing ? "Betriebsstand wird geladen …" : "Erneut laden"}
                </button>
                <button
                  className="secondary-action"
                  disabled={refreshing}
                  onClick={requestAdminDeviceRecovery}
                  type="button"
                >
                  Mit PIN anmelden
                </button>
              </div>
            )}
            {!isAdministrator ? (
              deviceAuthorizationRejected ? (
                <ValidationHint tone="error">
                  Dieses Browsergerät wurde nicht als Administration bestätigt. Mit der
                  Administrator-PIN kann der Zugang auf diesem Gerät sicher erneuert werden.
                </ValidationHint>
              ) : error ? (
                <ValidationHint tone="error">
                  Der Betriebsstand konnte nicht geladen werden. Erneut laden oder mit der
                  Administrator-PIN anmelden; vorhandene Betriebsdaten bleiben unverändert.
                </ValidationHint>
              ) : (
                <ValidationHint>Gerätebindung und Betriebsstand werden geprüft.</ValidationHint>
              )
            ) : null}
            <ValidationHint>
              {adminModeUnlocked
                ? "Änderungen sind freigeschaltet und werden automatisch protokolliert."
                : "Beim Auslösen einer administrativen Änderung erscheint die PIN-Abfrage."}
            </ValidationHint>
          </section>
          {adminArea === "master-data" ? (
            <header className="master-data-heading">
              <h1>
                Stammdaten <span aria-hidden="true">›</span>{" "}
                <strong>{masterDataSectionLabel[masterDataCategory]}</strong>
              </h1>
            </header>
          ) : null}
          <section className="reset-levels" hidden={adminArea !== "backup"}>
            {!isAdministrator ? (
              <ValidationHint tone="error">
                Reset ist sichtbar, bleibt aber gesperrt, bis dieses Administrationsgerät vom Server
                bestätigt wurde.
              </ValidationHint>
            ) : null}
            <div className="reset-level-row">
              <div>
                <h2>Betriebsdaten zurücksetzen</h2>
                <p>
                  Einen neuen, leeren Betriebsstand mit bestehenden Stammdaten anlegen. Der
                  bisherige Stand bleibt als Audit- und Wiederherstellungsquelle erhalten.
                </p>
              </div>
              <button
                disabled={!isAdministrator}
                onClick={() => {
                  setRestartMode("KEEP_MASTER_DATA");
                  setRestartConfirmation("");
                }}
                type="button"
              >
                Betriebsdaten zurücksetzen
              </button>
            </div>
            <div className="reset-level-row">
              <div>
                <h2>Neue Veranstaltung beginnen</h2>
                <p>
                  Einen neuen Veranstaltungstag ohne bestehende Gates, Ressourcen, Flugzeuge,
                  Pilotencodes oder Produkte beginnen.
                </p>
              </div>
              <button
                disabled={!isAdministrator}
                onClick={() => {
                  setRestartMode("EMPTY");
                  setRestartConfirmation("");
                }}
                type="button"
              >
                Neue Veranstaltung
              </button>
            </div>
            <div className="reset-level-row factory-reset-row">
              <div>
                <h2>Werkszustand herstellen</h2>
                <p>
                  Alle Anwendungsdaten, Stammdaten, Historien, Gerätebindungen und die
                  Ersteinrichtung werden gelöscht. Danach startet das System wieder bei /setup.
                </p>
              </div>
              <button
                className="danger-action"
                disabled={!isAdministrator}
                onClick={openFactoryReset}
                type="button"
              >
                <span>Werkszustand vorbereiten</span>
              </button>
            </div>
          </section>
          <section className="admin-section" hidden={adminArea !== "backup"}>
            <h2>Neuen Betriebsstand anlegen</h2>
            <p>
              Aktive Veranstaltung: <strong>{board?.event.name ?? EVENT_ID}</strong>. Ein Neustart
              legt eine neue Veranstaltung an. Der bisherige Stand bleibt für Audit, Berichte und
              Wiederherstellung unverändert erhalten.
            </p>
            <div className="event-catalog">
              {events.map((entry) => (
                <a
                  className={entry.eventId === EVENT_ID ? "current-event" : ""}
                  href={`/admin?event=${encodeURIComponent(entry.eventId)}`}
                  key={entry.eventId}
                >
                  <strong>{entry.name}</strong>
                  <span>
                    {entry.eventDate} · {entry.aerodrome || "Flugplatz offen"}
                  </span>
                </a>
              ))}
            </div>
            <div className="parameter-grid">
              <label>
                <FieldLabel
                  label="Neustart-Stufe"
                  help="Bestimmt, ob Stammdaten übernommen werden oder die neue Veranstaltung vollständig leer beginnt."
                />
                <select
                  value={restartMode}
                  onChange={(event) =>
                    setRestartMode(event.target.value as "KEEP_MASTER_DATA" | "EMPTY")
                  }
                >
                  <option value="KEEP_MASTER_DATA">Betriebsdaten zurücksetzen</option>
                  <option value="EMPTY">Vollständig neu einrichten</option>
                </select>
              </label>
              <label>
                <FieldLabel
                  label="Technische ID"
                  help="Eindeutige, URL-taugliche Kennung der neuen Veranstaltung; zum Beispiel rundflug-2027."
                />
                <input
                  value={newEventId}
                  onChange={(event) => setNewEventId(event.target.value)}
                  placeholder="rundflug-2027"
                />
              </label>
              <label>
                <FieldLabel
                  label="Bezeichnung"
                  help="Lesbarer Veranstaltungsname für Administration, Kasse und Anzeigen."
                />
                <input
                  value={newEventName}
                  onChange={(event) => setNewEventName(event.target.value)}
                  placeholder="Flugtag 2027"
                />
              </label>
              <LocalizedDateInput
                label="Datum"
                labelContent={
                  <FieldLabel
                    label="Datum"
                    help="Veranstaltungstag im deutschen Format TT.MM.JJJJ."
                  />
                }
                value={newEventDate}
                onChange={setNewEventDate}
              />
              <label>
                <FieldLabel
                  label="Flugplatz"
                  help="Kurze Flugplatzkennung oder Ortsangabe für die Veranstaltung."
                />
                <input
                  value={newEventAerodrome}
                  onChange={(event) => setNewEventAerodrome(event.target.value)}
                  placeholder="EDXX"
                />
              </label>
              <label>
                <FieldLabel
                  label="Bestätigung"
                  help="Schutz vor versehentlichem Neustart. Zur Ausführung muss NEUSTART eingegeben werden."
                />
                <input
                  value={restartConfirmation}
                  onChange={(event) => setRestartConfirmation(event.target.value)}
                  placeholder="NEUSTART"
                  autoComplete="off"
                />
              </label>
            </div>
            <p className="help-text">
              {restartMode === "KEEP_MASTER_DATA"
                ? "Übernommen werden Parameter, Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen und Piloten-IDs. Tickets, Gruppen, Umläufe und Flugdaten beginnen leer; Verkäufe bleiben zunächst gesperrt."
                : "Nur Veranstaltungsdaten, Grundeinstellungen und dieses Administrationsgerät werden angelegt. Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen, Piloten-IDs und alle Betriebsdaten beginnen leer."}
            </p>
            <button
              type="button"
              disabled={
                !isAdministrator ||
                restartConfirmation !== "NEUSTART" ||
                newEventId.trim().length < 3 ||
                newEventName.trim().length < 3 ||
                !newEventDate ||
                newEventAerodrome.trim().length < 2
              }
              onClick={() => void createEventFromTemplate()}
            >
              Sicheren Neustart anlegen
            </button>
          </section>
          <section className="admin-section" hidden={adminArea !== "setup"}>
            <h2>Veranstaltungsparameter</h2>
            <div className="parameter-grid">
              <LocalizedDateTimeInput
                label="Verkaufsbeginn"
                labelContent={
                  <FieldLabel
                    label="Verkaufsbeginn"
                    help="Lokaler Zeitpunkt, ab dem Tickets verkauft werden dürfen. Eingabe im deutschen Datum und 24-Stunden-Format."
                  />
                }
                value={saleOpensAt}
                onChange={setSaleOpensAt}
              />
              <LocalizedDateTimeInput
                label="Betriebsende"
                labelContent={
                  <FieldLabel
                    label="Betriebsende"
                    help="Geplantes lokales Ende des Rundflugbetriebs; Grundlage für Verkaufs- und Kapazitätsgrenzen."
                  />
                }
                value={operationsEndAt}
                onChange={setOperationsEndAt}
              />
              <label>
                <FieldLabel
                  label="No-Show nach Minuten"
                  help="Frühester Zeitpunkt nach dem Aufruf, ab dem fehlende Tickets manuell als No-Show behandelt werden dürfen."
                />
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={noShowAfterMinutes}
                  onChange={(event) => setNoShowAfterMinutes(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Klärung Kasse nach Zurückstellungen"
                  help="Nach dieser Anzahl manueller Zurückstellungen wird die Gruppe zur Klärung an der Kasse markiert."
                />
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={maxTicketDeferrals}
                  onChange={(event) => setMaxTicketDeferrals(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Benachrichtigungsvorlauf (Min.)"
                  help="Bestimmt, wie früh ein freiwilliger Web-Push zur Vorbereitung ausgelöst werden kann."
                />
                <input
                  type="number"
                  min="1"
                  max="240"
                  value={notificationLeadMinutes}
                  onChange={(event) => setNotificationLeadMinutes(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Referenzgewicht Kind (kg)"
                  help="Anonymer Rechenwert für Tickets der Gewichtsklasse Kind; keine flugbetriebliche Freigabe."
                />
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={childReferenceWeightKg}
                  onChange={(event) => setChildReferenceWeightKg(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Referenzgewicht Normal (kg)"
                  help="Anonymer Rechenwert für Tickets der Gewichtsklasse Normal; keine flugbetriebliche Freigabe."
                />
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={normalReferenceWeightKg}
                  onChange={(event) => setNormalReferenceWeightKg(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Referenzgewicht Schwer (kg)"
                  help="Anonymer Rechenwert für Tickets der Gewichtsklasse Schwer; keine flugbetriebliche Freigabe."
                />
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={heavyReferenceWeightKg}
                  onChange={(event) => setHeavyReferenceWeightKg(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Plan Boarding (Min.)"
                  help="Planwert für das Einsteigen zur initialen Prognose; tatsächliche Ereignisse ersetzen ihn im Betrieb."
                />
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={plannedBoardingMinutes}
                  onChange={(event) => setPlannedBoardingMinutes(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Plan Ausstieg (Min.)"
                  help="Planwert für Ausstieg und Bodenprozess nach der Landung."
                />
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={plannedDeboardingMinutes}
                  onChange={(event) => setPlannedDeboardingMinutes(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Plan Puffer (Min.)"
                  help="Zusätzlicher organisatorischer Zeitpuffer zwischen Umläufen."
                />
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={plannedBufferMinutes}
                  onChange={(event) => setPlannedBufferMinutes(Number(event.target.value))}
                />
              </label>
            </div>
            {!operationsEndAt ? (
              <ValidationHint tone="error">Ein Betriebsende muss festgelegt werden.</ValidationHint>
            ) : null}
            <button
              className="primary-action"
              disabled={!isAdministrator || !operationsEndAt}
              onClick={() => requestAdminAction(saveEventParameters)}
              type="button"
            >
              Veranstaltungsparameter speichern
            </button>
          </section>
          <section className="admin-section setup-release" hidden={adminArea !== "setup"}>
            <div className="section-heading">
              <div>
                <h2>Betriebsfreigabe</h2>
                <p>Der Verkauf kann erst nach vollständiger Einrichtung gestartet werden.</p>
              </div>
              <strong>
                {setupSteps.filter((step) => step.complete).length}/{setupSteps.length} Schritte
              </strong>
            </div>
            <ul className="setup-checklist">
              {setupSteps.slice(0, -1).map((step) => (
                <li className={step.complete ? "complete" : "missing"} key={step.id}>
                  <span aria-hidden="true">{step.complete ? "✓" : "–"}</span>
                  <button onClick={() => openSetupStep(step)} type="button">
                    {step.label}
                  </button>
                  <strong>{step.complete ? "Erledigt" : "Fehlt"}</strong>
                </li>
              ))}
            </ul>
            {setupSteps.slice(0, -1).some((step) => !step.complete) ? (
              <ValidationHint tone="error">
                Vor der Betriebsfreigabe müssen alle fehlenden Einrichtungsschritte abgeschlossen
                werden.
              </ValidationHint>
            ) : (
              <ValidationHint>
                Alle Stammdaten sind vollständig. Der Betrieb kann freigegeben werden.
              </ValidationHint>
            )}
            {!board ? (
              <p className="help-text">Der bestätigte Betriebsstand wird geladen.</p>
            ) : board.event.status === "PREPARATION" ? (
              <button
                className="primary-action release-action"
                disabled={
                  !isAdministrator || setupSteps.slice(0, -1).some((step) => !step.complete)
                }
                onClick={() => requestAdminAction(() => setEventLifecycle("ACTIVE"))}
                type="button"
              >
                Veranstaltung aktivieren
              </button>
            ) : (
              <p className="success-message">
                Der Veranstaltungsbetrieb wurde bereits freigegeben.
              </p>
            )}
          </section>
          <MasterDataNavigation
            activeCategory={masterDataCategory}
            counts={masterDataCounts}
            onChange={(category) => {
              setMasterDataCategory(category);
              setMasterSearch("");
              setMasterSubmitAttempted(false);
              setMasterEditorOpen(false);
            }}
          />
          <section className="master-data-workspace" hidden={adminArea !== "master-data"}>
            {["aircraft", "assignments"].includes(masterDataCategory) &&
            resourceGroups.length === 0 ? (
              <ValidationHint>
                Für eine Zuordnung muss zuerst eine Ressourcengruppe angelegt sein.
              </ValidationHint>
            ) : null}
            <div className="master-data-toolbar">
              <label className="master-data-search">
                <span className="visually-hidden">Stammdaten durchsuchen</span>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4.5 4.5" />
                </svg>
                <input
                  onChange={(event) => setMasterSearch(event.target.value)}
                  placeholder={`${masterDataSingularLabel[masterDataCategory]} suchen`}
                  type="search"
                  value={masterSearch}
                />
              </label>
              <button className="primary-action" onClick={startNewMasterDataEntry} type="button">
                <span aria-hidden="true">+</span> {masterDataSingularLabel[masterDataCategory]}
              </button>
            </div>
            <div className="master-data-table-scroll">
              {masterDataCategory === "gates" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <th>Bezeichnung</th>
                      <th>Status</th>
                      <th>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGates.map((gate) => (
                      <tr
                        className={masterEditorOpen && gateEditorId === gate.id ? "selected" : ""}
                        key={gate.id}
                        onClick={() => selectGateForEditing(gate.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectGateForEditing(gate.id);
                        }}
                        tabIndex={0}
                      >
                        <td>{gate.label}</td>
                        <td>
                          <span className={`status-text ${gate.active ? "active" : "inactive"}`}>
                            {gate.active ? "Aktiv" : "Inaktiv"}
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`${gate.label} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectGateForEditing(gate.id);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "resource-groups" ? (
                <table className="master-data-table resource-group-list-table">
                  <thead>
                    <tr>
                      <th>Ressourcengruppe</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResourceGroups.map((group) => (
                      <tr
                        className={
                          masterEditorOpen && resourceEditorId === group.id ? "selected" : ""
                        }
                        key={group.id}
                        onClick={() => selectResourceForEditing(group.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectResourceForEditing(group.id);
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{group.name}</strong>
                          <small>
                            {group.activeAircraftIds.length} Flugzeug
                            {group.activeAircraftIds.length === 1 ? "" : "e"} · Kapazität{" "}
                            {group.referenceCapacity}{" "}
                            {group.referenceCapacity === 1 ? "Platz" : "Plätze"} · {group.gateLabel}
                          </small>
                        </td>
                        <td>
                          <span
                            className={`status-text ${group.status === "ACTIVE" ? "active" : "inactive"}`}
                          >
                            {group.status === "ACTIVE" ? "Aktiv" : group.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "aircraft" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <th>Kennung</th>
                      <th>Flugzeugtyp</th>
                      <th>Sitzplätze</th>
                      <th>Ressourcengruppe</th>
                      <th>Status</th>
                      <th>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAircraft.map((aircraft) => (
                      <tr
                        className={
                          masterEditorOpen && aircraftEditorId === aircraft.id ? "selected" : ""
                        }
                        key={aircraft.id}
                        onClick={() => selectAircraftForEditing(aircraft.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectAircraftForEditing(aircraft.id);
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{aircraft.registration}</strong>
                        </td>
                        <td>{aircraft.aircraftType}</td>
                        <td>{aircraft.passengerSeats}</td>
                        <td>{aircraft.resourceGroupName || "Nicht zugeordnet"}</td>
                        <td>
                          <span
                            className={`status-text ${aircraft.operationalState === "INACTIVE" ? "inactive" : "active"}`}
                          >
                            {aircraftStateLabel[aircraft.operationalState]}
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`${aircraft.registration} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectAircraftForEditing(aircraft.id);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "assignments" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <th>Flugzeug</th>
                      <th>Flugzeugtyp</th>
                      <th>Aktuelle Ressourcengruppe</th>
                      <th>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAircraft.map((aircraft) => (
                      <tr
                        className={
                          masterEditorOpen && assignmentAircraftId === aircraft.id ? "selected" : ""
                        }
                        key={aircraft.id}
                        onClick={() => {
                          setAssignmentAircraftId(aircraft.id);
                          setAssignmentResourceGroupId(aircraft.resourceGroupId);
                          setMasterSubmitAttempted(false);
                          setMasterEditorOpen(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            setAssignmentAircraftId(aircraft.id);
                            setAssignmentResourceGroupId(aircraft.resourceGroupId);
                            setMasterSubmitAttempted(false);
                            setMasterEditorOpen(true);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{aircraft.registration}</strong>
                        </td>
                        <td>{aircraft.aircraftType}</td>
                        <td>{aircraft.resourceGroupName || "Nicht zugeordnet"}</td>
                        <td>
                          <button
                            aria-label={`Zuordnung von ${aircraft.registration} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              setAssignmentAircraftId(aircraft.id);
                              setAssignmentResourceGroupId(aircraft.resourceGroupId);
                              setMasterSubmitAttempted(false);
                              setMasterEditorOpen(true);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "pilots" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <th>Operativer Code</th>
                      <th>Organisatorische Bemerkung</th>
                      <th>Status</th>
                      <th>Aktueller Umlauf</th>
                      <th>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePilots.map((pilot) => (
                      <tr
                        className={masterEditorOpen && pilotEditorId === pilot.id ? "selected" : ""}
                        key={pilot.id}
                        onClick={() => selectPilotForEditing(pilot.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectPilotForEditing(pilot.id);
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{pilot.operationalCode}</strong>
                        </td>
                        <td>{pilot.operationalNote || "Keine Bemerkung"}</td>
                        <td>
                          <span className={`status-text ${pilot.active ? "active" : "inactive"}`}>
                            {pilot.active ? "Aktiv" : "Inaktiv"}
                          </span>
                        </td>
                        <td>
                          {pilot.currentCommunicationNumber
                            ? `Fluggruppe ${pilot.currentCommunicationNumber}`
                            : "Nicht zugeordnet"}
                        </td>
                        <td>
                          <button
                            aria-label={`${pilot.operationalCode} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectPilotForEditing(pilot.id);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "products" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <th>Kürzel</th>
                      <th>Bezeichnung</th>
                      <th>Ressourcengruppe</th>
                      <th>Gate</th>
                      <th>Status</th>
                      <th>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map((product) => (
                      <tr
                        className={
                          masterEditorOpen && productEditorId === product.id ? "selected" : ""
                        }
                        key={product.id}
                        onClick={() => selectProductForEditing(product.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectProductForEditing(product.id);
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{product.code}</strong>
                        </td>
                        <td>{product.name}</td>
                        <td>{product.resourceGroupName}</td>
                        <td>{product.gateLabel}</td>
                        <td>
                          <span
                            className={`status-text ${product.saleEnabled ? "active" : "inactive"}`}
                          >
                            {product.saleEnabled ? "Verkauf aktiv" : "Verkauf gesperrt"}
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`${product.name} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectProductForEditing(product.id);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {(masterDataCategory === "gates" && (board?.gates.length ?? 0) === 0) ||
              (masterDataCategory === "resource-groups" && resourceGroups.length === 0) ||
              (masterDataCategory === "aircraft" && (board?.aircraft.length ?? 0) === 0) ||
              (masterDataCategory === "assignments" && (board?.aircraft.length ?? 0) === 0) ||
              (masterDataCategory === "pilots" && (board?.pilots.length ?? 0) === 0) ||
              (masterDataCategory === "products" && (board?.products.length ?? 0) === 0) ? (
                <div className="master-data-empty">
                  <strong>
                    Noch keine{" "}
                    {masterDataCategory === "gates"
                      ? "Gates"
                      : masterDataCategory === "resource-groups"
                        ? "Ressourcengruppe"
                        : masterDataCategory === "aircraft"
                          ? "Flugzeuge"
                          : masterDataCategory === "assignments"
                            ? "Flugzeuge für eine Zuordnung"
                            : masterDataCategory === "pilots"
                              ? "Pilotencodes"
                              : "Produkte"}{" "}
                    angelegt
                  </strong>
                  <p>
                    {masterDataCategory === "resource-groups"
                      ? "Eine Ressourcengruppe benötigt ein aktives Gate."
                      : masterDataCategory === "products"
                        ? "Ein Produkt benötigt eine Ressourcengruppe und ein aktives Gate."
                        : masterDataCategory === "assignments"
                          ? "Legen Sie zuerst ein Flugzeug und eine Ressourcengruppe an."
                          : "Mit der Schaltfläche oben kann der erste Datensatz angelegt werden."}
                  </p>
                  {masterDataCategory === "resource-groups" ? (
                    <button
                      className="table-action"
                      onClick={() => setMasterDataCategory("gates")}
                      type="button"
                    >
                      Gate verwalten
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
          <section
            className="admin-section master-data-editor master-data-drawer"
            hidden={
              adminArea !== "master-data" ||
              !masterEditorOpen ||
              !["gates", "products"].includes(masterDataCategory)
            }
          >
            <div className="drawer-heading">
              <h2>
                {masterDataCategory === "gates"
                  ? gateEditorId === "new"
                    ? "Gate anlegen"
                    : "Gate bearbeiten"
                  : productEditorId === "new"
                    ? "Produkt anlegen"
                    : "Produkt bearbeiten"}
              </h2>
              <button
                aria-label="Editor schließen"
                onClick={() => setMasterEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="master-data-columns">
              <fieldset hidden={masterDataCategory !== "gates"}>
                <legend>Gate</legend>
                <p className="form-introduction">
                  Ein Gate ist der sichtbare Treff- oder Ausgabepunkt einer Ressourcengruppe. Für
                  den normalen Betrieb genügt eine Bezeichnung; technische Gate-Arten sind nicht
                  erforderlich.
                </p>
                <label>
                  <FieldLabel
                    label="Bezeichnung"
                    help="Kurzer, vor Ort eindeutig sichtbarer Name, zum Beispiel Eingang Halle oder Flight Line Nord."
                  />
                  <input value={gateLabel} onChange={(event) => setGateLabel(event.target.value)} />
                </label>
                <div className="gate-active-field">
                  <FieldLabel
                    label="Status"
                    help="Nur aktive Gates stehen für neue Zuordnungen und öffentliche Anzeigen zur Verfügung."
                  />
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={gateActive}
                      onChange={(event) => setGateActive(event.target.checked)}
                    />
                    <span>Gate ist aktiv</span>
                  </label>
                </div>
                <section
                  className="gate-display-filter"
                  aria-labelledby="gate-display-filter-title"
                >
                  <div>
                    <h3 id="gate-display-filter-title">Anzeigefilter</h3>
                    <p>
                      Leere Auswahl bedeutet: alle Produkte beziehungsweise alle Umlaufstatus
                      anzeigen.
                    </p>
                  </div>
                  <div className="gate-filter-group">
                    <strong>
                      <FieldLabel
                        label="Produkte"
                        help="Begrenzt die öffentliche Gate-Anzeige auf die ausgewählten Produkte. Die Ressourcenzuordnung bleibt unverändert."
                      />
                    </strong>
                    <div className="gate-filter-options">
                      {board?.products.map((product) => (
                        <label className="checkbox-label" key={product.id}>
                          <input
                            checked={gateDisplayProductIds.includes(product.id)}
                            onChange={() =>
                              setGateDisplayProductIds((current) =>
                                current.includes(product.id)
                                  ? current.filter((id) => id !== product.id)
                                  : [...current, product.id],
                              )
                            }
                            type="checkbox"
                          />
                          <span>{product.name}</span>
                        </label>
                      ))}
                      {board?.products.length === 0 ? (
                        <span className="help-text">Noch keine Produkte angelegt.</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="gate-filter-group">
                    <strong>
                      <FieldLabel
                        label="Umlaufstatus"
                        help="Begrenzt die Anzeige auf die gewählten Phasen. Diese Auswahl löst keine Zustandsänderung aus."
                      />
                    </strong>
                    <div className="gate-filter-options">
                      {(
                        [
                          ["DRAFT", "Vorbereitung"],
                          ["CALLED", "Aufgerufen"],
                          ["IN_FLIGHT", "Im Flug"],
                          ["LANDED", "Gelandet"],
                          ["COMPLETED", "Abgeschlossen"],
                        ] as const
                      ).map(([status, label]) => (
                        <label className="checkbox-label" key={status}>
                          <input
                            checked={gateDisplayRotationStatuses.includes(status)}
                            onChange={() =>
                              setGateDisplayRotationStatuses((current) =>
                                current.includes(status)
                                  ? current.filter((entry) => entry !== status)
                                  : [...current, status],
                              )
                            }
                            type="checkbox"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {gateEditorId !== "new" ? (
                    <div className="gate-assignment-summary">
                      <strong>Zugeordnete Ressourcengruppen</strong>
                      <span>
                        {resourceGroups
                          .filter((group) => group.gateId === gateEditorId)
                          .map((group) => group.name)
                          .join(", ") || "Keine"}
                      </span>
                      <small>Zuordnungen werden bei der Ressourcengruppe gepflegt.</small>
                    </div>
                  ) : null}
                </section>
                {masterSubmitAttempted && gateLabel.trim().length < 2 ? (
                  <ValidationHint tone="error">
                    Die Gate-Bezeichnung muss mindestens 2 Zeichen lang sein.
                  </ValidationHint>
                ) : null}
                <button
                  className="primary-action"
                  disabled={!isAdministrator}
                  onClick={() => requestMasterSave("gate", gateLabel.trim().length >= 2)}
                  type="button"
                >
                  Gate speichern
                </button>
                {gateEditorId !== "new" ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Gate löschen</strong>
                      <span>Nur in der Vorbereitung und ohne operative Verwendung möglich.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() => requestMasterDelete("GATE", gateEditorId, gateLabel)}
                      type="button"
                    >
                      Löschen
                    </button>
                  </div>
                ) : null}
              </fieldset>
              <fieldset hidden={masterDataCategory !== "products"}>
                <legend>Produkt</legend>
                <section className="product-editor-section">
                  <h3>Allgemein</h3>
                  <div className="parameter-grid">
                    <label>
                      <FieldLabel
                        label="Bezeichnung"
                        help="Interner und öffentlicher Name des Produkts."
                      />
                      <input
                        id="product-name"
                        value={productName}
                        onChange={(event) => setProductName(event.target.value)}
                      />
                      {masterSubmitAttempted && productName.trim().length < 2 ? (
                        <span className="field-error">Mindestens 2 Zeichen eingeben.</span>
                      ) : null}
                    </label>
                    <label>
                      <FieldLabel
                        label="Kürzel"
                        help="2–12 Großbuchstaben, Ziffern oder Bindestriche; Bestandteil der stabilen Fluggruppenkennung."
                      />
                      <input
                        id="product-code"
                        value={productCode}
                        maxLength={12}
                        onChange={(event) => setProductCode(event.target.value.toUpperCase())}
                      />
                      {masterSubmitAttempted && !/^[A-Z0-9-]{2,12}$/.test(productCode) ? (
                        <span className="field-error">Zum Beispiel PAN20 oder KURZ-10.</span>
                      ) : null}
                    </label>
                    <label>
                      <FieldLabel
                        label="Preis in €"
                        help="Informatorischer Einzelpreis je Ticket. Das System ist keine elektronische Kasse."
                      />
                      <input
                        id="product-price"
                        inputMode="decimal"
                        value={productPriceInput}
                        onBlur={() => {
                          const cents = parseEuroToCents(productPriceInput);
                          if (cents !== null) setProductPriceInput(formatEuroInput(cents));
                        }}
                        onChange={(event) => setProductPriceInput(event.target.value)}
                      />
                      {masterSubmitAttempted && productPriceCents === null ? (
                        <span className="field-error">
                          Eurobetrag mit höchstens zwei Nachkommastellen eingeben.
                        </span>
                      ) : null}
                    </label>
                    <label className="product-description-field">
                      <FieldLabel
                        label="Öffentliche Beschreibung"
                        help="Kurzer Text für Kasse und öffentliche Anzeigen."
                      />
                      <input
                        value={productDescription}
                        maxLength={240}
                        onChange={(event) => setProductDescription(event.target.value)}
                      />
                    </label>
                  </div>
                </section>
                <section className="product-editor-section">
                  <h3>Planung</h3>
                  <div className="parameter-grid">
                    <label>
                      <FieldLabel
                        label="Ressourcengruppe"
                        help="Ordnet das Produkt genau einer gemeinsamen operativen Queue und Kapazität zu."
                      />
                      <select
                        id="product-resource-group"
                        value={productResourceGroupId}
                        onChange={(event) => setProductResourceGroupId(event.target.value)}
                      >
                        <option value="">Bitte wählen</option>
                        {resourceGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                      {masterSubmitAttempted && !productResourceGroupId ? (
                        <span className="field-error">Eine Ressourcengruppe auswählen.</span>
                      ) : null}
                    </label>
                    <label>
                      <FieldLabel
                        label="Gate"
                        help="Veröffentlichter Treffpunkt beziehungsweise Abfertigungsort."
                      />
                      <select
                        id="product-gate"
                        value={productGateId}
                        onChange={(event) => setProductGateId(event.target.value)}
                      >
                        <option value="">Bitte wählen</option>
                        {board?.gates
                          .filter((gate) => gate.active)
                          .map((gate) => (
                            <option key={gate.id} value={gate.id}>
                              {gate.label}
                            </option>
                          ))}
                      </select>
                      {masterSubmitAttempted && !productGateId ? (
                        <span className="field-error">Ein aktives Gate auswählen.</span>
                      ) : null}
                    </label>
                    <label>
                      <FieldLabel
                        label="Referenzdauer"
                        help="Planwert für den Kaltstart der Prognose, keine zugesagte Flugzeit."
                      />
                      <input
                        type="number"
                        min="1"
                        max="600"
                        value={productReferenceDuration}
                        onChange={(event) =>
                          setProductReferenceDuration(Number(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      <FieldLabel
                        label="Position in Anzeigen"
                        help="Legt nur die Reihenfolge in Kasse und Anzeigen fest. Queue und Priorität ändern sich dadurch nicht."
                      />
                      <select
                        value={productSortOrder}
                        onChange={(event) => setProductSortOrder(Number(event.target.value))}
                      >
                        {productPositionChoices.map((option) => (
                          <option key={`${option.value}-${option.label}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>
                <section className="product-editor-section product-weight-section">
                  <h3>Angaben beim Verkauf</h3>
                  <FieldLabel
                    label="Gewichtserfassung"
                    help="Aktivierte Klassen werden an der Kasse je anonymem Ticket abgefragt. Es werden keine Namen erfasst."
                  />
                  <div className="weight-capture-mode" id="product-weight-capture">
                    <label>
                      <input
                        checked={!weightCaptureEnabled(productWeightClasses)}
                        name="product-weight-mode"
                        onChange={() => {
                          setProductWeightClasses(setWeightCaptureMode(false));
                          setProductChildCompanion(false);
                        }}
                        type="radio"
                      />
                      <span>Keine Gewichtserfassung</span>
                    </label>
                    <label>
                      <input
                        checked={weightCaptureEnabled(productWeightClasses)}
                        name="product-weight-mode"
                        onChange={() => setProductWeightClasses(setWeightCaptureMode(true))}
                        type="radio"
                      />
                      <span>Gewichtsklassen erfassen</span>
                    </label>
                  </div>
                  {weightCaptureEnabled(productWeightClasses) ? (
                    <div className="weight-class-options">
                      {(
                        [
                          ["CHILD", "Kind"],
                          ["NORMAL", "Standard"],
                          ["HEAVY", "Schwer"],
                          ["INDIVIDUAL", "Individuelles Gewicht"],
                        ] as const
                      ).map(([weightClass, label]) => (
                        <label key={weightClass}>
                          <input
                            type="checkbox"
                            checked={productWeightClasses.includes(weightClass)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setProductWeightClasses((current) =>
                                toggleWeightClass(current, weightClass, checked),
                              );
                              if (weightClass === "CHILD" && !checked)
                                setProductChildCompanion(false);
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {masterSubmitAttempted && productWeightClasses.length === 0 ? (
                    <span className="field-error">Mindestens eine Gewichtsklasse auswählen.</span>
                  ) : null}
                  <div className="checkbox-field">
                    <div className="checkbox-field-heading">
                      <label className="checkbox-label">
                        <input
                          id="product-child-companion"
                          type="checkbox"
                          checked={productChildCompanion}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setProductChildCompanion(checked);
                            if (checked) {
                              setProductWeightClasses((current) =>
                                weightClassesForChildCompanion(current, true),
                              );
                            }
                          }}
                        />
                        <span>Bei Kinderbuchungen auf Begleitung hinweisen</span>
                      </label>
                      <FieldHelp
                        label="Begleithinweis für Kinder"
                        help="Aktiviert bei Bedarf automatisch die Gewichtsklasse „Kind“ und zeigt an der Kasse einen organisatorischen Hinweis, wenn keine passende Begleitung erfasst ist. Dies ist keine flugbetriebliche Freigabe."
                      />
                    </div>
                    <span className="field-help">
                      Die Auswahl „Kind“ wird beim Aktivieren automatisch eingeschaltet.
                    </span>
                  </div>
                </section>
                <div className="editor-actions product-editor-actions">
                  <button onClick={() => setMasterEditorOpen(false)} type="button">
                    Abbrechen
                  </button>
                  <button
                    className="primary-action"
                    disabled={!isAdministrator}
                    onClick={requestProductSave}
                    type="button"
                  >
                    <span>Produkt speichern</span>
                  </button>
                </div>
                {productEditorId !== "new" ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Produkt löschen</strong>
                      <span>Nur ohne Tickets oder Umläufe möglich.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() => requestMasterDelete("PRODUCT", productEditorId, productName)}
                      type="button"
                    >
                      Löschen
                    </button>
                  </div>
                ) : null}
              </fieldset>
            </div>
          </section>
          <section
            className="admin-section master-data-editor master-data-drawer"
            hidden={
              adminArea !== "master-data" ||
              !masterEditorOpen ||
              !["resource-groups", "aircraft", "assignments"].includes(masterDataCategory)
            }
          >
            <div className="drawer-heading">
              <h2>
                {masterDataCategory === "resource-groups"
                  ? resourceEditorId === "new"
                    ? "Ressourcengruppe anlegen"
                    : "Ressourcengruppe bearbeiten"
                  : masterDataCategory === "assignments"
                    ? "Zuordnung ändern"
                    : aircraftEditorId === "new"
                      ? "Flugzeug anlegen"
                      : "Flugzeug bearbeiten"}
              </h2>
              <button
                aria-label="Editor schließen"
                onClick={() => setMasterEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="resource-master-grid">
              <fieldset hidden={masterDataCategory !== "resource-groups"}>
                <legend>Ressourcengruppe</legend>
                <label>
                  <FieldLabel
                    label="Bezeichnung"
                    help="Lesbarer Name der gemeinsamen operativen Warteschlange."
                  />
                  <input
                    value={resourceName}
                    onChange={(event) => setResourceName(event.target.value)}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Gate"
                    help="Standardmäßiger Treffpunkt für Produkte und Umläufe dieser Ressourcengruppe."
                  />
                  <select
                    value={resourceGateId}
                    onChange={(event) => setResourceGateId(event.target.value)}
                  >
                    <option value="">Bitte wählen</option>
                    {board?.gates
                      .filter((gate) => gate.active)
                      .map((gate) => (
                        <option key={gate.id} value={gate.id}>
                          {gate.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <FieldLabel
                    label="Plan-Umlaufzeit (Min.)"
                    help="Initialer Zeitwert eines vollständigen Umlaufs für die Prognose."
                  />
                  <input
                    type="number"
                    min="1"
                    max="600"
                    value={resourcePlannedMinutes}
                    onChange={(event) => setResourcePlannedMinutes(Number(event.target.value))}
                  />
                </label>
                <section className="resource-aircraft-selection">
                  <h3>Flugzeuge dieser Ressourcengruppe</h3>
                  <p>
                    Kapazität und passende Gruppengröße werden automatisch aus diesen Flugzeugen
                    ermittelt.
                  </p>
                  {board?.aircraft.map((aircraft) => (
                    <label className="checkbox-label" key={aircraft.id}>
                      <input
                        checked={resourceAircraftIds.includes(aircraft.id)}
                        onChange={(event) =>
                          setResourceAircraftIds((current) =>
                            event.target.checked
                              ? [...current, aircraft.id]
                              : current.filter((id) => id !== aircraft.id),
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>{aircraft.registration}</strong> · {aircraft.aircraftType} ·{" "}
                        {aircraft.passengerSeats} Plätze
                        {aircraft.resourceGroupId && aircraft.resourceGroupId !== resourceEditorId
                          ? ` · aktuell ${aircraft.resourceGroupName}`
                          : ""}
                      </span>
                    </label>
                  ))}
                  {board?.aircraft.length === 0 ? (
                    <ValidationHint>
                      Zuerst mindestens ein Flugzeug anlegen; die Zuordnung kann anschließend hier
                      erfolgen.
                    </ValidationHint>
                  ) : null}
                </section>
                <section
                  className="derived-resource-summary"
                  aria-label="Abgeleitete Zusammenfassung"
                >
                  <strong>Zusammenfassung (abgeleitet)</strong>
                  <span>
                    {selectedResourceAircraft.length} Flugzeug
                    {selectedResourceAircraft.length === 1 ? "" : "e"} · Kapazität{" "}
                    {selectedResourceCapacity || "–"}{" "}
                    {selectedResourceCapacity === 1 ? "Platz" : "Plätze"} · Gruppen bis{" "}
                    {selectedResourceCapacity || "–"} Personen ohne Teilung
                  </span>
                </section>
                {masterSubmitAttempted && (resourceName.trim().length < 2 || !resourceGateId) ? (
                  <ValidationHint tone="error">
                    Bezeichnung und Gate müssen für die Ressourcengruppe angegeben werden.
                  </ValidationHint>
                ) : null}
                <button
                  className="primary-action"
                  disabled={!isAdministrator}
                  onClick={() =>
                    requestMasterSave(
                      "resource-group",
                      resourceName.trim().length >= 2 && Boolean(resourceGateId),
                    )
                  }
                  type="button"
                >
                  Ressourcengruppe speichern
                </button>
                {resourceEditorId !== "new" ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Ressourcengruppe löschen</strong>
                      <span>Produkte und Flugzeugzuordnungen müssen vorher entfernt sein.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() =>
                        requestMasterDelete("RESOURCE_GROUP", resourceEditorId, resourceName)
                      }
                      type="button"
                    >
                      Löschen
                    </button>
                  </div>
                ) : null}
              </fieldset>
              <fieldset hidden={masterDataCategory !== "aircraft"}>
                <legend>Flugzeug</legend>
                <label>
                  <FieldLabel
                    label="Kennzeichen"
                    help="Eindeutiges operatives Luftfahrzeugkennzeichen, beispielsweise D-EXYZ."
                  />
                  <input
                    value={aircraftRegistration}
                    maxLength={16}
                    onChange={(event) => setAircraftRegistration(event.target.value.toUpperCase())}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Flugzeugtyp"
                    help="Typbezeichnung zur Prüfung gegen kompatible Ressourcengruppen."
                  />
                  <input
                    value={aircraftType}
                    onChange={(event) => setAircraftType(event.target.value)}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Passagierplätze"
                    help="Maximale Ticketanzahl je Umlauf; Besatzungsplätze werden hier nicht eingetragen."
                  />
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={aircraftSeats}
                    onChange={(event) => setAircraftSeats(Number(event.target.value))}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Max. Passagierzuladung (kg)"
                    help="Optionaler organisatorischer Hinweiswert. Er besitzt keine Freigabe- oder Sicherheitssemantik."
                  />
                  <input
                    type="number"
                    min="1"
                    value={aircraftMaximumPayload}
                    onChange={(event) => setAircraftMaximumPayload(event.target.value)}
                  />
                </label>
                {masterSubmitAttempted &&
                (aircraftRegistration.trim().length < 3 || aircraftType.trim().length < 2) ? (
                  <ValidationHint tone="error">
                    Kennzeichen und Flugzeugtyp müssen mindestens 2 Zeichen lang sein.
                  </ValidationHint>
                ) : null}
                <button
                  className="primary-action"
                  disabled={!isAdministrator}
                  onClick={() =>
                    requestMasterSave(
                      "aircraft",
                      aircraftRegistration.trim().length >= 3 && aircraftType.trim().length >= 2,
                    )
                  }
                  type="button"
                >
                  Flugzeug speichern
                </button>
                {aircraftEditorId !== "new" ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Flugzeug löschen</strong>
                      <span>Eine bestehende Zuordnung muss zuerst entfernt werden.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() =>
                        requestMasterDelete("AIRCRAFT", aircraftEditorId, aircraftRegistration)
                      }
                      type="button"
                    >
                      Löschen
                    </button>
                  </div>
                ) : null}
              </fieldset>
              <fieldset hidden={masterDataCategory !== "assignments"}>
                <legend>Historisierte Zuordnung</legend>
                <label>
                  <FieldLabel
                    label="Flugzeug"
                    help="Flugzeug, dessen aktive Ressourcengruppenzuordnung geändert werden soll."
                  />
                  <select
                    value={assignmentAircraftId}
                    onChange={(event) => setAssignmentAircraftId(event.target.value)}
                  >
                    <option value="">Bitte wählen</option>
                    {board?.aircraft.map((aircraft) => (
                      <option key={aircraft.id} value={aircraft.id}>
                        {aircraft.registration} · {aircraft.resourceGroupName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <FieldLabel
                    label="Neue Ressourcengruppe"
                    help="Zielgruppe der neuen historisierten Zuordnung. Ein Flugzeug kann gleichzeitig nur einer aktiven Gruppe angehören."
                  />
                  <select
                    value={assignmentResourceGroupId}
                    onChange={(event) => setAssignmentResourceGroupId(event.target.value)}
                  >
                    <option value="">Bitte wählen</option>
                    {resourceGroups
                      .filter((group) => group.status !== "ENDED")
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p>
                  Wirksam ab Bestätigung. Aktive Umläufe und inkompatible Flugzeugtypen werden
                  serverseitig abgewiesen.
                </p>
                {masterSubmitAttempted && (!assignmentAircraftId || !assignmentResourceGroupId) ? (
                  <ValidationHint tone="error">
                    Flugzeug und neue Ressourcengruppe müssen ausgewählt werden.
                  </ValidationHint>
                ) : null}
                <button
                  className="primary-action"
                  disabled={!isAdministrator}
                  onClick={() =>
                    requestMasterSave(
                      "assignment",
                      Boolean(assignmentAircraftId && assignmentResourceGroupId),
                    )
                  }
                  type="button"
                >
                  Zuordnung ändern
                </button>
                {assignmentAircraftId &&
                board?.aircraft.find((entry) => entry.id === assignmentAircraftId)
                  ?.resourceGroupId ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Zuordnung entfernen</strong>
                      <span>Das Flugzeug und die Ressourcengruppe bleiben erhalten.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() =>
                        requestMasterDelete(
                          "ASSIGNMENT",
                          assignmentAircraftId,
                          `Zuordnung ${board?.aircraft.find((entry) => entry.id === assignmentAircraftId)?.registration ?? ""}`,
                        )
                      }
                      type="button"
                    >
                      Entfernen
                    </button>
                  </div>
                ) : null}
              </fieldset>
            </div>
          </section>
          <section
            className="admin-section master-data-editor master-data-drawer"
            hidden={
              adminArea !== "master-data" || !masterEditorOpen || masterDataCategory !== "pilots"
            }
          >
            <div className="drawer-heading">
              <h2>{pilotEditorId === "new" ? "Pilotencode anlegen" : "Pilotencode bearbeiten"}</h2>
              <button
                aria-label="Editor schließen"
                onClick={() => setMasterEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="parameter-grid compact-editor-grid">
              <label>
                <FieldLabel
                  label="Operativer Pilotencode"
                  help="Anonymer technischer Code für die operative Zuordnung; keine Namen oder Lizenzdaten erfassen."
                />
                <input
                  aria-label="Operativer Pilotencode"
                  value={pilotCode}
                  onChange={(event) => setPilotCode(event.target.value.toUpperCase())}
                />
                <span className="field-help">
                  Nur technische Codes, keine Namen oder Lizenzdaten.
                </span>
              </label>
              <label>
                <FieldLabel
                  label="Organisatorische Bemerkung"
                  help="Optionaler nicht personenbezogener Hinweis, zum Beispiel Einsatzbereich oder Schicht."
                />
                <input
                  value={pilotNote}
                  onChange={(event) => setPilotNote(event.target.value)}
                  placeholder="Optional · keine personenbezogenen Daten"
                />
              </label>
            </div>
            {masterSubmitAttempted && !/^[A-Z0-9-]{2,12}$/.test(pilotCode) ? (
              <ValidationHint tone="error">
                Der Pilotencode muss aus 2 bis 12 Großbuchstaben, Ziffern oder Bindestrichen
                bestehen.
              </ValidationHint>
            ) : null}
            <div className="editor-actions">
              <button
                className="primary-action"
                disabled={!isAdministrator}
                onClick={() => requestMasterSave("pilot", /^[A-Z0-9-]{2,12}$/.test(pilotCode))}
                type="button"
              >
                {pilotEditorId === "new" ? "Pilotencode anlegen" : "Änderungen speichern"}
              </button>
              <button onClick={() => setMasterEditorOpen(false)} type="button">
                Abbrechen
              </button>
              {pilotEditorId !== "new" ? (
                <button
                  disabled={!isAdministrator}
                  onClick={() => requestMasterSave("pilot-toggle", true)}
                  type="button"
                >
                  {board?.pilots.find((pilot) => pilot.id === pilotEditorId)?.active
                    ? "Deaktivieren"
                    : "Aktivieren"}
                </button>
              ) : null}
            </div>
            {pilotEditorId !== "new" ? (
              <div className="master-delete-zone">
                <div>
                  <strong>Pilotencode löschen</strong>
                  <span>Nur ohne Umlauf oder Flugzeugbindung möglich.</span>
                </div>
                <button
                  className="danger-link-action"
                  onClick={() => requestMasterDelete("PILOT", pilotEditorId, pilotCode)}
                  type="button"
                >
                  Löschen
                </button>
              </div>
            ) : null}
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <h2>Notfallmodus</h2>
            <label>
              <FieldLabel
                label="Begründung für den Notfallmodus"
                help="Nur außergewöhnliche Eingriffe benötigen einen frei eingegebenen Grund. Normale Betriebsänderungen werden automatisch protokolliert."
              />
              <input
                onChange={(event) => setReason(event.target.value)}
                placeholder="Mindestens 3 Zeichen"
                value={reason}
              />
            </label>
            {!board?.event.emergencyMode ? (
              <button
                className="danger-action"
                disabled={reason.trim().length < 3}
                onClick={() => emergency("TRIGGER_EMERGENCY")}
                type="button"
              >
                Not-Halt auslösen
              </button>
            ) : (
              <button
                className="danger-action"
                disabled={!isAdministrator || reason.trim().length < 3}
                onClick={() => requestAdminAction(() => emergency("CLEAR_EMERGENCY"))}
                type="button"
              >
                Notfallmodus aufheben
              </button>
            )}
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <h2>Laufende Umläufe</h2>
            <div className="active-rotation-list">
              {board?.rotations
                .filter((rotation) => ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status))
                .map((rotation) => (
                  <div key={rotation.id}>
                    <strong>{rotation.communicationLabel}</strong>
                    <span>{rotation.status}</span>
                    <span>{rotation.aircraftRegistration ?? "Flugzeug offen"}</span>
                    <span>Pilotencode {rotation.pilotOperationalCode ?? "offen"}</span>
                  </div>
                ))}
              {board && board.metrics.activeRotations === 0 ? (
                <p>Keine laufenden Umläufe.</p>
              ) : null}
            </div>
          </section>
          <section
            className="admin-section manifest-correction"
            hidden={adminArea !== "evaluation"}
          >
            <div className="section-heading">
              <div>
                <h2>Dokumentierte Besetzung korrigieren</h2>
                <p>
                  Seltener Admin-Sonderweg nach dem Flugstart. Eine anonyme Buchungsgruppe wird
                  immer vollständig einem bereits gestarteten oder abgeschlossenen Umlauf
                  zugeordnet.
                </p>
              </div>
              <span className="admin-only-badge">Nur Administration</span>
            </div>
            <ValidationHint>
              Diese Korrektur berichtigt ausschließlich die Dokumentation und besitzt keine
              flugbetriebliche oder sicherheitsbezogene Freigabewirkung.
            </ValidationHint>
            <div className="manifest-correction-grid">
              <label>
                <FieldLabel
                  label="Zu korrigierende Buchungsgruppe"
                  help="Es werden nur anonyme Gruppen angeboten, deren dokumentierter Umlauf bereits im Flug, gelandet oder abgeschlossen ist."
                />
                <select
                  value={manifestTicketGroupId}
                  onChange={(event) => {
                    setManifestTicketGroupId(event.target.value);
                    setManifestTargetRotationId("");
                  }}
                >
                  <option value="">Bitte wählen</option>
                  {manifestCandidates.map((candidate) => (
                    <option key={candidate.ticketGroupId} value={candidate.ticketGroupId}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <FieldLabel
                  label="Tatsächlicher Zielumlauf"
                  help="Der Zielumlauf muss mindestens den Status Im Flug erreicht haben. Bisherige Umläufe der Gruppe sind ausgeschlossen."
                />
                <select
                  disabled={!selectedManifestCandidate}
                  value={manifestTargetRotationId}
                  onChange={(event) => setManifestTargetRotationId(event.target.value)}
                >
                  <option value="">Bitte wählen</option>
                  {manifestTargets.map((rotation) => (
                    <option key={rotation.id} value={rotation.id}>
                      {rotation.communicationLabel} · {rotationStatusLabel[rotation.status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="manifest-reason-field">
                <FieldLabel
                  label="Dokumentationsgrund"
                  help="Mindestens 10 Zeichen. Der Grund wird zusammen mit Quelle, Ziel, Gerät und Version dauerhaft auditiert."
                />
                <textarea
                  maxLength={500}
                  placeholder="Zum Beispiel: Tatsächliche Besetzung nach Rückmeldung der Flight Line berichtigen"
                  value={manifestCorrectionReason}
                  onChange={(event) => setManifestCorrectionReason(event.target.value)}
                />
                <small>{manifestCorrectionReason.trim().length}/10 Mindestzeichen</small>
              </label>
            </div>
            {selectedManifestCandidate ? (
              <div className="manifest-correction-preview">
                <div>
                  <span>Bisher dokumentiert</span>
                  <strong>{selectedManifestCandidate.label}</strong>
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <span>Wird vollständig zugeordnet zu</span>
                  <strong>
                    {manifestTargets.find((rotation) => rotation.id === manifestTargetRotationId)
                      ?.communicationLabel ?? "Zielumlauf wählen"}
                  </strong>
                </div>
              </div>
            ) : null}
            <button
              className="primary-action manifest-correction-action"
              disabled={
                !isAdministrator ||
                !manifestTicketGroupId ||
                !manifestTargetRotationId ||
                manifestCorrectionReason.trim().length < 10
              }
              onClick={() => requestAdminAction(correctRotationManifest)}
              type="button"
            >
              Besetzung protokolliert korrigieren
            </button>
            {manifestCandidates.length === 0 ? (
              <p className="help-text">Aktuell ist keine Korrektur nach Flugstart erforderlich.</p>
            ) : null}
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <h2>Betriebs- und Wetterhinweise</h2>
            <label>
              <FieldLabel
                label="Organisatorischer Hinweis"
                help="Öffentlich sichtbare Information ohne automatische Auswirkung auf Verkauf oder Flugbetrieb."
              />
              <input
                value={operationalNotice}
                maxLength={240}
                onChange={(event) => setOperationalNotice(event.target.value)}
                placeholder="Hinweis setzen oder leer speichern zum Entfernen"
              />
            </label>
            <div className="secondary-actions notice-actions">
              <button onClick={() => setNotice()} type="button">
                Für gesamte Veranstaltung veröffentlichen
              </button>
              {resourceGroups.map((group) => (
                <button key={group.id} onClick={() => setNotice(group.id)} type="button">
                  Für {group.name} veröffentlichen
                </button>
              ))}
            </div>
            <button
              className="interrupt-action"
              onClick={() => setEventInterruption(!(board?.event.operationalInterrupted ?? false))}
              type="button"
            >
              {board?.event.operationalInterrupted
                ? "Veranstaltungsbetrieb fortsetzen"
                : "Veranstaltungsbetrieb unterbrechen"}
            </button>
            <p>Hinweise stoppen keinen Flugbetrieb. Unterbrechungen werden separat gesetzt.</p>
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <h2>Kapazität und Verkaufsempfehlung</h2>
            <LocalizedDateTimeInput
              label="Neuer harter Verkaufsschluss"
              labelContent={
                <FieldLabel
                  label="Neuer harter Verkaufsschluss"
                  help="Nach diesem lokalen Zeitpunkt werden für das gewählte Produkt keine neuen Verkäufe akzeptiert."
                />
              }
              value={saleClosesAt}
              onChange={setSaleClosesAt}
            />
            <div className="capacity-overview">
              {board?.products.map((product) => (
                <div className="capacity-row" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>{capacityLabel[product.capacityStatus]}</span>
                  </div>
                  <div>
                    <strong>{product.remainingSellableSeats}</strong>
                    <span>vorsichtig kalkulierte Restplätze</span>
                  </div>
                  <div>
                    <strong>
                      {product.saleRecommended ? "Verkauf empfohlen" : "Nicht verkaufen"}
                    </strong>
                    <span>Prognose {predictionQualityLabel[product.predictionQuality]}</span>
                  </div>
                  <div className="secondary-actions">
                    <button
                      disabled={!isAdministrator}
                      onClick={() =>
                        requestAdminAction(() =>
                          configureProductSales(product, !product.saleEnabled),
                        )
                      }
                      type="button"
                    >
                      {product.saleEnabled ? "Verkauf sperren" : "Verkauf freigeben"}
                    </button>
                    <button
                      disabled={!isAdministrator || !saleClosesAt}
                      onClick={() =>
                        requestAdminAction(() =>
                          configureProductSales(product, product.saleEnabled, true),
                        )
                      }
                      type="button"
                    >
                      Verkaufsschluss setzen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <h2>Flotte, Tanken und Pausen</h2>
            <p className="safety-disclaimer">
              Ausschließlich organisatorische Hinweise – keine flugbetriebliche oder
              sicherheitsbezogene Freigabewirkung.
            </p>
            <div className="fleet-list">
              {board?.aircraft.map((aircraft) => (
                <div className="fleet-row" key={aircraft.id}>
                  <div>
                    <strong>{aircraft.registration}</strong>
                    <span>
                      {aircraft.aircraftType} · {aircraft.passengerSeats} Sitze
                    </span>
                    <span>Queue {aircraft.resourceGroupName}</span>
                  </div>
                  <div>
                    <strong>{aircraftStateLabel[aircraft.operationalState]}</strong>
                    <span>
                      {aircraft.rotationsSinceRefuel}/{aircraft.refuelReminderThreshold} Umläufe
                      seit Tanken
                    </span>
                    {aircraft.refuelPlanned ? (
                      <span className="warning-text">Tanken vorgemerkt</span>
                    ) : null}
                  </div>
                  <div className="secondary-actions fleet-actions">
                    <button
                      disabled={
                        !["REFUELING", "PAUSED", "INACTIVE", "INTERRUPTED"].includes(
                          aircraft.operationalState,
                        )
                      }
                      onClick={() => setAircraftState(aircraft.id, "AVAILABLE")}
                      type="button"
                    >
                      Verfügbar
                    </button>
                    <button
                      disabled={aircraft.operationalState !== "AVAILABLE"}
                      onClick={() => setAircraftState(aircraft.id, "PAUSED")}
                      type="button"
                    >
                      Pause
                    </button>
                    <button
                      disabled={aircraft.operationalState !== "AVAILABLE"}
                      onClick={() => setAircraftState(aircraft.id, "REFUELING")}
                      type="button"
                    >
                      Tanken aktuell
                    </button>
                    <button
                      disabled={aircraft.operationalState !== "AVAILABLE"}
                      onClick={() => setAircraftState(aircraft.id, "INACTIVE")}
                      type="button"
                    >
                      Inaktiv
                    </button>
                    <button
                      disabled={aircraft.operationalState !== "AVAILABLE"}
                      onClick={() => setAircraftState(aircraft.id, "INTERRUPTED")}
                      type="button"
                    >
                      Unterbrechen
                    </button>
                    <button
                      onClick={() => scheduleRefuel(aircraft.id, !aircraft.refuelPlanned)}
                      type="button"
                    >
                      {aircraft.refuelPlanned ? "Vormerkung aufheben" : "Tanken vormerken"}
                    </button>
                    <button
                      disabled={!isAdministrator}
                      onClick={() =>
                        requestAdminAction(() => configureRefuelThreshold(aircraft.id))
                      }
                      type="button"
                    >
                      Schwelle {refuelThreshold} setzen
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <label className="threshold-input">
              <FieldLabel
                label="Umläufe bis Tank-Erinnerung"
                help="Rein organisatorischer Erinnerungswert je Flugzeug; keine Kraftstoff- oder Freigabeentscheidung."
              />
              <input
                type="number"
                min={1}
                max={100}
                value={refuelThreshold}
                onChange={(event) => setRefuelThreshold(Number(event.target.value))}
              />
            </label>
            <h3>Pilotenpausen</h3>
            <p className="help-text">
              Pilotencodes und organisatorische Bemerkungen werden unter Stammdaten verwaltet.
            </p>
            <div className="pilot-list">
              {board?.pilots.map((pilot) => (
                <div key={pilot.id}>
                  <strong>{pilot.operationalCode}</strong>
                  <span>{pilot.active ? (pilot.paused ? "Pause" : "aktiv") : "inaktiv"}</span>
                  <span>{pilot.operationalNote || "Keine organisatorische Bemerkung"}</span>
                  <span>
                    {pilot.currentCommunicationNumber
                      ? `Aktuell Fluggruppe ${pilot.currentCommunicationNumber}`
                      : "Aktuell keinem Umlauf zugeordnet"}
                  </span>
                  <button
                    disabled={!pilot.active}
                    onClick={() => setPilotPause(pilot.id, !pilot.paused)}
                    type="button"
                  >
                    {pilot.paused ? "Pause beenden" : "Pause starten"}
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <h2>Ressourcengruppen</h2>
            {resourceGroups.map((group) => (
              <div className="resource-control" key={group.id}>
                <div>
                  <strong>{group.name}</strong>
                  <span>{group.status}</span>
                </div>
                <div className="secondary-actions">
                  <button onClick={() => setResourceStatus(group.id, "PAUSED")} type="button">
                    Pausieren
                  </button>
                  <button onClick={() => setResourceStatus(group.id, "INTERRUPTED")} type="button">
                    Unterbrechen
                  </button>
                  <button onClick={() => setResourceStatus(group.id, "ACTIVE")} type="button">
                    Aktivieren
                  </button>
                  <button
                    disabled={group.status === "ENDED"}
                    onClick={() => setResourceStatus(group.id, "ENDED")}
                    type="button"
                  >
                    Beenden
                  </button>
                </div>
              </div>
            ))}
          </section>
          <section className="admin-section" hidden={adminArea !== "backup"}>
            <h2>Geräte ohne Helferkonten</h2>
            <div className="device-admin-context">
              <div>
                <strong>Geräteänderung bestätigen</strong>
                <span>
                  Änderungen nutzen den Bearbeitungsmodus oder fragen die PIN direkt ab.
                  Begründungen sind zusätzlich für Widerrufe erforderlich.
                </span>
              </div>
              <label>
                <FieldLabel
                  label="Begründung"
                  help="Wird nur beim Widerruf einer Gerätebindung verlangt und dauerhaft auditiert."
                />
                <input
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Für einen Widerruf"
                  value={reason}
                />
              </label>
            </div>
            <div className="device-pairing-form">
              <label>
                <FieldLabel
                  label="Technische Gerätebezeichnung"
                  help="Erkennbare, nicht personenbezogene Bezeichnung wie „Kasse Eingang“ oder „Flight Line 2“."
                />
                <input
                  value={deviceLabel}
                  onChange={(event) => setDeviceLabel(event.target.value)}
                />
              </label>
              <label>
                <FieldLabel
                  label="Feste Rolle"
                  help="Legt die Berechtigungen dieses Geräts dauerhaft fest. Eine spätere Änderung erfordert eine neue Kopplung."
                />
                <select
                  value={deviceRole}
                  onChange={(event) => setDeviceRole(event.target.value as typeof deviceRole)}
                >
                  <option value="CASHIER">Kasse</option>
                  <option value="FLIGHT_LINE">Flight Line</option>
                  <option value="FLIGHT_LINE_LEAD">Leitung Flight Line</option>
                  <option value="FLIGHT_DIRECTOR">Flugleitung</option>
                  <option value="DISPLAY">Anzeige</option>
                  <option value="ADMIN">Administration</option>
                </select>
              </label>
              <button
                disabled={!isAdministrator || deviceLabel.trim().length < 2}
                onClick={() => requestAdminAction(pairDevice)}
                type="button"
              >
                QR-Kopplung erzeugen
              </button>
            </div>
            {pairingQr && pairingUrl ? (
              <div className="pairing-qr">
                <img src={pairingQr} alt="QR-Code zur einmaligen Gerätekopplung" />
                <p>
                  Nur mit dem vorgesehenen Gerät scannen. Der QR-Code enthält dessen
                  Zugangsschlüssel.
                </p>
                <a href={pairingUrl}>Kopplung auf diesem Gerät öffnen</a>
              </div>
            ) : null}
            <div className="device-list">
              {devices.map((device) => (
                <div key={device.id}>
                  <span className={device.online ? "online-dot online" : "online-dot"} />
                  <strong>{device.label}</strong>
                  <span>{device.role}</span>
                  <span>
                    {device.active ? (device.online ? "online" : "offline") : "widerrufen"}
                  </span>
                  <time dateTime={device.lastSeenAt}>
                    zuletzt{" "}
                    {new Date(device.lastSeenAt).toLocaleString("de-DE", {
                      timeZone: board?.event.timeZone ?? "Europe/Berlin",
                    })}
                  </time>
                  {device.active ? (
                    <button
                      disabled={!isAdministrator || reason.trim().length < 3}
                      onClick={() => requestAdminAction(() => revokeDevice(device))}
                      type="button"
                    >
                      Widerrufen
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <div className="section-heading">
              <h2>Audit und Tagesabschluss</h2>
              <div className="report-actions">
                <button onClick={exportDailyReport} type="button">
                  CSV-Tagesbericht
                </button>
                <button onClick={exportDailyPdf} type="button">
                  PDF-Tagesbericht
                </button>
                <button onClick={exportRawData} type="button">
                  Ticket-Rohdaten CSV
                </button>
              </div>
            </div>
            <div className="history-tabs" role="tablist" aria-label="Verlaufsansicht">
              {(
                [
                  ["OPERATIONS", "Betriebshistorie"],
                  ["FORECASTS", "Prognosegüte"],
                  ["AUDIT", "Auditprotokoll"],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-selected={historyView === value}
                  className={historyView === value ? "active" : ""}
                  key={value}
                  onClick={() => {
                    setHistoryView(value);
                    setHistoryOffset(0);
                  }}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <fieldset className="history-filters">
              <legend>
                {historyView === "OPERATIONS"
                  ? "Betriebsdaten filtern"
                  : historyView === "FORECASTS"
                    ? "Prognosen filtern"
                    : "Audit-Ereignisse filtern"}
              </legend>
              <LocalizedDateTimeInput
                label="Von"
                labelContent={
                  <FieldLabel label="Von" help="Optionaler Beginn des ausgewerteten Zeitraums." />
                }
                value={historySince}
                onChange={setHistorySince}
              />
              <LocalizedDateTimeInput
                label="Bis"
                labelContent={
                  <FieldLabel label="Bis" help="Optionales Ende des ausgewerteten Zeitraums." />
                }
                value={historyUntil}
                onChange={setHistoryUntil}
              />
              {historyView === "AUDIT" ? (
                <>
                  <label>
                    <FieldLabel
                      label="Ereignistyp"
                      help="Technischer Audit-Ereignisname, beispielsweise TICKET_NO_SHOW. Leer zeigt alle Typen."
                    />
                    <input
                      value={historyEventType}
                      onChange={(event) => setHistoryEventType(event.target.value)}
                      placeholder="z. B. TICKET_NO_SHOW"
                    />
                  </label>
                  <label>
                    <FieldLabel
                      label="Bezugsart"
                      help="Art des betroffenen Objekts, beispielsweise ROTATION, TICKET oder PRODUCT."
                    />
                    <input
                      value={historyAggregateType}
                      onChange={(event) => setHistoryAggregateType(event.target.value)}
                      placeholder="z. B. ROTATION"
                    />
                  </label>
                  <label>
                    <FieldLabel
                      label="Bezugs-ID"
                      help="Interne anonyme Kennung eines bestimmten Objekts zur gezielten Nachverfolgung."
                    />
                    <input
                      value={historyAggregateId}
                      onChange={(event) => setHistoryAggregateId(event.target.value)}
                      placeholder="interne ID"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <FieldLabel
                      label="Flugzeug"
                      help="Begrenzt Betriebs- oder Prognoseeinträge auf ein Flugzeug."
                    />
                    <select
                      value={historyAircraftId}
                      onChange={(event) => setHistoryAircraftId(event.target.value)}
                    >
                      <option value="">Alle</option>
                      {board?.aircraft.map((aircraft) => (
                        <option value={aircraft.id} key={aircraft.id}>
                          {aircraft.registration}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel
                      label="Pilotencode"
                      help="Begrenzt die Ansicht auf einen anonymen operativen Pilotencode."
                    />
                    <select
                      value={historyPilotId}
                      onChange={(event) => setHistoryPilotId(event.target.value)}
                    >
                      <option value="">Alle</option>
                      {board?.pilots.map((pilot) => (
                        <option value={pilot.id} key={pilot.id}>
                          {pilot.operationalCode}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel
                      label="Umlauf-ID"
                      help="Interne Kennung eines konkreten Umlaufs; leer zeigt alle Umläufe."
                    />
                    <input
                      value={historyRotationId}
                      onChange={(event) => setHistoryRotationId(event.target.value)}
                      placeholder="interne ID"
                    />
                  </label>
                  {historyView === "OPERATIONS" ? (
                    <>
                      <label>
                        <FieldLabel
                          label="Ticketstatus"
                          help="Filtert nach dem aktuellen oder protokollierten anonymen Ticketzustand."
                        />
                        <select
                          value={historyTicketStatus}
                          onChange={(event) => setHistoryTicketStatus(event.target.value)}
                        >
                          <option value="">Alle</option>
                          {[
                            "QUEUED",
                            "CHECKED_IN",
                            "CALLED",
                            "BOARDING",
                            "IN_FLIGHT",
                            "LANDED",
                            "COMPLETED",
                            "NO_SHOW",
                            "CANCELED",
                            "CLARIFICATION",
                          ].map((status) => (
                            <option value={status} key={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <FieldLabel
                          label="Produkt"
                          help="Begrenzt die Betriebshistorie auf ein Produkt."
                        />
                        <select
                          value={historyProductId}
                          onChange={(event) => setHistoryProductId(event.target.value)}
                        >
                          <option value="">Alle</option>
                          {board?.products.map((product) => (
                            <option value={product.id} key={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <FieldLabel
                          label="Ressourcengruppe"
                          help="Begrenzt die Betriebshistorie auf die gemeinsame operative Queue."
                        />
                        <select
                          value={historyResourceGroupId}
                          onChange={(event) => setHistoryResourceGroupId(event.target.value)}
                        >
                          <option value="">Alle</option>
                          {board?.resourceGroups.map((group) => (
                            <option value={group.id} key={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <FieldLabel
                          label="Fluggruppennummer"
                          help="Stabile öffentliche Kommunikationsnummer der Fluggruppe, keine garantierte Uhrzeit."
                        />
                        <input
                          min="1"
                          type="number"
                          value={historyCommunicationNumber}
                          onChange={(event) => setHistoryCommunicationNumber(event.target.value)}
                        />
                      </label>
                      <label>
                        <FieldLabel
                          label="Ticket-ID"
                          help="Interne anonyme Ticketkennung; nicht der öffentliche QR-Code."
                        />
                        <input
                          value={historyTicketId}
                          onChange={(event) => setHistoryTicketId(event.target.value)}
                          placeholder="interne ID"
                        />
                      </label>
                      <label>
                        <FieldLabel
                          label="Ticketgruppe"
                          help="Interne anonyme Kennung einer gemeinsam gebuchten und untrennbaren Gruppe."
                        />
                        <input
                          value={historyTicketGroupId}
                          onChange={(event) => setHistoryTicketGroupId(event.target.value)}
                          placeholder="interne ID"
                        />
                      </label>
                    </>
                  ) : null}
                </>
              )}
              <button
                onClick={() =>
                  historyView === "AUDIT" ? void refreshHistory() : void refreshDetailedHistory(0)
                }
                type="button"
              >
                Filter anwenden
              </button>
            </fieldset>
            {historyView === "OPERATIONS" ? (
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Zeitpunkt</th>
                      <th>Fluggruppe</th>
                      <th>Ticket / Gruppe</th>
                      <th>Status</th>
                      <th>Flugzeug</th>
                      <th>Pilot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationalHistory.entries.map((entry) => (
                      <tr key={`${entry.ticketId}-${entry.rotationId ?? "open"}`}>
                        <td>
                          {new Date(entry.latestAt).toLocaleString("de-DE", {
                            timeZone: board?.event.timeZone ?? "Europe/Berlin",
                          })}
                        </td>
                        <td>{entry.communicationLabel ?? "Noch offen"}</td>
                        <td>
                          <code>{entry.ticketId}</code>
                          <small>
                            <code>{entry.ticketGroupId}</code>
                          </small>
                        </td>
                        <td>{entry.ticketStatus}</td>
                        <td>{entry.aircraftRegistration ?? "–"}</td>
                        <td>{entry.pilotOperationalCode ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {operationalHistory.entries.length === 0 ? (
                  <p>Keine passenden Betriebsdaten.</p>
                ) : null}
              </div>
            ) : historyView === "FORECASTS" ? (
              <div className="history-table-wrap">
                <table className="history-table forecast-history-table">
                  <thead>
                    <tr>
                      <th>Snapshot</th>
                      <th>Fluggruppe</th>
                      <th>Auslöser</th>
                      <th>Qualität / Grundlage</th>
                      <th>Abweichungen in Minuten</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastHistory.entries.map((entry) => (
                      <tr key={entry.snapshotId}>
                        <td>
                          {new Date(entry.capturedAt).toLocaleString("de-DE", {
                            timeZone: board?.event.timeZone ?? "Europe/Berlin",
                          })}
                        </td>
                        <td>
                          {entry.communicationLabel}
                          <small>
                            <code>{entry.rotationId}</code>
                          </small>
                        </td>
                        <td>{entry.triggerEventType}</td>
                        <td>
                          {entry.quality}
                          <small>
                            {entry.dataBasisScope} · n={entry.sampleSize} · Alter{" "}
                            {Math.round(entry.dataAgeMinutes)} Min.
                          </small>
                        </td>
                        <td>
                          <span>Boarding {entry.deviationMinutes.boarding ?? "–"}</span>
                          <span>Start {entry.deviationMinutes.departure ?? "–"}</span>
                          <span>Landung {entry.deviationMinutes.landing ?? "–"}</span>
                          <span>Abschluss {entry.deviationMinutes.completion ?? "–"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {forecastHistory.entries.length === 0 ? (
                  <p>Keine passenden Prognosesnapshots.</p>
                ) : null}
              </div>
            ) : (
              <div className="audit-list">
                {history.entries.slice(0, 50).map((entry) => (
                  <div key={entry.sequence}>
                    <time dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleString("de-DE", {
                        timeZone: board?.event.timeZone ?? "Europe/Berlin",
                      })}
                    </time>
                    <strong>{entry.eventType}</strong>
                    <span>
                      {entry.aggregateType} · Version {entry.aggregateVersion}
                    </span>
                    <code>{entry.deviceId}</code>
                  </div>
                ))}
                {history.entries.length === 0 ? <p>Keine passenden Ereignisse.</p> : null}
              </div>
            )}
            {historyView !== "AUDIT" ? (
              <div className="history-pagination">
                <button
                  disabled={historyOffset === 0}
                  onClick={() => void refreshDetailedHistory(Math.max(0, historyOffset - 50))}
                  type="button"
                >
                  Zurück
                </button>
                <span>
                  {historyOffset + 1}–
                  {Math.min(
                    historyOffset + 50,
                    historyView === "OPERATIONS" ? operationalHistory.total : forecastHistory.total,
                  )}{" "}
                  von{" "}
                  {historyView === "OPERATIONS" ? operationalHistory.total : forecastHistory.total}
                </span>
                <button
                  disabled={
                    historyOffset + 50 >=
                    (historyView === "OPERATIONS"
                      ? operationalHistory.total
                      : forecastHistory.total)
                  }
                  onClick={() => void refreshDetailedHistory(historyOffset + 50)}
                  type="button"
                >
                  Weiter
                </button>
              </div>
            ) : null}
          </section>
          {adminPinDialog ? (
            <div className="modal-backdrop">
              <form
                aria-labelledby="admin-pin-dialog-title"
                aria-modal="true"
                className="confirmation-dialog"
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeAdminPinDialog();
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmAdminPinDialog();
                }}
                role="dialog"
              >
                <div className="drawer-heading">
                  <div>
                    <h2 id="admin-pin-dialog-title">
                      {adminPinDialog === "recover"
                        ? "Administrationszugang erneuern"
                        : adminPinDialog === "unlock"
                          ? "Bearbeitungsmodus entsperren"
                          : "Änderung bestätigen"}
                    </h2>
                    <p>
                      {adminPinDialog === "recover"
                        ? "Die Gerätebindung wird mit der Administrator-PIN neu ausgestellt. Vorhandene Betriebsdaten bleiben unverändert."
                        : adminPinDialog === "unlock"
                          ? "Die PIN gilt nur in diesem Browser-Tab und wird nach 15 Minuten Inaktivität verworfen."
                          : "Diese einzelne Änderung wird nach erfolgreicher PIN-Prüfung ausgeführt und protokolliert."}
                    </p>
                  </div>
                  <button
                    aria-label="Bestätigung schließen"
                    disabled={adminPinBusy}
                    onClick={closeAdminPinDialog}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <label>
                  Administrator-PIN
                  <input
                    autoComplete="current-password"
                    onChange={(event) => setAdminPin(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void confirmAdminPinDialog();
                      }
                    }}
                    ref={adminPinInputRef}
                    type="password"
                    value={adminPin}
                  />
                </label>
                {adminPinError ? (
                  <ValidationHint tone="error">{adminPinError}</ValidationHint>
                ) : null}
                <div className="dialog-actions">
                  <button disabled={adminPinBusy} onClick={closeAdminPinDialog} type="button">
                    Abbrechen
                  </button>
                  <button
                    className="primary-action"
                    disabled={adminPin.length < 4 || adminPinBusy}
                    type="submit"
                  >
                    {adminPinBusy
                      ? "PIN wird geprüft …"
                      : adminPinDialog === "recover"
                        ? "Zugang erneuern"
                        : adminPinDialog === "unlock"
                          ? "Entsperren"
                          : "Bestätigen"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
          {pendingMasterDelete ? (
            <div className="modal-backdrop">
              <form
                aria-labelledby="master-delete-title"
                aria-modal="true"
                className="confirmation-dialog master-delete-dialog"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setPendingMasterDelete(null);
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmMasterDelete();
                }}
                role="dialog"
              >
                <div className="drawer-heading">
                  <div>
                    <span className="danger-eyebrow">Endgültig löschen</span>
                    <h2 id="master-delete-title">{pendingMasterDelete.label} löschen?</h2>
                    <p>Die Löschung wird mit Ihrer technischen Geräte-ID protokolliert.</p>
                  </div>
                  <button
                    aria-label="Löschen abbrechen"
                    onClick={() => setPendingMasterDelete(null)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                {board?.event.status !== "PREPARATION" ? (
                  <div className="delete-blockers" role="status">
                    <strong>Löschen ist nach Betriebsfreigabe gesperrt.</strong>
                    <span>Stammdaten können jetzt nur noch deaktiviert werden.</span>
                  </div>
                ) : pendingMasterDelete.blockers.length > 0 ? (
                  <div className="delete-blockers" role="status">
                    <strong>Löschen noch nicht möglich</strong>
                    <span>Zuerst entfernen:</span>
                    <ul>
                      {pendingMasterDelete.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="delete-ready-copy">
                    Der Datensatz hat keine erkennbaren Abhängigkeiten und kann in der Vorbereitung
                    entfernt werden. Der Server prüft dies vor der Löschung erneut.
                  </p>
                )}
                {!adminModeUnlocked ? (
                  <label>
                    Administrator-PIN
                    <input
                      autoComplete="current-password"
                      onChange={(event) => setAdminPin(event.target.value)}
                      ref={adminPinInputRef}
                      type="password"
                      value={adminPin}
                    />
                  </label>
                ) : (
                  <ValidationHint>
                    Bearbeitungsmodus aktiv. Die Löschung benötigt weiterhin diese ausdrückliche
                    Bestätigung.
                  </ValidationHint>
                )}
                <div className="dialog-actions">
                  <button onClick={() => setPendingMasterDelete(null)} type="button">
                    Abbrechen
                  </button>
                  <button
                    className="danger-action"
                    disabled={
                      board?.event.status !== "PREPARATION" ||
                      pendingMasterDelete.blockers.length > 0 ||
                      adminPin.length < 4
                    }
                    type="submit"
                  >
                    Endgültig löschen
                  </button>
                </div>
              </form>
            </div>
          ) : null}
          {factoryResetOpen ? (
            <div className="modal-backdrop factory-reset-backdrop">
              <form
                aria-labelledby="factory-reset-title"
                aria-modal="true"
                className="confirmation-dialog factory-reset-dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  void performFactoryReset();
                }}
                role="dialog"
              >
                <div className="drawer-heading">
                  <div>
                    <h2 id="factory-reset-title">Werkszustand herstellen</h2>
                    <p>Diese Aktion kann nicht rückgängig gemacht werden.</p>
                  </div>
                  <button
                    aria-label="Werksreset schließen"
                    disabled={factoryResetBusy}
                    onClick={() => setFactoryResetOpen(false)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <div className="factory-delete-summary">
                  <strong>Wird gelöscht</strong>
                  <ul>
                    <li>Alle Tickets, Warteschlangen, Umläufe und Flugdaten</li>
                    <li>Alle Stammdaten und Veranstaltungsparameter</li>
                    <li>Alle Historien, Protokolle und Gerätebindungen</li>
                    <li>Die Ersteinrichtung und lokalen Zugangsdaten</li>
                  </ul>
                </div>
                <label>
                  <FieldLabel
                    label="Begründung"
                    help="Dokumentiert, warum der vollständige Werksreset ausgeführt wird."
                  />
                  <textarea
                    maxLength={240}
                    onChange={(event) => setFactoryResetReason(event.target.value)}
                    placeholder="Grund für den Werksreset"
                    value={factoryResetReason}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Administrator-PIN"
                    help="Bestätigt die Berechtigung für diesen irreversiblen Vorgang. Die PIN wird nicht protokolliert."
                  />
                  <input
                    autoComplete="current-password"
                    onChange={(event) => setFactoryResetPin(event.target.value)}
                    type="password"
                    value={factoryResetPin}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Sicherheitsbestätigung"
                    help="Zum Schutz vor versehentlicher Ausführung muss WERKSZUSTAND vollständig eingegeben werden."
                  />
                  <input
                    autoComplete="off"
                    onChange={(event) => setFactoryResetConfirmation(event.target.value)}
                    value={factoryResetConfirmation}
                  />
                </label>
                <label className="reset-checkbox">
                  <input
                    checked={retainRecoveryBackup}
                    onChange={(event) => {
                      setRetainRecoveryBackup(event.target.checked);
                      if (event.target.checked) setDeleteAllBackups(false);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>Wiederherstellungssicherung in R2 behalten</strong>
                    <small>Empfohlen – ermöglicht eine spätere Wiederherstellung.</small>
                  </span>
                </label>
                <label className="reset-checkbox extra-danger">
                  <input
                    checked={deleteAllBackups}
                    onChange={(event) => {
                      setDeleteAllBackups(event.target.checked);
                      if (event.target.checked) setRetainRecoveryBackup(false);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>Auch alle R2-Sicherungen endgültig löschen</strong>
                    <small>Diese Aktion kann nicht rückgängig gemacht werden.</small>
                  </span>
                </label>
                <p className="reset-consequence">
                  Nach erfolgreichem Reset werden lokale Zugangsdaten entfernt und /setup geöffnet.
                </p>
                {factoryResetError ? (
                  <ValidationHint tone="error">{factoryResetError}</ValidationHint>
                ) : null}
                <div className="dialog-actions">
                  <button
                    disabled={factoryResetBusy}
                    onClick={() => setFactoryResetOpen(false)}
                    type="button"
                  >
                    Abbrechen
                  </button>
                  <button
                    className="danger-action"
                    disabled={
                      factoryResetBusy ||
                      factoryResetReason.trim().length < 3 ||
                      factoryResetPin.length < 4 ||
                      factoryResetConfirmation !== "WERKSZUSTAND"
                    }
                    onClick={() => void performFactoryReset()}
                    type="button"
                  >
                    {factoryResetBusy
                      ? "System wird zurückgesetzt …"
                      : "Alles löschen und neu starten"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
          {message ? (
            <div className="action-message admin-action-message" role="status">
              <span>{message}</span>
              <button aria-label="Hinweis schließen" onClick={() => setMessage(null)} type="button">
                ×
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </Shell>
  );
}

export function App() {
  const path = window.location.pathname;
  const ticketMatch = path.match(/^\/ticket\/([A-Za-z2-9]{12,32})$/);
  const ticketCode = ticketMatch?.[1];
  if (ticketCode) return <TicketStatusView code={ticketCode.toUpperCase()} />;
  if (path === "/setup") return <SetupView />;
  if (path === "/pair") return <PairDeviceView />;
  if (path === "/datenschutz") return <PrivacyView />;
  if (path === "/flight-line") return <FlightLineView />;
  if (path === "/fids") return <FidsView />;
  if (path === "/admin") return <AdminView />;
  return <CashierView />;
}
