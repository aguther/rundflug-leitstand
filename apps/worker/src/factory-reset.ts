import type { FactoryResetRequest, FactoryResetResponse } from "@rundflug/contracts";
import { sha256Hex } from "./crypto";
import type { Env } from "./types";

export const FACTORY_RESET_DELETE_TABLES = [
  "dispatch_recommendation_leases",
  "flight_line_assist_claims",
  "web_push_deliveries",
  "web_push_subscriptions",
  "outage_recovery_references",
  "outage_recovery_entries",
  "outage_recovery_batches",
  "analysis_archive_events",
  "analysis_archives",
  "forecast_snapshots",
  "planning_runs",
  "planning_contexts",
  "planning_chunks",
  "rotation_manifest_corrections",
  "rotation_tickets",
  "ticket_group_recalls",
  "operational_blocks",
  "planned_operational_constraints",
  "recurring_operational_rules",
  "rotations",
  "flight_groups",
  "tickets",
  "ticket_groups",
  "outbox",
  "idempotency_receipts",
  "resource_group_memberships",
  "aircraft_product_turnaround_overrides",
  "products",
  "pilots",
  "operational_events",
  "event_deletion_receipts",
  "app_bootstrap",
  "operator_sessions",
  "fids_preferences",
  "operator_accounts",
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

interface FactoryResetStatementInput {
  commandId: string;
  completedAt: string;
  r2CleanupPending: boolean;
  requestHash: string;
  response: FactoryResetResponse;
  setupBrowserBindingHash: string;
  setupGrantExpiresAt: string;
  setupGrantHash: string;
}

export function factoryResetStatements(
  env: Env,
  input: FactoryResetStatementInput,
): D1PreparedStatement[] {
  return [
    // Planning captures contain self-referencing lineage (anchor_run_id and previous_*_id).
    // D1 batches are transactional, so defer those checks until every application row is gone.
    env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
    env.DB.prepare("UPDATE system_reset_control SET active = 1 WHERE singleton = 1"),
    ...FACTORY_RESET_DELETE_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    env.DB.prepare("DELETE FROM system_reset_receipts"),
    env.DB.prepare("UPDATE system_reset_control SET active = 0 WHERE singleton = 1"),
    env.DB.prepare("PRAGMA defer_foreign_keys = OFF"),
    env.DB.prepare(
      `INSERT INTO system_reset_receipts
        (command_id, request_hash, completed_at, r2_cleanup_pending, response_json,
         setup_grant_hash, setup_grant_expires_at, setup_grant_used_at,
         setup_browser_binding_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)`,
    ).bind(
      input.commandId,
      input.requestHash,
      input.completedAt,
      input.r2CleanupPending ? 1 : 0,
      JSON.stringify(input.response),
      input.setupGrantHash,
      input.setupGrantExpiresAt,
      input.setupBrowserBindingHash,
    ),
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
