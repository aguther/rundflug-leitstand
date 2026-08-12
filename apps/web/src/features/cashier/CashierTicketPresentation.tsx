import type { TicketSearchResult } from "@rundflug/contracts";
import { CircleCheck, CircleEllipsis, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cashierTicketCompletionIndicator } from "../../cashier-guidance";
import type { TicketReceipt } from "../operations/operation-types";

export function TableIconHeader({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <span className="cashier-icon-heading" title={label}>
      {children}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

export function CashierCompletionIcon({ result }: Readonly<{ result: TicketSearchResult }>) {
  const indicator = cashierTicketCompletionIndicator(result.groupStatus, result.rotationStatuses);
  if (indicator === "NONE") return null;
  const completed = indicator === "COMPLETED";
  const label = completed ? "Alle Fluggruppen abgeschlossen" : "Boarding oder Flugbetrieb begonnen";
  return (
    <span
      aria-label={label}
      className={`cashier-completion-icon${completed ? " is-complete" : ""}`}
      role="img"
      title={label}
    >
      {completed ? (
        <CircleCheck aria-hidden="true" size={17} />
      ) : (
        <CircleEllipsis aria-hidden="true" size={17} />
      )}
    </span>
  );
}

export function TicketPaper({
  compact = false,
  ticket,
}: Readonly<{
  compact?: boolean;
  ticket: TicketReceipt;
}>) {
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

export function QrScanDialog({
  onClose,
  open,
  ticket,
}: Readonly<{
  onClose: () => void;
  open: boolean;
  ticket: TicketReceipt | undefined;
}>) {
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
