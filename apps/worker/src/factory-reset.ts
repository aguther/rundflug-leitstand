import type { FactoryResetRequest, FactoryResetResponse } from "@rundflug/contracts";
import { sha256Hex } from "./crypto";
import type { Env } from "./types";

export const FACTORY_RESET_DELETE_TABLES = [
  "flight_line_assist_claims",
  "web_push_deliveries",
  "web_push_subscriptions",
  "outage_recovery_references",
  "outage_recovery_entries",
  "outage_recovery_batches",
  "forecast_snapshots",
  "rotation_manifest_corrections",
  "rotation_tickets",
  "rotations",
  "flight_groups",
  "tickets",
  "ticket_groups",
  "outbox",
  "idempotency_receipts",
  "operational_blocks",
  "resource_group_memberships",
  "products",
  "pilots",
  "operational_events",
  "app_bootstrap",
  "resource_groups",
  "gates",
  "paired_devices",
  "operation_days",
  "aircraft",
] as const;

export async function factoryResetRequestHash(input: FactoryResetRequest): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      commandId: input.commandId,
      eventId: input.eventId,
      reason: input.reason,
      confirmation: input.confirmation,
      retainRecoveryBackup: input.retainRecoveryBackup,
      deleteAllBackups: input.deleteAllBackups,
    }),
  );
}

export async function clearFactoryResetCoordinators(
  namespace: DurableObjectNamespace,
  eventIds: readonly string[],
): Promise<void> {
  // A real installation can contain dozens of historical events. Running every Durable Object
  // request concurrently exceeds the Worker's outbound connection budget during a factory reset.
  // The reset is exceptional and destructive, so deterministic sequential cleanup is preferable.
  for (const eventId of eventIds) {
    const stub = namespace.get(namespace.idFromName(eventId));
    const response = await stub.fetch(`https://internal/events/${eventId}/factory-reset`, {
      method: "POST",
    });
    if (!response.ok) throw new Error(`Durable Object ${eventId} konnte nicht geleert werden.`);
  }
}

export function factoryResetStatements(
  env: Env,
  commandId: string,
  requestHash: string,
  completedAt: string,
  r2CleanupPending: boolean,
  response: FactoryResetResponse,
): D1PreparedStatement[] {
  return [
    env.DB.prepare("UPDATE system_reset_control SET active = 1 WHERE singleton = 1"),
    ...FACTORY_RESET_DELETE_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    env.DB.prepare("DELETE FROM system_reset_receipts"),
    env.DB.prepare("UPDATE system_reset_control SET active = 0 WHERE singleton = 1"),
    env.DB.prepare(
      `INSERT INTO system_reset_receipts
        (command_id, request_hash, completed_at, r2_cleanup_pending, response_json)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(commandId, requestHash, completedAt, r2CleanupPending ? 1 : 0, JSON.stringify(response)),
  ];
}

export async function emptyBackupBucket(bucket: R2Bucket): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ ...(cursor ? { cursor } : {}) });
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function finishR2Cleanup(
  env: Env,
  commandId: string,
  response: FactoryResetResponse,
): Promise<FactoryResetResponse> {
  await emptyBackupBucket(env.BACKUPS);
  const completedResponse = { ...response, r2BackupsDeleted: true };
  await env.DB.prepare(
    `UPDATE system_reset_receipts
        SET r2_cleanup_pending = 0, response_json = ?1
      WHERE command_id = ?2`,
  )
    .bind(JSON.stringify(completedResponse), commandId)
    .run();
  return completedResponse;
}
