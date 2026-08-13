import { APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import {
  type AnalysisSnapshot,
  analysisSnapshotSchema,
  type OperationBoard,
} from "@rundflug/contracts";
import { compareTechnicalStrings } from "@rundflug/domain";
import type { Env } from "./types";

const SUPPORT_SAFE_DENIED_KEYS = new Set([
  "name",
  "publicDescription",
  "operationalNote",
  "resourceGroupName",
  "resourceGroupOperationalNote",
  "productName",
  "gateLabel",
  "label",
  "registration",
  "aircraftRegistration",
  "suggestedAircraftRegistration",
  "operationalCode",
  "pilotOperationalCode",
  "suggestedPilotOperationalCode",
  "currentPilotOperationalCode",
  "ownerLoginCode",
  "publicNote",
  "reason",
  "fidsMessage",
  "publicMessage",
  "ticketCode",
  "ticketToken",
  "pushEndpoint",
  "credential",
  "credentialHash",
  "pin",
  "pinHash",
  "userAgent",
  "stack",
]);

interface PlanningRunExportRow {
  id: string;
  operation_day_version: number;
  context_id: string;
  anchor_run_id: string;
  replay_distance: number;
  calculation_now: string;
  captured_at: string;
  trigger_event_type: string;
  capture_mode: "REFERENCE" | "CHANGE" | "ANCHOR";
  source_revision: string;
  dispatch_plan_revision: string;
  forecast_digest: string;
  precall_digest: string;
  duration_ms: number;
  capture_duration_ms: number | null;
  previous_forecast_state_chunk_id: string | null;
  previous_dispatch_state_chunk_id: string | null;
  dispatch_result_chunk_id: string | null;
  precall_result_chunk_id: string | null;
  anchor_previous_forecast_state_chunk_id: string | null;
  anchor_previous_dispatch_state_chunk_id: string | null;
  anchor_dispatch_result_chunk_id: string | null;
  anchor_precall_result_chunk_id: string | null;
}

interface PlanningContextExportRow {
  id: string;
  operation_day_version: number;
  schema_version: number;
  manifest_json: string;
  manifest_hash: string;
}

interface PlanningRunLineageRow {
  id: string;
  previous_run_id: string | null;
  anchor_run_id: string;
  context_id: string;
  operation_day_version: number;
  replay_distance: number;
  calculation_now: string;
  captured_at: string;
  trigger_event_type: string;
  capture_mode: "REFERENCE" | "CHANGE" | "ANCHOR";
  source_revision: string;
  dispatch_plan_revision: string;
  forecast_digest: string;
  precall_digest: string;
  previous_forecast_state_chunk_id: string | null;
  previous_dispatch_state_chunk_id: string | null;
  dispatch_result_chunk_id: string | null;
  precall_result_chunk_id: string | null;
}

interface PlanningChunkExportRow {
  id: string;
  chunk_kind: AnalysisSnapshot["planning"]["chunks"][number]["kind"];
  schema_version: number;
  payload_hash: string;
  payload_json: string;
  byte_size: number;
}

interface ForecastSnapshotExportRow {
  id: string;
  planning_run_id: string;
  rotation_id: string;
  captured_at: string;
  quality: "STABLE" | "CHANGING" | "UNCERTAIN";
  lower_minutes: number;
  upper_minutes: number;
  predicted_boarding_at: string | null;
  predicted_departure_at: string | null;
  predicted_landing_at: string | null;
  predicted_completion_at: string | null;
  dispatch_plan_revision: string | null;
}

interface AnalysisEventRow {
  event_date: string;
  time_zone: string;
  version: number;
}

function supportSafeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(supportSafeValue);
  if (value === null || typeof value !== "object") return value;
  const safe: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SUPPORT_SAFE_DENIED_KEYS.has(key)) continue;
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("secret") ||
      normalizedKey.includes("password") ||
      normalizedKey.includes("phone") ||
      normalizedKey.includes("guest") ||
      normalizedKey.includes("endpoint") ||
      normalizedKey.endsWith("token") ||
      normalizedKey.endsWith("hash")
    ) {
      continue;
    }
    safe[key] = supportSafeValue(entry);
  }
  return safe;
}

export function supportSafeOperationBoard(board: OperationBoard): unknown {
  return supportSafeValue(board);
}

export function currentDispatchPlanRevision(board: OperationBoard): string | null {
  const revisions = [
    ...new Set(
      board.rotations.flatMap((rotation) =>
        rotation.status === "DRAFT" && rotation.dispatchPlan?.revision
          ? [rotation.dispatchPlan.revision]
          : [],
      ),
    ),
  ];
  if (revisions.length > 1) throw new Error("ANALYSIS_SNAPSHOT_DATA_INCOMPLETE");
  return revisions[0] ?? null;
}

function parseJson(value: string, code: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(code);
  }
}

const ANALYSIS_SNAPSHOT_DATA_INCOMPLETE = "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE";

async function loadReplayChain(input: {
  database: D1Database;
  eventId: string;
  expectedEventVersion: number;
  run: PlanningRunExportRow;
}): Promise<PlanningRunLineageRow[]> {
  const replayChain: PlanningRunLineageRow[] = [];
  let lineageRunId: string | null = input.run.id;
  for (let distance = 0; lineageRunId && distance <= 10; distance += 1) {
    const lineageRow: PlanningRunLineageRow | null = await input.database
      .prepare(
        `SELECT id, previous_run_id, anchor_run_id, context_id, operation_day_version,
                replay_distance, calculation_now, captured_at, trigger_event_type, capture_mode,
                source_revision, dispatch_plan_revision, forecast_digest, precall_digest,
                previous_forecast_state_chunk_id, previous_dispatch_state_chunk_id,
                dispatch_result_chunk_id, precall_result_chunk_id
           FROM planning_runs
          WHERE id = ?1 AND operation_day_id = ?2 AND status = 'SUCCEEDED'`,
      )
      .bind(lineageRunId, input.eventId)
      .first<PlanningRunLineageRow>();
    if (
      lineageRow?.operation_day_version !== input.expectedEventVersion ||
      lineageRow.anchor_run_id !== input.run.anchor_run_id
    ) {
      throw new Error(ANALYSIS_SNAPSHOT_DATA_INCOMPLETE);
    }
    replayChain.unshift(lineageRow);
    if (lineageRow.id === input.run.anchor_run_id) break;
    lineageRunId = lineageRow.previous_run_id;
  }
  if (
    replayChain.length < 1 ||
    replayChain[0]?.id !== input.run.anchor_run_id ||
    replayChain.at(-1)?.id !== input.run.id
  ) {
    throw new Error(ANALYSIS_SNAPSHOT_DATA_INCOMPLETE);
  }
  return replayChain;
}

async function loadPlanningContext(input: {
  database: D1Database;
  eventId: string;
  expectedEventVersion: number;
  contextId: string;
}): Promise<{
  context: PlanningContextExportRow;
  manifest: AnalysisSnapshot["planning"]["context"]["manifest"];
}> {
  const context = await input.database
    .prepare(
      `SELECT id, operation_day_version, schema_version, manifest_json, manifest_hash
         FROM planning_contexts WHERE id = ?1 AND operation_day_id = ?2`,
    )
    .bind(input.contextId, input.eventId)
    .first<PlanningContextExportRow>();
  if (context?.operation_day_version !== input.expectedEventVersion) {
    throw new Error(ANALYSIS_SNAPSHOT_DATA_INCOMPLETE);
  }
  const manifest = parseJson(
    context.manifest_json,
    ANALYSIS_SNAPSHOT_DATA_INCOMPLETE,
  ) as AnalysisSnapshot["planning"]["context"]["manifest"];
  if (!Array.isArray(manifest)) throw new Error(ANALYSIS_SNAPSHOT_DATA_INCOMPLETE);
  return { context, manifest };
}

function planningChunkIds(
  manifest: AnalysisSnapshot["planning"]["context"]["manifest"],
  replayChain: readonly PlanningRunLineageRow[],
): string[] {
  const chunkIds = new Set(manifest.map((entry) => entry.chunkId));
  for (const lineageRun of replayChain) {
    for (const chunkId of [
      lineageRun.previous_forecast_state_chunk_id,
      lineageRun.previous_dispatch_state_chunk_id,
      lineageRun.dispatch_result_chunk_id,
      lineageRun.precall_result_chunk_id,
    ]) {
      if (chunkId) chunkIds.add(chunkId);
    }
  }
  return [...chunkIds].sort(compareTechnicalStrings);
}

async function loadPlanningChunks(
  database: D1Database,
  eventId: string,
  ids: readonly string[],
): Promise<PlanningChunkExportRow[]> {
  if (ids.length === 0) return [];
  const chunks = await database
    .prepare(
      `SELECT id, chunk_kind, schema_version, payload_hash, payload_json, byte_size
         FROM planning_chunks
        WHERE operation_day_id = ?1 AND id IN (${ids.map((_, index) => `?${index + 2}`).join(", ")})
        ORDER BY id`,
    )
    .bind(eventId, ...ids)
    .all<PlanningChunkExportRow>();
  if (chunks.results.length !== ids.length) {
    throw new Error(ANALYSIS_SNAPSHOT_DATA_INCOMPLETE);
  }
  return chunks.results;
}

async function loadForecastSnapshots(
  database: D1Database,
  replayChain: readonly PlanningRunLineageRow[],
): Promise<ForecastSnapshotExportRow[]> {
  const replayRunIds = replayChain.map((lineageRun) => lineageRun.id);
  const forecastSnapshots = await database
    .prepare(
      `SELECT id, planning_run_id, rotation_id, captured_at, quality, lower_minutes, upper_minutes,
              predicted_boarding_at, predicted_departure_at, predicted_landing_at,
              predicted_completion_at, dispatch_plan_revision
         FROM forecast_snapshots
        WHERE planning_run_id IN (${replayRunIds.map((_, index) => `?${index + 1}`).join(", ")})
        ORDER BY captured_at, rotation_id, id`,
    )
    .bind(...replayRunIds)
    .all<ForecastSnapshotExportRow>();
  const dispatchRevisionByRunId = new Map(
    replayChain.map((lineageRun) => [lineageRun.id, lineageRun.dispatch_plan_revision]),
  );
  const hasMismatchedRevision = forecastSnapshots.results.some(
    (snapshot) =>
      snapshot.dispatch_plan_revision !== dispatchRevisionByRunId.get(snapshot.planning_run_id),
  );
  if (hasMismatchedRevision) throw new Error(ANALYSIS_SNAPSHOT_DATA_INCOMPLETE);
  return forecastSnapshots.results;
}

export async function buildAnalysisSnapshot(input: {
  env: Env;
  eventId: string;
  expectedEventVersion: number;
  planningRunId: string;
  operationBoard: OperationBoard;
  capturedAt?: string;
}): Promise<AnalysisSnapshot> {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const event = await input.env.DB.prepare(
    "SELECT event_date, time_zone, version FROM operation_days WHERE id = ?1",
  )
    .bind(input.eventId)
    .first<AnalysisEventRow>();
  if (event?.version !== input.expectedEventVersion) {
    throw new Error("ANALYSIS_SNAPSHOT_CHANGED");
  }
  const dispatchRevision = currentDispatchPlanRevision(input.operationBoard);
  const run = await input.env.DB.prepare(
    `SELECT run.id, run.operation_day_version, run.context_id, run.anchor_run_id,
            run.replay_distance, run.calculation_now, run.captured_at, run.trigger_event_type,
            run.capture_mode, run.source_revision, run.dispatch_plan_revision,
            run.forecast_digest, run.precall_digest, run.duration_ms, run.capture_duration_ms,
            run.previous_forecast_state_chunk_id, run.previous_dispatch_state_chunk_id,
            run.dispatch_result_chunk_id, run.precall_result_chunk_id,
            anchor.previous_forecast_state_chunk_id AS anchor_previous_forecast_state_chunk_id,
            anchor.previous_dispatch_state_chunk_id AS anchor_previous_dispatch_state_chunk_id,
            anchor.dispatch_result_chunk_id AS anchor_dispatch_result_chunk_id,
            anchor.precall_result_chunk_id AS anchor_precall_result_chunk_id
       FROM planning_runs run
       JOIN planning_runs anchor ON anchor.id = run.anchor_run_id
      WHERE run.id = ?1 AND run.operation_day_id = ?2 AND run.operation_day_version = ?3
        AND run.status = 'SUCCEEDED'`,
  )
    .bind(input.planningRunId, input.eventId, input.expectedEventVersion)
    .first<PlanningRunExportRow>();
  if (!run) throw new Error("ANALYSIS_SNAPSHOT_NOT_READY");
  if (dispatchRevision !== null && run.dispatch_plan_revision !== dispatchRevision) {
    throw new Error("ANALYSIS_SNAPSHOT_CHANGED");
  }
  const replayChain = await loadReplayChain({
    database: input.env.DB,
    eventId: input.eventId,
    expectedEventVersion: input.expectedEventVersion,
    run,
  });
  const { context, manifest } = await loadPlanningContext({
    database: input.env.DB,
    eventId: input.eventId,
    expectedEventVersion: input.expectedEventVersion,
    contextId: run.context_id,
  });
  const chunks = await loadPlanningChunks(
    input.env.DB,
    input.eventId,
    planningChunkIds(manifest, replayChain),
  );
  const forecastSnapshots = await loadForecastSnapshots(input.env.DB, replayChain);

  const snapshot: AnalysisSnapshot = {
    format: "rundflug-analysis-snapshot",
    formatVersion: 1,
    manifest: {
      exportId: crypto.randomUUID(),
      capturedAt,
      applicationVersion: APP_VERSION,
      requirementsVersion: REQUIREMENTS_VERSION,
      sourceRevision: run.source_revision,
      environment: input.env.APP_ENV,
      privacyProfile: "SUPPORT_SAFE",
      eventId: input.eventId,
      eventVersion: event.version,
      eventDate: event.event_date,
      timeZone: event.time_zone,
      planningRunId: run.id,
      planningRunEventVersion: run.operation_day_version,
      dispatchPlanRevision: run.dispatch_plan_revision,
      schemaVersions: {
        snapshot: 1,
        planningContext: context.schema_version,
        planningRun: 1,
      },
    },
    currentState: {
      operationBoard: supportSafeOperationBoard(input.operationBoard) as never,
    },
    planning: {
      metadata: {
        mode: run.capture_mode,
        contextId: context.id,
        anchorRunId: run.anchor_run_id,
        replayDistance: run.replay_distance,
      },
      run: {
        id: run.id,
        eventVersion: run.operation_day_version,
        calculationNow: run.calculation_now,
        capturedAt: run.captured_at,
        trigger: run.trigger_event_type,
        sourceRevision: run.source_revision,
        dispatchPlanRevision: run.dispatch_plan_revision,
        forecastDigest: run.forecast_digest,
        precallDigest: run.precall_digest,
        durationMs: run.duration_ms,
        captureDurationMs: run.capture_duration_ms ?? 0,
      },
      replayChain: replayChain.map((lineageRun) => ({
        id: lineageRun.id,
        previousRunId: lineageRun.previous_run_id,
        anchorRunId: lineageRun.anchor_run_id,
        contextId: lineageRun.context_id,
        eventVersion: lineageRun.operation_day_version,
        replayDistance: lineageRun.replay_distance,
        calculationNow: lineageRun.calculation_now,
        capturedAt: lineageRun.captured_at,
        trigger: lineageRun.trigger_event_type,
        mode: lineageRun.capture_mode,
        sourceRevision: lineageRun.source_revision,
        dispatchPlanRevision: lineageRun.dispatch_plan_revision,
        forecastDigest: lineageRun.forecast_digest,
        precallDigest: lineageRun.precall_digest,
        previousForecastStateChunkId: lineageRun.previous_forecast_state_chunk_id,
        previousDispatchStateChunkId: lineageRun.previous_dispatch_state_chunk_id,
        dispatchResultChunkId: lineageRun.dispatch_result_chunk_id,
        precallResultChunkId: lineageRun.precall_result_chunk_id,
      })),
      context: {
        id: context.id,
        eventVersion: context.operation_day_version,
        schemaVersion: context.schema_version,
        manifestHash: context.manifest_hash,
        manifest,
      },
      chunks: chunks.map((chunk) => ({
        id: chunk.id,
        kind: chunk.chunk_kind,
        schemaVersion: chunk.schema_version,
        hash: chunk.payload_hash,
        byteSize: chunk.byte_size,
        payload: parseJson(chunk.payload_json, "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE") as never,
      })),
      forecastSnapshots: forecastSnapshots.map((snapshot) => ({
        id: snapshot.id,
        planningRunId: snapshot.planning_run_id,
        rotationId: snapshot.rotation_id,
        capturedAt: snapshot.captured_at,
        quality: snapshot.quality,
        lowerMinutes: snapshot.lower_minutes,
        upperMinutes: snapshot.upper_minutes,
        predictedBoardingAt: snapshot.predicted_boarding_at,
        predictedDepartureAt: snapshot.predicted_departure_at,
        predictedLandingAt: snapshot.predicted_landing_at,
        predictedCompletionAt: snapshot.predicted_completion_at,
        dispatchPlanRevision: snapshot.dispatch_plan_revision,
      })),
    },
    client: null,
  };
  return analysisSnapshotSchema.parse(snapshot);
}
