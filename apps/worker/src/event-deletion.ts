import type { Env } from "./types";

export function eventDeletionStatements(env: Env, eventId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM fids_preferences WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM flight_line_assist_claims WHERE operation_day_id = ?1").bind(
      eventId,
    ),
    env.DB.prepare("DELETE FROM web_push_deliveries WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM web_push_subscriptions WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM outage_recovery_references WHERE operation_day_id = ?1").bind(
      eventId,
    ),
    env.DB.prepare(
      "DELETE FROM outage_recovery_entries WHERE batch_id IN (SELECT id FROM outage_recovery_batches WHERE operation_day_id = ?1)",
    ).bind(eventId),
    env.DB.prepare("DELETE FROM outage_recovery_batches WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM forecast_snapshots WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM rotation_manifest_corrections WHERE operation_day_id = ?1").bind(
      eventId,
    ),
    env.DB.prepare(
      "DELETE FROM rotation_tickets WHERE rotation_id IN (SELECT id FROM rotations WHERE operation_day_id = ?1)",
    ).bind(eventId),
    env.DB.prepare("DELETE FROM rotations WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM flight_groups WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare(
      "DELETE FROM tickets WHERE ticket_group_id IN (SELECT id FROM ticket_groups WHERE operation_day_id = ?1)",
    ).bind(eventId),
    env.DB.prepare("DELETE FROM ticket_groups WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM outbox WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM idempotency_receipts WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM operational_blocks WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM resource_group_memberships WHERE operation_day_id = ?1").bind(
      eventId,
    ),
    env.DB.prepare("DELETE FROM products WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM pilots WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM operational_events WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM resource_groups WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM gates WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM paired_devices WHERE operation_day_id = ?1").bind(eventId),
    env.DB.prepare("DELETE FROM operation_days WHERE id = ?1").bind(eventId),
    env.DB.prepare(
      "DELETE FROM aircraft WHERE id NOT IN (SELECT DISTINCT aircraft_id FROM resource_group_memberships)",
    ),
  ];
}
