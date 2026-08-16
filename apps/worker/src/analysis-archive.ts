import { APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import type { AnalysisArchive } from "@rundflug/contracts";
import { StreamingZipWriter, uploadMultipartStream } from "./analysis-archive-writer";
import {
  analysisCsvReports,
  analysisExportProjections,
  loadArchiveEntryCounts,
  pagedCsv,
  pagedNdjson,
} from "./analysis-export-projections";
import { sha256Hex } from "./crypto";
import { listVerifiedPlanningHistoryPackages } from "./planning-history-compaction";
import type { Env } from "./types";

const ARCHIVE_FORMAT = "rundflug-analysis-day-archive";
const ARCHIVE_CONTENT_TYPE = "application/zip";
const SYSTEM_ACTOR_ALIAS = "system";
const CURRENT_ARCHIVE_FORMAT_VERSION = 2;

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function streamSha256Hex(stream: ReadableStream<Uint8Array>): Promise<string> {
  const workerCrypto = crypto as Crypto & { DigestStream: typeof DigestStream };
  const digest = new workerCrypto.DigestStream("SHA-256");
  await stream.pipeTo(digest);
  return bytesToHex(await digest.digest);
}

type ArchiveStatus = AnalysisArchive["status"];

interface ArchiveRow {
  id: string;
  operation_day_id: string;
  operation_day_version: number;
  request_id: string;
  request_hash: string;
  privacy_profile: "SUPPORT_SAFE";
  format_version: 1 | 2;
  status: ArchiveStatus;
  object_key: string | null;
  object_etag: string | null;
  object_size_bytes: number | null;
  content_type: string | null;
  source_revision: string;
  application_version: string;
  requirements_version: string;
  entry_counts_json: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string;
  failure_code: string | null;
  version: number;
}

interface ArchiveEventRow {
  id: string;
  event_date: string;
  time_zone: string;
  status: "CLOSED" | "ARCHIVED";
  version: number;
}

export interface AnalysisArchiveRequestResult {
  archive: AnalysisArchive;
  created: boolean;
}

export function analysisRetentionDays(env: Env): number {
  const raw = env.ANALYSIS_RETENTION_DAYS?.trim();
  if (!raw) {
    if (env.APP_ENV === "production") throw new Error("ANALYSIS_RETENTION_DAYS_REQUIRED");
    return 30;
  }
  const value = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || value < 14 || value > 365) {
    throw new Error("ANALYSIS_RETENTION_DAYS_INVALID");
  }
  return value;
}

function sourceRevision(env: Env): string {
  const value = env.SOURCE_REVISION?.trim() || "unknown";
  return /^[a-zA-Z0-9._-]{1,128}$/.test(value) ? value : "unknown";
}

function archiveProjection(row: ArchiveRow): AnalysisArchive {
  return {
    id: row.id,
    eventId: row.operation_day_id,
    eventVersion: row.operation_day_version,
    privacyProfile: row.privacy_profile,
    formatVersion: row.format_version,
    status: row.status,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    sizeBytes: row.object_size_bytes,
    failureCode: row.failure_code,
  };
}

async function requestHash(eventId: string, eventVersion: number): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      eventId,
      eventVersion,
      formatVersion: CURRENT_ARCHIVE_FORMAT_VERSION,
      privacyProfile: "SUPPORT_SAFE",
    }),
  );
}

export async function analysisActorAlias(stableActorId: string | null): Promise<string> {
  if (!stableActorId) return "development-admin";
  return `analysis-actor-${(await sha256Hex(stableActorId)).slice(0, 16)}`;
}

function expiresAt(env: Env, requestedAt: Date): string {
  return new Date(
    requestedAt.getTime() + analysisRetentionDays(env) * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function archiveEventStatement(input: {
  env: Env;
  archiveId: string;
  eventId: string;
  eventType:
    | "ARCHIVE_REQUESTED"
    | "ARCHIVE_BUILD_STARTED"
    | "ARCHIVE_READY"
    | "ARCHIVE_FAILED"
    | "ARCHIVE_DOWNLOADED"
    | "ARCHIVE_EXPIRED"
    | "ARCHIVE_DELETED";
  occurredAt: string;
  actorAlias: string;
  details?: Record<string, unknown>;
  eventIdOverride?: string;
}): D1PreparedStatement {
  return input.env.DB.prepare(
    `INSERT INTO analysis_archive_events
      (id, archive_id, operation_day_id, event_type, occurred_at, actor_alias, details_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(
    input.eventIdOverride ?? crypto.randomUUID(),
    input.archiveId,
    input.eventId,
    input.eventType,
    input.occurredAt,
    input.actorAlias,
    JSON.stringify(input.details ?? {}),
  );
}

export async function automaticArchiveRequestStatements(input: {
  env: Env;
  eventId: string;
  eventVersion: number;
  requestedAt: string;
}): Promise<D1PreparedStatement[]> {
  const hash = await requestHash(input.eventId, input.eventVersion);
  const archiveId = `archive-${hash.slice(0, 32)}`;
  const requestId = `automatic-${hash.slice(0, 32)}`;
  const accessEventId = `archive-request-${hash.slice(0, 32)}`;
  return [
    input.env.DB.prepare(
      `INSERT OR IGNORE INTO analysis_archives
        (id, operation_day_id, operation_day_version, request_id, request_hash,
         privacy_profile, format_version, status, source_revision, application_version,
         requirements_version, entry_counts_json, requested_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'SUPPORT_SAFE', 2, 'PENDING', ?6, ?7, ?8, '{}', ?9, ?10)`,
    ).bind(
      archiveId,
      input.eventId,
      input.eventVersion,
      requestId,
      hash,
      sourceRevision(input.env),
      APP_VERSION,
      REQUIREMENTS_VERSION,
      input.requestedAt,
      expiresAt(input.env, new Date(input.requestedAt)),
    ),
    input.env.DB.prepare(
      `INSERT OR IGNORE INTO analysis_archive_events
        (id, archive_id, operation_day_id, event_type, occurred_at, actor_alias, details_json)
       SELECT ?1, ?2, ?3, 'ARCHIVE_REQUESTED', ?4, ?5, '{}'
        WHERE EXISTS (SELECT 1 FROM analysis_archives WHERE id = ?2)`,
    ).bind(accessEventId, archiveId, input.eventId, input.requestedAt, SYSTEM_ACTOR_ALIAS),
  ];
}

async function findArchiveByRequest(env: Env, requestId: string): Promise<ArchiveRow | null> {
  return env.DB.prepare("SELECT * FROM analysis_archives WHERE request_id = ?1")
    .bind(requestId)
    .first<ArchiveRow>();
}

async function findArchiveForVersion(
  env: Env,
  eventId: string,
  eventVersion: number,
): Promise<ArchiveRow | null> {
  return env.DB.prepare(
    `SELECT * FROM analysis_archives
      WHERE operation_day_id = ?1 AND operation_day_version = ?2
        AND format_version = ?3 AND privacy_profile = 'SUPPORT_SAFE'`,
  )
    .bind(eventId, eventVersion, CURRENT_ARCHIVE_FORMAT_VERSION)
    .first<ArchiveRow>();
}

interface AnalysisArchiveRequestInput {
  env: Env;
  eventId: string;
  expectedEventVersion: number;
  requestId: string;
  actorAlias: string;
  now?: Date;
}

async function retryFailedAnalysisArchive(
  input: AnalysisArchiveRequestInput,
  archive: ArchiveRow,
): Promise<AnalysisArchiveRequestResult> {
  const retriedAt = (input.now ?? new Date()).toISOString();
  await input.env.DB.batch([
    input.env.DB.prepare(
      `UPDATE analysis_archives
          SET status = 'PENDING', started_at = NULL, completed_at = NULL,
              failure_code = NULL, version = version + 1
        WHERE id = ?1 AND status = 'FAILED' AND version = ?2`,
    ).bind(archive.id, archive.version),
    archiveEventStatement({
      env: input.env,
      archiveId: archive.id,
      eventId: input.eventId,
      eventType: "ARCHIVE_REQUESTED",
      occurredAt: retriedAt,
      actorAlias: input.actorAlias,
      details: { retry: true },
    }),
  ]);
  const retried = await findArchiveForVersion(
    input.env,
    input.eventId,
    archive.operation_day_version,
  );
  if (!retried) throw new Error("ANALYSIS_ARCHIVE_NOT_FOUND");
  return { archive: archiveProjection(retried), created: true };
}

export async function requestAnalysisArchive(
  input: AnalysisArchiveRequestInput,
): Promise<AnalysisArchiveRequestResult> {
  const hash = await requestHash(input.eventId, input.expectedEventVersion);
  const priorRequest = await findArchiveByRequest(input.env, input.requestId);
  if (priorRequest) {
    if (priorRequest.request_hash !== hash)
      throw new Error("ANALYSIS_ARCHIVE_IDEMPOTENCY_CONFLICT");
    return { archive: archiveProjection(priorRequest), created: false };
  }
  const event = await input.env.DB.prepare(
    "SELECT id, event_date, time_zone, status, version FROM operation_days WHERE id = ?1",
  )
    .bind(input.eventId)
    .first<ArchiveEventRow>();
  if (!event) throw new Error("EVENT_NOT_FOUND");
  if (event.version !== input.expectedEventVersion)
    throw new Error("ANALYSIS_ARCHIVE_STALE_VERSION");
  if (!["CLOSED", "ARCHIVED"].includes(event.status))
    throw new Error("ANALYSIS_ARCHIVE_EVENT_OPEN");

  const existing = await findArchiveForVersion(input.env, input.eventId, event.version);
  if (existing) {
    if (existing.status === "FAILED") return retryFailedAnalysisArchive(input, existing);
    return { archive: archiveProjection(existing), created: false };
  }

  const now = input.now ?? new Date();
  const requestedAt = now.toISOString();
  const archiveId = crypto.randomUUID();
  try {
    await input.env.DB.batch([
      input.env.DB.prepare(
        `INSERT INTO analysis_archives
          (id, operation_day_id, operation_day_version, request_id, request_hash,
           privacy_profile, format_version, status, source_revision, application_version,
           requirements_version, entry_counts_json, requested_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'SUPPORT_SAFE', 2, 'PENDING', ?6, ?7, ?8, '{}', ?9, ?10)`,
      ).bind(
        archiveId,
        input.eventId,
        event.version,
        input.requestId,
        hash,
        sourceRevision(input.env),
        APP_VERSION,
        REQUIREMENTS_VERSION,
        requestedAt,
        expiresAt(input.env, now),
      ),
      archiveEventStatement({
        env: input.env,
        archiveId,
        eventId: input.eventId,
        eventType: "ARCHIVE_REQUESTED",
        occurredAt: requestedAt,
        actorAlias: input.actorAlias,
      }),
    ]);
  } catch (error) {
    const concurrent = await findArchiveForVersion(input.env, input.eventId, event.version);
    if (concurrent) return { archive: archiveProjection(concurrent), created: false };
    throw error;
  }
  const created = await findArchiveForVersion(input.env, input.eventId, event.version);
  if (!created) throw new Error("ANALYSIS_ARCHIVE_NOT_FOUND");
  return { archive: archiveProjection(created), created: true };
}

export async function listAnalysisArchives(env: Env, eventId: string): Promise<AnalysisArchive[]> {
  const rows = await env.DB.prepare(
    "SELECT * FROM analysis_archives WHERE operation_day_id = ?1 ORDER BY requested_at DESC, id DESC",
  )
    .bind(eventId)
    .all<ArchiveRow>();
  return rows.results.map(archiveProjection);
}

function archiveReadme(): string {
  return (
    `# Rundflug-Leitstand Tagesanalyse\n\nDieses Paket verwendet das Profil SUPPORT_SAFE.\n\n` +
    `Freitexte, öffentliche Ticketkennungen und deren Hashes, Sitzungs- und Gerätezugänge, ` +
    `Push-Ziele, Zahlungs- und Einzelgewichtsdaten sind ausgeschlossen. Planungsdaten sind ` +
    `inhaltsadressiert; calculation_now wird ausschließlich aus planning/runs.ndjson injiziert.\n`
  );
}

async function buildAnalysisArchiveManifest(input: {
  env: Env;
  archive: ArchiveRow;
  event: ArchiveEventRow;
  entryCounts: Record<string, number>;
  createdAt: string;
  planningHistoryPackages: Array<{
    path: string;
    compactionId: string;
    sha256: string;
    rowCounts: Record<string, number>;
  }>;
}): Promise<Record<string, unknown>> {
  return {
    format: ARCHIVE_FORMAT,
    formatVersion: input.archive.format_version,
    createdAt: input.createdAt,
    privacyProfile: "SUPPORT_SAFE",
    applicationVersion: input.archive.application_version,
    requirementsVersion: input.archive.requirements_version,
    sourceRevision: input.archive.source_revision,
    environment: input.env.APP_ENV,
    event: {
      id: input.event.id,
      date: input.event.event_date,
      timeZone: input.event.time_zone,
      sourceEventVersion: input.archive.operation_day_version,
      status: input.event.status,
    },
    schemaVersions: { manifest: 1, planningContext: 1, planningRun: 1 },
    entries: input.entryCounts,
    planningHistory:
      input.archive.format_version === 2
        ? {
            packageFormat: "rundflug-planning-history",
            packageFormatVersion: 1,
            packages: input.planningHistoryPackages,
          }
        : undefined,
    redaction: {
      profile: "SUPPORT_SAFE",
      freeTextIncluded: false,
      publicTokenHashesIncluded: false,
      pushDataIncluded: false,
      sessionDataIncluded: false,
      individualWeightIncluded: false,
    },
  };
}

async function archiveRowById(env: Env, archiveId: string): Promise<ArchiveRow | null> {
  return env.DB.prepare("SELECT * FROM analysis_archives WHERE id = ?1")
    .bind(archiveId)
    .first<ArchiveRow>();
}

export async function buildAnalysisArchive(env: Env, archiveId: string): Promise<boolean> {
  const archive = await archiveRowById(env, archiveId);
  if (archive?.status !== "PENDING") return false;
  const startedAt = new Date().toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE analysis_archives
        SET status = 'BUILDING', started_at = ?1, failure_code = NULL, version = version + 1
      WHERE id = ?2 AND status = 'PENDING' AND version = ?3`,
  )
    .bind(startedAt, archiveId, archive.version)
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) return false;
  await archiveEventStatement({
    env,
    archiveId,
    eventId: archive.operation_day_id,
    eventType: "ARCHIVE_BUILD_STARTED",
    occurredAt: startedAt,
    actorAlias: SYSTEM_ACTOR_ALIAS,
  }).run();

  const event = await env.DB.prepare(
    `SELECT id, event_date, time_zone, status, version FROM operation_days
      WHERE id = ?1 AND version = ?2 AND status IN ('CLOSED', 'ARCHIVED')`,
  )
    .bind(archive.operation_day_id, archive.operation_day_version)
    .first<ArchiveEventRow>();
  if (!event) {
    const failedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE analysis_archives
            SET status = 'FAILED', completed_at = ?1,
                failure_code = 'ARCHIVE_SOURCE_CHANGED', version = version + 1
          WHERE id = ?2 AND status = 'BUILDING'`,
      ).bind(failedAt, archiveId),
      archiveEventStatement({
        env,
        archiveId,
        eventId: archive.operation_day_id,
        eventType: "ARCHIVE_FAILED",
        occurredAt: failedAt,
        actorAlias: SYSTEM_ACTOR_ALIAS,
        details: { failureCode: "ARCHIVE_SOURCE_CHANGED" },
      }),
    ]);
    return false;
  }

  const objectKey = `analysis/${archive.operation_day_id}/${event.event_date}/${archive.id}.zip`;
  const writer = new StreamingZipWriter();
  const uploadPromise = uploadMultipartStream({
    bucket: env.BACKUPS,
    key: objectKey,
    stream: writer.readable,
    customMetadata: {
      format: ARCHIVE_FORMAT,
      formatVersion: String(archive.format_version),
      applicationVersion: archive.application_version,
      requirementsVersion: archive.requirements_version,
      sourceRevision: archive.source_revision,
      eventId: archive.operation_day_id,
      eventVersion: String(archive.operation_day_version),
      privacyProfile: "SUPPORT_SAFE",
      createdAt: startedAt,
    },
  });
  try {
    const coldPackages =
      archive.format_version === 2
        ? await listVerifiedPlanningHistoryPackages(env, archive.operation_day_id)
        : [];
    const planningHistoryPackages = coldPackages.map((entry) => ({
      path: `planning-history/${entry.id}.zip`,
      compactionId: entry.id,
      sha256: entry.object_sha256 ?? "",
      rowCounts: JSON.parse(entry.entry_counts_json) as Record<string, number>,
    }));
    if (planningHistoryPackages.some((entry) => !/^[a-f0-9]{64}$/.test(entry.sha256))) {
      throw new Error("ANALYSIS_ARCHIVE_COLD_HISTORY_UNVERIFIED");
    }
    const entryCounts = {
      ...(await loadArchiveEntryCounts(env.DB, archive.operation_day_id)),
      planningHistoryPackages: planningHistoryPackages.length,
    };
    const manifest = await buildAnalysisArchiveManifest({
      env,
      archive,
      event,
      entryCounts,
      createdAt: startedAt,
      planningHistoryPackages,
    });
    await writer.addTextEntry("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    await writer.addTextEntry("README.md", archiveReadme());
    await writer.addTextEntry(
      "snapshot/event.json",
      `${JSON.stringify({
        id: event.id,
        eventDate: event.event_date,
        timeZone: event.time_zone,
        status: event.status,
        version: event.version,
      })}\n`,
    );
    for (const [index, coldPackage] of coldPackages.entries()) {
      const packageObject = await env.BACKUPS.get(coldPackage.object_key);
      if (!packageObject?.body) throw new Error("ANALYSIS_ARCHIVE_COLD_HISTORY_MISSING");
      const [archiveStream, digestStream] = packageObject.body.tee();
      const digestPromise = streamSha256Hex(digestStream);
      await writer.addBinaryEntry(
        planningHistoryPackages[index]?.path ?? `planning-history/${coldPackage.id}.zip`,
        archiveStream,
      );
      if ((await digestPromise) !== coldPackage.object_sha256) {
        throw new Error("ANALYSIS_ARCHIVE_COLD_HISTORY_HASH_MISMATCH");
      }
    }
    for (const projection of analysisExportProjections) {
      await writer.addTextEntry(
        projection.path,
        pagedNdjson({ db: env.DB, eventId: archive.operation_day_id, sql: projection.pageSql }),
      );
    }
    for (const report of analysisCsvReports) {
      await writer.addTextEntry(
        report.path,
        pagedCsv({
          db: env.DB,
          eventId: archive.operation_day_id,
          sql: report.sql,
          columns: report.columns,
        }),
      );
    }
    await writer.finalize();
    const object = await uploadPromise;
    const completedAt = new Date().toISOString();
    const current = await archiveRowById(env, archiveId);
    if (current?.status !== "BUILDING") throw new Error("ANALYSIS_ARCHIVE_CLAIM_LOST");
    const ready = await env.DB.prepare(
      `UPDATE analysis_archives
          SET status = 'READY', object_key = ?1, object_etag = ?2, object_size_bytes = ?3,
              content_type = ?4, entry_counts_json = ?5, completed_at = ?6,
              failure_code = NULL, version = version + 1
        WHERE id = ?7 AND status = 'BUILDING' AND version = ?8`,
    )
      .bind(
        objectKey,
        object.etag,
        object.size,
        ARCHIVE_CONTENT_TYPE,
        JSON.stringify(entryCounts),
        completedAt,
        archiveId,
        current.version,
      )
      .run();
    if ((ready.meta.changes ?? 0) !== 1) throw new Error("ANALYSIS_ARCHIVE_CLAIM_LOST");
    await archiveEventStatement({
      env,
      archiveId,
      eventId: archive.operation_day_id,
      eventType: "ARCHIVE_READY",
      occurredAt: completedAt,
      actorAlias: SYSTEM_ACTOR_ALIAS,
      details: { sizeBytes: object.size },
    }).run();
    return true;
  } catch (error) {
    await writer.abort(error);
    await uploadPromise.catch(() => undefined);
    await env.BACKUPS.delete(objectKey).catch(() => undefined);
    const failedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE analysis_archives
            SET status = 'FAILED', completed_at = ?1, failure_code = 'ARCHIVE_BUILD_FAILED',
                object_key = NULL, object_etag = NULL, object_size_bytes = NULL,
                content_type = NULL, version = version + 1
          WHERE id = ?2 AND status = 'BUILDING'`,
      ).bind(failedAt, archiveId),
      archiveEventStatement({
        env,
        archiveId,
        eventId: archive.operation_day_id,
        eventType: "ARCHIVE_FAILED",
        occurredAt: failedAt,
        actorAlias: SYSTEM_ACTOR_ALIAS,
        details: { failureCode: "ARCHIVE_BUILD_FAILED" },
      }),
    ]);
    return false;
  }
}

export async function processPendingAnalysisArchives(env: Env, limit = 2): Promise<number> {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1_000).toISOString();
  const stale = await env.DB.prepare(
    `SELECT id, operation_day_id FROM analysis_archives
      WHERE status = 'BUILDING' AND started_at < ?1
      ORDER BY started_at LIMIT 25`,
  )
    .bind(staleBefore)
    .all<{ id: string; operation_day_id: string }>();
  for (const row of stale.results) {
    const failedAt = new Date().toISOString();
    const recovered = await env.DB.prepare(
      `UPDATE analysis_archives
          SET status = 'FAILED', completed_at = ?1,
              failure_code = 'ARCHIVE_BUILD_TIMEOUT', version = version + 1
        WHERE id = ?2 AND status = 'BUILDING' AND started_at < ?3`,
    )
      .bind(failedAt, row.id, staleBefore)
      .run();
    if ((recovered.meta.changes ?? 0) === 1) {
      await archiveEventStatement({
        env,
        archiveId: row.id,
        eventId: row.operation_day_id,
        eventType: "ARCHIVE_FAILED",
        occurredAt: failedAt,
        actorAlias: SYSTEM_ACTOR_ALIAS,
        details: { failureCode: "ARCHIVE_BUILD_TIMEOUT" },
      }).run();
    }
  }

  const pending = await env.DB.prepare(
    "SELECT id FROM analysis_archives WHERE status = 'PENDING' ORDER BY requested_at LIMIT ?1",
  )
    .bind(limit)
    .all<{ id: string }>();
  let built = 0;
  for (const row of pending.results) if (await buildAnalysisArchive(env, row.id)) built += 1;
  return built;
}

export async function analysisArchiveDownload(input: {
  env: Env;
  eventId: string;
  archiveId: string;
  actorAlias: string;
}): Promise<{ archive: AnalysisArchive; object: R2ObjectBody } | null> {
  const row = await archiveRowById(input.env, input.archiveId);
  if (row?.operation_day_id !== input.eventId || row.status !== "READY" || !row.object_key) {
    return null;
  }
  const object = await input.env.BACKUPS.get(row.object_key);
  if (!object) throw new Error("ANALYSIS_ARCHIVE_OBJECT_MISSING");
  await archiveEventStatement({
    env: input.env,
    archiveId: row.id,
    eventId: row.operation_day_id,
    eventType: "ARCHIVE_DOWNLOADED",
    occurredAt: new Date().toISOString(),
    actorAlias: input.actorAlias,
  }).run();
  return { archive: archiveProjection(row), object };
}

export async function deleteAnalysisArchive(input: {
  env: Env;
  eventId: string;
  archiveId: string;
  actorAlias: string;
}): Promise<AnalysisArchive | null> {
  const row = await archiveRowById(input.env, input.archiveId);
  if (row?.operation_day_id !== input.eventId) return null;
  if (row.status === "DELETED") return archiveProjection(row);
  if (row.status === "BUILDING") throw new Error("ANALYSIS_ARCHIVE_BUILDING");
  if (row.object_key) await input.env.BACKUPS.delete(row.object_key);
  const deletedAt = new Date().toISOString();
  await input.env.DB.batch([
    input.env.DB.prepare(
      `UPDATE analysis_archives
          SET status = 'DELETED', object_key = NULL, object_etag = NULL,
              object_size_bytes = NULL, content_type = NULL, completed_at = ?1,
              failure_code = NULL, version = version + 1
        WHERE id = ?2 AND status <> 'DELETED'`,
    ).bind(deletedAt, row.id),
    archiveEventStatement({
      env: input.env,
      archiveId: row.id,
      eventId: row.operation_day_id,
      eventType: "ARCHIVE_DELETED",
      occurredAt: deletedAt,
      actorAlias: input.actorAlias,
    }),
  ]);
  const updated = await archiveRowById(input.env, row.id);
  return updated ? archiveProjection(updated) : null;
}

export async function expireAnalysisArchives(
  env: Env,
  now = new Date(),
  limit = 25,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT * FROM analysis_archives
      WHERE status = 'READY' AND expires_at <= ?1 ORDER BY expires_at LIMIT ?2`,
  )
    .bind(now.toISOString(), limit)
    .all<ArchiveRow>();
  let expired = 0;
  for (const row of rows.results) {
    if (row.object_key) await env.BACKUPS.delete(row.object_key);
    const occurredAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE analysis_archives
            SET status = 'EXPIRED', object_key = NULL, object_etag = NULL,
                object_size_bytes = NULL, content_type = NULL, completed_at = ?1,
                version = version + 1
          WHERE id = ?2 AND status = 'READY'`,
      ).bind(occurredAt, row.id),
      archiveEventStatement({
        env,
        archiveId: row.id,
        eventId: row.operation_day_id,
        eventType: "ARCHIVE_EXPIRED",
        occurredAt,
        actorAlias: SYSTEM_ACTOR_ALIAS,
      }),
    ]);
    expired += 1;
  }
  return expired;
}
