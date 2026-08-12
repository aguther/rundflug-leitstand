import type { FidsBoardRow } from "@rundflug/contracts";
import { derivePublicRotationStatus } from "@rundflug/domain";
import type { FidsProjectionEvent, FidsProjectionRow } from "./fids-board-projection";

export function projectedPredictionQuality(
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

export function publicStatus(
  row: FidsProjectionRow,
  predictionQuality: FidsBoardRow["predictionQuality"],
): FidsBoardRow["status"] {
  if (row.resource_group_status !== "ACTIVE") return "SERVICE_PAUSED";
  return derivePublicRotationStatus({
    rotationState: row.status,
    draftStatus: draftPublicStatus(row, predictionQuality),
  });
}

export function sharedFlightKey(
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
