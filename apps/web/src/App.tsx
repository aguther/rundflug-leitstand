import type {
  AuditHistory,
  EventCatalogEntry,
  OperationBoard,
  PublicBoard,
  PublicTicketStatus,
  TicketSearchResult,
} from "@rundflug/contracts";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import type { PairedDeviceSummary } from "./api";
import {
  bootstrapSystem,
  cloneEvent,
  downloadDailyPdf,
  downloadDailyReport,
  downloadTicketRawData,
  getAuditHistory,
  getDeviceContext,
  getEventCatalog,
  getOperationBoard,
  getPairedDevices,
  getPublicBoard,
  getPublicTicketStatus,
  getPushPublicKey,
  getSetupStatus,
  registerTicketPush,
  revokeTicketPush,
  searchTickets,
  sendCommand,
} from "./api";
import {
  type BoardSyncState,
  nextBoardReconnectDelay,
  OPERATION_BOARD_POLL_INTERVAL_MS,
  OPERATION_BOARD_RECONNECT_INITIAL_MS,
  reduceBoardSyncState,
  requestBoardSync,
} from "./board-sync";
import { rememberActiveEvent, resolveActiveEvent } from "./event-context";
import {
  eventDateInTimeZone,
  eventLocalDateTimeToIso,
  formatEventLocalDateTime,
} from "./event-time";
import {
  appendCashierDraftRevision,
  cashierDraftQueueKey,
  latestCashierDraft,
  readCashierDraftQueue,
  writeCashierDraftQueue,
} from "./offline-drafts";
import { confirmedStateLabel, loadOperationBoard, saveOperationBoard } from "./offline-store";
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
type WeightClass = "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL";
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

function saleClosingLabel(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  const minutes = Math.ceil((Date.parse(value) - Date.now()) / 60_000);
  if (minutes <= 0) return "Verkaufsschluss erreicht";
  if (minutes <= 30) return `Verkaufsschluss in ${minutes} Minuten`;
  return `Verkaufsschluss ${new Date(value).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  })}`;
}

function operationalTimeLabel(value: string | null, timeZone: string): string {
  if (!value) return "–";
  return new Date(value).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function deviceTokenFor(deviceId: string): string {
  const pairedToken = window.localStorage.getItem(`device-token:${deviceId}`);
  if (pairedToken) return pairedToken;
  if (LOCAL_DEVELOPMENT && EVENT_ID === "demo-2026") {
    if (deviceId === "cashier-tablet-1") return "demo-cashier-device-token";
    if (deviceId === "flight-line-tablet-1") return "demo-flight-line-device-token";
    return "demo-admin-device-token";
  }
  return "";
}

function deviceIdForRole(role: string, developmentId: string): string {
  const pairedDeviceId = window.localStorage.getItem(`device-id:${role}`);
  if (pairedDeviceId) return pairedDeviceId;
  return LOCAL_DEVELOPMENT && EVENT_ID === "demo-2026"
    ? developmentId
    : `unpaired-${role.toLowerCase()}`;
}

const CASHIER_DEVICE_ID = deviceIdForRole("CASHIER", "cashier-tablet-1");
const FLIGHT_LINE_DEVICE_ID = deviceIdForRole("FLIGHT_LINE", "flight-line-tablet-1");
const ADMIN_DEVICE_ID = deviceIdForRole("ADMIN", "technical-scaffold");

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
  const refresh = useCallback(async () => {
    const deviceToken = deviceTokenFor(deviceId);
    const outcome = await requestBoardSync(() =>
      getOperationBoard(EVENT_ID, deviceId, deviceToken),
    );
    if (outcome.type === "UNAVAILABLE" && outcome.message.includes("(403)") && deviceToken) {
      try {
        const context = await getDeviceContext(deviceId, deviceToken);
        if (context.eventId !== EVENT_ID) {
          rememberActiveEvent(window.localStorage, context.eventId);
          const target = new URL(window.location.href);
          target.searchParams.set("event", context.eventId);
          window.location.replace(target);
          return;
        }
      } catch {
        // The original board error remains the useful user-facing state.
      }
    }
    setState((current) => reduceBoardSyncState(current, outcome));
    if (outcome.type === "CONFIRMED") {
      void saveOperationBoard(EVENT_ID, deviceId, outcome.board, outcome.confirmedAt);
    }
  }, [deviceId]);
  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelay = OPERATION_BOARD_RECONNECT_INITIAL_MS;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/public/events/${encodeURIComponent(EVENT_ID)}/live`,
      );
      socket.addEventListener("open", () => {
        reconnectDelay = OPERATION_BOARD_RECONNECT_INITIAL_MS;
        void refresh();
      });
      socket.addEventListener("message", () => void refresh());
      socket.addEventListener("close", () => {
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
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      window.clearInterval(timer);
    };
  }, [refresh, deviceId]);
  return { ...state, refresh };
}

function Shell({
  title,
  children,
  kiosk = false,
}: {
  title: string;
  children: React.ReactNode;
  kiosk?: boolean;
}) {
  const online = useConnectivity();
  return (
    <main className={kiosk ? "app-shell kiosk-shell" : "app-shell"}>
      <header className="app-header">
        <div>
          <strong>Rundflug-Leitstand</strong>
          <span>{title}</span>
        </div>
        <nav aria-label="Ansichten">
          <a href="/kasse">Kasse</a>
          <a href="/flight-line">Flight Line</a>
          <a href="/fids">FIDS</a>
          <a href="/admin">Administration</a>
        </nav>
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
  const [paymentStatus, setPaymentStatus] = useState<
    "UNPAID" | "PAID" | "WAIVED" | "INFORMATIONAL_ONLY"
  >("PAID");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD" | "VOUCHER" | "OTHER" | null>(
    "CASH",
  );
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
  const product = board?.products.find((entry) => entry.id === productId) ?? board?.products[0];
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
  useEffect(() => {
    if (paymentStatus === "UNPAID" || paymentStatus === "WAIVED") setPaymentMethod(null);
    else if (paymentMethod === null) setPaymentMethod("CASH");
  }, [paymentMethod, paymentStatus]);

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
            paymentStatus,
            paymentMethod,
            oversizeSplitAcknowledged: false,
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
            ? `Offline-Entwurf wiederhergestellt · ${pendingDraftCount} Änderung${pendingDraftCount === 1 ? "" : "en"} prüfen und Verkauf bewusst bestätigen.`
            : `Entwurf lokal gespeichert · ${pendingDraftCount} Änderung${pendingDraftCount === 1 ? "" : "en"} ausstehend · ohne operative Wirkung.`}
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
              onClick={() => setProductId(entry.id)}
              type="button"
            >
              <strong>{entry.name}</strong>
              <span>{entry.resourceGroupStatus === "ACTIVE" ? "Verkauf aktiv" : "Gesperrt"}</span>
              <span>
                Wartezeit {entry.estimatedWaitLowerMinutes}–{entry.estimatedWaitUpperMinutes} Min.
              </span>
              <span>
                {entry.nextBoardingWindowLowerAt && entry.nextBoardingWindowUpperAt
                  ? `Nächstes Boardingfenster ${operationalTimeLabel(entry.nextBoardingWindowLowerAt, board.event.timeZone)}–${operationalTimeLabel(entry.nextBoardingWindowUpperAt, board.event.timeZone)}`
                  : "Boardingfenster derzeit unsicher"}
              </span>
              <span>Gemeinsame Queue: {entry.resourceGroupOpenTickets} Tickets</span>
              <span>{capacityLabel[entry.capacityStatus]}</span>
              {entry.resourceGroupOperationalNote ? (
                <span>Betriebshinweis: {entry.resourceGroupOperationalNote}</span>
              ) : null}
              <span>Noch vorsichtig kalkuliert: {entry.remainingSellableSeats} Plätze</span>
              {saleClosingLabel(entry.saleClosesAt, board.event.timeZone) ? (
                <span>{saleClosingLabel(entry.saleClosesAt, board.event.timeZone)}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="sale-editor">
          <section className="group-size" aria-labelledby="group-title">
            <h1 id="group-title">Gruppengröße</h1>
            <div className="stepper">
              <button type="button" onClick={() => setSize((value) => Math.max(1, value - 1))}>
                −
              </button>
              <output>{size}</output>
              <button type="button" onClick={() => setSize((value) => Math.min(12, value + 1))}>
                +
              </button>
            </div>
            <p>Keine Namen und keine Telefonnummern.</p>
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
            <fieldset className="payment-information">
              <legend>Zahlungsinformation</legend>
              <label>
                Status
                <select
                  value={paymentStatus}
                  onChange={(event) =>
                    setPaymentStatus(
                      event.target.value as "UNPAID" | "PAID" | "WAIVED" | "INFORMATIONAL_ONLY",
                    )
                  }
                >
                  <option value="PAID">Bezahlt</option>
                  <option value="UNPAID">Offen</option>
                  <option value="WAIVED">Erlassen</option>
                  <option value="INFORMATIONAL_ONLY">Nur Information</option>
                </select>
              </label>
              <label>
                Zahlart
                <select
                  disabled={paymentStatus === "UNPAID" || paymentStatus === "WAIVED"}
                  value={paymentMethod ?? ""}
                  onChange={(event) =>
                    setPaymentMethod(
                      (event.target.value || null) as "CASH" | "CARD" | "VOUCHER" | "OTHER" | null,
                    )
                  }
                >
                  <option value="">Keine</option>
                  <option value="CASH">Bar</option>
                  <option value="CARD">Karte</option>
                  <option value="VOUCHER">Gutschein</option>
                  <option value="OTHER">Sonstige</option>
                </select>
              </label>
              <strong>
                Summe:{" "}
                {(((product?.priceCents ?? 0) * size) / 100).toLocaleString("de-DE", {
                  style: "currency",
                  currency: "EUR",
                })}
              </strong>
              <p>Nur Abstimmhilfe · keine elektronische Kasse oder Zahlungsabwicklung.</p>
            </fieldset>
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
              </div>
            ) : null}
          </section>
          <section className="ticket-preview">
            <h2>QR-Tickets</h2>
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
            ) : (
              <p>Beim Bestätigen werden {size} nicht erratbare Codes erzeugt.</p>
            )}
            {message ? (
              <div className="action-message" role="status">
                {message}
              </div>
            ) : null}
            {lastTicketGroupId ? (
              <div className="correction-controls">
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
              </div>
            ) : null}
          </section>
        </div>
        <section className="ticket-search" aria-labelledby="ticket-search-title">
          <div>
            <h2 id="ticket-search-title">Ticketsuche</h2>
            <p>Ticket-/QR-Code, Gruppen-ID oder Fluggruppenkennung eingeben.</p>
          </div>
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
        </section>
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
            ticketDetails.some(
              (detail) =>
                detail.weightClass === "INDIVIDUAL" &&
                ((detail.individualWeightKg ?? 0) < 15 || (detail.individualWeightKg ?? 0) > 250),
            ) ||
            ((paymentStatus === "PAID" || paymentStatus === "INFORMATIONAL_ONLY") &&
              paymentMethod === null) ||
            busy
          }
          onClick={sell}
          type="button"
        >
          {busy
            ? "Wird bestätigt …"
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
  LANDED: { label: "ABGESCHLOSSEN", command: "MARK_COMPLETED" },
  COMPLETED: null,
} as const;

function FlightLineView() {
  const { board, error, lastConfirmedAt, refresh } = useOperationBoard(FLIGHT_LINE_DEVICE_ID);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [queueReason, setQueueReason] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [nextAircraftId, setNextAircraftId] = useState("");
  const [nextPilotId, setNextPilotId] = useState("");
  const operationalRotations = board?.rotations.filter(
    (rotation) => rotation.status !== "COMPLETED",
  );
  const selected =
    operationalRotations?.find((rotation) => rotation.id === selectedId) ??
    operationalRotations?.[0];
  const action = selected ? actionForState[selected.status] : null;
  useEffect(() => {
    if (selected?.status !== "DRAFT") return;
    setNextAircraftId(selected.suggestedAircraftId ?? "");
    setNextPilotId(selected.suggestedPilotId ?? "");
  }, [selected?.status, selected?.suggestedAircraftId, selected?.suggestedPilotId]);
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

  async function mutateQueue(type: "DEFER_TICKET_GROUP" | "MARK_NO_SHOW") {
    if (!board || !selected || queueReason.trim().length < 3) return;
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
          payload: { ticketGroupId: selected.ticketGroupId, reason: queueReason.trim() },
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
    <Shell title="Flight Line">
      <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
      <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
      <OperationalNotice note={board?.event.operationalNote} />
      {board?.currentDeviceRole === "FLIGHT_LINE_LEAD" && !board.event.emergencyMode ? (
        <section className="emergency-control" aria-labelledby="flight-line-emergency-title">
          <label>
            <span id="flight-line-emergency-title">Not-Halt</span>
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
        </section>
      ) : null}
      <section className="flight-workspace">
        <div className="queue-list">
          <h1>Warteschlange</h1>
          {operationalRotations?.map((rotation) => (
            <button
              key={rotation.id}
              className={rotation.id === selected?.id ? "queue-row selected" : "queue-row"}
              onClick={() => setSelectedId(rotation.id)}
              type="button"
            >
              <strong>{rotation.communicationLabel}</strong>
              <span>{rotation.productName}</span>
              <span>
                {rotation.ticketCount} Plätze · {rotation.predictedLowerMinutes}–
                {rotation.predictedUpperMinutes} Min.
              </span>
            </button>
          ))}
          {operationalRotations?.length === 0 ? <p>Keine offenen Fluggruppen.</p> : null}
        </div>
        <div className="rotation-detail">
          {selected ? (
            <>
              <div className={`state-banner state-${selected.status.toLowerCase()}`}>
                <span>Status</span>
                <strong>{selected.status}</strong>
              </div>
              <h2>Fluggruppe {selected.communicationLabel}</h2>
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
                <div>
                  <dt>Pilotencode</dt>
                  <dd>
                    {selected.status === "DRAFT" ? (
                      <label>
                        <select
                          aria-label="Pilotencode für NEXT"
                          value={nextPilotId}
                          onChange={(event) => setNextPilotId(event.target.value)}
                        >
                          <option value="">Kein Pilotencode verfügbar</option>
                          {board?.pilots
                            .filter(
                              (pilot) =>
                                pilot.active &&
                                !pilot.paused &&
                                (!pilot.currentRotationId ||
                                  pilot.currentRotationId === selected.id),
                            )
                            .map((pilot) => (
                              <option value={pilot.id} key={pilot.id}>
                                {pilot.operationalCode}
                                {pilot.id === selected.suggestedPilotId ? " · Vorschlag" : ""}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : (
                      (selected.pilotOperationalCode ?? "Kein anonymer Pilotencode verfügbar")
                    )}
                  </dd>
                </div>
              </dl>
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
                    {selected.timeline.predictionQuality ?? "noch nicht berechnet"}
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
                      selected.tickets.filter((ticket) => ticket.attendanceStatus === "CHECKED_IN")
                        .length
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
                    <button
                      disabled={queueReason.trim().length < 3 || !noShowReady}
                      onClick={() => mutateQueue("MARK_NO_SHOW")}
                      type="button"
                    >
                      {selected.status === "CALLED" && !noShowReady
                        ? `No-Show nach ${board?.event.noShowAfterMinutes ?? 10} Min.`
                        : "No-Show"}
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
      </section>
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
    let reconnectDelay = OPERATION_BOARD_RECONNECT_INITIAL_MS;
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
        void refresh();
      });
      socket.addEventListener("message", () => void refresh());
      socket.addEventListener("close", () => {
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
    window.localStorage.setItem(`device-id:${viewRole}`, deviceId);
    window.localStorage.setItem(`device-token:${deviceId}`, token);
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
      window.localStorage.setItem("device-id:ADMIN", result.adminDeviceId);
      window.localStorage.setItem(`device-token:${result.adminDeviceId}`, token);
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
              <label>
                Datum
                <input
                  type="date"
                  value={eventDate}
                  onChange={(event) => setEventDate(event.target.value)}
                />
              </label>
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
    let reconnectDelay = 1_000;
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
        void refresh();
      });
      socket.addEventListener("message", () => void refresh());
      socket.addEventListener("close", () => {
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
  const { board, error, lastConfirmedAt, refresh } = useOperationBoard(ADMIN_DEVICE_ID);
  const [reason, setReason] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [saleClosesAt, setSaleClosesAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [history, setHistory] = useState<AuditHistory>({ entries: [] });
  const [historyEventType, setHistoryEventType] = useState("");
  const [historyAggregateType, setHistoryAggregateType] = useState("");
  const [historyAggregateId, setHistoryAggregateId] = useState("");
  const [historySince, setHistorySince] = useState("");
  const [historyUntil, setHistoryUntil] = useState("");
  const [devices, setDevices] = useState<PairedDeviceSummary[]>([]);
  const [deviceLabel, setDeviceLabel] = useState("Kasse 2");
  const [deviceRole, setDeviceRole] = useState<
    "CASHIER" | "FLIGHT_LINE" | "FLIGHT_LINE_LEAD" | "FLIGHT_DIRECTOR" | "ADMIN" | "DISPLAY"
  >("CASHIER");
  const [pairingQr, setPairingQr] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [pilotCode, setPilotCode] = useState("P-02");
  const [pilotNote, setPilotNote] = useState("");
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
  const [productPriceCents, setProductPriceCents] = useState(0);
  const [productReferenceCapacity, setProductReferenceCapacity] = useState(1);
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
  const [resourceEditorId, setResourceEditorId] = useState("new");
  const [resourceName, setResourceName] = useState("");
  const [resourceGateId, setResourceGateId] = useState("");
  const [resourceReferenceCapacity, setResourceReferenceCapacity] = useState(1);
  const [resourcePlannedMinutes, setResourcePlannedMinutes] = useState(30);
  const [resourceCompatibleTypes, setResourceCompatibleTypes] = useState("");
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
  const resourceGroups = board?.resourceGroups ?? [];
  const isAdministrator = board?.currentDeviceRole === "ADMIN";
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
    if (isAdministrator) void refreshDevices();
  }, [isAdministrator, refreshDevices, refreshHistory]);
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
      const result = await cloneEvent(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID), {
        commandId: crypto.randomUUID(),
        expectedSourceVersion: board?.event.version ?? 0,
        eventId: newEventId,
        name: newEventName,
        eventDate: newEventDate,
        aerodrome: newEventAerodrome,
        timeZone: board?.event.timeZone ?? "Europe/Berlin",
        restartMode,
      });
      window.localStorage.setItem("device-id:ADMIN", result.adminDeviceId);
      window.location.assign(`/admin?event=${encodeURIComponent(result.eventId)}`);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Veranstaltung konnte nicht angelegt werden.",
      );
    }
  }

  async function setEventLifecycle(status: "PREPARATION" | "ACTIVE" | "CLOSED" | "ARCHIVED") {
    if (!board || reason.trim().length < 3 || adminPin.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_EVENT_LIFECYCLE",
          payload: { status, reason: reason.trim(), adminPin },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(`Veranstaltungsstatus auf ${status} gesetzt und protokolliert.`);
      setAdminPin("");
      await refresh();
      await refreshEvents();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Statusänderung fehlgeschlagen.");
    }
  }

  async function pairDevice() {
    if (!board || deviceLabel.trim().length < 2 || adminPin.length < 4) return;
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
            adminPin,
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
      setAdminPin("");
      await refresh();
      await refreshDevices();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Gerätekopplung fehlgeschlagen.");
    }
  }

  async function saveEventParameters() {
    if (!board || !operationsEndAt || reason.trim().length < 3 || adminPin.length < 4) return;
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
            reason: reason.trim(),
            adminPin,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Veranstaltungsparameter wurden protokolliert aktualisiert.");
      setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Parameter konnten nicht gespeichert werden.",
      );
    }
  }

  function selectProductForEditing(id: string) {
    setProductEditorId(id);
    const entry = board?.products.find((product) => product.id === id);
    setProductName(entry?.name ?? "");
    setProductCode(entry?.code ?? "");
    setProductDescription(entry?.publicDescription ?? "");
    setProductResourceGroupId(entry?.resourceGroupId ?? resourceGroups[0]?.id ?? "");
    setProductGateId(entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "");
    setProductPriceCents(entry?.priceCents ?? 0);
    setProductReferenceCapacity(entry?.referenceCapacity ?? 1);
    setProductReferenceDuration(entry?.referenceDurationMinutes ?? 20);
    setProductChildCompanion(entry?.childCompanionRequired ?? false);
    setProductWeightClasses(entry?.weightClasses ?? ["NOT_CAPTURED"]);
    setProductSortOrder(entry?.sortOrder ?? 10);
  }

  function selectGateForEditing(id: string) {
    setGateEditorId(id);
    const entry = board?.gates.find((gate) => gate.id === id);
    setGateLabel(entry?.label ?? "");
    setGateType(entry?.gateType ?? "FLIGHT_LINE");
    setGateActive(entry?.active ?? true);
    setGateSortOrder(entry?.sortOrder ?? 10);
  }

  async function saveGate() {
    if (!board || gateLabel.trim().length < 2 || reason.trim().length < 3 || adminPin.length < 4)
      return;
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
            reason: reason.trim(),
            adminPin,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Gate-Stammdaten wurden protokolliert gespeichert.");
      setAdminPin("");
      setGateEditorId("new");
      setGateLabel("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Gate konnte nicht gespeichert werden.");
    }
  }

  async function saveProduct() {
    if (
      !board ||
      !productResourceGroupId ||
      !productGateId ||
      productWeightClasses.length === 0 ||
      reason.trim().length < 3 ||
      adminPin.length < 4
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
            referenceCapacity: productReferenceCapacity,
            referenceDurationMinutes: productReferenceDuration,
            childCompanionRequired: productChildCompanion,
            weightClasses: productWeightClasses as Array<
              "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
            >,
            sortOrder: productSortOrder,
            reason: reason.trim(),
            adminPin,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Produktstammdaten wurden protokolliert gespeichert.");
      setAdminPin("");
      selectProductForEditing("new");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Produkt konnte nicht gespeichert werden.",
      );
    }
  }

  function selectResourceForEditing(id: string) {
    setResourceEditorId(id);
    const entry = resourceGroups.find((group) => group.id === id);
    setResourceName(entry?.name ?? "");
    setResourceGateId(entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "");
    setResourceReferenceCapacity(entry?.referenceCapacity ?? 1);
    setResourcePlannedMinutes(entry?.plannedRotationMinutes ?? 30);
    setResourceCompatibleTypes(entry?.compatibleAircraftTypes.join(", ") ?? "");
  }

  function selectAircraftForEditing(id: string) {
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
      reason.trim().length < 3 ||
      adminPin.length < 4
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
          type: "UPSERT_RESOURCE_GROUP",
          payload: {
            resourceGroupId: resourceEditorId === "new" ? crypto.randomUUID() : resourceEditorId,
            name: resourceName.trim(),
            gateId: resourceGateId,
            referenceCapacity: resourceReferenceCapacity,
            plannedRotationMinutes: resourcePlannedMinutes,
            compatibleAircraftTypes: resourceCompatibleTypes
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
            reason: reason.trim(),
            adminPin,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Ressourcengruppe wurde protokolliert gespeichert.");
      setAdminPin("");
      selectResourceForEditing("new");
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
      reason.trim().length < 3 ||
      adminPin.length < 4
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
            reason: reason.trim(),
            adminPin,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Flugzeugstammdaten wurden protokolliert gespeichert.");
      setAdminPin("");
      selectAircraftForEditing("new");
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
      reason.trim().length < 3 ||
      adminPin.length < 4
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
            reason: reason.trim(),
            adminPin,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        "Flugzeugzuordnung wurde historisiert geändert; Queue und Prognose werden neu berechnet.",
      );
      setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugzuordnung konnte nicht geändert werden.",
      );
    }
  }

  async function revokeDevice(device: PairedDeviceSummary) {
    if (!board || reason.trim().length < 3 || adminPin.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "REVOKE_DEVICE",
          payload: { pairedDeviceId: device.id, adminPin, reason: reason.trim() },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Gerätekopplung wurde sofort widerrufen.");
      setAdminPin("");
      await refresh();
      await refreshDevices();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Widerruf fehlgeschlagen.");
    }
  }

  async function emergency(type: "TRIGGER_EMERGENCY" | "CLEAR_EMERGENCY") {
    if (!board || reason.trim().length < 3 || (type === "CLEAR_EMERGENCY" && adminPin.length < 4))
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
              payload: { reason: reason.trim(), adminPin },
            },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        type === "TRIGGER_EMERGENCY" ? "Notfallmodus ausgelöst." : "Notfallmodus aufgehoben.",
      );
      setReason("");
      setAdminPin("");
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
    if (!board || reason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_RESOURCE_GROUP_STATUS",
          payload: { resourceGroupId, status, reason: reason.trim(), expectedReviewAt: null },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(`Ressourcengruppe auf ${status} gesetzt.`);
      setReason("");
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
    if (!board || reason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_EVENT_INTERRUPTION",
          payload: { interrupted, reason: reason.trim(), expectedReviewAt: null },
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
    if (!board || reason.trim().length < 3 || adminPin.length < 4) return;
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
            reason: reason.trim(),
            adminPin,
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
    if (!board || reason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_AIRCRAFT_OPERATIONAL_STATE",
          payload: { aircraftId, state, reason: reason.trim(), expectedReviewAt: null },
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
    if (!board || reason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SCHEDULE_AIRCRAFT_REFUEL",
          payload: { aircraftId, planned, reason: reason.trim() },
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
    if (!board || reason.trim().length < 3 || adminPin.length < 4) return;
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
            reason: reason.trim(),
            adminPin,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Organisatorische Tank-Erinnerungsschwelle wurde aktualisiert.");
      setAdminPin("");
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
    if (!board || reason.trim().length < 3 || adminPin.length < 4) return;
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
            reason: reason.trim(),
            adminPin,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Anonymer operativer Pilotencode wurde aktualisiert.");
      setAdminPin("");
      setPilotNote("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Pilotencode konnte nicht geändert werden.",
      );
    }
  }

  async function setPilotPause(pilotId: string, paused: boolean) {
    if (!board || reason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_PILOT_PAUSE",
          payload: { pilotId, paused, reason: reason.trim(), expectedReviewAt: null },
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

  return (
    <Shell title="Administration">
      <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
      {setupRequired ? (
        <div className="connection-warning" role="status">
          Dieses System ist noch nicht eingerichtet. <a href="/setup">Ersteinrichtung öffnen</a>
        </div>
      ) : null}
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
      <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
      <OperationalNotice note={board?.event.operationalNote} />
      <section className="admin-workspace">
        <h1>Betriebssteuerung</h1>
        {board?.currentDeviceRole === "FLIGHT_DIRECTOR" ? (
          <div className="readonly-banner">Flugleitungsansicht · primär lesend</div>
        ) : null}
        {board ? (
          <section className="metrics-grid" aria-label="Betriebskennzahlen">
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
              <strong>{board.metrics.activePushSubscriptions}</strong>
              <span>Web-Push aktiv</span>
            </div>
          </section>
        ) : null}
        <label>
          Begründung
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Pflichtangabe"
          />
        </label>
        {isAdministrator ? (
          <section className="admin-section">
            <h2>Veranstaltungen und Vorlagen</h2>
            <p>
              Aktive Veranstaltung: <strong>{board?.event.name ?? EVENT_ID}</strong>. Ein Neustart
              legt eine neue Veranstaltung an. Der bisherige Stand bleibt für Audit, Berichte und
              Wiederherstellung unverändert erhalten.
            </p>
            <div className="event-lifecycle">
              <span>
                Betriebsphase: <strong>{board?.event.status ?? "–"}</strong>
              </span>
              <label>
                Administrator-PIN
                <input
                  type="password"
                  value={adminPin}
                  onChange={(event) => setAdminPin(event.target.value)}
                />
              </label>
              {board?.event.status === "PREPARATION" ? (
                <button
                  type="button"
                  disabled={reason.trim().length < 3 || adminPin.length < 4}
                  onClick={() => void setEventLifecycle("ACTIVE")}
                >
                  Veranstaltung aktivieren
                </button>
              ) : null}
              {board?.event.status === "ACTIVE" ? (
                <button
                  type="button"
                  disabled={reason.trim().length < 3 || adminPin.length < 4}
                  onClick={() => void setEventLifecycle("CLOSED")}
                >
                  Veranstaltung schließen
                </button>
              ) : null}
              {board?.event.status === "CLOSED" ? (
                <>
                  <button
                    type="button"
                    disabled={reason.trim().length < 3 || adminPin.length < 4}
                    onClick={() => void setEventLifecycle("ACTIVE")}
                  >
                    Erneut aktivieren
                  </button>
                  <button
                    type="button"
                    disabled={reason.trim().length < 3 || adminPin.length < 4}
                    onClick={() => void setEventLifecycle("ARCHIVED")}
                  >
                    Archivieren
                  </button>
                </>
              ) : null}
            </div>
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
                Neustart-Stufe
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
                Technische ID
                <input
                  value={newEventId}
                  onChange={(event) => setNewEventId(event.target.value)}
                  placeholder="rundflug-2027"
                />
              </label>
              <label>
                Bezeichnung
                <input
                  value={newEventName}
                  onChange={(event) => setNewEventName(event.target.value)}
                  placeholder="Flugtag 2027"
                />
              </label>
              <label>
                Datum
                <input
                  type="date"
                  value={newEventDate}
                  onChange={(event) => setNewEventDate(event.target.value)}
                />
              </label>
              <label>
                Flugplatz
                <input
                  value={newEventAerodrome}
                  onChange={(event) => setNewEventAerodrome(event.target.value)}
                  placeholder="EDXX"
                />
              </label>
              <label>
                Bestätigung
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
        ) : null}
        <section className="admin-section">
          <h2>Veranstaltungsparameter</h2>
          <div className="parameter-grid">
            <label>
              Verkaufsbeginn
              <input
                type="datetime-local"
                value={saleOpensAt}
                onChange={(event) => setSaleOpensAt(event.target.value)}
              />
            </label>
            <label>
              Betriebsende
              <input
                type="datetime-local"
                value={operationsEndAt}
                onChange={(event) => setOperationsEndAt(event.target.value)}
              />
            </label>
            <label>
              No-Show nach Minuten
              <input
                type="number"
                min="1"
                max="120"
                value={noShowAfterMinutes}
                onChange={(event) => setNoShowAfterMinutes(Number(event.target.value))}
              />
            </label>
            <label>
              Klärung Kasse nach Zurückstellungen
              <input
                type="number"
                min="1"
                max="10"
                value={maxTicketDeferrals}
                onChange={(event) => setMaxTicketDeferrals(Number(event.target.value))}
              />
            </label>
            <label>
              Benachrichtigungsvorlauf (Min.)
              <input
                type="number"
                min="1"
                max="240"
                value={notificationLeadMinutes}
                onChange={(event) => setNotificationLeadMinutes(Number(event.target.value))}
              />
            </label>
            <label>
              Referenzgewicht Kind (kg)
              <input
                type="number"
                min="1"
                max="300"
                value={childReferenceWeightKg}
                onChange={(event) => setChildReferenceWeightKg(Number(event.target.value))}
              />
            </label>
            <label>
              Referenzgewicht Normal (kg)
              <input
                type="number"
                min="1"
                max="300"
                value={normalReferenceWeightKg}
                onChange={(event) => setNormalReferenceWeightKg(Number(event.target.value))}
              />
            </label>
            <label>
              Referenzgewicht Schwer (kg)
              <input
                type="number"
                min="1"
                max="300"
                value={heavyReferenceWeightKg}
                onChange={(event) => setHeavyReferenceWeightKg(Number(event.target.value))}
              />
            </label>
            <label>
              Plan Boarding (Min.)
              <input
                type="number"
                min="1"
                max="120"
                value={plannedBoardingMinutes}
                onChange={(event) => setPlannedBoardingMinutes(Number(event.target.value))}
              />
            </label>
            <label>
              Plan Ausstieg (Min.)
              <input
                type="number"
                min="1"
                max="120"
                value={plannedDeboardingMinutes}
                onChange={(event) => setPlannedDeboardingMinutes(Number(event.target.value))}
              />
            </label>
            <label>
              Plan Puffer (Min.)
              <input
                type="number"
                min="0"
                max="120"
                value={plannedBufferMinutes}
                onChange={(event) => setPlannedBufferMinutes(Number(event.target.value))}
              />
            </label>
            <label>
              Administrator-PIN
              <input
                type="password"
                value={adminPin}
                onChange={(event) => setAdminPin(event.target.value)}
              />
            </label>
          </div>
          <button
            disabled={
              !isAdministrator ||
              !operationsEndAt ||
              reason.trim().length < 3 ||
              adminPin.length < 4
            }
            onClick={saveEventParameters}
            type="button"
          >
            Veranstaltungsparameter speichern
          </button>
        </section>
        <section className="admin-section">
          <h2>Gates und Produktstammdaten</h2>
          <div className="master-data-columns">
            <fieldset>
              <legend>Gate</legend>
              <label>
                Datensatz
                <select
                  value={gateEditorId}
                  onChange={(event) => selectGateForEditing(event.target.value)}
                >
                  <option value="new">Neues Gate</option>
                  {board?.gates.map((gate) => (
                    <option key={gate.id} value={gate.id}>
                      {gate.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bezeichnung
                <input value={gateLabel} onChange={(event) => setGateLabel(event.target.value)} />
              </label>
              <label>
                Art
                <select
                  value={gateType}
                  onChange={(event) => setGateType(event.target.value as typeof gateType)}
                >
                  <option value="FLIGHT_LINE">Flight Line</option>
                  <option value="BOARDING">Boarding</option>
                  <option value="DISPLAY_ONLY">Nur Anzeige</option>
                </select>
              </label>
              <label>
                Sortierung
                <input
                  type="number"
                  min="0"
                  value={gateSortOrder}
                  onChange={(event) => setGateSortOrder(Number(event.target.value))}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={gateActive}
                  onChange={(event) => setGateActive(event.target.checked)}
                />{" "}
                aktiv
              </label>
              <button
                disabled={
                  !isAdministrator ||
                  gateLabel.trim().length < 2 ||
                  reason.trim().length < 3 ||
                  adminPin.length < 4
                }
                onClick={saveGate}
                type="button"
              >
                Gate speichern
              </button>
            </fieldset>
            <fieldset>
              <legend>Produkt</legend>
              <label>
                Datensatz
                <select
                  value={productEditorId}
                  onChange={(event) => selectProductForEditing(event.target.value)}
                >
                  <option value="new">Neues Produkt</option>
                  {board?.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.code} · {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="parameter-grid">
                <label>
                  Bezeichnung
                  <input
                    value={productName}
                    onChange={(event) => setProductName(event.target.value)}
                  />
                </label>
                <label>
                  Kürzel
                  <input
                    value={productCode}
                    maxLength={12}
                    onChange={(event) => setProductCode(event.target.value.toUpperCase())}
                  />
                </label>
                <label>
                  Preis (Cent)
                  <input
                    type="number"
                    min="0"
                    value={productPriceCents}
                    onChange={(event) => setProductPriceCents(Number(event.target.value))}
                  />
                </label>
                <label>
                  Ressourcengruppe
                  <select
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
                </label>
                <label>
                  Gate
                  <select
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
                </label>
                <label>
                  Referenzplätze
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={productReferenceCapacity}
                    onChange={(event) => setProductReferenceCapacity(Number(event.target.value))}
                  />
                </label>
                <label>
                  Flugdauer (Min.)
                  <input
                    type="number"
                    min="1"
                    max="600"
                    value={productReferenceDuration}
                    onChange={(event) => setProductReferenceDuration(Number(event.target.value))}
                  />
                </label>
                <label>
                  Sortierung
                  <input
                    type="number"
                    min="0"
                    value={productSortOrder}
                    onChange={(event) => setProductSortOrder(Number(event.target.value))}
                  />
                </label>
              </div>
              <label>
                Öffentliche Beschreibung
                <input
                  value={productDescription}
                  maxLength={240}
                  onChange={(event) => setProductDescription(event.target.value)}
                />
              </label>
              <div className="weight-class-options">
                {(["NOT_CAPTURED", "CHILD", "NORMAL", "HEAVY", "INDIVIDUAL"] as const).map(
                  (weightClass) => (
                    <label key={weightClass}>
                      <input
                        type="checkbox"
                        checked={productWeightClasses.includes(weightClass)}
                        onChange={(event) =>
                          setProductWeightClasses((current) =>
                            event.target.checked
                              ? [...new Set([...current, weightClass])]
                              : current.filter((entry) => entry !== weightClass),
                          )
                        }
                      />
                      {weightClass}
                    </label>
                  ),
                )}
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={productChildCompanion}
                  onChange={(event) => setProductChildCompanion(event.target.checked)}
                />{" "}
                Begleitpflicht für Kinder
              </label>
              <label>
                Administrator-PIN
                <input
                  type="password"
                  value={adminPin}
                  onChange={(event) => setAdminPin(event.target.value)}
                />
              </label>
              <button
                disabled={
                  !isAdministrator ||
                  productName.trim().length < 2 ||
                  !/^[A-Z0-9-]{2,12}$/.test(productCode) ||
                  !productResourceGroupId ||
                  !productGateId ||
                  productWeightClasses.length === 0 ||
                  reason.trim().length < 3 ||
                  adminPin.length < 4
                }
                onClick={saveProduct}
                type="button"
              >
                Produkt speichern
              </button>
            </fieldset>
          </div>
        </section>
        <section className="admin-section">
          <h2>Ressourcen und Flugzeugzuordnung</h2>
          <div className="resource-master-grid">
            <fieldset>
              <legend>Ressourcengruppe</legend>
              <label>
                Datensatz
                <select
                  value={resourceEditorId}
                  onChange={(event) => selectResourceForEditing(event.target.value)}
                >
                  <option value="new">Neue Ressourcengruppe</option>
                  {resourceGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bezeichnung
                <input
                  value={resourceName}
                  onChange={(event) => setResourceName(event.target.value)}
                />
              </label>
              <label>
                Gate
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
                Referenzkapazität
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={resourceReferenceCapacity}
                  onChange={(event) => setResourceReferenceCapacity(Number(event.target.value))}
                />
              </label>
              <label>
                Plan-Umlaufzeit (Min.)
                <input
                  type="number"
                  min="1"
                  max="600"
                  value={resourcePlannedMinutes}
                  onChange={(event) => setResourcePlannedMinutes(Number(event.target.value))}
                />
              </label>
              <label>
                Kompatible Typen (kommagetrennt)
                <input
                  value={resourceCompatibleTypes}
                  onChange={(event) => setResourceCompatibleTypes(event.target.value)}
                  placeholder="leer = alle Typen"
                />
              </label>
              <button
                disabled={
                  !isAdministrator ||
                  resourceName.trim().length < 2 ||
                  !resourceGateId ||
                  reason.trim().length < 3 ||
                  adminPin.length < 4
                }
                onClick={saveResourceGroup}
                type="button"
              >
                Ressourcengruppe speichern
              </button>
            </fieldset>
            <fieldset>
              <legend>Flugzeug</legend>
              <label>
                Datensatz
                <select
                  value={aircraftEditorId}
                  onChange={(event) => selectAircraftForEditing(event.target.value)}
                >
                  <option value="new">Neues Flugzeug</option>
                  {board?.aircraft.map((aircraft) => (
                    <option key={aircraft.id} value={aircraft.id}>
                      {aircraft.registration}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kennzeichen
                <input
                  value={aircraftRegistration}
                  maxLength={16}
                  onChange={(event) => setAircraftRegistration(event.target.value.toUpperCase())}
                />
              </label>
              <label>
                Flugzeugtyp
                <input
                  value={aircraftType}
                  onChange={(event) => setAircraftType(event.target.value)}
                />
              </label>
              <label>
                Passagierplätze
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={aircraftSeats}
                  onChange={(event) => setAircraftSeats(Number(event.target.value))}
                />
              </label>
              <label>
                Max. Passagierzuladung (kg, optional)
                <input
                  type="number"
                  min="1"
                  value={aircraftMaximumPayload}
                  onChange={(event) => setAircraftMaximumPayload(event.target.value)}
                />
              </label>
              <button
                disabled={
                  !isAdministrator ||
                  aircraftRegistration.trim().length < 3 ||
                  aircraftType.trim().length < 2 ||
                  reason.trim().length < 3 ||
                  adminPin.length < 4
                }
                onClick={saveAircraft}
                type="button"
              >
                Flugzeug speichern
              </button>
            </fieldset>
            <fieldset>
              <legend>Historisierte Zuordnung</legend>
              <label>
                Flugzeug
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
                Neue Ressourcengruppe
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
              <label>
                Administrator-PIN
                <input
                  type="password"
                  value={adminPin}
                  onChange={(event) => setAdminPin(event.target.value)}
                />
              </label>
              <button
                disabled={
                  !isAdministrator ||
                  !assignmentAircraftId ||
                  !assignmentResourceGroupId ||
                  reason.trim().length < 3 ||
                  adminPin.length < 4
                }
                onClick={assignAircraft}
                type="button"
              >
                Zuordnung ändern
              </button>
            </fieldset>
          </div>
        </section>
        <section className="admin-section">
          <h2>Notfallmodus</h2>
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
            <>
              <label>
                Administrator-PIN
                <input
                  type="password"
                  value={adminPin}
                  onChange={(event) => setAdminPin(event.target.value)}
                />
              </label>
              <button
                className="danger-action"
                disabled={!isAdministrator || reason.trim().length < 3 || adminPin.length < 4}
                onClick={() => emergency("CLEAR_EMERGENCY")}
                type="button"
              >
                Notfallmodus aufheben
              </button>
            </>
          )}
        </section>
        <section className="admin-section">
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
            {board && board.metrics.activeRotations === 0 ? <p>Keine laufenden Umläufe.</p> : null}
          </div>
        </section>
        <section className="admin-section">
          <h2>Betriebs- und Wetterhinweise</h2>
          <label>
            Organisatorischer Hinweis
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
            disabled={reason.trim().length < 3}
            onClick={() => setEventInterruption(!(board?.event.operationalInterrupted ?? false))}
            type="button"
          >
            {board?.event.operationalInterrupted
              ? "Veranstaltungsbetrieb fortsetzen"
              : "Veranstaltungsbetrieb unterbrechen"}
          </button>
          <p>Hinweise stoppen keinen Flugbetrieb. Unterbrechungen werden separat gesetzt.</p>
        </section>
        <section className="admin-section">
          <h2>Kapazität und Verkaufsempfehlung</h2>
          <label>
            Neuer harter Verkaufsschluss
            <input
              type="datetime-local"
              value={saleClosesAt}
              onChange={(event) => setSaleClosesAt(event.target.value)}
            />
          </label>
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
                  <span>Prognose {product.predictionQuality}</span>
                </div>
                <div className="secondary-actions">
                  <button
                    disabled={!isAdministrator || reason.trim().length < 3 || adminPin.length < 4}
                    onClick={() => configureProductSales(product, !product.saleEnabled)}
                    type="button"
                  >
                    {product.saleEnabled ? "Verkauf sperren" : "Verkauf freigeben"}
                  </button>
                  <button
                    disabled={
                      !isAdministrator ||
                      reason.trim().length < 3 ||
                      adminPin.length < 4 ||
                      !saleClosesAt
                    }
                    onClick={() => configureProductSales(product, product.saleEnabled, true)}
                    type="button"
                  >
                    Verkaufsschluss setzen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="admin-section">
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
                    {aircraft.rotationsSinceRefuel}/{aircraft.refuelReminderThreshold} Umläufe seit
                    Tanken
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
                      ) || reason.trim().length < 3
                    }
                    onClick={() => setAircraftState(aircraft.id, "AVAILABLE")}
                    type="button"
                  >
                    Verfügbar
                  </button>
                  <button
                    disabled={aircraft.operationalState !== "AVAILABLE" || reason.trim().length < 3}
                    onClick={() => setAircraftState(aircraft.id, "PAUSED")}
                    type="button"
                  >
                    Pause
                  </button>
                  <button
                    disabled={aircraft.operationalState !== "AVAILABLE" || reason.trim().length < 3}
                    onClick={() => setAircraftState(aircraft.id, "REFUELING")}
                    type="button"
                  >
                    Tanken aktuell
                  </button>
                  <button
                    disabled={aircraft.operationalState !== "AVAILABLE" || reason.trim().length < 3}
                    onClick={() => setAircraftState(aircraft.id, "INACTIVE")}
                    type="button"
                  >
                    Inaktiv
                  </button>
                  <button
                    disabled={aircraft.operationalState !== "AVAILABLE" || reason.trim().length < 3}
                    onClick={() => setAircraftState(aircraft.id, "INTERRUPTED")}
                    type="button"
                  >
                    Unterbrechen
                  </button>
                  <button
                    disabled={reason.trim().length < 3}
                    onClick={() => scheduleRefuel(aircraft.id, !aircraft.refuelPlanned)}
                    type="button"
                  >
                    {aircraft.refuelPlanned ? "Vormerkung aufheben" : "Tanken vormerken"}
                  </button>
                  <button
                    disabled={!isAdministrator || reason.trim().length < 3 || adminPin.length < 4}
                    onClick={() => configureRefuelThreshold(aircraft.id)}
                    type="button"
                  >
                    Schwelle {refuelThreshold} setzen
                  </button>
                </div>
              </div>
            ))}
          </div>
          <label className="threshold-input">
            Umläufe bis Tank-Erinnerung
            <input
              type="number"
              min={1}
              max={100}
              value={refuelThreshold}
              onChange={(event) => setRefuelThreshold(Number(event.target.value))}
            />
          </label>
          <h3>Anonyme Pilotencodes</h3>
          <div className="pilot-controls">
            <input
              value={pilotCode}
              onChange={(event) => setPilotCode(event.target.value.toUpperCase())}
              aria-label="Neuer operativer Pilotencode"
            />
            <input
              value={pilotNote}
              onChange={(event) => setPilotNote(event.target.value)}
              aria-label="Organisatorische Pilotencode-Bemerkung"
              placeholder="Optional · keine Namen oder Lizenzdaten"
            />
            <button
              disabled={
                !isAdministrator ||
                !/^[A-Z0-9-]{2,12}$/.test(pilotCode) ||
                reason.trim().length < 3 ||
                adminPin.length < 4
              }
              onClick={() => upsertPilot(crypto.randomUUID(), pilotCode, pilotNote, true)}
              type="button"
            >
              Pilotencode anlegen
            </button>
          </div>
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
                  disabled={!pilot.active || reason.trim().length < 3}
                  onClick={() => setPilotPause(pilot.id, !pilot.paused)}
                  type="button"
                >
                  {pilot.paused ? "Pause beenden" : "Pause starten"}
                </button>
                <button
                  disabled={!isAdministrator || reason.trim().length < 3 || adminPin.length < 4}
                  onClick={() =>
                    upsertPilot(
                      pilot.id,
                      pilot.operationalCode,
                      pilot.operationalNote,
                      !pilot.active,
                    )
                  }
                  type="button"
                >
                  {pilot.active ? "Deaktivieren" : "Aktivieren"}
                </button>
              </div>
            ))}
          </div>
        </section>
        <section className="admin-section">
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
        <section className="admin-section">
          <h2>Geräte ohne Helferkonten</h2>
          <div className="device-pairing-form">
            <label>
              Technische Gerätebezeichnung
              <input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} />
            </label>
            <label>
              Feste Rolle
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
            <label>
              Administrator-PIN
              <input
                type="password"
                value={adminPin}
                onChange={(event) => setAdminPin(event.target.value)}
              />
            </label>
            <button
              disabled={!isAdministrator || deviceLabel.trim().length < 2 || adminPin.length < 4}
              onClick={pairDevice}
              type="button"
            >
              QR-Kopplung erzeugen
            </button>
          </div>
          {pairingQr && pairingUrl ? (
            <div className="pairing-qr">
              <img src={pairingQr} alt="QR-Code zur einmaligen Gerätekopplung" />
              <p>
                Nur mit dem vorgesehenen Gerät scannen. Der QR-Code enthält dessen Zugangsschlüssel.
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
                <span>{device.active ? (device.online ? "online" : "offline") : "widerrufen"}</span>
                <time dateTime={device.lastSeenAt}>
                  zuletzt{" "}
                  {new Date(device.lastSeenAt).toLocaleString("de-DE", {
                    timeZone: board?.event.timeZone ?? "Europe/Berlin",
                  })}
                </time>
                {device.active ? (
                  <button
                    disabled={!isAdministrator || reason.trim().length < 3 || adminPin.length < 4}
                    onClick={() => revokeDevice(device)}
                    type="button"
                  >
                    Widerrufen
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        <section className="admin-section">
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
          <fieldset className="history-filters">
            <legend>Audit-Historie filtern</legend>
            <label>
              Ereignistyp
              <input
                value={historyEventType}
                onChange={(event) => setHistoryEventType(event.target.value)}
                placeholder="z. B. TICKETS_SOLD"
              />
            </label>
            <label>
              Bezugsart
              <input
                value={historyAggregateType}
                onChange={(event) => setHistoryAggregateType(event.target.value)}
                placeholder="z. B. ROTATION"
              />
            </label>
            <label>
              Bezugs-ID
              <input
                value={historyAggregateId}
                onChange={(event) => setHistoryAggregateId(event.target.value)}
                placeholder="interne ID"
              />
            </label>
            <label>
              Von
              <input
                type="datetime-local"
                value={historySince}
                onChange={(event) => setHistorySince(event.target.value)}
              />
            </label>
            <label>
              Bis
              <input
                type="datetime-local"
                value={historyUntil}
                onChange={(event) => setHistoryUntil(event.target.value)}
              />
            </label>
            <button onClick={refreshHistory} type="button">
              Filter anwenden
            </button>
          </fieldset>
          <div className="audit-list">
            {history.entries.slice(0, 20).map((entry) => (
              <div key={entry.sequence}>
                <time dateTime={entry.occurredAt}>
                  {new Date(entry.occurredAt).toLocaleTimeString("de-DE", {
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
        </section>
        {message ? (
          <div className="action-message" role="status">
            {message}
          </div>
        ) : null}
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
