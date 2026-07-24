import type { OperationBoard, TicketGroupPrintData, TicketSearchResult } from "@rundflug/contracts";
import {
  AlertTriangle,
  Check,
  CircleArrowRight,
  CircleCheck,
  CircleUserRound,
  Clock3,
  Maximize2,
  Minus,
  PlaneLanding,
  PlaneTakeoff,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Tag,
  Ticket,
  TicketsPlane,
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
  Tabs,
  TextField,
} from "./design-system/components";
import {
  appendCashierDraftRevision,
  cashierDraftQueueKey,
  latestCashierDraft,
  legacyCashierDraftQueueKey,
  readCashierDraftQueue,
  shouldPersistCashierDraft,
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
import { formatAbsoluteTimeWindow } from "./time-window";

function TicketPaper({ compact = false, ticket }: { compact?: boolean; ticket: TicketReceipt }) {
  return (
    <article className={compact ? "ticket-paper ticket-paper-preview" : "ticket-paper"}>
      <strong>{ticket.eventName}</strong>
      <b>{ticket.code}</b>
      <img src={ticket.qrDataUrl} alt={`QR-Code der Gruppe ${ticket.communicationLabel}`} />
      <dl>
        <div>
          <dt>Gruppe:</dt>
          <dd>{ticket.communicationLabel}</dd>
        </div>
        <div>
          <dt>Personen:</dt>
          <dd>{ticket.groupSize}</dd>
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
      <small>Gruppenstatus über QR-Code öffnen</small>
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
              <span id="qr-scan-dialog-title">Gruppenstatus scannen</span>
              <strong>{ticket.code}</strong>
            </div>
            <button
              aria-label="Gruppen-QR-Code schließen"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              <X aria-hidden="true" size={22} />
            </button>
          </header>
          <img
            src={ticket.qrDataUrl}
            alt={`QR-Code der Gruppe ${ticket.communicationLabel} in Großansicht`}
          />
          <p id="qr-scan-dialog-description">
            {ticket.communicationLabel} · {ticket.groupSize} Personen · {ticket.productName}
          </p>
        </div>
      ) : null}
    </dialog>
  );
}

export function CashierView() {
  const { board, error, lastConfirmedAt, backendConfirmed, confirmEvent, refresh } =
    useOperationBoard(CASHIER_DEVICE_ID);
  const online = useConnectivity();
  const serverConfirmed = online && backendConfirmed && error === null;
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
  const [receipt, setReceipt] = useState<TicketReceipt | null>(null);
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
  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [manualRefreshBusy, setManualRefreshBusy] = useState(false);
  const ticketListRequestRef = useRef(0);
  const ticketListSentinelRef = useRef<HTMLDivElement | null>(null);
  const printDocumentRef = useRef<HTMLDivElement | null>(null);
  const ticketListResultCountRef = useRef(0);
  const ticketListNextCursorRef = useRef<string | null>(null);
  const lastTicketListBoardVersionRef = useRef<number | null>(null);
  const selectedTicketGroup = ticketSearchResults.find(
    (entry) => entry.ticketGroupId === lastTicketGroupId,
  );
  const selectedRotations =
    board?.rotations.filter((rotation) =>
      rotation.bookingGroups.some((group) => group.id === lastTicketGroupId),
    ) ?? [];
  const visibleTicketGroups = ticketSearchResults.filter((entry) =>
    ticketListTab === "CANCELED"
      ? entry.groupStatus === "CANCELED"
      : entry.groupStatus !== "CANCELED",
  );
  const currency = (cents: number) =>
    (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  async function printableTicket(data: TicketGroupPrintData): Promise<TicketReceipt> {
    const statusUrl = `${window.location.origin}/gruppe/${encodeURIComponent(data.code)}`;
    return {
      code: data.code,
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
      groupSize: data.groupSize,
    };
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

  async function reopenTicketGroup(
    ticketGroupId: string,
    confirmedPrintData?: TicketGroupPrintData,
  ): Promise<boolean> {
    try {
      const data =
        confirmedPrintData ??
        (await getTicketGroupPrintData(
          EVENT_ID,
          ticketGroupId,
          CASHIER_DEVICE_ID,
          deviceTokenFor(CASHIER_DEVICE_ID),
        ));
      const prepared = await printableTicket(data);
      setReceipt(prepared);
      return true;
    } catch (reason) {
      setReceipt(null);
      setMessage(
        reason instanceof Error ? reason.message : "Ticketzettel konnten nicht geladen werden.",
      );
      return false;
    }
  }
  function changeGroupSize(nextSize: number) {
    setSize(nextSize);
    if (
      !shouldPersistCashierDraft({
        hasPendingDraft: pendingDraftCount > 0,
        online,
        connectionError: error,
      })
    )
      return;
    const queue = appendCashierDraftRevision(readCashierDraftQueue(localStorage, draftQueueKey), {
      productId,
      size: nextSize,
    });
    writeCashierDraftQueue(localStorage, draftQueueKey, queue);
    setPendingDraftCount(queue.length);
  }
  useEffect(() => {
    localStorage.removeItem(legacyCashierDraftQueueKey(EVENT_ID, CASHIER_DEVICE_ID));
  }, []);
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
    const groupCode = createTicketCode();
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
            publicGroupCode: groupCode,
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
      lastTicketListBoardVersionRef.current = saleResult.event.version;
      confirmEvent(saleResult.event);
      setLastTicketGroupId(soldTicketGroupId);
      setMessage(`${codes.length} Ticket${codes.length === 1 ? "" : "s"} verkauft.`);
      writeCashierDraftQueue(localStorage, draftQueueKey, []);
      setPendingDraftCount(0);
      setSize(1);
      const printPreparation = soldTicketGroupId
        ? reopenTicketGroup(soldTicketGroupId, saleResult.saleReceipt)
        : Promise.resolve(true);
      const [printPrepared] = await Promise.all([
        printPreparation,
        refresh(saleResult.event.version),
        loadTicketList({ preserveLoaded: true }),
      ]);
      if (!printPrepared) {
        setMessage(
          `${codes.length} Ticket${codes.length === 1 ? "" : "s"} verkauft. Druckvorbereitung fehlgeschlagen; Nachdruck bleibt möglich.`,
        );
      }
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
      setReceipt(null);
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
    setReceipt(null);
  }

  async function printTicketDocument() {
    if (!receipt || selectedTicketGroup?.groupStatus === "CANCELED") {
      setMessage("Für diese Buchungsgruppe steht kein druckbares Ticketdokument bereit.");
      return;
    }
    const documentRoot = printDocumentRef.current;
    if (!documentRoot) {
      setMessage("Ticketdokument konnte nicht vorbereitet werden.");
      return;
    }
    setPrintBusy(true);
    try {
      const images = Array.from(documentRoot.querySelectorAll("img"));
      if (images.length !== 1) throw new Error("QR-Code ist noch nicht vollständig.");
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
    } finally {
      setPrintBusy(false);
    }
  }

  async function refreshTicketList() {
    setManualRefreshBusy(true);
    try {
      await loadTicketList({ preserveLoaded: true });
    } finally {
      setManualRefreshBusy(false);
    }
  }

  function rotationStatusIcon(rotation: OperationBoard["rotations"][number]) {
    const props = { "aria-hidden": true, size: 17 } as const;
    switch (rotation.status) {
      case "DRAFT":
        return <Clock3 {...props} />;
      case "CALLED":
        return <TicketsPlane {...props} />;
      case "IN_FLIGHT":
        return <PlaneTakeoff {...props} />;
      case "LANDED":
        return <PlaneLanding {...props} />;
      case "COMPLETED":
        return <CircleCheck {...props} />;
    }
  }

  function rotationStatusLabel(status: OperationBoard["rotations"][number]["status"]) {
    return {
      DRAFT: "Wartet",
      CALLED: "Boarding",
      IN_FLIGHT: "Im Flug",
      LANDED: "Gelandet",
      COMPLETED: "Abgeschlossen",
    }[status];
  }

  function rotationTimeWindow(rotation: OperationBoard["rotations"][number]) {
    return formatAbsoluteTimeWindow({
      lowerAt: rotation.boardingWindowLowerAt,
      upperAt: rotation.boardingWindowUpperAt,
      timeZone: board?.event.timeZone ?? "Europe/Berlin",
      variant: "compact",
      quality: rotation.timeline.predictionQuality,
      phase:
        rotation.status === "CALLED" ||
        (rotation.status === "DRAFT" && Boolean(rotation.precalledAt))
          ? "NOW"
          : rotation.status === "DRAFT"
            ? "FORECAST"
            : "FINISHED",
    });
  }

  return (
    <Shell
      className="cashier-shell"
      connection={{ backendConfirmed, error, lastConfirmedAt }}
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
                  onClick={() => changeGroupSize(Math.max(1, size - 1))}
                  type="button"
                >
                  <Minus aria-hidden="true" size={18} />
                </IconButton>
                <output aria-live="polite">{size}</output>
                <IconButton
                  aria-label="Gruppengröße erhöhen"
                  label="Gruppengröße erhöhen"
                  onClick={() => changeGroupSize(Math.min(12, size + 1))}
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
                    <span className="cashier-product-name">
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.publicDescription ||
                          `Flugzeit ca. ${entry.promisedFlightMinutes} Min.`}
                      </small>
                    </span>
                    <span className="cashier-product-metric">
                      <small>Zeitfenster</small>
                      <strong>
                        {formatAbsoluteTimeWindow({
                          lowerAt: entry.nextBoardingWindowLowerAt,
                          upperAt: entry.nextBoardingWindowUpperAt,
                          timeZone: board.event.timeZone,
                          quality: entry.predictionQuality,
                        })}
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
                      busy={busyProductId === entry.id}
                      busyLabel={`${size} Ticket${size === 1 ? "" : "s"} für ${entry.name} werden verkauft`}
                      onClick={() => void sell(entry)}
                      type="button"
                      variant="primary"
                    >
                      <Ticket aria-hidden="true" size={20} />
                      <span className="cashier-sell-copy">
                        <span>
                          {size} Ticket{size === 1 ? "" : "s"}
                        </span>
                        <span>{currency(entry.priceCents * size)}</span>
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
              busy={manualRefreshBusy}
              onClick={() => void refreshTicketList()}
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
                  void reopenTicketGroup(result.ticketGroupId);
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
              <div className="cashier-flight-groups">
                <DataTable
                  columns={[
                    {
                      key: "flight-group",
                      header: (
                        <span className="cashier-icon-heading" title="Fluggruppe">
                          <Tag aria-hidden="true" size={17} />
                          <span className="visually-hidden">Fluggruppe</span>
                        </span>
                      ),
                      render: (rotation) => rotation.communicationLabel,
                    },
                    {
                      key: "people",
                      header: "Personen",
                      align: "center",
                      render: (rotation) =>
                        rotation.bookingGroups.find(
                          (group) => group.id === selectedTicketGroup?.ticketGroupId,
                        )?.ticketCount ?? 0,
                    },
                    {
                      key: "status",
                      header: "Status",
                      align: "center",
                      render: (rotation) => (
                        <span
                          className="cashier-phase-icon"
                          role="img"
                          aria-label={rotationStatusLabel(rotation.status)}
                          title={rotationStatusLabel(rotation.status)}
                        >
                          {rotationStatusIcon(rotation)}
                        </span>
                      ),
                    },
                    {
                      key: "go-to-gate",
                      header: (
                        <span className="cashier-icon-heading" title="GoToGate-Aktiv">
                          <CircleArrowRight aria-hidden="true" size={17} />
                          <span className="visually-hidden">GoToGate-Aktiv</span>
                        </span>
                      ),
                      align: "center",
                      render: (rotation) =>
                        rotation.status === "DRAFT" && rotation.precalledAt ? (
                          <Check aria-label="GoToGate-Aktiv" size={18} />
                        ) : null,
                    },
                    {
                      key: "time-window",
                      header: "Zeitfenster",
                      render: rotationTimeWindow,
                    },
                  ]}
                  emptyLabel={
                    selectedTicketGroup
                      ? "Keine aktive Fluggruppe vorhanden."
                      : "Ticketgruppe auswählen."
                  }
                  rowKey={(rotation) => rotation.id}
                  rows={selectedRotations}
                />
              </div>
              <div className="cashier-ticket-paper">
                {receipt ? (
                  <>
                    <TicketPaper compact ticket={receipt} />
                    <button
                      aria-label={`QR-Code der Gruppe ${receipt.communicationLabel} vergrößern`}
                      className="cashier-ticket-enlarge"
                      onClick={() => setQrScanOpen(true)}
                      type="button"
                      title="QR-Code vergrößern"
                    >
                      <Maximize2 aria-hidden="true" size={15} />
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
                disabled={!receipt || selectedTicketGroup?.groupStatus === "CANCELED"}
                busy={printBusy}
                onClick={() => void printTicketDocument()}
                type="button"
              >
                <Printer aria-hidden="true" size={18} />
                Ticket drucken
              </Button>
            </div>
          </section>
        </Panel>
      </section>
      <div className="ticket-print-document" ref={printDocumentRef} aria-hidden="true">
        {receipt ? <TicketPaper ticket={receipt} /> : null}
      </div>
      <QrScanDialog
        onClose={() => setQrScanOpen(false)}
        open={qrScanOpen && Boolean(receipt)}
        ticket={receipt ?? undefined}
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
        confirmDisabled={cancelReason.trim().length < 3}
        confirmBusy={cancelBusy}
        confirmLabel="Stornieren"
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
