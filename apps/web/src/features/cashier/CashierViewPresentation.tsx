import type { OperationBoard, TicketSearchRequest, TicketSearchResult } from "@rundflug/contracts";
import { Check, Maximize2 } from "lucide-react";
import type { ReactNode } from "react";
import { PageNotice } from "../../app/PageNotifications";
import {
  ConnectionNotice,
  EmergencyNotice,
  InterruptionNotice,
  OperationalNotice,
} from "../operations/operation-notices";
import type { TicketReceipt } from "../operations/operation-types";
import { TicketPaper } from "./CashierTicketPresentation";

export type TicketListTab = TicketSearchRequest["status"];

export function ticketMatchesListStatus(entry: TicketSearchResult, status: TicketListTab) {
  if (status === "CANCELED") return entry.groupStatus === "CANCELED";
  if (status === "OPEN") {
    return entry.groupStatus !== "CANCELED" && entry.groupStatus !== "COMPLETED";
  }
  return entry.groupStatus !== "CANCELED";
}

export function ticketListEmptyLabel(status: TicketListTab) {
  if (status === "CANCELED") return "Keine stornierten Tickets vorhanden.";
  if (status === "OPEN") return "Keine offenen Tickets vorhanden.";
  return "Noch keine Tickets verkauft.";
}

export function ticketListSentinelLabel(loading: boolean, nextCursor: string | null) {
  if (loading) return "Liste wird aktualisiert …";
  if (nextCursor) return "Weitere Buchungsgruppen werden beim Scrollen geladen.";
  return "Listenende";
}

export function rotationStatusLabel(status: OperationBoard["rotations"][number]["status"]) {
  return {
    DRAFT: "Wartet",
    CALLED: "Boarding",
    IN_FLIGHT: "Im Flug",
    LANDED: "Gelandet",
    COMPLETED: "Abgeschlossen",
  }[status];
}

export function rotationTimeWindowPhase(
  rotation: OperationBoard["rotations"][number],
): "NOW" | "FORECAST" | "FINISHED" {
  if (rotation.status === "CALLED" || (rotation.status === "DRAFT" && rotation.precalledAt)) {
    return "NOW";
  }
  return rotation.status === "DRAFT" ? "FORECAST" : "FINISHED";
}

export function measurePerformanceSafely(name: string, startedAt: number) {
  try {
    performance.measure(name, { start: startedAt, end: performance.now() });
  } catch {
    // Performance measurement must never affect a confirmed sale.
  }
}

export function ticketSearchRequest(input: {
  query: string;
  status: TicketListTab;
  preserveLoaded: boolean;
  loadedCount: number;
  append: boolean;
  nextCursor: string | null;
  soldByOperatorAccountId?: string;
}): Partial<TicketSearchRequest> {
  const request: Partial<TicketSearchRequest> = {
    q: input.query,
    status: input.status,
    limit: input.preserveLoaded ? Math.min(Math.max(input.loadedCount, 20), 50) : 20,
  };
  if (input.append && input.nextCursor) request.cursor = input.nextCursor;
  if (input.soldByOperatorAccountId) {
    request.soldByOperatorAccountId = input.soldByOperatorAccountId;
  }
  return request;
}

export function CashierNotifications({
  error,
  lastConfirmedAt,
  pendingDraftCount,
  serverConfirmed,
  board,
}: Readonly<{
  error: string | null;
  lastConfirmedAt: string | null;
  pendingDraftCount: number;
  serverConfirmed: boolean;
  board: OperationBoard | null;
}>) {
  let draftNotice: ReactNode = null;
  if (pendingDraftCount > 0) {
    draftNotice = (
      <PageNotice
        noticeKey={`cashier-draft:${serverConfirmed ? "restored" : "local"}:${pendingDraftCount}`}
        tone="warning"
      >
        {serverConfirmed
          ? "Offline-Entwurf wiederhergestellt · aktuellen Stand prüfen und Verkauf bewusst bestätigen."
          : "Entwurf lokal gespeichert · noch nicht bestätigt · ohne operative Wirkung."}
      </PageNotice>
    );
  }
  return (
    <>
      <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
      {draftNotice}
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
      <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
      <OperationalNotice note={board?.event.operationalNote} />
    </>
  );
}

export function CashierTicketGroupHeader({
  group,
}: Readonly<{ group: TicketSearchResult | undefined }>) {
  if (!group) {
    return (
      <header>
        <div>
          <h2>Ticketgruppe auswählen</h2>
        </div>
      </header>
    );
  }
  return (
    <header>
      <div>
        <h2>Gruppe {group.bookingGroupLabel}</h2>
        <span>
          {group.groupSize} Person{group.groupSize === 1 ? "" : "en"}
        </span>
      </div>
      <div className="cashier-ticket-sale-meta">
        <small>Kasse: {group.soldByOperatorLoginCode ?? "Nicht zugeordnet"}</small>
        <time>
          Verkauft:{" "}
          {new Date(group.soldAt).toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          Uhr
        </time>
      </div>
    </header>
  );
}

export function CashierTicketPaperPreview({
  receipt,
  onEnlarge,
}: Readonly<{
  receipt: TicketReceipt | null;
  onEnlarge: () => void;
}>) {
  if (!receipt) return <span>Ticketzettel wird nach Auswahl angezeigt.</span>;
  return (
    <>
      <TicketPaper compact ticket={receipt} />
      <button
        aria-label={`QR-Code der Gruppe ${receipt.communicationLabel} vergrößern`}
        className="cashier-ticket-enlarge"
        onClick={onEnlarge}
        type="button"
        title="QR-Code vergrößern"
      >
        <Maximize2 aria-hidden="true" size={15} />
      </button>
    </>
  );
}

export function rotationPhaseClass(status: OperationBoard["rotations"][number]["status"]) {
  return status === "COMPLETED" ? "cashier-phase-icon is-complete" : "cashier-phase-icon";
}

export function goToGateIcon(rotation: OperationBoard["rotations"][number]) {
  return rotation.status === "DRAFT" && rotation.precalledAt ? (
    <Check aria-label="GoToGate-Aktiv" size={18} />
  ) : null;
}

export function activeFlightEmptyLabel(group: TicketSearchResult | undefined) {
  return group ? "Keine aktive Fluggruppe vorhanden." : "Ticketgruppe auswählen.";
}

export function printableTicketDocument(receipt: TicketReceipt | null) {
  return receipt ? <TicketPaper ticket={receipt} /> : null;
}

export function cancellationDescription(group: TicketSearchResult | undefined) {
  const label = group?.bookingGroupLabel ?? "Buchungsgruppe";
  const size = group?.groupSize ?? 0;
  return `${label} · ${size} Ticket${size === 1 ? "" : "s"}. Die aktive Belegung wird gelöst und die Kapazität sofort freigegeben.`;
}
