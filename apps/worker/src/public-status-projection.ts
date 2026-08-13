import { buildTicketGroupRecallCopy, formatBookingGroupLabel } from "@rundflug/domain";

export { predictedBoardingWindow } from "./public-boarding-window";

export interface ActiveTicketGroupRecallColumns {
  recall_id: string | null;
  recall_sequence: number | null;
  recall_started_at: string | null;
  recall_expires_at: string | null;
  product_code: string;
  communication_number: number;
  gate_label: string;
}

export function activeTicketGroupRecallProjection(row: ActiveTicketGroupRecallColumns) {
  if (
    !row.recall_id ||
    row.recall_sequence === null ||
    !row.recall_started_at ||
    !row.recall_expires_at
  ) {
    return null;
  }
  const copy = buildTicketGroupRecallCopy({
    communicationLabel: formatBookingGroupLabel(row.product_code, row.communication_number),
    gateLabel: row.gate_label,
  });
  return {
    id: row.recall_id,
    sequence: row.recall_sequence,
    startedAt: row.recall_started_at,
    expiresAt: row.recall_expires_at,
    fidsMessage: copy.fids,
    publicMessage: copy.publicStatus,
  };
}
