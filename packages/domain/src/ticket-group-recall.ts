export const TICKET_GROUP_RECALL_DURATION_MS = 5 * 60 * 1_000;

export type TicketGroupRecallEndReason =
  | "MANUAL"
  | "PRESENT"
  | "BOARDING"
  | "DEFERRED"
  | "NO_SHOW"
  | "CANCELED"
  | "EXPIRED";

export type TicketGroupRecallEligibilityReason =
  | "ELIGIBLE"
  | "STATUS_NOT_ELIGIBLE"
  | "GATE_REQUIRED"
  | "ALREADY_ACTIVE";

export interface TicketGroupRecallCopy {
  fids: string;
  publicStatus: string;
  pushTitle: string;
  pushBody: string;
}

export function ticketGroupRecallEligibility(input: {
  status: string;
  gateLabel: string;
  activeRecall: boolean;
}): { eligible: boolean; reason: TicketGroupRecallEligibilityReason } {
  if (input.activeRecall) return { eligible: false, reason: "ALREADY_ACTIVE" };
  if (input.status !== "QUEUED" && input.status !== "MISSING") {
    return { eligible: false, reason: "STATUS_NOT_ELIGIBLE" };
  }
  if (!input.gateLabel.trim()) return { eligible: false, reason: "GATE_REQUIRED" };
  return { eligible: true, reason: "ELIGIBLE" };
}

export function buildTicketGroupRecallCopy(input: {
  communicationLabel: string;
  gateLabel: string;
}): TicketGroupRecallCopy {
  const communicationLabel = input.communicationLabel.trim();
  const gateLabel = input.gateLabel.trim();
  return {
    fids: `NACHRUF · ${communicationLabel} – Bitte sofort zu ${gateLabel} kommen.`,
    publicStatus: `Ihre Gruppe wird erneut aufgerufen. Bitte kommen Sie jetzt sofort zu ${gateLabel}.`,
    pushTitle: "Erneuter Aufruf",
    pushBody: `Ihre Gruppe ${communicationLabel} wird erneut aufgerufen. Bitte kommen Sie jetzt zu ${gateLabel}.`,
  };
}
