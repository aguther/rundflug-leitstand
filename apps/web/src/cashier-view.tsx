import type { TicketGroupPrintData, TicketSearchResult } from "@rundflug/contracts";
import {
  CircleUserRound,
  Filter,
  Info,
  Minus,
  Plane,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Ticket,
  Trash2,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { getTicketGroupPrintData, searchTickets, sendCommand } from "./api";
import { AppShell as Shell } from "./app/AppShell";
import { requiresChildCompanionWarning } from "./cashier-guidance";
import {
  Button,
  DataTable,
  IconButton,
  PageHeader,
  Panel,
  SelectField,
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
  type TicketDetail,
  type TicketReceipt,
  useOperationBoard,
  type WeightClass,
  weightClassLabel,
} from "./operation-workspace";
import { oversizeSplitPreview } from "./operational-exceptions";
import { useConnectivity } from "./shared/hooks/use-connectivity";

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
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<TicketReceipt[]>([]);
  const [ticketCodeMode, setTicketCodeMode] = useState<"GENERATED" | "PREPRINTED">("GENERATED");
  const [preprintedCodes, setPreprintedCodes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [lastTicketGroupId, setLastTicketGroupId] = useState<string | null>(null);
  const [lastProductId, setLastProductId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rebookProductId, setRebookProductId] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketSearchResults, setTicketSearchResults] = useState<TicketSearchResult[]>([]);
  const [ticketListTab, setTicketListTab] = useState<"ACTIVE" | "CANCELLED">("ACTIVE");
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
  const selectedTicketGroup = ticketSearchResults.find(
    (entry) => entry.ticketGroupId === lastTicketGroupId,
  );
  const visibleTicketGroups = ticketSearchResults.filter((entry) =>
    ticketListTab === "CANCELLED"
      ? entry.groupStatus === "CANCELLED"
      : entry.groupStatus !== "CANCELLED",
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
            width: 360,
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

  async function reopenTicketGroup(ticketGroupId: string) {
    try {
      const data = await getTicketGroupPrintData(
        EVENT_ID,
        ticketGroupId,
        CASHIER_DEVICE_ID,
        deviceTokenFor(CASHIER_DEVICE_ID),
      );
      setReceipt(await printableTickets(data));
      setMessage("Ticketzettel stehen zum Scan oder erneuten Druck bereit.");
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Ticketzettel konnten nicht geladen werden.",
      );
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
    if (!serverConfirmed) return;
    void searchTickets(EVENT_ID, CASHIER_DEVICE_ID, deviceTokenFor(CASHIER_DEVICE_ID), "")
      .then((response) => {
        setTicketSearchResults(response.results);
        const firstResult = response.results[0];
        if (firstResult) {
          setLastTicketGroupId(firstResult.ticketGroupId);
          setLastProductId(firstResult.productId);
        }
      })
      .catch(() => undefined);
  }, [serverConfirmed]);
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
      const soldTicketGroupId = saleResult.aggregate?.id ?? null;
      if (soldTicketGroupId) await reopenTicketGroup(soldTicketGroupId);
      setPreprintedCodes("");
      setLastTicketGroupId(soldTicketGroupId);
      setLastProductId(product.id);
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
            adminPin: "SESSION",
          },
        },
        deviceTokenFor(CASHIER_DEVICE_ID),
      );
      setMessage("Verkauf storniert und protokolliert.");
      setReceipt([]);
      setLastTicketGroupId(null);
      setLastProductId(null);
      setCancelReason("");
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
            adminPin: "SESSION",
          },
        },
        deviceTokenFor(CASHIER_DEVICE_ID),
      );
      setMessage("Tickets umgebucht und in die neue Queue eingereiht.");
      setCancelReason("");
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
    setReceipt([]);
    setMessage(
      `${result.productName} · ${result.groupSize} Ticket${result.groupSize === 1 ? "" : "s"} ausgewählt.`,
    );
  }

  return (
    <Shell className="cashier-shell" title="Kasse">
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
      <section className="cashier-v15-workspace">
        <Panel className="cashier-sale-panel" aria-labelledby="cashier-sale-title">
          <PageHeader level={1} title="Tickets verkaufen" />
          <div className="cashier-products">
            {board?.products.map((entry) => {
              const selected = entry.id === product?.id;
              return (
                <article
                  className={selected ? "cashier-product selected" : "cashier-product"}
                  key={entry.id}
                >
                  <button
                    className="cashier-product-heading"
                    onClick={() => {
                      setProductId(entry.id);
                      setOversizeSplitAcknowledged(false);
                    }}
                    type="button"
                  >
                    <Plane aria-hidden="true" />
                    <span>
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
                  </button>
                  <div className="cashier-product-controls" aria-hidden={!selected}>
                    <div>
                      <span className="cashier-field-label">Gruppengröße</span>
                      <div className="cashier-stepper">
                        <IconButton
                          aria-label="Gruppengröße verringern"
                          label="Gruppengröße verringern"
                          onClick={() => {
                            setProductId(entry.id);
                            setSize((value) => Math.max(1, value - 1));
                            setOversizeSplitAcknowledged(false);
                          }}
                          type="button"
                        >
                          <Minus aria-hidden="true" size={18} />
                        </IconButton>
                        <output>{size}</output>
                        <IconButton
                          aria-label="Gruppengröße erhöhen"
                          label="Gruppengröße erhöhen"
                          onClick={() => {
                            setProductId(entry.id);
                            setSize((value) => Math.min(12, value + 1));
                            setOversizeSplitAcknowledged(false);
                          }}
                          type="button"
                        >
                          <Plus aria-hidden="true" size={18} />
                        </IconButton>
                      </div>
                    </div>
                    <div className="cashier-weight-picker">
                      <span className="cashier-field-label">Gewichtsklasse (pro Person)</span>
                      <div>
                        {(entry.weightClasses.length > 0
                          ? entry.weightClasses
                          : ["NOT_CAPTURED" as WeightClass]
                        ).map((weightClass) => (
                          <Button
                            className={
                              ticketDetails.every((detail) => detail.weightClass === weightClass)
                                ? "selected"
                                : ""
                            }
                            key={weightClass}
                            onClick={() => {
                              setProductId(entry.id);
                              setTicketDetails((current) =>
                                current.map((detail) => ({
                                  ...detail,
                                  weightClass,
                                  individualWeightKg: weightClass === "INDIVIDUAL" ? 80 : null,
                                })),
                              );
                            }}
                            size="default"
                            type="button"
                            variant="secondary"
                          >
                            {weightClassLabel[weightClass]}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="cashier-sale-options">
            <Info aria-hidden="true" size={18} />
            <span>Gewichtshinweise sind informativ; die Entscheidung liegt beim Piloten.</span>
            <SelectField
              label="Ticket-Ausgabe"
              value={ticketCodeMode}
              onChange={(event) =>
                setTicketCodeMode(event.target.value as "GENERATED" | "PREPRINTED")
              }
            >
              <option value="GENERATED">QR-Tickets erzeugen</option>
              <option value="PREPRINTED">Vorgedruckte Codes scannen</option>
            </SelectField>
          </div>
          {ticketCodeMode === "PREPRINTED" ? (
            <label className="cashier-preprinted-codes">
              Codes · einer pro Ticket
              <textarea
                rows={Math.min(5, Math.max(2, size))}
                value={preprintedCodes}
                onChange={(event) => setPreprintedCodes(event.target.value)}
                placeholder="QR-Code scannen oder eingeben"
              />
            </label>
          ) : null}
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
                <small>Die gemeinsam verkaufte Buchungsgruppe bleibt vollständig verbunden.</small>
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
                {productAircraft.length === 1 ? "" : "en"} passen für diese Gruppe. Dadurch kann die
                Wartezeit etwas länger sein.
              </span>
            </div>
          ) : null}
          {childCompanionWarning ? (
            <div className="child-companion-warning" role="alert">
              <strong>Begleitung prüfen</strong>
              <span>
                In dieser Gruppe ist ein Kind erfasst, aber keine erwachsene Begleitperson.
              </span>
            </div>
          ) : null}
          <div className="cashier-information">
            <Info aria-hidden="true" size={18} />
            Preise dienen nur der Abstimmung; keine Zahlungsabwicklung im System.
          </div>
          <Button
            className="cashier-sell-action"
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
            size="touch"
            type="button"
            variant="primary"
          >
            <Ticket aria-hidden="true" />
            {busy
              ? "Wird bestätigt …"
              : splitPreview.required && !oversizeSplitAcknowledged
                ? "Aufteilung bestätigen"
                : `Tickets verkaufen`}
            <small>
              Gruppe mit {size} Person{size === 1 ? "" : "en"} · {product?.name} ·{" "}
              {currency((product?.priceCents ?? 0) * size)}
            </small>
          </Button>
        </Panel>

        <Panel className="cashier-ticket-panel" padding="none" aria-label="Verkaufte Tickets">
          <Tabs
            label="Ticketstatus"
            value={ticketListTab}
            onChange={setTicketListTab}
            items={[
              { value: "ACTIVE", label: "Verkaufte Tickets" },
              { value: "CANCELLED", label: "Stornierte Tickets" },
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
            <IconButton label="Filter" type="button">
              <Filter aria-hidden="true" size={18} />
            </IconButton>
            <IconButton
              label="Liste aktualisieren"
              onClick={() =>
                void searchTickets(
                  EVENT_ID,
                  CASHIER_DEVICE_ID,
                  deviceTokenFor(CASHIER_DEVICE_ID),
                  "",
                ).then((response) => setTicketSearchResults(response.results))
              }
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
                  render: (result) => `G-${String(result.queueSequence).padStart(4, "0")}`,
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
                    <StatusPill tone={result.groupStatus === "CANCELLED" ? "danger" : "success"}>
                      {result.groupStatus === "ACTIVE" ? "Gebucht" : result.groupStatus}
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
                ticketListTab === "CANCELLED"
                  ? "Keine stornierten Tickets vorhanden."
                  : "Noch keine Tickets verkauft."
              }
              onRowClick={(result) => {
                selectSearchResult(result);
                void reopenTicketGroup(result.ticketGroupId);
              }}
              rowKey={(result) => result.ticketGroupId}
              rows={visibleTicketGroups}
              {...(lastTicketGroupId ? { selectedRowKey: lastTicketGroupId } : {})}
            />
          </div>
          <section className="cashier-ticket-detail">
            <header>
              <div>
                <h2>
                  {selectedTicketGroup
                    ? `Gruppe G-${String(selectedTicketGroup.queueSequence).padStart(4, "0")}`
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
            {message ? (
              <div className="action-message" role="status">
                {message}
              </div>
            ) : null}
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
                  <dd>{selectedTicketGroup?.groupStatus ?? "–"}</dd>
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
                {receipt.map((ticket) => (
                  <span key={ticket.code}>
                    <Ticket aria-hidden="true" size={18} />
                    {ticket.code}
                  </span>
                ))}
              </div>
              <div className="cashier-ticket-paper">
                {receipt[0] ? (
                  <article className="ticket-paper">
                    <strong>Rundflug-Leitstand</strong>
                    <small>{receipt[0].eventName}</small>
                    <b>{receipt[0].code}</b>
                    <img src={receipt[0].qrDataUrl} alt={`QR-Ticket ${receipt[0].code}`} />
                    <dl>
                      <div>
                        <dt>Gruppe:</dt>
                        <dd>{receipt[0].communicationLabel}</dd>
                      </div>
                      <div>
                        <dt>Produkt:</dt>
                        <dd>{receipt[0].productName}</dd>
                      </div>
                      <div>
                        <dt>Eingang:</dt>
                        <dd>{receipt[0].gateLabel}</dd>
                      </div>
                    </dl>
                    <small>QR-Code für aktuellen Status scannen</small>
                  </article>
                ) : (
                  <span>Ticketzettel wird nach Auswahl angezeigt.</span>
                )}
              </div>
            </div>
            {lastTicketGroupId ? (
              <details className="cashier-correction">
                <summary>Verkauf bearbeiten</summary>
                <div>
                  <TextField
                    label="Grund"
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    placeholder="Mindestens 3 Zeichen"
                  />
                  <SelectField
                    label="Umbuchen auf"
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
                  </SelectField>
                </div>
              </details>
            ) : null}
            <div className="cashier-ticket-actions">
              <Button
                variant="danger"
                disabled={!lastTicketGroupId || cancelReason.trim().length < 3}
                onClick={cancelLastSale}
                type="button"
              >
                <Trash2 aria-hidden="true" size={18} />
                Stornieren
              </Button>
              <Button
                disabled={!rebookProductId || cancelReason.trim().length < 3}
                onClick={rebookLastSale}
                type="button"
              >
                Umbuchen
              </Button>
              <Button disabled={receipt.length === 0} onClick={() => window.print()} type="button">
                <Printer aria-hidden="true" size={18} />
                Ticketzettel erneut drucken
              </Button>
            </div>
          </section>
        </Panel>
      </section>
    </Shell>
  );
}
