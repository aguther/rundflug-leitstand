import type { CommandResult } from "@rundflug/contracts";
import type { TicketGroupRecallEndReason } from "@rundflug/domain";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

export interface StoredTicketGroupRecall {
  id: string;
  ticket_group_id: string;
  sequence: number;
  started_at: string;
  expires_at: string;
}

export interface TicketGroupRecallClosureInput {
  recalls: readonly StoredTicketGroupRecall[];
  eventId: string;
  reason: TicketGroupRecallEndReason;
  deviceId: string;
  now: string;
  event: CommandResult["event"];
}

export class TicketGroupRecallPersistenceService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async loadOpen(
    eventId: string,
    ticketGroupIds: readonly string[],
    onlyUnexpiredAt?: string,
  ): Promise<StoredTicketGroupRecall[]> {
    const distinctGroupIds = [...new Set(ticketGroupIds)];
    if (distinctGroupIds.length === 0) return [];
    const groupPlaceholders = distinctGroupIds.map((_, index) => `?${index + 2}`).join(", ");
    const expiryFilter = onlyUnexpiredAt
      ? `AND recall.expires_at > ?${distinctGroupIds.length + 2}`
      : "";
    const rows = await this.env.DB.prepare(
      `SELECT recall.id, recall.ticket_group_id, recall.sequence,
              recall.started_at, recall.expires_at
         FROM ticket_group_recalls recall
        WHERE recall.operation_day_id = ?1
          AND recall.ticket_group_id IN (${groupPlaceholders})
          AND recall.ended_at IS NULL
          ${expiryFilter}
        ORDER BY recall.ticket_group_id`,
    )
      .bind(eventId, ...distinctGroupIds, ...(onlyUnexpiredAt ? [onlyUnexpiredAt] : []))
      .all<StoredTicketGroupRecall>();
    return rows.results;
  }

  closureStatements(input: TicketGroupRecallClosureInput): D1PreparedStatement[] {
    return input.recalls.flatMap((recall) => {
      const result: CommandResult = {
        accepted: true,
        duplicate: false,
        event: input.event,
        eventType: "TICKET_GROUP_RECALL_CLEARED",
        aggregate: { type: "TICKET_GROUP_RECALL", id: recall.id },
      };
      return [
        this.env.DB.prepare(
          `UPDATE ticket_group_recalls
              SET ended_at = ?1, end_reason = ?2
            WHERE id = ?3 AND operation_day_id = ?4 AND ended_at IS NULL`,
        ).bind(input.now, input.reason, recall.id, input.eventId),
        this.env.DB.prepare(
          `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, 'TICKET_GROUP_RECALL_CLEARED', ?3, ?4,
                   'TICKET_GROUP_RECALL', ?5, ?6, ?7)`,
        ).bind(
          crypto.randomUUID(),
          input.eventId,
          input.now,
          input.deviceId,
          recall.id,
          recall.sequence,
          JSON.stringify({
            recallId: recall.id,
            ticketGroupId: recall.ticket_group_id,
            sequence: recall.sequence,
            reason: input.reason,
          }),
        ),
        this.env.DB.prepare(
          `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
           VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)`,
        ).bind(crypto.randomUUID(), input.eventId, JSON.stringify(result), input.now),
      ];
    });
  }

  async expire(event: StoredEventRow): Promise<void> {
    const now = new Date().toISOString();
    const due = await this.env.DB.prepare(
      `SELECT id, ticket_group_id, sequence, started_at, expires_at
         FROM ticket_group_recalls
        WHERE operation_day_id = ?1 AND ended_at IS NULL AND expires_at <= ?2
        ORDER BY expires_at, id
        LIMIT 20`,
    )
      .bind(event.id, now)
      .all<StoredTicketGroupRecall>();
    if (due.results.length === 0) return;

    const nextVersion = event.version + 1;
    const nextEvent = rowToSnapshot({ ...event, version: nextVersion, updated_at: now });
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: nextEvent,
      eventType: "TICKET_GROUP_RECALL_EXPIRED",
      aggregate: { type: "OPERATION_DAY", id: event.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE operation_days SET version = ?1, updated_at = ?2
          WHERE id = ?3 AND version = ?4`,
      ).bind(nextVersion, now, event.id, event.version),
      ...this.closureStatements({
        recalls: due.results,
        eventId: event.id,
        reason: "EXPIRED",
        deviceId: "SYSTEM",
        now,
        event: nextEvent,
      }),
    ]);
    this.broadcast(result);
  }
}
