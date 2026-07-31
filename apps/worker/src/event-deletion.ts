import type { Env } from "./types";

export interface EventDeletionResponse {
  deleted: true;
  eventId: string;
  setupRequired: boolean;
  assetCleanupPending: boolean;
}

export const EVENT_DELETION_SQL = [
  "DELETE FROM fids_preferences WHERE operation_day_id = ?1",
  "DELETE FROM flight_line_assist_claims WHERE operation_day_id = ?1",
  "DELETE FROM web_push_deliveries WHERE operation_day_id = ?1",
  "DELETE FROM web_push_subscriptions WHERE operation_day_id = ?1",
  "DELETE FROM outage_recovery_references WHERE operation_day_id = ?1",
  "DELETE FROM outage_recovery_entries WHERE batch_id IN (SELECT id FROM outage_recovery_batches WHERE operation_day_id = ?1)",
  "DELETE FROM outage_recovery_batches WHERE operation_day_id = ?1",
  "DELETE FROM forecast_snapshots WHERE operation_day_id = ?1",
  "DELETE FROM rotation_manifest_corrections WHERE operation_day_id = ?1",
  "DELETE FROM rotation_tickets WHERE rotation_id IN (SELECT id FROM rotations WHERE operation_day_id = ?1)",
  "DELETE FROM ticket_group_recalls WHERE operation_day_id = ?1",
  "DELETE FROM operational_blocks WHERE operation_day_id = ?1",
  "DELETE FROM planned_operational_constraints WHERE operation_day_id = ?1",
  "DELETE FROM recurring_operational_rules WHERE operation_day_id = ?1",
  "DELETE FROM rotations WHERE operation_day_id = ?1",
  "DELETE FROM flight_groups WHERE operation_day_id = ?1",
  "DELETE FROM tickets WHERE ticket_group_id IN (SELECT id FROM ticket_groups WHERE operation_day_id = ?1)",
  "DELETE FROM ticket_groups WHERE operation_day_id = ?1",
  "DELETE FROM outbox WHERE operation_day_id = ?1",
  "DELETE FROM idempotency_receipts WHERE operation_day_id = ?1",
  "DELETE FROM aircraft_product_turnaround_overrides WHERE operation_day_id = ?1",
  "DELETE FROM resource_group_memberships WHERE operation_day_id = ?1",
  "DELETE FROM products WHERE operation_day_id = ?1",
  "DELETE FROM pilots WHERE operation_day_id = ?1",
  "DELETE FROM operational_events WHERE operation_day_id = ?1",
  "DELETE FROM resource_groups WHERE operation_day_id = ?1",
  "DELETE FROM gates WHERE operation_day_id = ?1",
  "DELETE FROM paired_devices WHERE operation_day_id = ?1",
  "DELETE FROM operation_days WHERE id = ?1",
  "DELETE FROM aircraft WHERE id NOT IN (SELECT DISTINCT aircraft_id FROM resource_group_memberships)",
] as const;

export function eventDeletionStatements(env: Env, eventId: string): D1PreparedStatement[] {
  return EVENT_DELETION_SQL.map((sql) => {
    const statement = env.DB.prepare(sql);
    return sql.includes("?1") ? statement.bind(eventId) : statement;
  });
}

export async function finishEventDeletionAssetCleanup(
  env: Env,
  commandId: string,
  logoObjectKeys: readonly string[],
  response: EventDeletionResponse,
): Promise<EventDeletionResponse> {
  if (logoObjectKeys.length > 0) await env.BACKUPS.delete([...logoObjectKeys]);
  const completedResponse = { ...response, assetCleanupPending: false };
  await env.DB.prepare(
    `UPDATE event_deletion_receipts
        SET r2_cleanup_pending = 0, logo_object_keys_json = '[]', response_json = ?1
      WHERE command_id = ?2`,
  )
    .bind(JSON.stringify(completedResponse), commandId)
    .run();
  return completedResponse;
}
