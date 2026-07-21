import type {
  OperationBoard,
  TicketGroupOperationalStatus,
  TicketGroupPrintData,
  TicketSearchResult,
} from "@rundflug/contracts";
import {
  AlertTriangle,
  CircleUserRound,
  Maximize2,
  Minus,
  Plane,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTicketGroupPrintData, searchTickets, sendCommand } from "./api";
import { AppShell as Shell } from "./app/AppShell";
import { PageNotice, useActionMessageBridge } from "./app/PageNotifications";
import {
  Button,
  ConfirmationDialog,
  DataTable,
  IconButton,
  PageHeader,
  Panel,
  StatusPill,
  Tabs,
  TextField,
} from "./design-system/components";
import {
  appendCashierDraftRevision,
  cashierDraftQueueKey,
  latestCashierDraft,
  readCashierDraftQueue,
  writeCashierDraftQueue,
} from "./offline-drafts";
import {
  CASHIER_DEVICE_ID,
  ConnectionNotice,
  createTicketCode,
  deviceTokenFor,
  EmergencyNotice,
  EVENT_ID,
  InterruptionNotice,
  OperationalNotice,
  type TicketReceipt,
  useOperationBoard,
} from "./operation-workspace";
import { oversizeSplitPreview } from "./operational-exceptions";
import { useConnectivity } from "./shared/hooks/use-connectivity";

const ticketGroupStatusLabel: Record<TicketGroupOperationalStatus, string> = {
  QUEUED: "Wartet",
  PRESENT: "Anwesend",
  CALLED: "Aufgerufen",
  BOARDING: "Boarding",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
  NO_SHOW: "Nicht erschienen",
  CANCELED: "Storniert",
  CLARIFICATION: "Klärung erforderlich",
  MISSING: "Nicht da",
};

function TicketPaper({ compact = false, ticket }: { compact?: boolean; ticket: TicketReceipt }) {
  return (
    <article className={compact ? "ticket-paper ticket-paper-preview" : "ticket-paper"}>
      <strong>Rundflug-Leitstand</strong>
      <small>{ticket.eventName}</small>
      <b>{ticket.code}</b>
      <img src={ticket.qrDataUrl} alt={`QR-Ticket ${ticket.code}`} />
      <dl>
        <div>
          <dt>Gruppe:</dt>
          <dd>{ticket.communicationLabel}</dd>
        </div>
        <div>
          <dt>Ticket:</dt>
          <dd>
            {ticket.position} von {ticket.groupSize}
          </dd>
        </div>
        <div>
          <dt>Produkt:</dt>
          <dd>{ticket.productName}</dd>
        </div>
        <div>
          <dt>Eingang:</dt>
          <dd>{ticket.gateLabel}</dd>
        </div>
      </dl>
      <small>QR-Code für aktuellen Status scannen</small>
    </article>
  );
}

function QrScanDialog({
  onClose,
  open,
  ticket,
}: {
  onClose: () => void;
  open: boolean;
  ticket: TicketReceipt | undefined;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    let focusFrame: number | null = null;
    if (open && !dialog.open) {
      dialog.showModal();
      focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
    return () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
    };
  }, [open]);

  return (
    <dialog
      aria-labelledby="qr-scan-dialog-title"
      aria-describedby="qr-scan-dialog-description"
      className="qr-scan-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      {ticket ? (
        <div className="qr-scan-dialog-content">
          <header>
            <div>
              <span id="qr-scan-dialog-title">QR-Ticket scannen</span>
              <strong>{ticket.code}</strong>
            </div>
            <button
              aria-label="QR-Ticket schließen"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              <X aria-hidden="true" size={22} />
            </button>
          </header>
          <img src={ticket.qrDataUrl} alt={`QR-Ticket ${ticket.code} in Großansicht`} />
          <p id="qr-scan-dialog-description">
            Ticket {ticket.position} von {ticket.groupSize} · {ticket.productName}
          </p>
        </div>
      ) : null}
    </dialog>
  );
}

export function CashierView() {
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
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TicketReceipt[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);
  const [lastTicketGroupId, setLastTicketGroupId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketSearchQuery, setTicketSearchQuery] = useState("");
  const [ticketSearchResults, setTicketSearchResults] = useState<TicketSearchResult[]>([]);
  const [ticketListTab, setTicketListTab] = useState<"ACTIVE" | "CANCELED">("ACTIVE");
  const [ticketListNextCursor, setTicketListNextCursor] = useState<string | null>(null);
  const [ticketListLoading, setTicketListLoading] = useState(false);
  const [selectedReceiptIndex, setSelectedReceiptIndex] = useState(0);
  const [qrScanOpen, setQrScanOpen] = useState(false);
  const ticketListRequestRef = useRef(0);
  const ticketListSentinelRef = useRef<HTMLDivElement | null>(null);
  const printDocumentRef = useRef<HTMLDivElement | null>(null);
  const ticketListResultCountRef = useRef(0);
  const ticketListNextCursorRef = useRef<string | null>(null);
  const lastTicketListBoardVersionRef = useRef<number | null>(null);
  const selectedTicketGroup = ticketSearchResults.find(
    (entry) => entry.ticketGroupId === lastTicketGroupId,
  );
  const visibleTicketGroups = ticketSearchResults.filter((entry) =>
    ticketListTab === "CANCELED"
      ? entry.groupStatus === "CANCELED"
      : entry.groupStatus !== "CANCELED",
  );
  const currency = (cents: number) =>
    (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  async function printableTickets(data: TicketGroupPrintData): Promise<TicketReceipt[]> {
    return Promise.all(
      data.tickets.map(async (ticket) => {
        const statusUrl = `${window.location.origin}/ticket/${encodeURIComponent(ticket.code)}`;
        return {
          code: ticket.code,
          statusUrl,
          qrDataUrl: await QRCode.toDataURL(statusUrl, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 768,
          }),
          eventName: data.eventName,
          productName: data.productName,
          gateLabel: data.gateLabel,
          communicationLabel: data.communicationLabel,
          position: ticket.position,
          groupSize: data.tickets.length,
        };
      }),
    );
  }

  const loadTicketList = useCallback(
    async ({
      append = false,
      preserveLoaded = false,
      status = ticketListTab,
      query = ticketSearchQuery,
    }: {
      append?: boolean;
      preserveLoaded?: boolean;
      status?: "ACTIVE" | "CANCELED";
      query?: string;
    } = {}) => {
      if (!serverConfirmed) return;
      const requestId = ++ticketListRequestRef.current;
      setTicketListLoading(true);
      try {
        const response = await searchTickets(
          EVENT_ID,
          CASHIER_DEVICE_ID,
          deviceTokenFor(CASHIER_DEVICE_ID),
          {
            q: query,
            status,
            limit: preserveLoaded
              ? Math.min(Math.max(ticketListResultCountRef.current, 20), 50)
              : 20,
            ...(append && ticketListNextCursorRef.current
              ? { cursor: ticketListNextCursorRef.current }
              : {}),
          },
        );
        if (requestId !== ticketListRequestRef.current) return;
        setTicketSearchResults((current) => {
          let nextResults: TicketSearchResult[];
          if (append) {
            const known = new Set(current.map((entry) => entry.ticketGroupId));
            nextResults = [
              ...current,
              ...response.results.filter((entry) => !known.has(entry.ticketGroupId)),
            ];
          } else if (!preserveLoaded) {
            nextResults = response.results;
          } else {
            const updatedIds = new Set(response.results.map((entry) => entry.ticketGroupId));
            const matchingStatus = (entry: TicketSearchResult) =>
              status === "CANCELED"
                ? entry.groupStatus === "CANCELED"
                : entry.groupStatus !== "CANCELED";
            nextResults = [
              ...response.results,
              ...current.filter(
                (entry) => !updatedIds.has(entry.ticketGroupId) && matchingStatus(entry),
              ),
            ];
          }
          ticketListResultCountRef.current = nextResults.length;
          return nextResults;
        });
        ticketListNextCursorRef.current = response.nextCursor;
        setTicketListNextCursor(response.nextCursor);
        const firstResult = response.results[0];
        if (!append && firstResult) {
          setLastTicketGroupId((current) => current ?? firstResult.ticketGroupId);
        }
      } catch (reason) {
        if (requestId === ticketListRequestRef.current) {
          setMessage(reason instanceof Error ? reason.message : "Ticketliste nicht verfügbar.");
        }
      } finally {
        if (requestId === ticketListRequestRef.current) setTicketListLoading(false);
      }
    },
    [serverConfirmed, ticketListTab, ticketSearchQuery],
  );

  async function reopenTicketGroup(ticketGroupId: string): Promise<boolean> {
    try {
      const data = await getTicketGroupPrintData(
        EVENT_ID,
        ticketGroupId,
        CASHIER_DEVICE_ID,
        deviceTokenFor(CASHIER_DEVICE_ID),
      );
      const prepared = await printableTickets(data);
      if (prepared.length === 0) throw new Error("Ticketdokument enthält keine Tickets.");
      setReceipt(prepared);
      setSelectedReceiptIndex(0);
      return true;
    } catch (reason) {
      setReceipt([]);
      setMessage(
        reason instanceof Error ? reason.message : "Ticketzettel konnten nicht geladen werden.",
      );
      return false;
    }
  }
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
    if (!serverConfirmed) return;
    void loadTicketList();
  }, [loadTicketList, serverConfirmed]);
  useEffect(() => {
    const boardVersion = board?.event.version ?? null;
    if (boardVersion === null) return;
    if (lastTicketListBoardVersionRef.current === null) {
      lastTicketListBoardVersionRef.current = boardVersion;
      return;
    }
    if (lastTicketListBoardVersionRef.current === boardVersion) return;
    lastTicketListBoardVersionRef.current = boardVersion;
    void loadTicketList({ preserveLoaded: true });
  }, [board?.event.version, loadTicketList]);
  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") void loadTicketList({ preserveLoaded: true });
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [loadTicketList]);
  useEffect(() => {
    const sentinel = ticketListSentinelRef.current;
    if (!sentinel || !ticketListNextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !ticketListLoading) {
          void loadTicketList({ append: true });
        }
      },
      { root: sentinel.parentElement, rootMargin: "120px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadTicketList, ticketListLoading, ticketListNextCursor]);

  async function sell(saleProduct: OperationBoard["products"][number]) {
    if (!board || busyProductId) return;
    const saleSplitPreview = oversizeSplitPreview(size, saleProduct.referenceCapacity);
    const codes = Array.from({ length: size }, createTicketCode);
    setProductId(saleProduct.id);
    setBusyProductId(saleProduct.id);
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
            productId: saleProduct.id,
            publicTicketCodes: codes,
            standby: false,
            paymentStatus: "INFORMATIONAL_ONLY",
            paymentMethod: null,
            oversizeSplitAcknowledged: saleSplitPreview.required,
          },
        },
        deviceTokenFor(CASHIER_DEVICE_ID),
      );
      const soldTicketGroupId = saleResult.aggregate?.id ?? null;
      const printPrepared = soldTicketGroupId ? await reopenTicketGroup(soldTicketGroupId) : false;
      setLastTicketGroupId(soldTicketGroupId);
      setMessage(
        `${codes.length} Ticket${codes.length === 1 ? "" : "s"} verkauft.${
          printPrepared ? "" : " Druckvorbereitung fehlgeschlagen; Nachdruck bleibt möglich."
        }`,
      );
      writeCashierDraftQueue(localStorage, draftQueueKey, []);
      setPendingDraftCount(0);
      setSize(1);
      await Promise.all([refresh(), loadTicketList({ preserveLoaded: true })]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Verkauf fehlgeschlagen.");
    } finally {
      setBusyProductId(null);
    }
  }

  async function cancelLastSale() {
    if (!board || !lastTicketGroupId || cancelReason.trim().length < 3 || cancelBusy) return;
    setCancelBusy(true);
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
            adminPin: "SESSION",
          },
        },
        deviceTokenFor(CASHIER_DEVICE_ID),
      );
      setMessage("Verkauf storniert und Kapazität freigegeben.");
      setReceipt([]);
      setCancelReason("");
      setCancelDialogOpen(false);
      setTicketListTab("CANCELED");
      await Promise.all([
        refresh(),
        loadTicketList({ status: "CANCELED", query: ticketSearchQuery }),
      ]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Storno fehlgeschlagen.");
    } finally {
      setCancelBusy(false);
    }
  }

  async function runTicketSearch() {
    const query = ticketSearch.trim();
    if (query.length === 1) {
      setMessage("Für die Suche mindestens zwei Zeichen eingeben.");
      return;
    }
    setTicketSearchQuery(query);
    await loadTicketList({ query });
  }

  function selectSearchResult(result: TicketSearchResult) {
    setLastTicketGroupId(result.ticketGroupId);
    setReceipt([]);
    setMessage(
      `${result.productName} · ${result.groupSize} Ticket${result.groupSize === 1 ? "" : "s"} ausgewählt.`,
    );
  }

  async function printTicketDocument() {
    if (receipt.length === 0 || selectedTicketGroup?.groupStatus === "CANCELED") {
      setMessage("Für diese Buchungsgruppe steht kein druckbares Ticketdokument bereit.");
      return;
    }
    const documentRoot = printDocumentRef.current;
    if (!documentRoot) {
      setMessage("Ticketdokument konnte nicht vorbereitet werden.");
      return;
    }
    try {
      const images = Array.from(documentRoot.querySelectorAll("img"));
      if (images.length !== receipt.length)
        throw new Error("QR-Codes sind noch nicht vollständig.");
      await Promise.all(
        images.map(async (image) => {
          if (!image.complete) {
            await new Promise<void>((resolve, reject) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => reject(new Error("QR-Code fehlt.")), {
                once: true,
              });
            });
          }
          if (image.naturalWidth === 0) throw new Error("QR-Code konnte nicht dargestellt werden.");
          await image.decode?.();
        }),
      );
      window.print();
      setMessage("Druckdialog geöffnet. Der Verkauf bleibt unabhängig vom Ausdruck gültig.");
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Ticketdokument konnte nicht gedruckt werden.",
      );
    }
  }

  return (
    <Shell
      className="cashier-shell"
      title="Kasse"
      notifications={
        <>
          <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
          {pendingDraftCount > 0 ? (
            <PageNotice
              noticeKey={`cashier-draft:${serverConfirmed ? "restored" : "local"}:${pendingDraftCount}`}
              tone="warning"
            >
              {serverConfirmed
                ? "Offline-Entwurf wiederhergestellt · aktuellen Stand prüfen und Verkauf bewusst bestätigen."
                : "Entwurf lokal gespeichert · noch nicht bestätigt · ohne operative Wirkung."}
            </PageNotice>
          ) : null}
          <EmergencyNotice active={board?.event.emergencyMode ?? false} />
          <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
          <OperationalNotice note={board?.event.operationalNote} />
        </>
      }
    >
      <section className="cashier-v15-workspace">
        <Panel className="cashier-sale-panel" aria-labelledby="cashier-sale-title">
          <div className="cashier-sale-heading">
            <PageHeader level={1} title="Tickets verkaufen" />
            <div className="cashier-group-size">
              <span className="cashier-field-label">Gruppengröße</span>
              <div className="cashier-stepper">
                <IconButton
                  aria-label="Gruppengröße verringern"
                  label="Gruppengröße verringern"
                  onClick={() => setSize((value) => Math.max(1, value - 1))}
                  type="button"
                >
                  <Minus aria-hidden="true" size={18} />
                </IconButton>
                <output aria-live="polite">{size}</output>
                <IconButton
                  aria-label="Gruppengröße erhöhen"
                  label="Gruppengröße erhöhen"
                  onClick={() => setSize((value) => Math.min(12, value + 1))}
                  type="button"
                >
                  <Plus aria-hidden="true" size={18} />
                </IconButton>
              </div>
            </div>
          </div>
          <div className="cashier-products">
            {board?.products.map((entry) => {
              const entrySplitPreview = oversizeSplitPreview(size, entry.referenceCapacity);
              const splitDescriptionId = `cashier-split-${entry.id}`;
              const saleDisabled =
                !serverConfirmed ||
                !board ||
                !entry.saleEnabled ||
                entry.resourceGroupStatus !== "ACTIVE" ||
                !entry.saleRecommended ||
                entry.remainingSellableSeats < size ||
                board.event.emergencyMode ||
                board.event.operationalInterrupted ||
                busyProductId !== null;
              return (
                <article className="cashier-product" key={entry.id}>
                  <div className="cashier-product-row">
                    <Plane aria-hidden="true" />
                    <span className="cashier-product-name">
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.publicDescription ||
                          `Flugzeit ca. ${entry.promisedFlightMinutes} Min.`}
                      </small>
                    </span>
                    <span className="cashier-product-metric">
                      <small>Wartezeit</small>
                      <strong>
                        {entry.estimatedWaitLowerMinutes}–{entry.estimatedWaitUpperMinutes} Min.
                      </strong>
                    </span>
                    <span className="cashier-product-metric">
                      <small>Kapazität</small>
                      <strong>
                        {entry.remainingSellableSeats}/{entry.projectedSeats}
                      </strong>
                    </span>
                    <span className="cashier-product-price">
                      <small>Preis / Person</small>
                      <strong>{currency(entry.priceCents)}</strong>
                    </span>
                    <Button
                      aria-describedby={splitDescriptionId}
                      aria-label={`${size} Ticket${size === 1 ? "" : "s"} für ${entry.name} verkaufen, ${currency(entry.priceCents * size)}`}
                      className="cashier-sell-action"
                      disabled={saleDisabled}
                      onClick={() => void sell(entry)}
                      type="button"
                      variant="primary"
                    >
                      <Ticket aria-hidden="true" size={16} />
                      <span>
                        {busyProductId === entry.id
                          ? "Wird bestätigt …"
                          : `${size} Ticket${size === 1 ? "" : "s"} · ${currency(entry.priceCents * size)}`}
                      </span>
                    </Button>
                  </div>
                  <div
                    className={
                      entrySplitPreview.required
                        ? "cashier-split-line warning"
                        : "cashier-split-line"
                    }
                    id={splitDescriptionId}
                  >
                    {entrySplitPreview.required ? (
                      <>
                        <AlertTriangle aria-hidden="true" size={16} />
                        <span>
                          Aufteilung: {entrySplitPreview.slotSizes.join(" + ")} Personen in{" "}
                          {entrySplitPreview.slotSizes.length} aufeinanderfolgenden Fluggruppen; die
                          Buchungsgruppe bleibt verbunden.
                        </span>
                      </>
                    ) : (
                      <span aria-hidden="true">&nbsp;</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>

        <Panel className="cashier-ticket-panel" padding="none" aria-label="Verkaufte Tickets">
          <Tabs
            label="Ticketstatus"
            value={ticketListTab}
            onChange={setTicketListTab}
            items={[
              { value: "ACTIVE", label: "Verkaufte Tickets" },
              { value: "CANCELED", label: "Stornierte Tickets" },
            ]}
          />
          <div className="ds-toolbar cashier-ticket-toolbar">
            <label className="ds-search-field">
              <Search aria-hidden="true" size={18} />
              <input
                aria-label="Tickets suchen"
                value={ticketSearch}
                onChange={(event) => setTicketSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runTicketSearch();
                }}
                placeholder="Suche (z. B. Gruppe, Produkt)"
              />
            </label>
            <IconButton
              label="Liste aktualisieren"
              onClick={() => void loadTicketList({ preserveLoaded: true })}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={18} />
            </IconButton>
          </div>
          <div className="cashier-ticket-table-wrap">
            <DataTable
              className="cashier-ticket-table"
              columns={[
                {
                  key: "sold",
                  header: "Verkauf",
                  render: (result) =>
                    new Date(result.soldAt).toLocaleTimeString("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                },
                {
                  key: "group",
                  header: "Gruppe",
                  render: (result) => result.bookingGroupLabel,
                },
                { key: "product", header: "Produkt", render: (result) => result.productName },
                {
                  key: "people",
                  header: "Personen",
                  render: (result) => (
                    <span className="cashier-person-count">
                      {result.groupSize}
                      <CircleUserRound aria-hidden="true" size={15} />
                    </span>
                  ),
                },
                {
                  key: "flight-group",
                  header: "Fluggruppe",
                  render: (result) => result.communicationLabels.join(" / ") || "–",
                },
                {
                  key: "status",
                  header: "Status",
                  render: (result) => (
                    <StatusPill tone={result.groupStatus === "CANCELED" ? "danger" : "success"}>
                      {ticketGroupStatusLabel[result.groupStatus]}
                    </StatusPill>
                  ),
                },
                {
                  key: "total",
                  header: "Summe",
                  align: "right",
                  render: (result) =>
                    currency(
                      (board?.products.find((entry) => entry.id === result.productId)?.priceCents ??
                        0) * result.groupSize,
                    ),
                },
              ]}
              emptyLabel={
                ticketListTab === "CANCELED"
                  ? "Keine stornierten Tickets vorhanden."
                  : "Noch keine Tickets verkauft."
              }
              onRowClick={(result) => {
                selectSearchResult(result);
                if (result.groupStatus !== "CANCELED") {
                  void reopenTicketGroup(result.ticketGroupId).then((prepared) => {
                    if (prepared) setMessage("Ticketzettel stehen zum Nachdruck bereit.");
                  });
                }
              }}
              rowKey={(result) => result.ticketGroupId}
              rows={visibleTicketGroups}
              {...(lastTicketGroupId ? { selectedRowKey: lastTicketGroupId } : {})}
            />
            <div className="cashier-ticket-list-sentinel" ref={ticketListSentinelRef}>
              {ticketListLoading
                ? "Liste wird aktualisiert …"
                : ticketListNextCursor
                  ? "Weitere Buchungsgruppen werden beim Scrollen geladen."
                  : "Listenende"}
            </div>
          </div>
          <section className="cashier-ticket-detail">
            <header>
              <div>
                <h2>
                  {selectedTicketGroup
                    ? `Gruppe ${selectedTicketGroup.bookingGroupLabel}`
                    : "Ticketgruppe auswählen"}
                </h2>
                {selectedTicketGroup ? (
                  <span>
                    {selectedTicketGroup.groupSize} Person
                    {selectedTicketGroup.groupSize === 1 ? "" : "en"}
                  </span>
                ) : null}
              </div>
              {selectedTicketGroup ? (
                <time>
                  Verkauft:{" "}
                  {new Date(selectedTicketGroup.soldAt).toLocaleTimeString("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  Uhr
                </time>
              ) : null}
            </header>
            <div className="cashier-ticket-detail-grid">
              <dl>
                <div>
                  <dt>Produkt</dt>
                  <dd>{selectedTicketGroup?.productName ?? "–"}</dd>
                </div>
                <div>
                  <dt>Fluggruppe</dt>
                  <dd>{selectedTicketGroup?.communicationLabels.join(" / ") || "–"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {selectedTicketGroup
                      ? ticketGroupStatusLabel[selectedTicketGroup.groupStatus]
                      : "–"}
                  </dd>
                </div>
                <div>
                  <dt>Summe</dt>
                  <dd>
                    {selectedTicketGroup
                      ? currency(
                          (board?.products.find(
                            (entry) => entry.id === selectedTicketGroup.productId,
                          )?.priceCents ?? 0) * selectedTicketGroup.groupSize,
                        )
                      : "–"}
                  </dd>
                </div>
              </dl>
              <div className="cashier-ticket-identifiers">
                <strong>Tickets</strong>
                {receipt.map((ticket, index) => (
                  <button
                    className={index === selectedReceiptIndex ? "selected" : ""}
                    key={ticket.code}
                    onClick={() => setSelectedReceiptIndex(index)}
                    type="button"
                  >
                    <Ticket aria-hidden="true" size={18} />
                    <span>
                      {ticket.position} von {ticket.groupSize} · {ticket.code}
                    </span>
                  </button>
                ))}
              </div>
              <div className="cashier-ticket-paper">
                {receipt[selectedReceiptIndex] ? (
                  <>
                    <TicketPaper compact ticket={receipt[selectedReceiptIndex]} />
                    <button
                      aria-label={`QR-Ticket ${receipt[selectedReceiptIndex].code} vergrößern`}
                      className="cashier-ticket-enlarge"
                      onClick={() => setQrScanOpen(true)}
                      type="button"
                    >
                      <Maximize2 aria-hidden="true" size={15} />
                      QR-Code vergrößern
                    </button>
                  </>
                ) : (
                  <span>Ticketzettel wird nach Auswahl angezeigt.</span>
                )}
              </div>
            </div>
            <div className="cashier-ticket-actions">
              <Button
                variant="danger"
                disabled={!lastTicketGroupId || selectedTicketGroup?.groupStatus === "CANCELED"}
                onClick={() => setCancelDialogOpen(true)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={18} />
                Stornieren
              </Button>
              <Button
                disabled={receipt.length === 0 || selectedTicketGroup?.groupStatus === "CANCELED"}
                onClick={() => void printTicketDocument()}
                type="button"
              >
                <Printer aria-hidden="true" size={18} />
                Ticketzettel erneut drucken
              </Button>
            </div>
          </section>
        </Panel>
      </section>
      <div className="ticket-print-document" ref={printDocumentRef} aria-hidden="true">
        {receipt.map((ticket) => (
          <TicketPaper key={ticket.code} ticket={ticket} />
        ))}
      </div>
      <QrScanDialog
        onClose={() => setQrScanOpen(false)}
        open={qrScanOpen && Boolean(receipt[selectedReceiptIndex])}
        ticket={receipt[selectedReceiptIndex]}
      />
      <ConfirmationDialog
        open={cancelDialogOpen}
        title="Tickets stornieren"
        body={
          <div className="cashier-cancel-dialog-body">
            <p>
              {selectedTicketGroup?.bookingGroupLabel ?? "Buchungsgruppe"} ·{" "}
              {selectedTicketGroup?.groupSize ?? 0} Ticket
              {selectedTicketGroup?.groupSize === 1 ? "" : "s"}. Die aktive Belegung wird gelöst und
              die Kapazität sofort freigegeben.
            </p>
            <TextField
              autoFocus
              label="Grund"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Mindestens 3 Zeichen"
            />
          </div>
        }
        confirmDisabled={cancelReason.trim().length < 3 || cancelBusy}
        confirmLabel={cancelBusy ? "Wird storniert …" : "Stornieren"}
        danger
        onCancel={() => {
          if (cancelBusy) return;
          setCancelDialogOpen(false);
          setCancelReason("");
        }}
        onConfirm={() => void cancelLastSale()}
      />
    </Shell>
  );
}
