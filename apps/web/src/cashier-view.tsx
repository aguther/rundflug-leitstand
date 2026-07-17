import type { TicketSearchResult } from "@rundflug/contracts";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { searchTickets, sendCommand } from "./api";
import { AppShell as Shell } from "./app/AppShell";
import { requiresChildCompanionWarning } from "./cashier-guidance";
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
    setCorrectionTargetLabel(
      result.communicationLabels.join(" / ") || `Gruppe ${result.ticketGroupId.slice(0, 8)}`,
    );
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
              <span>Flugzeit ca. {entry.promisedFlightMinutes} Min.</span>
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
                  <button
                    disabled={cancelReason.trim().length < 3}
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
                    disabled={!rebookProductId || cancelReason.trim().length < 3}
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
