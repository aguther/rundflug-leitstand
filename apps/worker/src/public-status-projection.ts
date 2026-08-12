import {
  buildTicketGroupRecallCopy,
  formatBookingGroupLabel,
  type NonCanceledRotationState,
} from "@rundflug/domain";

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

export function predictedBoardingWindow(input: {
  status: NonCanceledRotationState;
  quality: "STABLE" | "CHANGING" | "UNCERTAIN";
  predictedBoardingAt: string | null;
  lowerMinutes: number;
  upperMinutes: number;
  referenceAt: string;
}): { lowerAt: string | null; upperAt: string | null } {
  if (input.status !== "DRAFT" || input.quality === "UNCERTAIN") {
    return { lowerAt: null, upperAt: null };
  }
  const referenceMs = Date.parse(input.referenceAt);
  const storedCenterMs = input.predictedBoardingAt
    ? Date.parse(input.predictedBoardingAt)
    : Number.NaN;
  const midpointMinutes = (input.lowerMinutes + input.upperMinutes) / 2;
  const lowerMs = Number.isFinite(storedCenterMs)
    ? storedCenterMs + (input.lowerMinutes - midpointMinutes) * 60_000
    : referenceMs + input.lowerMinutes * 60_000;
  const upperMs = Number.isFinite(storedCenterMs)
    ? storedCenterMs + (input.upperMinutes - midpointMinutes) * 60_000
    : referenceMs + input.upperMinutes * 60_000;
  return {
    lowerAt: new Date(lowerMs).toISOString(),
    upperAt: new Date(Math.max(lowerMs, upperMs)).toISOString(),
  };
}
