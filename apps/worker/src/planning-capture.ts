import { APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import type {
  AutomaticPrecallQueueDecision,
  AutomaticPrecallQueueEntry,
  ForecastCalculationResult,
  ForecastTimelinesInput,
} from "@rundflug/domain";
import { sha256Hex } from "./crypto";
import type { Env } from "./types";

export const PLANNING_CAPTURE_SCHEMA_VERSION = 1;
export const PLANNING_CHUNK_ENTITY_LIMIT = 50;
export const PLANNING_ANCHOR_INTERVAL_MS = 5 * 60_000;
export const PLANNING_MAX_REPLAY_DISTANCE = 10;

export type PlanningCaptureMode = "REFERENCE" | "CHANGE" | "ANCHOR";

export type PlanningChunkKind =
  | "EVENT_CONFIGURATION"
  | "ROTATIONS_QUEUE"
  | "CAPACITIES"
  | "DURATION_SAMPLES"
  | "OPERATIONAL_CONSTRAINTS"
  | "PREVIOUS_FORECAST_STATE"
  | "PREVIOUS_DISPATCH_STATE"
  | "DISPATCH_RESULT"
  | "PRECALL_RESULT";

export interface PlanningCaptureMetadata {
  mode: PlanningCaptureMode;
  contextId: string;
  anchorRunId: string;
  replayDistance: number;
}

export interface PreparedPlanningCapture extends PlanningCaptureMetadata {
  runId: string;
  startedAtMs: number;
}

interface PlanningChunkManifestEntry {
  kind: PlanningChunkKind;
  partitionKey: string;
  chunkId: string;
}

interface CanonicalPlanningChunk {
  id: string;
  kind: PlanningChunkKind;
  hash: string;
  schemaVersion: number;
  json: string;
  byteSize: number;
}

interface PreviousPlanningRunRow {
  id: string;
  context_id: string;
  anchor_run_id: string | null;
  replay_distance: number;
  calculation_now: string;
  anchor_calculation_now: string | null;
  dispatch_plan_revision: string;
  forecast_digest: string;
  forecast_semantic_digest: string;
  precall_digest: string;
  source_revision: string;
}

interface PlanningContextRow {
  id: string;
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | CanonicalJsonMap;
interface CanonicalJsonMap {
  [key: string]: CanonicalJsonValue;
}

function canonicalValue(value: unknown, path: string): CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Planning value at ${path} is not finite.`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Planning value at ${path} is not a plain object.`);
    }
    const result: CanonicalJsonMap = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = canonicalValue(entry, `${path}.${key}`);
    }
    return result;
  }
  throw new Error(`Planning value at ${path} cannot be serialized.`);
}

export function canonicalPlanningJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, "$"));
}

export async function canonicalPlanningChunk(
  kind: PlanningChunkKind,
  value: unknown,
): Promise<CanonicalPlanningChunk> {
  const json = canonicalPlanningJson(value);
  const hash = await sha256Hex(json);
  const identityHash = await sha256Hex(`${kind}:${PLANNING_CAPTURE_SCHEMA_VERSION}:${hash}`);
  return {
    id: `planning-chunk-${identityHash}`,
    kind,
    hash,
    schemaVersion: PLANNING_CAPTURE_SCHEMA_VERSION,
    json,
    byteSize: new TextEncoder().encode(json).byteLength,
  };
}

function normalizedSourceRevision(env: Env): string {
  return env.SOURCE_REVISION?.trim() || "unknown";
}

function partitionKeySegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "default";
}

function partitionEntities<T>(
  kind: PlanningChunkKind,
  entities: readonly T[],
  groupOf: (entity: T) => string,
  idOf: (entity: T) => string,
): Array<{ kind: PlanningChunkKind; partitionKey: string; value: T[] }> {
  const grouped = new Map<string, T[]>();
  for (const entity of entities) {
    const group = groupOf(entity);
    const values = grouped.get(group) ?? [];
    values.push(entity);
    grouped.set(group, values);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([group, values]) => {
      const sorted = [...values].sort((left, right) => idOf(left).localeCompare(idOf(right)));
      const chunks: Array<{ kind: PlanningChunkKind; partitionKey: string; value: T[] }> = [];
      for (let offset = 0; offset < sorted.length; offset += PLANNING_CHUNK_ENTITY_LIMIT) {
        chunks.push({
          kind,
          partitionKey: `${partitionKeySegment(group)}:${Math.floor(offset / PLANNING_CHUNK_ENTITY_LIMIT)}`,
          value: sorted.slice(offset, offset + PLANNING_CHUNK_ENTITY_LIMIT),
        });
      }
      return chunks;
    });
}

export function planningContextChunkValues(input: ForecastTimelinesInput): Array<{
  kind: PlanningChunkKind;
  partitionKey: string;
  value: unknown;
}> {
  const { now: _calculationNow, ...eventConfiguration } = input.event;
  const rotations = input.rotations.map((rotation) => {
    const {
      constraints: _constraints,
      turnaroundProfiles: _turnaroundProfiles,
      confirmedTurnaroundProfile: _confirmedTurnaroundProfile,
      predictedDepartureAt: _predictedDepartureAt,
      predictedLandingAt: _predictedLandingAt,
      predictedCompletionAt: _predictedCompletionAt,
      ...base
    } = rotation;
    return base;
  });
  const capacities = input.capacities.map((capacity) => ({
    ...capacity,
    sharedConstraints: undefined,
    availabilityLanes: capacity.availabilityLanes?.map((lane) => ({
      ...lane,
      constraints: undefined,
      recurringConstraints: undefined,
    })),
  }));
  const operationalConstraints = [
    ...input.rotations.map((rotation) => ({
      id: `rotation:${rotation.id}`,
      resourceGroupId: rotation.resourceGroupId,
      constraints: rotation.constraints ?? [],
      turnaroundProfiles: rotation.turnaroundProfiles ?? [],
      confirmedTurnaroundProfile: rotation.confirmedTurnaroundProfile ?? null,
    })),
    ...input.capacities.map((capacity) => ({
      id: `capacity:${capacity.resourceGroupId}`,
      resourceGroupId: capacity.resourceGroupId,
      sharedConstraints: capacity.sharedConstraints ?? [],
      lanes: (capacity.availabilityLanes ?? []).map((lane) => ({
        laneId: lane.laneId,
        constraints: lane.constraints ?? [],
        recurringConstraints: lane.recurringConstraints ?? [],
      })),
    })),
  ];
  const durationSamples = input.durationSamples.map((sample, index) => ({
    ...sample,
    stableId: [
      sample.eventId,
      sample.productCode,
      sample.aircraftType ?? "",
      sample.completedAt,
      String(sample.minutes),
      String(index),
    ].join(":"),
  }));
  return [
    {
      kind: "EVENT_CONFIGURATION",
      partitionKey: "event:0",
      value: {
        event: eventConfiguration,
        tuning: input.tuning ?? null,
        dispatchPlanningLimits: input.dispatchPlanningLimits ?? null,
      },
    },
    ...partitionEntities(
      "ROTATIONS_QUEUE",
      rotations,
      (rotation) => rotation.resourceGroupId,
      (rotation) => rotation.id,
    ),
    ...partitionEntities(
      "CAPACITIES",
      capacities,
      (capacity) => capacity.resourceGroupId,
      (capacity) => capacity.resourceGroupId,
    ),
    ...partitionEntities(
      "DURATION_SAMPLES",
      durationSamples,
      (sample) => `${sample.productCode}:${sample.aircraftType ?? "default"}`,
      (sample) => sample.stableId,
    ).map((chunk) => ({
      ...chunk,
      value: chunk.value.map(({ stableId: _stableId, ...sample }) => sample),
    })),
    ...partitionEntities(
      "OPERATIONAL_CONSTRAINTS",
      operationalConstraints,
      (entry) => entry.resourceGroupId,
      (entry) => entry.id,
    ),
  ];
}

async function persistChunks(
  env: Env,
  operationDayId: string,
  capturedAt: string,
  values: Array<{ kind: PlanningChunkKind; partitionKey: string; value: unknown }>,
): Promise<{ chunks: CanonicalPlanningChunk[]; manifest: PlanningChunkManifestEntry[] }> {
  const chunks = await Promise.all(
    values.map(({ kind, value }) => canonicalPlanningChunk(kind, value)),
  );
  if (chunks.length > 0) {
    await env.DB.batch(
      chunks.map((chunk) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO planning_chunks
            (id, operation_day_id, chunk_kind, schema_version, payload_hash, payload_json,
             byte_size, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        ).bind(
          chunk.id,
          operationDayId,
          chunk.kind,
          chunk.schemaVersion,
          chunk.hash,
          chunk.json,
          chunk.byteSize,
          capturedAt,
        ),
      ),
    );
  }
  return {
    chunks,
    manifest: values
      .map((value, index) => ({
        kind: value.kind,
        partitionKey: value.partitionKey,
        chunkId: chunks[index]?.id ?? "",
      }))
      .sort(
        (left, right) =>
          left.kind.localeCompare(right.kind) ||
          left.partitionKey.localeCompare(right.partitionKey),
      ),
  };
}

async function resolveContext(input: {
  env: Env;
  eventId: string;
  eventVersion: number;
  capturedAt: string;
  forecastInput: ForecastTimelinesInput;
  previousContextId: string | null;
  anchorReason: string | null;
}): Promise<string> {
  const existing = await input.env.DB.prepare(
    `SELECT id FROM planning_contexts
      WHERE operation_day_id = ?1 AND operation_day_version = ?2 AND schema_version = ?3`,
  )
    .bind(input.eventId, input.eventVersion, PLANNING_CAPTURE_SCHEMA_VERSION)
    .first<PlanningContextRow>();
  if (existing) return existing.id;

  const { manifest } = await persistChunks(
    input.env,
    input.eventId,
    input.capturedAt,
    planningContextChunkValues(input.forecastInput),
  );
  const manifestJson = canonicalPlanningJson(manifest);
  const manifestHash = await sha256Hex(manifestJson);
  const contextIdentity = await sha256Hex(
    `${input.eventId}:${input.eventVersion}:${PLANNING_CAPTURE_SCHEMA_VERSION}:${manifestHash}`,
  );
  const contextId = `planning-context-${contextIdentity}`;
  await input.env.DB.prepare(
    `INSERT OR IGNORE INTO planning_contexts
      (id, operation_day_id, operation_day_version, schema_version, previous_context_id,
       manifest_json, manifest_hash, anchor_reason, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      contextId,
      input.eventId,
      input.eventVersion,
      PLANNING_CAPTURE_SCHEMA_VERSION,
      input.previousContextId,
      manifestJson,
      manifestHash,
      input.anchorReason,
      input.capturedAt,
    )
    .run();
  return contextId;
}

function anchorReason(input: {
  triggerEventType: string;
  contextChanged: boolean;
  sourceRevision: string;
  previous: PreviousPlanningRunRow | null;
  dispatchRevision: string;
  forecastSemanticDigest: string;
  precallDigest: string;
  calculationNow: string;
}): string | null {
  if (!input.previous) return "INITIAL_RUN";
  if (input.triggerEventType !== "AUTOMATIC_FORECAST_TICK") {
    return `TRIGGER:${input.triggerEventType}`;
  }
  if (input.contextChanged) return "CONTEXT_CHANGED";
  if (input.previous.source_revision !== input.sourceRevision) return "SOURCE_REVISION_CHANGED";
  if (input.previous.dispatch_plan_revision !== input.dispatchRevision) {
    return "DISPATCH_REVISION_CHANGED";
  }
  if (input.previous.precall_digest !== input.precallDigest) return "PRECALL_DECISION_CHANGED";
  if (input.previous.forecast_semantic_digest !== input.forecastSemanticDigest) {
    return "FORECAST_SEMANTICS_CHANGED";
  }
  const anchorAt = Date.parse(
    input.previous.anchor_calculation_now ?? input.previous.calculation_now,
  );
  const calculationAt = Date.parse(input.calculationNow);
  if (
    !Number.isFinite(anchorAt) ||
    !Number.isFinite(calculationAt) ||
    calculationAt - anchorAt >= PLANNING_ANCHOR_INTERVAL_MS ||
    input.previous.replay_distance >= PLANNING_MAX_REPLAY_DISTANCE - 1
  ) {
    return "PERIODIC_ANCHOR";
  }
  return null;
}

async function resultDigests(
  result: ForecastCalculationResult,
  precallDecisions: readonly AutomaticPrecallQueueDecision[],
): Promise<{
  forecastDigest: string;
  forecastSemanticDigest: string;
  precallDigest: string;
}> {
  const forecastDigest = await sha256Hex(canonicalPlanningJson(result.projections));
  const forecastSemanticDigest = await sha256Hex(
    canonicalPlanningJson(
      result.projections.map((projection) => ({
        rotationId: projection.rotationId,
        forecastState: projection.forecastState,
        predictionQuality: projection.predictionQuality,
        capacityStatus: projection.capacityStatus,
        uncertaintyReasons: projection.uncertaintyReasons,
        extendsBeyondOperationsEnd: projection.extendsBeyondOperationsEnd,
        overtimeMinutes: projection.overtimeMinutes,
      })),
    ),
  );
  const precallDigest = await sha256Hex(canonicalPlanningJson(precallDecisions));
  return { forecastDigest, forecastSemanticDigest, precallDigest };
}

export async function preparePlanningCapture(input: {
  env: Env;
  eventId: string;
  eventVersion: number;
  calculationNow: string;
  capturedAt: string;
  triggerEventType: string;
  forecastInput: ForecastTimelinesInput;
  calculationResult: ForecastCalculationResult;
  precallInput: readonly AutomaticPrecallQueueEntry[];
  precallOutput: readonly AutomaticPrecallQueueDecision[];
  durationMs: number;
  runId?: string;
}): Promise<PreparedPlanningCapture> {
  const startedAtMs = performance.now();
  const sourceRevision = normalizedSourceRevision(input.env);
  const previous = await input.env.DB.prepare(
    `SELECT run.id, run.context_id, run.anchor_run_id, run.replay_distance,
            run.calculation_now, anchor.calculation_now AS anchor_calculation_now,
            run.dispatch_plan_revision, run.forecast_digest, run.forecast_semantic_digest,
            run.precall_digest, run.source_revision
       FROM planning_runs run
       LEFT JOIN planning_runs anchor ON anchor.id = run.anchor_run_id
      WHERE run.operation_day_id = ?1 AND run.status = 'SUCCEEDED'
      ORDER BY run.calculation_now DESC, run.captured_at DESC LIMIT 1`,
  )
    .bind(input.eventId)
    .first<PreviousPlanningRunRow>();
  const { forecastDigest, forecastSemanticDigest, precallDigest } = await resultDigests(
    input.calculationResult,
    input.precallOutput,
  );
  const dispatchRevision = input.calculationResult.diagnostics.dispatchPlan.revision;
  const contextChanged =
    !previous ||
    !(await input.env.DB.prepare(
      `SELECT id FROM planning_contexts
        WHERE id = ?1 AND operation_day_version = ?2 AND schema_version = ?3`,
    )
      .bind(previous.context_id, input.eventVersion, PLANNING_CAPTURE_SCHEMA_VERSION)
      .first<PlanningContextRow>());
  const reason = anchorReason({
    triggerEventType: input.triggerEventType,
    contextChanged,
    sourceRevision,
    previous: previous ?? null,
    dispatchRevision,
    forecastSemanticDigest,
    precallDigest,
    calculationNow: input.calculationNow,
  });
  const mode: PlanningCaptureMode = reason ? "ANCHOR" : "REFERENCE";
  const runId = input.runId ?? crypto.randomUUID();
  const contextId = await resolveContext({
    env: input.env,
    eventId: input.eventId,
    eventVersion: input.eventVersion,
    capturedAt: input.capturedAt,
    forecastInput: input.forecastInput,
    previousContextId: previous?.context_id ?? null,
    anchorReason: reason,
  });

  let previousForecastStateChunkId: string | null = null;
  let previousDispatchStateChunkId: string | null = null;
  let dispatchResultChunkId: string | null = null;
  let precallResultChunkId: string | null = null;
  if (mode !== "REFERENCE") {
    const persisted = await persistChunks(input.env, input.eventId, input.capturedAt, [
      {
        kind: "PREVIOUS_FORECAST_STATE",
        partitionKey: "run:0",
        value: input.forecastInput.rotations.map((rotation) => ({
          rotationId: rotation.id,
          predictedDepartureAt: rotation.predictedDepartureAt,
          predictedLandingAt: rotation.predictedLandingAt,
          predictedCompletionAt: rotation.predictedCompletionAt,
        })),
      },
      {
        kind: "PREVIOUS_DISPATCH_STATE",
        partitionKey: "run:0",
        value: input.forecastInput.previousDispatchPlan ?? null,
      },
      {
        kind: "DISPATCH_RESULT",
        partitionKey: "run:0",
        value: input.calculationResult.diagnostics.dispatchPlan,
      },
      {
        kind: "PRECALL_RESULT",
        partitionKey: "run:0",
        value: { input: input.precallInput, output: input.precallOutput },
      },
    ]);
    previousForecastStateChunkId = persisted.chunks[0]?.id ?? null;
    previousDispatchStateChunkId = persisted.chunks[1]?.id ?? null;
    dispatchResultChunkId = persisted.chunks[2]?.id ?? null;
    precallResultChunkId = persisted.chunks[3]?.id ?? null;
  }

  const anchorRunId =
    mode === "ANCHOR" ? runId : (previous?.anchor_run_id ?? previous?.id ?? runId);
  const replayDistance =
    mode === "ANCHOR"
      ? 0
      : Math.min(PLANNING_MAX_REPLAY_DISTANCE, (previous?.replay_distance ?? 0) + 1);
  await input.env.DB.prepare(
    `INSERT INTO planning_runs
      (id, operation_day_id, operation_day_version, context_id, previous_run_id, anchor_run_id,
       replay_distance, calculation_now, captured_at, trigger_event_type, capture_mode,
       anchor_reason, application_version, requirements_version, source_revision,
       dispatch_plan_revision, forecast_digest, forecast_semantic_digest, precall_digest,
       previous_forecast_state_chunk_id, previous_dispatch_state_chunk_id,
       dispatch_result_chunk_id, precall_result_chunk_id, duration_ms, capture_duration_ms,
       status, failure_code)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
             ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, NULL, 'CAPTURING', NULL)`,
  )
    .bind(
      runId,
      input.eventId,
      input.eventVersion,
      contextId,
      previous?.id ?? null,
      anchorRunId,
      replayDistance,
      input.calculationNow,
      input.capturedAt,
      input.triggerEventType,
      mode,
      reason,
      APP_VERSION,
      REQUIREMENTS_VERSION,
      sourceRevision,
      dispatchRevision,
      forecastDigest,
      forecastSemanticDigest,
      precallDigest,
      previousForecastStateChunkId,
      previousDispatchStateChunkId,
      dispatchResultChunkId,
      precallResultChunkId,
      input.durationMs,
    )
    .run();
  return { runId, mode, contextId, anchorRunId, replayDistance, startedAtMs };
}

export async function completePlanningCapture(
  env: Env,
  capture: PreparedPlanningCapture,
): Promise<void> {
  const captureDurationMs = Math.max(0, performance.now() - capture.startedAtMs);
  const completed = await env.DB.prepare(
    `UPDATE planning_runs
        SET status = 'SUCCEEDED', capture_duration_ms = ?1
      WHERE id = ?2 AND status = 'CAPTURING'`,
  )
    .bind(captureDurationMs, capture.runId)
    .run();
  if ((completed.meta.changes ?? 0) !== 1) {
    throw new Error("PLANNING_CAPTURE_COMPLETION_FAILED");
  }
}

export async function failPlanningCapture(
  env: Env,
  capture: PreparedPlanningCapture,
  failureCode = "PLANNING_PERSISTENCE_FAILED",
): Promise<void> {
  const captureDurationMs = Math.max(0, performance.now() - capture.startedAtMs);
  await env.DB.prepare(
    `UPDATE planning_runs
        SET status = 'FAILED', capture_duration_ms = ?1, failure_code = ?2
      WHERE id = ?3 AND status = 'CAPTURING'`,
  )
    .bind(captureDurationMs, failureCode, capture.runId)
    .run();
}
