import { sha256Hex } from "./crypto";
import type { Env } from "./types";

export const BACKUP_TABLES = [
  "operation_days",
  "gates",
  "resource_groups",
  "aircraft",
  "pilots",
  "paired_devices",
  "resource_group_memberships",
  "products",
  "ticket_groups",
  "tickets",
  "flight_groups",
  "rotations",
  "rotation_tickets",
  "app_bootstrap",
  "operational_blocks",
  "forecast_snapshots",
  "outage_recovery_batches",
  "operational_events",
  "outage_recovery_entries",
  "outage_recovery_references",
  "idempotency_receipts",
  "outbox",
] as const;

export interface PortableBackup {
  format: "rundflug-leitstand-portable-backup";
  formatVersion: 1;
  createdAt: string;
  requirementsVersion: "1.4";
  reason: BackupReason;
  tables: Record<string, unknown[]>;
}

export type BackupReason = "DAILY" | "PRE_EVENT";

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

export async function createPortableBackup(
  env: Env,
  now = new Date(),
  reason: BackupReason = "DAILY",
): Promise<{
  key: string;
  checksum: string;
}> {
  const tables: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    const result = await env.DB.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
    tables[table] = result.results;
  }
  const createdAt = now.toISOString();
  const backup: PortableBackup = {
    format: "rundflug-leitstand-portable-backup",
    formatVersion: 1,
    createdAt,
    requirementsVersion: "1.4",
    reason,
    tables,
  };
  const body = serializePortableBackup(backup);
  const checksum = await sha256Hex(body);
  const day = createdAt.slice(0, 10);
  const key = `backups/${day}/${createdAt.replaceAll(":", "-")}.json`;
  await env.BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256: checksum, formatVersion: "1", reason },
  });

  const retentionThreshold = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  let cursor: string | undefined;
  do {
    const listed = await env.BACKUPS.list({ prefix: "backups/", ...(cursor ? { cursor } : {}) });
    const expired = listed.objects
      .filter((object) => object.uploaded.getTime() < retentionThreshold)
      .map((object) => object.key);
    if (expired.length > 0) await env.BACKUPS.delete(expired);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return { key, checksum };
}
