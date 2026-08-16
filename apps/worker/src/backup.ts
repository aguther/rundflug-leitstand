import { APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import {
  BACKUP_TABLES,
  type PortableBackupTable,
} from "@rundflug/contracts/portable-backup-table-contract";
import { StreamingZipWriter, uploadMultipartStream } from "./analysis-archive-writer";
import type { Env } from "./types";

const BACKUP_FORMAT = "rundflug-leitstand-portable-backup";
const BACKUP_FORMAT_VERSION = 2;
const BACKUP_PAGE_SIZE = 500;
const BACKUP_RETENTION_DAYS = 14;

export { BACKUP_TABLES };

export interface PortableBackup {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  createdAt: string;
  applicationVersion: string;
  requirementsVersion: string;
  reason: BackupReason;
  tables: Record<string, unknown[]>;
}

export interface PortableBackupTableManifest {
  name: PortableBackupTable;
  path: `tables/${PortableBackupTable}.ndjson`;
  rowCount: number;
  encoding: "ndjson";
}

export interface PortableBackupManifestV2 {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  createdAt: string;
  applicationVersion: string;
  requirementsVersion: string;
  reason: BackupReason;
  checksum: {
    algorithm: "SHA-256";
    scope: "archive-bytes";
    storage: "r2-sidecar";
  };
  tables: PortableBackupTableManifest[];
}

export type BackupReason = "DAILY" | "PRE_EVENT" | "FACTORY_RESET";

export function operationDateInTimeZone(date: Date, timeZone = "Europe/Berlin"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function serializePortableBackup(backup: PortableBackup): string {
  return JSON.stringify(backup);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tableRowCount(db: D1Database, table: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS row_count FROM ${table}`)
    .first<{ row_count: number }>();
  const count = row?.row_count;
  if (!Number.isSafeInteger(count) || (count ?? -1) < 0) {
    throw new Error(`BACKUP_TABLE_COUNT_INVALID:${table}`);
  }
  return count ?? 0;
}

async function* pagedTableNdjson(input: {
  db: D1Database;
  table: PortableBackupTable;
  expectedRowCount: number;
}): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  let offset = 0;
  while (offset < input.expectedRowCount) {
    const page = await input.db
      .prepare(`SELECT * FROM ${input.table} LIMIT ?1 OFFSET ?2`)
      .bind(BACKUP_PAGE_SIZE, offset)
      .all<Record<string, unknown>>();
    if (page.results.length === 0) {
      throw new Error(`BACKUP_TABLE_ROW_COUNT_CHANGED:${input.table}`);
    }
    for (const row of page.results) yield encoder.encode(`${JSON.stringify(row)}\n`);
    offset += page.results.length;
    if (offset > input.expectedRowCount) {
      throw new Error(`BACKUP_TABLE_ROW_COUNT_CHANGED:${input.table}`);
    }
  }
  const confirmedRowCount = await tableRowCount(input.db, input.table);
  if (offset !== input.expectedRowCount || confirmedRowCount !== input.expectedRowCount) {
    throw new Error(`BACKUP_TABLE_ROW_COUNT_CHANGED:${input.table}`);
  }
}

async function removeExpiredBackups(bucket: R2Bucket, now: Date): Promise<void> {
  const retentionThreshold = now.getTime() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: "backups/", ...(cursor ? { cursor } : {}) });
    const expired = listed.objects
      .filter((object) => object.uploaded.getTime() < retentionThreshold)
      .map((object) => object.key);
    if (expired.length > 0) await bucket.delete(expired);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function createPortableBackup(
  env: Env,
  now = new Date(),
  reason: BackupReason = "DAILY",
): Promise<{
  key: string;
  checksum: string;
}> {
  const createdAt = now.toISOString();
  const tables: PortableBackupTableManifest[] = [];
  for (const table of BACKUP_TABLES) {
    tables.push({
      name: table,
      path: `tables/${table}.ndjson`,
      rowCount: await tableRowCount(env.DB, table),
      encoding: "ndjson",
    });
  }
  const manifest: PortableBackupManifestV2 = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt,
    applicationVersion: APP_VERSION,
    requirementsVersion: REQUIREMENTS_VERSION,
    reason,
    checksum: {
      algorithm: "SHA-256",
      scope: "archive-bytes",
      storage: "r2-sidecar",
    },
    tables,
  };
  const day = createdAt.slice(0, 10);
  const key = `backups/${day}/${createdAt.replaceAll(":", "-")}.zip`;
  const checksumKey = `${key}.sha256`;
  const writer = new StreamingZipWriter();
  const [uploadStream, digestInput] = writer.readable.tee();
  const workerCrypto = crypto as Crypto & { DigestStream: typeof DigestStream };
  const digestStream = new workerCrypto.DigestStream("SHA-256");
  const checksumPromise = digestInput
    .pipeTo(digestStream)
    .then(() => digestStream.digest)
    .then(bytesToHex);
  const uploadPromise = uploadMultipartStream({
    bucket: env.BACKUPS,
    key,
    stream: uploadStream,
    customMetadata: {
      format: BACKUP_FORMAT,
      formatVersion: String(BACKUP_FORMAT_VERSION),
      applicationVersion: APP_VERSION,
      requirementsVersion: REQUIREMENTS_VERSION,
      reason,
      checksumAlgorithm: "SHA-256",
      checksumKey,
    },
  });
  try {
    await writer.addTextEntry("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    for (const table of tables) {
      await writer.addTextEntry(
        table.path,
        pagedTableNdjson({
          db: env.DB,
          table: table.name,
          expectedRowCount: table.rowCount,
        }),
      );
    }
    await writer.finalize();
    const [, checksum] = await Promise.all([uploadPromise, checksumPromise]);
    await env.BACKUPS.put(checksumKey, `${checksum}  ${key.split("/").at(-1)}\n`, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
      customMetadata: {
        format: "sha256-sidecar",
        formatVersion: "1",
        objectKey: key,
        sha256: checksum,
      },
    });
    await removeExpiredBackups(env.BACKUPS, now);
    return { key, checksum };
  } catch (error) {
    await writer.abort(error);
    await Promise.allSettled([uploadPromise, checksumPromise]);
    throw error;
  }
}

export const portableBackupLimits = {
  pageSize: BACKUP_PAGE_SIZE,
  retentionDays: BACKUP_RETENTION_DAYS,
} as const;
