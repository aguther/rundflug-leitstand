import type { OperationBoard, PublicBoard, PublicTicketStatus } from "@rundflug/contracts";
import { useCallback, useEffect, useState } from "react";
import { getOperationBoard, getPublicBoard, getPublicTicketStatus, sendCommand } from "./api";

const EVENT_ID = "demo-2026";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const publicStatusLabel = {
  WAITING: "Warten",
  PREPARE: "Bitte vorbereiten",
  COME_TO_FLIGHT_LINE: "Bitte zur Flight Line",
  BOARDING: "Boarding",
  IN_FLIGHT: "Flug läuft",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
} as const;

function deviceTokenFor(deviceId: string): string {
  if (import.meta.env.DEV) {
    if (deviceId === "cashier-tablet-1") return "demo-cashier-device-token";
    if (deviceId === "flight-line-tablet-1") return "demo-flight-line-device-token";
    return "demo-admin-device-token";
  }
  return window.localStorage.getItem(`device-token:${deviceId}`) ?? "";
}

function createTicketCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

function useOperationBoard(deviceId: string) {
  const [board, setBoard] = useState<OperationBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setBoard(await getOperationBoard(EVENT_ID, deviceId, deviceTokenFor(deviceId)));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Betriebsdaten nicht verfügbar.");
    }
  }, [deviceId]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { board, error, refresh };
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="app-shell">
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
      {children}
      <footer>Keine flugbetriebliche oder sicherheitsrelevante Freigabewirkung.</footer>
    </main>
  );
}

function ConnectionNotice({ error }: { error: string | null }) {
  return error ? <div className="connection-warning">Möglicherweise veraltet · {error}</div> : null;
}

function EmergencyNotice({ active }: { active: boolean }) {
  return active ? (
    <div className="emergency-notice">Notfallmodus aktiv · keine Verkäufe oder neuen Aufrufe</div>
  ) : null;
}

function CashierView() {
  const { board, error, refresh } = useOperationBoard("cashier-tablet-1");
  const [productId, setProductId] = useState("panorama-20");
  const [size, setSize] = useState(1);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [lastTicketGroupId, setLastTicketGroupId] = useState<string | null>(null);
  const [lastProductId, setLastProductId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rebookProductId, setRebookProductId] = useState("");
  const product = board?.products.find((entry) => entry.id === productId) ?? board?.products[0];

  async function sell() {
    if (!board || !product || busy) return;
    const codes = Array.from({ length: size }, createTicketCode);
    setBusy(true);
    try {
      const saleResult = await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: "cashier-tablet-1",
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SELL_TICKET_GROUP",
          payload: {
            productId: product.id,
            publicTicketCodes: codes,
            standby: false,
            paymentStatus: "PAID",
            paymentMethod: "CASH",
          },
        },
        deviceTokenFor("cashier-tablet-1"),
      );
      setReceipt(codes);
      setLastTicketGroupId(saleResult.aggregate?.id ?? null);
      setLastProductId(product.id);
      setMessage(`${codes.length} Ticket${codes.length === 1 ? "" : "s"} verkauft.`);
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
          deviceId: "cashier-tablet-1",
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CANCEL_TICKET_GROUP",
          payload: { ticketGroupId: lastTicketGroupId, reason: cancelReason.trim() },
        },
        deviceTokenFor("cashier-tablet-1"),
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
          deviceId: "cashier-tablet-1",
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "REBOOK_TICKET_GROUP",
          payload: {
            ticketGroupId: lastTicketGroupId,
            newProductId: rebookProductId,
            reason: cancelReason.trim(),
          },
        },
        deviceTokenFor("cashier-tablet-1"),
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

  return (
    <Shell title="Kasse">
      <ConnectionNotice error={error} />
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
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
              <span>Noch {entry.remainingSellableSeats} Plätze</span>
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
          </section>
          <section className="ticket-preview">
            <h2>QR-Tickets</h2>
            {receipt.length > 0 ? (
              <div className="receipt-list">
                {receipt.map((code) => (
                  <code key={code}>{code}</code>
                ))}
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
                <button
                  disabled={cancelReason.trim().length < 3}
                  onClick={cancelLastSale}
                  type="button"
                >
                  Letzten Verkauf stornieren
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
              </div>
            ) : null}
          </section>
        </div>
        <button
          className="primary-action"
          disabled={
            !board ||
            !product?.saleEnabled ||
            product.resourceGroupStatus !== "ACTIVE" ||
            board.event.emergencyMode ||
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
  const { board, error, refresh } = useOperationBoard("flight-line-tablet-1");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [queueReason, setQueueReason] = useState("");
  const selected =
    board?.rotations.find((rotation) => rotation.id === selectedId) ?? board?.rotations[0];
  const action = selected ? actionForState[selected.status] : null;

  async function advance() {
    if (!board || !selected || !action) return;
    try {
      const commandBase = {
        commandId: crypto.randomUUID(),
        eventId: EVENT_ID,
        deviceId: "flight-line-tablet-1",
        expectedVersion: board.event.version,
        issuedAt: new Date().toISOString(),
      };
      if (action.command === "CALL_NEXT") {
        await sendCommand(
          {
            ...commandBase,
            type: "CALL_NEXT",
            payload: { rotationId: selected.id, aircraftId: selected.suggestedAircraftId ?? "" },
          },
          deviceTokenFor("flight-line-tablet-1"),
        );
      } else {
        await sendCommand(
          { ...commandBase, type: action.command, payload: { rotationId: selected.id } },
          deviceTokenFor("flight-line-tablet-1"),
        );
      }
      setMessage(`${action.label} bestätigt.`);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Aktion fehlgeschlagen.");
    }
  }

  async function mutateQueue(type: "DEFER_TICKET_GROUP" | "MARK_NO_SHOW") {
    if (!board || !selected || queueReason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: "flight-line-tablet-1",
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type,
          payload: { ticketGroupId: selected.ticketGroupId, reason: queueReason.trim() },
        },
        deviceTokenFor("flight-line-tablet-1"),
      );
      setMessage(type === "MARK_NO_SHOW" ? "No-Show protokolliert." : "Fluggruppe zurückgestellt.");
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
          deviceId: "flight-line-tablet-1",
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "REVOKE_CALL",
          payload: { rotationId: selected.id },
        },
        deviceTokenFor("flight-line-tablet-1"),
      );
      setMessage("NEXT wurde durch ein Korrekturereignis zurückgenommen.");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Rücknahme fehlgeschlagen.");
    }
  }

  return (
    <Shell title="Flight Line">
      <ConnectionNotice error={error} />
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
      <section className="flight-workspace">
        <div className="queue-list">
          <h1>Warteschlange</h1>
          {board?.rotations.map((rotation) => (
            <button
              key={rotation.id}
              className={rotation.id === selected?.id ? "queue-row selected" : "queue-row"}
              onClick={() => setSelectedId(rotation.id)}
              type="button"
            >
              <strong>Gruppe {rotation.communicationNumber}</strong>
              <span>{rotation.productName}</span>
              <span>
                {rotation.ticketCount} Plätze · {rotation.predictedLowerMinutes}–
                {rotation.predictedUpperMinutes} Min.
              </span>
            </button>
          ))}
        </div>
        <div className="rotation-detail">
          {selected ? (
            <>
              <div className={`state-banner state-${selected.status.toLowerCase()}`}>
                <span>Status</span>
                <strong>{selected.status}</strong>
              </div>
              <h2>Fluggruppe {selected.communicationNumber}</h2>
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
                  <dt>Flugzeug</dt>
                  <dd>
                    {selected.aircraftRegistration ??
                      (selected.suggestedAircraftRegistration
                        ? `Vorschlag ${selected.suggestedAircraftRegistration} · Bestätigung mit NEXT`
                        : "Kein kompatibles Flugzeug verfügbar")}
                  </dd>
                </div>
              </dl>
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
                      disabled={queueReason.trim().length < 3}
                      onClick={() => mutateQueue("MARK_NO_SHOW")}
                      type="button"
                    >
                      No-Show
                    </button>
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
                    (!selected.suggestedAircraftId || board?.event.emergencyMode)
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
  useEffect(() => {
    const controller = new AbortController();
    getPublicTicketStatus(code, controller.signal)
      .then(setStatus)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Status nicht verfügbar."),
      );
    return () => controller.abort();
  }, [code]);
  return (
    <Shell title="Ticketstatus">
      <section className="ticket-status-page">
        <span className="eyebrow">Ihr Ticketcode</span>
        <code>{code}</code>
        {status ? (
          <>
            <h1>{status.productName}</h1>
            <div className="public-status">
              <span>Fluggruppe {status.communicationNumber}</span>
              <strong>{publicStatusLabel[status.status]}</strong>
            </div>
            <p>{status.message}</p>
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
                onChange={(event) => setPush(event.target.checked)}
              />
            </label>
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

function FidsView() {
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
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
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  return (
    <Shell title="FIDS">
      <ConnectionNotice error={error} />
      <section className="fids-board">
        <h1>Rundflug-Leitstand – FIDS</h1>
        <div className="fids-header">
          <span>Produkt</span>
          <span>Gruppe</span>
          <span>Status</span>
          <span>Zeitfenster</span>
        </div>
        {board?.emergencyMode ? (
          <div className="uncertainty">Der Rundflugbetrieb ist derzeit unterbrochen.</div>
        ) : null}
        {board?.groups.map((group) => (
          <div className="fids-row" key={group.communicationNumber}>
            <strong>{group.productName}</strong>
            <b>{group.communicationNumber}</b>
            <span>{publicStatusLabel[group.status]}</span>
            <span>
              {group.waitLowerMinutes}–{group.waitUpperMinutes} Min.
            </span>
          </div>
        ))}
        <p>Zeiten sind typische Bereiche und nicht garantiert.</p>
      </section>
    </Shell>
  );
}

function AdminView() {
  const { board, error, refresh } = useOperationBoard("technical-scaffold");
  const [reason, setReason] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const resourceGroups = Array.from(
    new Map(board?.products.map((product) => [product.resourceGroupId, product]) ?? []).values(),
  );

  async function emergency(type: "TRIGGER_EMERGENCY" | "CLEAR_EMERGENCY") {
    if (!board || reason.trim().length < 3) return;
    try {
      await sendCommand(
        type === "TRIGGER_EMERGENCY"
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: "technical-scaffold",
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type,
              payload: { reason: reason.trim() },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: "technical-scaffold",
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type,
              payload: { reason: reason.trim(), adminPin },
            },
        deviceTokenFor("technical-scaffold"),
      );
      setMessage(
        type === "TRIGGER_EMERGENCY" ? "Notfallmodus ausgelöst." : "Notfallmodus aufgehoben.",
      );
      setReason("");
      setAdminPin("");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Notfallkommando fehlgeschlagen.");
    }
  }

  async function setResourceStatus(
    resourceGroupId: string,
    status: "ACTIVE" | "PAUSED" | "INTERRUPTED",
  ) {
    if (!board || reason.trim().length < 3) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: "technical-scaffold",
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_RESOURCE_GROUP_STATUS",
          payload: { resourceGroupId, status, reason: reason.trim(), expectedReviewAt: null },
        },
        deviceTokenFor("technical-scaffold"),
      );
      setMessage(`Ressourcengruppe auf ${status} gesetzt.`);
      setReason("");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Statusänderung fehlgeschlagen.");
    }
  }

  return (
    <Shell title="Administration">
      <ConnectionNotice error={error} />
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
      <section className="admin-workspace">
        <h1>Betriebssteuerung</h1>
        <label>
          Begründung
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Pflichtangabe"
          />
        </label>
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
                disabled={reason.trim().length < 3 || adminPin.length < 4}
                onClick={() => emergency("CLEAR_EMERGENCY")}
                type="button"
              >
                Notfallmodus aufheben
              </button>
            </>
          )}
        </section>
        <section className="admin-section">
          <h2>Ressourcengruppen</h2>
          {resourceGroups.map((group) => (
            <div className="resource-control" key={group.resourceGroupId}>
              <div>
                <strong>{group.name}</strong>
                <span>{group.resourceGroupStatus}</span>
              </div>
              <div className="secondary-actions">
                <button
                  onClick={() => setResourceStatus(group.resourceGroupId, "PAUSED")}
                  type="button"
                >
                  Pausieren
                </button>
                <button
                  onClick={() => setResourceStatus(group.resourceGroupId, "INTERRUPTED")}
                  type="button"
                >
                  Unterbrechen
                </button>
                <button
                  onClick={() => setResourceStatus(group.resourceGroupId, "ACTIVE")}
                  type="button"
                >
                  Aktivieren
                </button>
              </div>
            </div>
          ))}
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
  if (path === "/flight-line") return <FlightLineView />;
  if (path === "/fids") return <FidsView />;
  if (path === "/admin") return <AdminView />;
  return <CashierView />;
}
