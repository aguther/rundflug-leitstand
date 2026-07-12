import { sha256Hex } from "./crypto";
import type { Env } from "./types";

export const BACKUP_TABLES = [
  "operation_days",
  "resource_groups",
  "aircraft",
  "pilots",
  "resource_group_memberships",
  "products",
  "gates",
  "ticket_groups",
  "tickets",
  "flight_groups",
  "rotations",
  "rotation_tickets",
  "paired_devices",
  "operational_blocks",
  "forecast_snapshots",
  "web_push_subscriptions",
  "outage_recovery_batches",
  "outage_recovery_entries",
  "outage_recovery_references",
  "operational_events",
  "idempotency_receipts",
  "outbox",
] as const;

export interface PortableBackup {
  format: "rundflug-leitstand-portable-backup";
  formatVersion: 1;
  createdAt: string;
  requirementsVersion: "1.4";
  tables: Record<string, unknown[]>;
}

export function serializePortableBackup(backup: PortableBackup): string {
  return JSON.stringify(backup);
}

export async function createPortableBackup(
  env: Env,
  now = new Date(),
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
    tables,
  };
  const body = serializePortableBackup(backup);
  const checksum = await sha256Hex(body);
  const day = createdAt.slice(0, 10);
  const key = `backups/${day}/${createdAt.replaceAll(":", "-")}.json`;
  await env.BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256: checksum, formatVersion: "1" },
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
