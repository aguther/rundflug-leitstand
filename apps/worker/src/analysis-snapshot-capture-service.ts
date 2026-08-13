import type { OperatorRole } from "@rundflug/contracts";
import type { DeviceRole } from "@rundflug/domain";
import {
  type AnalysisSnapshotReceiptRow,
  isAnalysisSnapshotCaptureAuthorized,
  parseAnalysisSnapshotReceipt,
} from "./analysis-snapshot-capture-receipt";
import type {
  ForecastRecalculationRequest,
  ForecastRecalculationResult,
} from "./forecast-timeline-service";
import { safeErrorMessage } from "./snapshot";
import type { Env } from "./types";

const ANALYSIS_SNAPSHOT_COMMAND_TYPE = "CAPTURE_ANALYSIS_SNAPSHOT";

export interface AnalysisSnapshotCaptureInput {
  eventId: string;
  requestId: string;
  expectedEventVersion: number;
  deviceId: string;
  actorRole: OperatorRole;
  deviceRole: DeviceRole;
}

export type AnalysisSnapshotCaptureResult =
  | {
      ok: true;
      planningRunId: string;
      eventVersion: number;
      dispatchPlanRevision: string;
    }
  | {
      ok: false;
      code:
        | "SESSION_NOT_AUTHORIZED"
        | "ANALYSIS_SNAPSHOT_STALE_VERSION"
        | "ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT"
        | "ANALYSIS_SNAPSHOT_CAPTURE_FAILED";
      currentVersion?: number;
    };

interface ExistingAnalysisPlanningRun {
  operation_day_id: string;
  operation_day_version: number;
  trigger_event_type: string;
  dispatch_plan_revision: string;
  status: "CAPTURING" | "SUCCEEDED" | "FAILED";
}

export class AnalysisSnapshotCaptureService {
  constructor(
    private readonly env: Env,
    private readonly recalculateForecastTimelines: (
      request: ForecastRecalculationRequest,
    ) => Promise<ForecastRecalculationResult>,
  ) {}

  async capture(input: AnalysisSnapshotCaptureInput): Promise<AnalysisSnapshotCaptureResult> {
    if (!isAnalysisSnapshotCaptureAuthorized(input.actorRole, input.deviceRole)) {
      return { ok: false, code: "SESSION_NOT_AUTHORIZED" };
    }

    const receiptResult = await this.restoreReceipt(input);
    if (receiptResult) return receiptResult;

    const existingRunResult = await this.restorePlanningRun(input);
    if (existingRunResult) return existingRunResult;

    const event = await this.env.DB.prepare("SELECT version FROM operation_days WHERE id = ?1")
      .bind(input.eventId)
      .first<{ version: number }>();
    if (event?.version !== input.expectedEventVersion) {
      return this.staleVersionResult(event);
    }

    return this.capturePlanningRun(input);
  }

  private async restoreReceipt(
    input: AnalysisSnapshotCaptureInput,
  ): Promise<AnalysisSnapshotCaptureResult | null> {
    const receipt = await this.env.DB.prepare(
      `SELECT operation_day_id, device_id, command_type, response_json
         FROM idempotency_receipts WHERE command_id = ?1`,
    )
      .bind(input.requestId)
      .first<AnalysisSnapshotReceiptRow>();
    if (!receipt) return null;
    if (
      receipt.operation_day_id !== input.eventId ||
      receipt.device_id !== input.deviceId ||
      receipt.command_type !== ANALYSIS_SNAPSHOT_COMMAND_TYPE
    ) {
      return { ok: false, code: "ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT" };
    }
    return parseAnalysisSnapshotReceipt(input, receipt.response_json);
  }

  private async restorePlanningRun(
    input: AnalysisSnapshotCaptureInput,
  ): Promise<AnalysisSnapshotCaptureResult | null> {
    const existingRun = await this.env.DB.prepare(
      `SELECT operation_day_id, operation_day_version, trigger_event_type,
              dispatch_plan_revision, status
         FROM planning_runs WHERE id = ?1`,
    )
      .bind(input.requestId)
      .first<ExistingAnalysisPlanningRun>();
    if (!existingRun) return null;
    if (
      existingRun.operation_day_id !== input.eventId ||
      existingRun.operation_day_version !== input.expectedEventVersion ||
      existingRun.trigger_event_type !== "MANUAL_DIAGNOSIS"
    ) {
      return { ok: false, code: "ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT" };
    }
    if (existingRun.status !== "SUCCEEDED") {
      return { ok: false, code: "ANALYSIS_SNAPSHOT_CAPTURE_FAILED" };
    }
    const recovered = {
      planningRunId: input.requestId,
      eventVersion: existingRun.operation_day_version,
      dispatchPlanRevision: existingRun.dispatch_plan_revision,
    };
    await this.persistAnalysisSnapshotReceipt(input, recovered);
    return { ok: true, ...recovered };
  }

  private staleVersionResult(event: { version: number } | null): AnalysisSnapshotCaptureResult {
    return {
      ok: false,
      code: "ANALYSIS_SNAPSHOT_STALE_VERSION",
      ...(event ? { currentVersion: event.version } : {}),
    };
  }

  private async capturePlanningRun(
    input: AnalysisSnapshotCaptureInput,
  ): Promise<AnalysisSnapshotCaptureResult> {
    try {
      const captured = await this.recalculateForecastTimelines({
        eventId: input.eventId,
        triggerEventType: "MANUAL_DIAGNOSIS",
        planningRunId: input.requestId,
        expectedEventVersion: input.expectedEventVersion,
      });
      await this.persistAnalysisSnapshotReceipt(input, captured);
      return { ok: true, ...captured };
    } catch (reason: unknown) {
      const code = reason instanceof Error ? reason.message : "ANALYSIS_SNAPSHOT_CAPTURE_FAILED";
      if (code === "ANALYSIS_SNAPSHOT_STALE_VERSION") {
        const current = await this.env.DB.prepare(
          "SELECT version FROM operation_days WHERE id = ?1",
        )
          .bind(input.eventId)
          .first<{ version: number }>();
        return this.staleVersionResult(current);
      }
      console.error(
        JSON.stringify({
          level: "error",
          code: "ANALYSIS_SNAPSHOT_CAPTURE_FAILED",
          eventId: input.eventId,
          message: safeErrorMessage(reason),
        }),
      );
      return { ok: false, code: "ANALYSIS_SNAPSHOT_CAPTURE_FAILED" };
    }
  }

  private async persistAnalysisSnapshotReceipt(
    input: AnalysisSnapshotCaptureInput,
    captured: ForecastRecalculationResult,
  ): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO idempotency_receipts
        (command_id, operation_day_id, device_id, command_type, received_at, response_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(
        input.requestId,
        input.eventId,
        input.deviceId,
        ANALYSIS_SNAPSHOT_COMMAND_TYPE,
        new Date().toISOString(),
        JSON.stringify({ expectedEventVersion: input.expectedEventVersion, ...captured }),
      )
      .run();
  }
}
