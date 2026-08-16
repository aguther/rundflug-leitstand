import { APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import type {
  PlanningHistoryContinuation,
  PlanningHistoryPackageEntry,
  PlanningHistoryPackageManifest,
} from "@rundflug/contracts/planning-history";
import { StreamingZipWriter, uploadMultipartStream } from "./analysis-archive-writer";
import { sha256Hex } from "./crypto";
import type { Env } from "./types";

const PACKAGE_FORMAT = "rundflug-planning-history";
const PACKAGE_FORMAT_VERSION = 1;
const SYSTEM_EVENT_ID_PREFIX = "planning-history-event";
const QUERY_PAGE_SIZE = 250;
const MAX_WORKFLOW_CANDIDATES = 100;

export const planningHistoryPruneLimits = {
  forecastSnapshots: 10_000,
  planningRuns: 500,
  planningContexts: 250,
  planningChunks: 500,
} as const;

export type PlanningHistoryCompactionState =
  | "PENDING"
  | "BUILDING"
  | "VERIFIED"
  | "PRUNING"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED"
  | "DELETED";

interface CompactionRow {
  id: string;
  operation_day_id: string;
  format_version: 1;
  privacy_profile: "SUPPORT_SAFE";
  status: PlanningHistoryCompactionState;
  segment_start_run_id: string;
  segment_start_captured_at: string;
  segment_end_run_id: string;
  segment_end_captured_at: string;
  continuation_run_id: string | null;
  continuation_context_id: string | null;
  continuation_previous_run_id: string | null;
  continuation_anchor_run_id: string | null;
  continuation_previous_context_id: string | null;
  terminal_segment: number;
  object_key: string;
  checksum_key: string;
  object_sha256: string | null;
  object_etag: string | null;
  object_size_bytes: number | null;
  entry_counts_json: string;
  source_revision: string;
  application_version: string;
  requirements_version: string;
  requested_at: string;
  workflow_dispatched_at: string | null;
  expires_at: string;
  version: number;
}

interface EventCandidateRow {
  id: string;
  event_date: string;
  status: "ACTIVE" | "CLOSED" | "ARCHIVED";
  operations_end_at: string | null;
  archived_at: string | null;
  updated_at: string;
}

interface PlanningRunBoundaryRow {
  id: string;
  context_id: string;
  previous_run_id: string | null;
  anchor_run_id: string | null;
  captured_at: string;
  status: "CAPTURING" | "SUCCEEDED" | "FAILED";
}

interface PlanningContextBoundaryRow {
  previous_context_id: string | null;
}

interface PackageProjection {
  path: PlanningHistoryPackageEntry["path"];
  sql: string;
}

const packageProjections: readonly PackageProjection[] = [
  {
    path: "planning/runs.ndjson",
    sql: `SELECT * FROM planning_runs
           WHERE operation_day_id = ?1
             AND (captured_at < ?2 OR (captured_at = ?2 AND id <= ?3))
           ORDER BY captured_at, id`,
  },
  {
    path: "planning/contexts.ndjson",
    sql: `SELECT * FROM planning_contexts
           WHERE operation_day_id = ?1 AND created_at <= ?2
           ORDER BY created_at, id`,
  },
  {
    path: "planning/chunks.ndjson",
    sql: `SELECT * FROM planning_chunks
           WHERE operation_day_id = ?1 AND created_at <= ?2
           ORDER BY created_at, id`,
  },
  {
    path: "history/forecast-snapshots.ndjson",
    sql: `SELECT snapshot.* FROM forecast_snapshots snapshot
           JOIN planning_runs run ON run.id = snapshot.planning_run_id
          WHERE run.operation_day_id = ?1
            AND (run.captured_at < ?2 OR (run.captured_at = ?2 AND run.id <= ?3))
          ORDER BY snapshot.captured_at, snapshot.id`,
  },
] as const;

function normalizedSourceRevision(env: Env): string {
  const value = env.SOURCE_REVISION?.trim() || "unknown";
  return /^[a-zA-Z0-9._-]{1,128}$/.test(value) ? value : "unknown";
}

function parseBoundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  requiredCode: string,
  invalidCode: string,
  production: boolean,
): number {
  const value = raw?.trim();
  if (!value) {
    if (production) throw new Error(requiredCode);
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!/^\d+$/.test(value) || parsed < minimum || parsed > maximum) {
    throw new Error(invalidCode);
  }
  return parsed;
}

export function planningDetailRetentionHours(env: Env): number {
  return parseBoundedInteger(
    env.PLANNING_DETAIL_RETENTION_HOURS,
    24,
    24,
    168,
    "PLANNING_DETAIL_RETENTION_HOURS_REQUIRED",
    "PLANNING_DETAIL_RETENTION_HOURS_INVALID",
    env.APP_ENV === "production",
  );
}

export function planningHistoryRetentionYears(env: Env): number {
  return parseBoundedInteger(
    env.PLANNING_HISTORY_RETENTION_YEARS,
    5,
    5,
    10,
    "PLANNING_HISTORY_RETENTION_YEARS_REQUIRED",
    "PLANNING_HISTORY_RETENTION_YEARS_INVALID",
    env.APP_ENV === "production",
  );
}

function addCalendarYears(date: Date, years: number): string {
  const retainedUntil = new Date(date);
  retainedUntil.setUTCFullYear(retainedUntil.getUTCFullYear() + years);
  return retainedUntil.toISOString();
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Stream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const workerCrypto = crypto as Crypto & { DigestStream: typeof DigestStream };
  const digest = new workerCrypto.DigestStream("SHA-256");
  await stream.pipeTo(digest);
  return bytesToHex(await digest.digest);
}

async function compactionById(env: Env, id: string): Promise<CompactionRow | null> {
  return env.DB.prepare("SELECT * FROM planning_history_compactions WHERE id = ?1")
    .bind(id)
    .first<CompactionRow>();
}

function lifecycleEventStatement(input: {
  env: Env;
  compaction: Pick<CompactionRow, "id" | "operation_day_id">;
  eventType:
    | "COMPACTION_REQUESTED"
    | "PACKAGE_BUILD_STARTED"
    | "PACKAGE_VERIFIED"
    | "PRUNING_STARTED"
    | "COMPACTION_COMPLETED"
    | "COMPACTION_FAILED"
    | "PACKAGE_EXPIRED"
    | "PACKAGE_DELETED";
  occurredAt: string;
  details?: Record<string, unknown>;
}): D1PreparedStatement {
  return input.env.DB.prepare(
    `INSERT INTO planning_history_compaction_events
      (id, compaction_id, operation_day_id, event_type, occurred_at, details_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(
    `${SYSTEM_EVENT_ID_PREFIX}-${crypto.randomUUID()}`,
    input.compaction.id,
    input.compaction.operation_day_id,
    input.eventType,
    input.occurredAt,
    JSON.stringify(input.details ?? {}),
  );
}

async function firstRun(env: Env, eventId: string): Promise<PlanningRunBoundaryRow | null> {
  return env.DB.prepare(
    `SELECT id, context_id, previous_run_id, anchor_run_id, captured_at, status
       FROM planning_runs WHERE operation_day_id = ?1 ORDER BY captured_at, id LIMIT 1`,
  )
    .bind(eventId)
    .first<PlanningRunBoundaryRow>();
}

async function terminalBoundary(
  env: Env,
  event: EventCandidateRow,
  cutoff: string,
): Promise<{ end: PlanningRunBoundaryRow; continuation: null } | null> {
  const terminalAt = event.archived_at ?? event.operations_end_at ?? event.updated_at;
  if (terminalAt > cutoff) return null;
  const end = await env.DB.prepare(
    `SELECT id, context_id, previous_run_id, anchor_run_id, captured_at, status
       FROM planning_runs WHERE operation_day_id = ?1 ORDER BY captured_at DESC, id DESC LIMIT 1`,
  )
    .bind(event.id)
    .first<PlanningRunBoundaryRow>();
  return end ? { end, continuation: null } : null;
}

async function rollingBoundary(
  env: Env,
  eventId: string,
  cutoff: string,
): Promise<{
  end: PlanningRunBoundaryRow;
  continuation: PlanningRunBoundaryRow;
} | null> {
  const continuation = await env.DB.prepare(
    `SELECT id, context_id, previous_run_id, anchor_run_id, captured_at, status
       FROM planning_runs
      WHERE operation_day_id = ?1 AND capture_mode = 'ANCHOR'
        AND captured_at <= ?2 AND status IN ('SUCCEEDED', 'FAILED')
      ORDER BY captured_at DESC, id DESC LIMIT 1`,
  )
    .bind(eventId, cutoff)
    .first<PlanningRunBoundaryRow>();
  if (!continuation?.previous_run_id) return null;
  const end = await env.DB.prepare(
    `SELECT id, context_id, previous_run_id, anchor_run_id, captured_at, status
       FROM planning_runs WHERE id = ?1 AND operation_day_id = ?2`,
  )
    .bind(continuation.previous_run_id, eventId)
    .first<PlanningRunBoundaryRow>();
  return end ? { end, continuation } : null;
}

async function createCompactionForEvent(
  env: Env,
  event: EventCandidateRow,
  cutoff: string,
  now: Date,
): Promise<string | null> {
  const existing = await env.DB.prepare(
    `SELECT id, status, workflow_dispatched_at FROM planning_history_compactions
      WHERE operation_day_id = ?1
        AND status IN ('PENDING', 'BUILDING', 'VERIFIED', 'PRUNING') LIMIT 1`,
  )
    .bind(event.id)
    .first<Pick<CompactionRow, "id" | "status" | "workflow_dispatched_at">>();
  if (existing) {
    return existing.status === "PENDING" && !existing.workflow_dispatched_at ? existing.id : null;
  }
  const boundary =
    event.status === "ACTIVE"
      ? await rollingBoundary(env, event.id, cutoff)
      : await terminalBoundary(env, event, cutoff);
  if (!boundary) return null;
  const start = await firstRun(env, event.id);
  if (!start || start.id === boundary.continuation?.id) return null;
  const capturing = await env.DB.prepare(
    `SELECT id FROM planning_runs
      WHERE operation_day_id = ?1 AND status = 'CAPTURING'
        AND (captured_at < ?2 OR (captured_at = ?2 AND id <= ?3)) LIMIT 1`,
  )
    .bind(event.id, boundary.end.captured_at, boundary.end.id)
    .first<{ id: string }>();
  if (capturing) return null;
  const continuationContext = boundary.continuation
    ? await env.DB.prepare("SELECT previous_context_id FROM planning_contexts WHERE id = ?1")
        .bind(boundary.continuation.context_id)
        .first<PlanningContextBoundaryRow>()
    : null;
  const identity = await sha256Hex(
    `${PACKAGE_FORMAT}:${PACKAGE_FORMAT_VERSION}:${event.id}:${boundary.end.id}`,
  );
  const id = `planning-history-${identity.slice(0, 32)}`;
  const objectKey = `planning-history/${event.id}/${event.event_date}/${id}.zip`;
  const requestedAt = now.toISOString();
  const inserted = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO planning_history_compactions
        (id, operation_day_id, format_version, privacy_profile, status,
         segment_start_run_id, segment_start_captured_at, segment_end_run_id,
         segment_end_captured_at, continuation_run_id, continuation_context_id,
         continuation_previous_run_id, continuation_anchor_run_id,
         continuation_previous_context_id, terminal_segment, object_key, checksum_key,
         source_revision, application_version, requirements_version, requested_at, expires_at)
       VALUES (?1, ?2, 1, 'SUPPORT_SAFE', 'PENDING', ?3, ?4, ?5, ?6, ?7, ?8, ?9,
               ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
    ).bind(
      id,
      event.id,
      start.id,
      start.captured_at,
      boundary.end.id,
      boundary.end.captured_at,
      boundary.continuation?.id ?? null,
      boundary.continuation?.context_id ?? null,
      boundary.continuation?.previous_run_id ?? null,
      boundary.continuation?.anchor_run_id ?? null,
      continuationContext?.previous_context_id ?? null,
      boundary.continuation ? 0 : 1,
      objectKey,
      `${objectKey}.sha256`,
      normalizedSourceRevision(env),
      APP_VERSION,
      REQUIREMENTS_VERSION,
      requestedAt,
      addCalendarYears(now, planningHistoryRetentionYears(env)),
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO planning_history_compaction_events
        (id, compaction_id, operation_day_id, event_type, occurred_at, details_json)
       SELECT ?1, ?2, ?3, 'COMPACTION_REQUESTED', ?4, ?5
        WHERE EXISTS (SELECT 1 FROM planning_history_compactions WHERE id = ?2)`,
    ).bind(
      `${SYSTEM_EVENT_ID_PREFIX}-requested-${identity.slice(0, 32)}`,
      id,
      event.id,
      requestedAt,
      JSON.stringify({ terminal: !boundary.continuation }),
    ),
  ]);
  return (inserted[0]?.meta.changes ?? 0) > 0 ? id : null;
}

export async function claimPlanningHistoryCompactions(
  env: Env,
  now = new Date(),
  limit = MAX_WORKFLOW_CANDIDATES,
): Promise<string[]> {
  const retentionMs = planningDetailRetentionHours(env) * 60 * 60 * 1_000;
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  const events = await env.DB.prepare(
    `SELECT id, event_date, status, operations_end_at, archived_at, updated_at
       FROM operation_days
      WHERE status IN ('ACTIVE', 'CLOSED', 'ARCHIVED')
      ORDER BY updated_at, id LIMIT ?1`,
  )
    .bind(Math.min(Math.max(limit, 1), MAX_WORKFLOW_CANDIDATES))
    .all<EventCandidateRow>();
  const ids: string[] = [];
  for (const event of events.results) {
    const id = await createCompactionForEvent(env, event, cutoff, now);
    if (id) ids.push(id);
  }
  return ids;
}

export async function markPlanningHistoryWorkflowsDispatched(
  env: Env,
  compactionIds: readonly string[],
  dispatchedAt = new Date().toISOString(),
): Promise<void> {
  if (compactionIds.length === 0) return;
  await env.DB.batch(
    compactionIds.map((id) =>
      env.DB.prepare(
        `UPDATE planning_history_compactions SET workflow_dispatched_at = ?1
          WHERE id = ?2 AND status = 'PENDING' AND workflow_dispatched_at IS NULL`,
      ).bind(dispatchedAt, id),
    ),
  );
}

async function* pagedProjection(
  env: Env,
  compaction: CompactionRow,
  projection: PackageProjection,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  let offset = 0;
  for (;;) {
    const page = await env.DB.prepare(`${projection.sql} LIMIT ?4 OFFSET ?5`)
      .bind(
        compaction.operation_day_id,
        compaction.segment_end_captured_at,
        compaction.segment_end_run_id,
        QUERY_PAGE_SIZE,
        offset,
      )
      .all<Record<string, unknown>>();
    for (const row of page.results) yield encoder.encode(`${JSON.stringify(row)}\n`);
    if (page.results.length < QUERY_PAGE_SIZE) return;
    offset += page.results.length;
  }
}

async function addHashedEntry(input: {
  writer: StreamingZipWriter;
  path: string;
  source: AsyncIterable<Uint8Array>;
}): Promise<PlanningHistoryPackageEntry> {
  const workerCrypto = crypto as Crypto & { DigestStream: typeof DigestStream };
  const digest = new workerCrypto.DigestStream("SHA-256");
  const digestWriter = digest.getWriter();
  let rowCount = 0;
  let byteCount = 0;
  await input.writer.addBinaryEntry(
    input.path,
    (async function* () {
      for await (const chunk of input.source) {
        rowCount += 1;
        byteCount += chunk.byteLength;
        await digestWriter.write(chunk);
        yield chunk;
      }
      await digestWriter.close();
    })(),
  );
  return {
    path: input.path,
    encoding: "ndjson",
    rowCount,
    byteCount,
    sha256: bytesToHex(await digest.digest),
  };
}

function continuationReceipt(compaction: CompactionRow): PlanningHistoryContinuation {
  return {
    terminal: compaction.terminal_segment === 1,
    continuationRunId: compaction.continuation_run_id,
    continuationContextId: compaction.continuation_context_id,
    previousRunId: compaction.continuation_previous_run_id,
    anchorRunId: compaction.continuation_anchor_run_id,
    previousContextId: compaction.continuation_previous_context_id,
  };
}

async function verifyStoredPackage(
  env: Env,
  compaction: CompactionRow,
  expectedSha256: string,
): Promise<R2Object> {
  const [object, checksumObject] = await Promise.all([
    env.BACKUPS.get(compaction.object_key),
    env.BACKUPS.get(compaction.checksum_key),
  ]);
  if (!object?.body || !checksumObject?.body) throw new Error("PLANNING_HISTORY_OBJECT_MISSING");
  const checksumText = (await checksumObject.text()).trim().split(/\s+/)[0];
  if (checksumText !== expectedSha256) throw new Error("PLANNING_HISTORY_SIDECAR_MISMATCH");
  const downloadedSha256 = await sha256Stream(object.body);
  if (downloadedSha256 !== expectedSha256) throw new Error("PLANNING_HISTORY_OBJECT_MISMATCH");
  return object;
}

async function packageEntryCounts(
  env: Env,
  compaction: CompactionRow,
): Promise<Record<PlanningHistoryPackageEntry["path"], number>> {
  const counts = {} as Record<PlanningHistoryPackageEntry["path"], number>;
  for (const projection of packageProjections) {
    const statement = env.DB.prepare(`SELECT COUNT(*) AS total FROM (${projection.sql})`);
    const bound = projection.sql.includes("?3")
      ? statement.bind(
          compaction.operation_day_id,
          compaction.segment_end_captured_at,
          compaction.segment_end_run_id,
        )
      : statement.bind(compaction.operation_day_id, compaction.segment_end_captured_at);
    const row = await bound.first<{ total: number }>();
    counts[projection.path] = row?.total ?? 0;
  }
  return counts;
}

async function writeChecksumSidecar(
  env: Env,
  compaction: CompactionRow,
  checksum: string,
): Promise<void> {
  await env.BACKUPS.put(
    compaction.checksum_key,
    `${checksum}  ${compaction.object_key.split("/").at(-1)}\n`,
    {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
      customMetadata: {
        format: "sha256-sidecar",
        formatVersion: "1",
        objectKey: compaction.object_key,
        sha256: checksum,
      },
    },
  );
}

async function markPackageVerified(input: {
  env: Env;
  compaction: CompactionRow;
  checksum: string;
  entryCounts: Record<PlanningHistoryPackageEntry["path"], number>;
  expectedSize?: number;
}): Promise<void> {
  const verifiedObject = await verifyStoredPackage(input.env, input.compaction, input.checksum);
  if (input.expectedSize !== undefined && verifiedObject.size !== input.expectedSize) {
    throw new Error("PLANNING_HISTORY_SIZE_MISMATCH");
  }
  const verifiedAt = new Date().toISOString();
  const current = await compactionById(input.env, input.compaction.id);
  if (current?.status !== "BUILDING") throw new Error("PLANNING_HISTORY_CLAIM_LOST");
  const results = await input.env.DB.batch([
    input.env.DB.prepare(
      `UPDATE planning_history_compactions
          SET status = 'VERIFIED', object_sha256 = ?1, object_etag = ?2,
              object_size_bytes = ?3, entry_counts_json = ?4, verified_at = ?5,
              failure_code = NULL, version = version + 1
        WHERE id = ?6 AND status = 'BUILDING' AND version = ?7`,
    ).bind(
      input.checksum,
      verifiedObject.etag,
      verifiedObject.size,
      JSON.stringify(input.entryCounts),
      verifiedAt,
      input.compaction.id,
      current.version,
    ),
    lifecycleEventStatement({
      env: input.env,
      compaction: input.compaction,
      eventType: "PACKAGE_VERIFIED",
      occurredAt: verifiedAt,
      details: { sha256: input.checksum, sizeBytes: verifiedObject.size },
    }),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) throw new Error("PLANNING_HISTORY_CLAIM_LOST");
}

export async function buildPlanningHistoryPackage(env: Env, id: string): Promise<boolean> {
  let compaction = await compactionById(env, id);
  if (!compaction) return false;
  if (["VERIFIED", "PRUNING", "COMPLETED"].includes(compaction.status)) return true;
  if (!["PENDING", "BUILDING"].includes(compaction.status)) return false;
  const startedAt = new Date().toISOString();
  if (compaction.status === "PENDING") {
    const claimed = await env.DB.batch([
      env.DB.prepare(
        `UPDATE planning_history_compactions
            SET status = 'BUILDING', started_at = ?1, failure_code = NULL, version = version + 1
          WHERE id = ?2 AND status = 'PENDING' AND version = ?3`,
      ).bind(startedAt, id, compaction.version),
      lifecycleEventStatement({
        env,
        compaction,
        eventType: "PACKAGE_BUILD_STARTED",
        occurredAt: startedAt,
      }),
    ]);
    if ((claimed[0]?.meta.changes ?? 0) !== 1) return false;
    compaction = await compactionById(env, id);
    if (!compaction) return false;
  }

  const expectedEntryCounts = await packageEntryCounts(env, compaction);
  const countUpdate = await env.DB.prepare(
    `UPDATE planning_history_compactions
        SET entry_counts_json = ?1, version = version + 1
      WHERE id = ?2 AND status = 'BUILDING' AND version = ?3`,
  )
    .bind(JSON.stringify(expectedEntryCounts), id, compaction.version)
    .run();
  if ((countUpdate.meta.changes ?? 0) !== 1) throw new Error("PLANNING_HISTORY_CLAIM_LOST");
  compaction = (await compactionById(env, id)) ?? compaction;

  const [existingObject, existingChecksumObject] = await Promise.all([
    env.BACKUPS.head(compaction.object_key),
    env.BACKUPS.get(compaction.checksum_key),
  ]);
  if (!existingObject && existingChecksumObject) {
    throw new Error("PLANNING_HISTORY_ORPHAN_CHECKSUM");
  }
  if (existingObject) {
    let checksum: string;
    if (existingChecksumObject?.body) {
      checksum = (await existingChecksumObject.text()).trim().split(/\s+/)[0] ?? "";
      if (!/^[a-f0-9]{64}$/.test(checksum)) {
        throw new Error("PLANNING_HISTORY_SIDECAR_INVALID");
      }
    } else {
      const object = await env.BACKUPS.get(compaction.object_key);
      if (!object?.body) throw new Error("PLANNING_HISTORY_OBJECT_MISSING");
      checksum = await sha256Stream(object.body);
      await writeChecksumSidecar(env, compaction, checksum);
    }
    await markPackageVerified({ env, compaction, checksum, entryCounts: expectedEntryCounts });
    return true;
  }

  const writer = new StreamingZipWriter();
  const [uploadStream, digestInput] = writer.readable.tee();
  const workerCrypto = crypto as Crypto & { DigestStream: typeof DigestStream };
  const archiveDigest = new workerCrypto.DigestStream("SHA-256");
  const checksumPromise = digestInput
    .pipeTo(archiveDigest)
    .then(() => archiveDigest.digest)
    .then(bytesToHex);
  const uploadPromise = uploadMultipartStream({
    bucket: env.BACKUPS,
    key: compaction.object_key,
    stream: uploadStream,
    customMetadata: {
      format: PACKAGE_FORMAT,
      formatVersion: String(PACKAGE_FORMAT_VERSION),
      eventId: compaction.operation_day_id,
      compactionId: compaction.id,
      privacyProfile: "SUPPORT_SAFE",
    },
  });
  try {
    const entries: PlanningHistoryPackageEntry[] = [];
    for (const projection of packageProjections) {
      entries.push(
        await addHashedEntry({
          writer,
          path: projection.path,
          source: pagedProjection(env, compaction, projection),
        }),
      );
    }
    const event = await env.DB.prepare("SELECT event_date FROM operation_days WHERE id = ?1")
      .bind(compaction.operation_day_id)
      .first<{ event_date: string }>();
    if (!event) throw new Error("PLANNING_HISTORY_EVENT_MISSING");
    const continuation = continuationReceipt(compaction);
    const continuationText = `${JSON.stringify(continuation, null, 2)}\n`;
    const manifest: PlanningHistoryPackageManifest = {
      format: PACKAGE_FORMAT,
      formatVersion: PACKAGE_FORMAT_VERSION,
      createdAt: startedAt,
      privacyProfile: "SUPPORT_SAFE",
      applicationVersion: compaction.application_version,
      requirementsVersion: compaction.requirements_version,
      sourceRevision: compaction.source_revision,
      event: { id: compaction.operation_day_id, date: event.event_date },
      segment: {
        compactionId: compaction.id,
        startRunId: compaction.segment_start_run_id,
        startCapturedAt: compaction.segment_start_captured_at,
        endRunId: compaction.segment_end_run_id,
        endCapturedAt: compaction.segment_end_captured_at,
        terminal: compaction.terminal_segment === 1,
      },
      continuation,
      continuationReceipt: {
        path: "continuation.json",
        encoding: "json",
        rowCount: 1,
        byteCount: new TextEncoder().encode(continuationText).byteLength,
        sha256: await sha256Hex(continuationText),
      },
      entries,
    };
    await writer.addTextEntry("continuation.json", continuationText);
    await writer.addTextEntry("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    await writer.finalize();
    const [uploaded, checksum] = await Promise.all([uploadPromise, checksumPromise]);
    const actualEntryCounts = Object.fromEntries(
      entries.map((entry) => [entry.path, entry.rowCount]),
    );
    if (JSON.stringify(actualEntryCounts) !== JSON.stringify(expectedEntryCounts)) {
      throw new Error("PLANNING_HISTORY_SOURCE_CHANGED");
    }
    await writeChecksumSidecar(env, compaction, checksum);
    await markPackageVerified({
      env,
      compaction,
      checksum,
      entryCounts: expectedEntryCounts,
      expectedSize: uploaded.size,
    });
    return true;
  } catch (error) {
    await writer.abort(error);
    await Promise.allSettled([uploadPromise, checksumPromise]);
    throw error;
  }
}

function maintenanceActivation(env: Env, compaction: CompactionRow, now: string) {
  return env.DB.prepare(
    `UPDATE planning_history_maintenance_control
        SET active = 1, compaction_id = ?1, operation_day_id = ?2,
            boundary_run_id = ?3, boundary_context_id = ?4, activated_at = ?5
      WHERE singleton = 1 AND active = 0`,
  ).bind(
    compaction.id,
    compaction.operation_day_id,
    compaction.continuation_run_id,
    compaction.continuation_context_id,
    now,
  );
}

function maintenanceRelease(env: Env) {
  return env.DB.prepare(
    `UPDATE planning_history_maintenance_control
        SET active = 0, compaction_id = NULL, operation_day_id = NULL,
            boundary_run_id = NULL, boundary_context_id = NULL, activated_at = NULL
      WHERE singleton = 1 AND active = 1`,
  );
}

export async function prunePlanningHistoryBatch(
  env: Env,
  id: string,
): Promise<{ completed: boolean; deletedRows: number }> {
  let compaction = await compactionById(env, id);
  if (!compaction || !["VERIFIED", "PRUNING"].includes(compaction.status)) {
    return { completed: compaction?.status === "COMPLETED", deletedRows: 0 };
  }
  const now = new Date().toISOString();
  if (compaction.status === "VERIFIED") {
    const started = await env.DB.batch([
      env.DB.prepare(
        `UPDATE planning_history_compactions
            SET status = 'PRUNING', pruning_started_at = ?1, version = version + 1
          WHERE id = ?2 AND status = 'VERIFIED' AND version = ?3`,
      ).bind(now, id, compaction.version),
      lifecycleEventStatement({
        env,
        compaction,
        eventType: "PRUNING_STARTED",
        occurredAt: now,
      }),
    ]);
    if ((started[0]?.meta.changes ?? 0) !== 1) return { completed: false, deletedRows: 0 };
    compaction = await compactionById(env, id);
    if (!compaction) return { completed: false, deletedRows: 0 };
  }
  const results = await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
    maintenanceActivation(env, compaction, now),
    env.DB.prepare(
      `UPDATE planning_runs SET previous_run_id = NULL, anchor_run_id = NULL
        WHERE id = ?1 AND operation_day_id = ?2`,
    ).bind(compaction.continuation_run_id, compaction.operation_day_id),
    env.DB.prepare(
      `UPDATE planning_contexts SET previous_context_id = NULL
        WHERE id = ?1 AND operation_day_id = ?2`,
    ).bind(compaction.continuation_context_id, compaction.operation_day_id),
    env.DB.prepare(
      `DELETE FROM forecast_snapshots WHERE id IN (
         SELECT snapshot.id FROM forecast_snapshots snapshot
         JOIN planning_runs run ON run.id = snapshot.planning_run_id
          WHERE run.operation_day_id = ?1
            AND (run.captured_at < ?2 OR (run.captured_at = ?2 AND run.id <= ?3))
          ORDER BY snapshot.captured_at, snapshot.id LIMIT ?4
       )`,
    ).bind(
      compaction.operation_day_id,
      compaction.segment_end_captured_at,
      compaction.segment_end_run_id,
      planningHistoryPruneLimits.forecastSnapshots,
    ),
    env.DB.prepare(
      `DELETE FROM planning_runs WHERE id IN (
         SELECT id FROM planning_runs
          WHERE operation_day_id = ?1
            AND (captured_at < ?2 OR (captured_at = ?2 AND id <= ?3))
          ORDER BY captured_at DESC, id DESC LIMIT ?4
       )`,
    ).bind(
      compaction.operation_day_id,
      compaction.segment_end_captured_at,
      compaction.segment_end_run_id,
      planningHistoryPruneLimits.planningRuns,
    ),
    env.DB.prepare(
      `DELETE FROM planning_contexts WHERE id IN (
         SELECT context.id FROM planning_contexts context
          WHERE context.operation_day_id = ?1 AND context.created_at <= ?2
            AND NOT EXISTS (SELECT 1 FROM planning_runs run WHERE run.context_id = context.id)
            AND NOT EXISTS (
              SELECT 1 FROM planning_contexts child WHERE child.previous_context_id = context.id
            )
          ORDER BY context.created_at DESC, context.id DESC LIMIT ?3
       )`,
    ).bind(
      compaction.operation_day_id,
      compaction.segment_end_captured_at,
      planningHistoryPruneLimits.planningContexts,
    ),
    env.DB.prepare(
      `DELETE FROM planning_chunks WHERE id IN (
         SELECT chunk.id FROM planning_chunks chunk
          WHERE chunk.operation_day_id = ?1 AND chunk.created_at <= ?2
            AND NOT EXISTS (
              SELECT 1 FROM planning_contexts context, json_each(context.manifest_json) manifest
               WHERE context.operation_day_id = ?1
                 AND json_extract(manifest.value, '$.chunkId') = chunk.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM planning_runs run WHERE run.operation_day_id = ?1 AND (
                run.previous_forecast_state_chunk_id = chunk.id OR
                run.previous_dispatch_state_chunk_id = chunk.id OR
                run.dispatch_result_chunk_id = chunk.id OR run.precall_result_chunk_id = chunk.id
              )
            )
          ORDER BY chunk.created_at, chunk.id LIMIT ?3
       )`,
    ).bind(
      compaction.operation_day_id,
      compaction.segment_end_captured_at,
      planningHistoryPruneLimits.planningChunks,
    ),
    maintenanceRelease(env),
  ]);
  const deletedRows = [4, 5, 6, 7].reduce(
    (total, index) => total + (results[index]?.meta.changes ?? 0),
    0,
  );
  if (deletedRows > 0) return { completed: false, deletedRows };
  const completedAt = new Date().toISOString();
  const current = await compactionById(env, id);
  if (current?.status !== "PRUNING") return { completed: false, deletedRows: 0 };
  const completed = await env.DB.batch([
    env.DB.prepare(
      `UPDATE planning_history_compactions
          SET status = 'COMPLETED', completed_at = ?1, version = version + 1
        WHERE id = ?2 AND status = 'PRUNING' AND version = ?3`,
    ).bind(completedAt, id, current.version),
    lifecycleEventStatement({
      env,
      compaction,
      eventType: "COMPACTION_COMPLETED",
      occurredAt: completedAt,
    }),
  ]);
  return { completed: (completed[0]?.meta.changes ?? 0) === 1, deletedRows: 0 };
}

export async function markPlanningHistoryFailure(
  env: Env,
  id: string,
  failureCode: string,
): Promise<void> {
  const compaction = await compactionById(env, id);
  if (!compaction || ["COMPLETED", "EXPIRED", "DELETED"].includes(compaction.status)) return;
  const failedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE planning_history_compactions
          SET status = 'FAILED', failure_code = ?1, completed_at = ?2, version = version + 1
        WHERE id = ?3 AND status NOT IN ('COMPLETED', 'EXPIRED', 'DELETED')`,
    ).bind(failureCode, failedAt, id),
    lifecycleEventStatement({
      env,
      compaction,
      eventType: "COMPACTION_FAILED",
      occurredAt: failedAt,
      details: { failureCode },
    }),
  ]);
}

export async function expirePlanningHistoryPackages(
  env: Env,
  now = new Date(),
  limit = 25,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT * FROM planning_history_compactions
      WHERE status = 'COMPLETED' AND expires_at <= ?1 ORDER BY expires_at, id LIMIT ?2`,
  )
    .bind(now.toISOString(), limit)
    .all<CompactionRow>();
  for (const row of rows.results) {
    await env.BACKUPS.delete([row.object_key, row.checksum_key]);
    const expiredAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE planning_history_compactions
            SET status = 'EXPIRED', object_etag = NULL, object_size_bytes = NULL,
                completed_at = ?1, version = version + 1
          WHERE id = ?2 AND status = 'COMPLETED'`,
      ).bind(expiredAt, row.id),
      lifecycleEventStatement({
        env,
        compaction: row,
        eventType: "PACKAGE_EXPIRED",
        occurredAt: expiredAt,
      }),
    ]);
  }
  return rows.results.length;
}

export async function listVerifiedPlanningHistoryPackages(
  env: Env,
  eventId: string,
): Promise<CompactionRow[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM planning_history_compactions
      WHERE operation_day_id = ?1 AND status IN ('VERIFIED', 'PRUNING', 'COMPLETED')
      ORDER BY segment_start_captured_at, id`,
  )
    .bind(eventId)
    .all<CompactionRow>();
  return rows.results;
}
