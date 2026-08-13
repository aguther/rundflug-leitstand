import { analysisSnapshotCaptureReceiptSchema, type OperatorRole } from "@rundflug/contracts";
import type { DeviceRole } from "@rundflug/domain";
import type {
  AnalysisSnapshotCaptureInput,
  AnalysisSnapshotCaptureResult,
} from "./analysis-snapshot-capture-service";

const ANALYSIS_SNAPSHOT_ROLES = new Set(["ADMIN", "FLIGHT_DIRECTOR"]);

export interface AnalysisSnapshotReceiptRow {
  operation_day_id: string;
  device_id: string;
  command_type: string;
  response_json: string;
}

export function isAnalysisSnapshotCaptureAuthorized(
  actorRole: OperatorRole,
  deviceRole: DeviceRole,
): boolean {
  return ANALYSIS_SNAPSHOT_ROLES.has(actorRole) && ANALYSIS_SNAPSHOT_ROLES.has(deviceRole);
}

export function parseAnalysisSnapshotReceipt(
  input: AnalysisSnapshotCaptureInput,
  responseJson: string,
): AnalysisSnapshotCaptureResult {
  try {
    const stored = analysisSnapshotCaptureReceiptSchema.safeParse(JSON.parse(responseJson));
    if (!stored.success || stored.data.expectedEventVersion !== input.expectedEventVersion) {
      return { ok: false, code: "ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT" };
    }
    return {
      ok: true,
      planningRunId: stored.data.planningRunId,
      eventVersion: stored.data.eventVersion,
      dispatchPlanRevision: stored.data.dispatchPlanRevision,
    };
  } catch {
    return { ok: false, code: "ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT" };
  }
}
