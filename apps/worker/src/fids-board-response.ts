import type { FidsBoardRow } from "@rundflug/contracts";
import {
  assessForecastFreshness,
  derivePublicForecastProjection,
  derivePublicRotationStatus,
  formatBookingGroupLabel,
  formatBookingGroupPartLabel,
} from "@rundflug/domain";
import { bookingGroupPartContextFromColumns } from "./booking-group-part-projection";
import type { FidsProjectionEvent, FidsProjectionRow } from "./fids-board-projection";
import {
  activeTicketGroupRecallProjection,
  predictedBoardingWindow,
} from "./public-status-projection";

function projectedPredictionQuality(
  row: FidsProjectionRow,
  event: FidsProjectionEvent,
  freshnessQuality: FidsBoardRow["predictionQuality"],
): FidsBoardRow["predictionQuality"] {
  if (
    event.operational_interrupted === 1 ||
    row.resource_group_status === "INTERRUPTED" ||
    row.resource_group_status === "ENDED"
  ) {
    return "UNCERTAIN";
  }
  return freshnessQuality;
}

function draftPublicStatus(
  row: FidsProjectionRow,
  predictionQuality: FidsBoardRow["predictionQuality"],
) {
  if (row.precalled_at !== null) return "COME_TO_FLIGHT_LINE" as const;
  if (row.precall_decision_status === "PREPARE" && predictionQuality !== "UNCERTAIN") {
    return "PREPARE" as const;
  }
  return "WAITING" as const;
}

function publicStatus(
  row: FidsProjectionRow,
  predictionQuality: FidsBoardRow["predictionQuality"],
): FidsBoardRow["status"] {
  if (row.resource_group_status !== "ACTIVE") return "SERVICE_PAUSED";
  return derivePublicRotationStatus({
    rotationState: row.status,
    draftStatus: draftPublicStatus(row, predictionQuality),
  });
}

function sharedFlightKey(
  row: FidsProjectionRow,
  status: FidsBoardRow["status"],
  hasActiveRecall: boolean,
): string | null {
  if (hasActiveRecall) return null;
  if (status === "COME_TO_FLIGHT_LINE" && row.dispatch_batch_id) {
    return `dispatch:${row.dispatch_batch_id}`;
  }
  if (["BOARDING", "IN_FLIGHT", "LANDED", "COMPLETED"].includes(status)) {
    return `rotation:${row.rotation_id}`;
  }
  return null;
}

export function mapFidsProjectionRow(
  row: FidsProjectionRow,
  event: FidsProjectionEvent,
  boardReadAt: string,
): FidsBoardRow {
  const forecastFreshness = assessForecastFreshness({
    predictionQuality: row.prediction_quality,
    predictionUpdatedAt: row.prediction_updated_at,
    now: boardReadAt,
  });
  const predictionQuality = projectedPredictionQuality(row, event, forecastFreshness.quality);
  const waitLowerMinutes = row.prediction_lower_minutes ?? row.projection_index * 20;
  const waitUpperMinutes = row.prediction_upper_minutes ?? (row.projection_index + 1) * 30;
  const boardingWindow = predictedBoardingWindow({
    status: row.status,
    quality: predictionQuality,
    predictedBoardingAt: row.predicted_boarding_at,
    lowerMinutes: waitLowerMinutes,
    upperMinutes: waitUpperMinutes,
    referenceAt: boardReadAt,
  });
  const publicForecast = derivePublicForecastProjection({
    rotationStatus: row.status,
    predictionQuality,
    predictedBoardingAt: row.predicted_boarding_at,
    predictedCompletionAt: row.predicted_completion_at,
    operationsEndAt: event.operations_end_at,
    dispatchBatchId: row.dispatch_batch_id,
    dispatchUnplannedReason: row.dispatch_unplanned_reason,
    emergencyMode: event.emergency_mode === 1,
    operationalInterrupted: event.operational_interrupted === 1,
    resourceGroupStatus: row.resource_group_status,
  });
  const publishesWindow =
    publicForecast.forecastState === "DISPATCH_WINDOW" ||
    publicForecast.forecastState === "LONG_RANGE_WINDOW";
  const activeRecall = activeTicketGroupRecallProjection(row);
  const bookingGroupPart = bookingGroupPartContextFromColumns(row);
  const bookingGroupLabel = bookingGroupPart
    ? formatBookingGroupPartLabel(row.product_code, row.communication_number, bookingGroupPart)
    : formatBookingGroupLabel(row.product_code, row.communication_number);
  const status = publicStatus(row, predictionQuality);
  return {
    rowId: row.row_id,
    productId: row.product_id,
    gateId: row.gate_id,
    productName: row.product_name,
    productCode: row.product_code,
    gateLabel: row.gate_label,
    communicationNumber: row.communication_number,
    bookingGroupLabels: [bookingGroupLabel],
    ticketLabels: Array.from(
      { length: Math.max(1, row.ticket_count) },
      (_, ticketIndex) =>
        `${formatBookingGroupLabel(row.product_code, row.communication_number)}/${ticketIndex + 1}`,
    ),
    aircraftRegistration: row.aircraft_registration,
    departedAt: row.departed_at,
    status,
    sharedFlightKey: sharedFlightKey(row, status, activeRecall !== null),
    waitLowerMinutes: publishesWindow ? waitLowerMinutes : 0,
    waitUpperMinutes: publishesWindow ? waitUpperMinutes : 0,
    boardingWindowLowerAt: publishesWindow ? boardingWindow.lowerAt : null,
    boardingWindowUpperAt: publishesWindow ? boardingWindow.upperAt : null,
    ...publicForecast,
    predictionQuality,
    dispatchOrder: row.dispatch_order,
    operationalNotice: row.planned_public_note || row.resource_group_operational_note,
    activeRecall,
  };
}
