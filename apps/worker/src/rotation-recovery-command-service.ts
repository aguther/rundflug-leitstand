import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import {
  assertTechnicalRotationAbortAllowed,
  DomainRuleError,
  planTechnicalRotationAbortQueueBlock,
} from "@rundflug/domain";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export const rotationRecoveryAuditEventTypes = {
  technicalAbort: "ROTATION_ABORTED_TO_QUEUE_AIRCRAFT_UNAVAILABLE",
  abort: "ROTATION_ABORTED_TO_QUEUE",
  revokeCall: "CALL_REVOKED",
} as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class RotationRecoveryCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleTechnicalRotationAbort(
    command: Extract<
      CommandEnvelope,
      { type: "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE" }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status, r.version, r.aircraft_id, a.version AS aircraft_version, r.pilot_id,
              r.called_at, r.departed_at, r.landed_at, r.completed_at,
              fg.id AS flight_group_id, fg.resource_group_id
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2`,
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED" | "CANCELED";
        version: number;
        aircraft_id: string | null;
        aircraft_version: number | null;
        pilot_id: string | null;
        called_at: string | null;
        departed_at: string | null;
        landed_at: string | null;
        completed_at: string | null;
        flight_group_id: string;
        resource_group_id: string;
      }>();
    if (!rotation) {
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    }
    try {
      assertTechnicalRotationAbortAllowed(rotation.status);
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    if (!rotation.aircraft_id) {
      return json(
        {
          error: {
            code: "AIRCRAFT_ASSIGNMENT_REQUIRED",
            message: "Dem Umlauf ist kein Flugzeug zugeordnet.",
          },
        },
        { status: 409 },
      );
    }
    if (
      rotation.version !== command.payload.expectedRotationVersion ||
      rotation.aircraft_version !== command.payload.expectedAircraftVersion
    ) {
      return json(
        {
          error: {
            code: "STALE_AGGREGATE_VERSION",
            message: "Umlauf oder Flugzeug wurde zwischenzeitlich geändert.",
            currentRotationVersion: rotation.version,
            currentAircraftVersion: rotation.aircraft_version,
          },
        },
        { status: 409 },
      );
    }

    const segmentRows = await this.env.DB.prepare(
      `SELECT tg.id AS ticket_group_id, tg.queue_sequence, MIN(rt.assigned_at) AS assigned_at
         FROM rotation_tickets rt
         JOIN tickets t ON t.id = rt.ticket_id
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
        WHERE rt.rotation_id = ?1 AND rt.released_at IS NULL
        GROUP BY tg.id, tg.queue_sequence
        ORDER BY tg.queue_sequence, assigned_at, tg.id`,
    )
      .bind(rotation.id)
      .all<{ ticket_group_id: string; queue_sequence: number; assigned_at: string }>();
    if (segmentRows.results.length === 0) {
      return json(
        {
          error: {
            code: "ROTATION_WITHOUT_TICKETS",
            message: "Der Umlauf enthält keine rückstellbare Buchungsgruppe.",
          },
        },
        { status: 409 },
      );
    }

    const queueMaximum = await this.env.DB.prepare(
      `SELECT COALESCE(MAX(tg.queue_sequence), 0) AS maximum_queue_sequence
         FROM ticket_groups tg
        WHERE tg.operation_day_id = ?1
          AND tg.product_id IN (
            SELECT id FROM products WHERE operation_day_id = ?1 AND resource_group_id = ?2
          )`,
    )
      .bind(command.eventId, rotation.resource_group_id)
      .first<{ maximum_queue_sequence: number }>();

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const queueBlock = planTechnicalRotationAbortQueueBlock(
      segmentRows.results.map((segment) => ({
        id: segment.ticket_group_id,
        queueSequence: segment.queue_sequence,
        assignedAt: segment.assigned_at,
      })),
    );
    const ticketGroupIds = queueBlock.map((segment) => segment.id);
    const parkingOffset = (queueMaximum?.maximum_queue_sequence ?? 0) + ticketGroupIds.length + 1;
    const placeholders = ticketGroupIds.map((_, index) => `?${index + 4}`).join(", ");
    const ticketGroupPlaceholders = ticketGroupIds.map((_, index) => `?${index + 1}`).join(", ");
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: rotationRecoveryAuditEventTypes.technicalAbort,
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET queue_sequence = queue_sequence + ?1
          WHERE operation_day_id = ?2
            AND product_id IN (
              SELECT id FROM products WHERE operation_day_id = ?2 AND resource_group_id = ?3
            )`,
      ).bind(parkingOffset, command.eventId, rotation.resource_group_id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET queue_sequence = queue_sequence - ?1
          WHERE operation_day_id = ?2
            AND product_id IN (
              SELECT id FROM products WHERE operation_day_id = ?2 AND resource_group_id = ?3
            )
            AND id NOT IN (${placeholders}) AND queue_sequence >= ?1`,
      ).bind(
        parkingOffset - ticketGroupIds.length,
        command.eventId,
        rotation.resource_group_id,
        ...ticketGroupIds,
      ),
      this.env.DB.prepare(
        `UPDATE flight_groups
            SET queue_position = COALESCE(queue_position, communication_number) + 1,
                version = version + 1,
                updated_at = ?1
          WHERE operation_day_id = ?2 AND resource_group_id = ?3
            AND id <> ?4 AND status = 'DRAFT'`,
      ).bind(now, command.eventId, rotation.resource_group_id, rotation.flight_group_id),
      this.env.DB.prepare(
        `UPDATE rotations
            SET status = 'DRAFT', aircraft_id = NULL, pilot_id = NULL,
                called_at = NULL, departed_at = NULL, landed_at = NULL, completed_at = NULL,
                version = version + 1, updated_at = ?1
          WHERE id = ?2 AND version = ?3`,
      ).bind(now, rotation.id, rotation.version),
      this.env.DB.prepare(
        `UPDATE flight_groups
            SET status = 'DRAFT', queue_position = 1, version = version + 1, updated_at = ?1
          WHERE id = ?2`,
      ).bind(now, rotation.flight_group_id),
      this.env.DB.prepare(
        `UPDATE tickets SET status = CASE
            WHEN attendance_status = 'CHECKED_IN' THEN 'CHECKED_IN' ELSE 'QUEUED' END
          WHERE id IN (
            SELECT ticket_id FROM rotation_tickets
             WHERE rotation_id = ?1 AND released_at IS NULL
          )`,
      ).bind(rotation.id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET status = CASE
            WHEN EXISTS (
              SELECT 1 FROM tickets
               WHERE ticket_group_id = ticket_groups.id AND attendance_status = 'CHECKED_IN'
            ) THEN 'PRESENT' ELSE 'QUEUED' END,
            version = version + 1
          WHERE id IN (${ticketGroupPlaceholders})`,
      ).bind(...ticketGroupIds),
      this.env.DB.prepare(
        `UPDATE aircraft SET operational_state = 'INACTIVE',
                operational_state_changed_at = CASE
                  WHEN operational_state <> 'INACTIVE' THEN ?1 ELSE operational_state_changed_at END,
                version = version + 1, updated_at = ?1
          WHERE id = ?2 AND version = ?3`,
      ).bind(now, rotation.aircraft_id, command.payload.expectedAircraftVersion),
    ];
    queueBlock.forEach((segment) => {
      statements.push(
        this.env.DB.prepare("UPDATE ticket_groups SET queue_sequence = ?1 WHERE id = ?2").bind(
          segment.queueSequence,
          segment.id,
        ),
      );
    });
    const auditPayload = {
      reason: command.payload.reason,
      fromStatus: rotation.status,
      aircraftId: rotation.aircraft_id,
      pilotId: rotation.pilot_id,
      ticketGroupIds,
      returnedToQueueSequences: ticketGroupIds.map((ticketGroupId, index) => ({
        ticketGroupId,
        queueSequence: index + 1,
      })),
      previousActuals: {
        boardingAt: rotation.called_at,
        departureAt: rotation.departed_at,
        landingAt: rotation.landed_at,
        completionAt: rotation.completed_at,
      },
      aircraftOperationalState: "INACTIVE",
    };
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, '${rotationRecoveryAuditEventTypes.technicalAbort}', ?3, ?4,
                 'ROTATION', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify(auditPayload),
      ),
      this.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        command.commandId,
        command.eventId,
        command.deviceId,
        command.type,
        now,
        JSON.stringify(result),
      ),
      this.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)`,
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }

  async handleAbortRotation(
    command: Extract<CommandEnvelope, { type: "ABORT_ROTATION" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status, r.version, r.aircraft_id, fg.id AS flight_group_id,
              fg.resource_group_id,
              tg.id AS ticket_group_id, tg.product_id
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         JOIN tickets t ON t.id = rt.ticket_id
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2
        LIMIT 1`,
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: string;
        version: number;
        aircraft_id: string | null;
        flight_group_id: string;
        resource_group_id: string;
        ticket_group_id: string;
        product_id: string;
      }>();
    if (rotation?.status !== "CALLED") {
      return json(
        {
          error: {
            code: "ROTATION_ABORT_NOT_ALLOWED",
            message: "Nur ein aufgerufener, noch nicht gestarteter Umlauf kann abgebrochen werden.",
          },
        },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: rotationRecoveryAuditEventTypes.abort,
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET queue_sequence = queue_sequence + 100000
          WHERE operation_day_id = ?1 AND id <> ?3 AND status = 'QUEUED'
            AND product_id IN (SELECT id FROM products WHERE operation_day_id = ?1 AND resource_group_id = ?2)`,
      ).bind(command.eventId, rotation.resource_group_id, rotation.ticket_group_id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET queue_sequence = 1, status = 'QUEUED', version = version + 1
          WHERE id = ?1`,
      ).bind(rotation.ticket_group_id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET queue_sequence = queue_sequence - 99999
          WHERE operation_day_id = ?1 AND id <> ?3 AND status = 'QUEUED' AND queue_sequence >= 100000
            AND product_id IN (SELECT id FROM products WHERE operation_day_id = ?1 AND resource_group_id = ?2)`,
      ).bind(command.eventId, rotation.resource_group_id, rotation.ticket_group_id),
      this.env.DB.prepare(
        `UPDATE rotations SET status = 'DRAFT', aircraft_id = NULL, pilot_id = NULL,
                called_at = NULL, version = version + 1, updated_at = ?1
          WHERE id = ?2 AND version = ?3`,
      ).bind(now, rotation.id, rotation.version),
      this.env.DB.prepare(
        "UPDATE flight_groups SET status = 'DRAFT', version = version + 1, updated_at = ?1 WHERE id = ?2",
      ).bind(now, rotation.flight_group_id),
      this.env.DB.prepare(
        `UPDATE tickets SET status = CASE
            WHEN attendance_status = 'CHECKED_IN' THEN 'CHECKED_IN' ELSE 'QUEUED' END
          WHERE id IN (SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?1 AND released_at IS NULL)`,
      ).bind(rotation.id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET status = CASE
            WHEN EXISTS (
              SELECT 1 FROM tickets
               WHERE ticket_group_id = ticket_groups.id AND attendance_status = 'CHECKED_IN'
            ) THEN 'PRESENT' ELSE 'QUEUED' END,
            version = version + 1
          WHERE id IN (
            SELECT DISTINCT t.ticket_group_id
              FROM tickets t
              JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
             WHERE rt.rotation_id = ?1
          )`,
      ).bind(rotation.id),
    ];
    if (rotation.aircraft_id) {
      statements.push(
        this.env.DB.prepare(
          `UPDATE aircraft SET operational_state = 'AVAILABLE',
                  operational_state_changed_at = CASE
                  WHEN operational_state <> 'AVAILABLE' THEN ?1
                  ELSE operational_state_changed_at END,
                  version = version + 1, updated_at = ?1 WHERE id = ?2`,
        ).bind(now, rotation.aircraft_id),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, '${rotationRecoveryAuditEventTypes.abort}', ?3, ?4, 'ROTATION', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({
          reason: command.payload.reason,
          ticketGroupId: rotation.ticket_group_id,
          returnedToQueueSequence: 1,
        }),
      ),
      this.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        command.commandId,
        command.eventId,
        command.deviceId,
        command.type,
        now,
        JSON.stringify(result),
      ),
      this.env.DB.prepare(
        "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }

  async handleRevokeCall(
    command: Extract<CommandEnvelope, { type: "REVOKE_CALL" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      "SELECT id, status, version, aircraft_id, called_at FROM rotations WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: string;
        version: number;
        aircraft_id: string | null;
        called_at: string | null;
      }>();
    if (rotation?.status !== "CALLED" || !rotation.called_at) {
      return json(
        {
          error: {
            code: "CALL_NOT_REVERSIBLE",
            message: "Aufruf kann nicht zurückgenommen werden.",
          },
        },
        { status: 409 },
      );
    }
    if (Date.now() - Date.parse(rotation.called_at) > 10_000) {
      return json(
        { error: { code: "UNDO_WINDOW_EXPIRED", message: "Zehn-Sekunden-Frist ist abgelaufen." } },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: rotationRecoveryAuditEventTypes.revokeCall,
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE rotations SET status = 'DRAFT', aircraft_id = NULL, pilot_id = NULL, call_revoked_at = ?1,
                version = version + 1, updated_at = ?1 WHERE id = ?2 AND version = ?3`,
      ).bind(now, rotation.id, rotation.version),
      this.env.DB.prepare(
        `UPDATE tickets SET status = CASE
            WHEN attendance_status = 'CHECKED_IN' THEN 'CHECKED_IN' ELSE 'QUEUED' END
          WHERE id IN (
            SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?1 AND released_at IS NULL
          )`,
      ).bind(rotation.id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET status = CASE
            WHEN EXISTS (
              SELECT 1 FROM tickets
               WHERE ticket_group_id = ticket_groups.id AND attendance_status = 'CHECKED_IN'
            ) THEN 'PRESENT' ELSE 'QUEUED' END,
            version = version + 1
          WHERE id IN (
            SELECT DISTINCT t.ticket_group_id
              FROM tickets t
              JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
             WHERE rt.rotation_id = ?1
          )`,
      ).bind(rotation.id),
      this.env.DB.prepare(
        "UPDATE flight_groups SET status = 'DRAFT', version = version + 1, updated_at = ?1 WHERE id = (SELECT flight_group_id FROM rotations WHERE id = ?2)",
      ).bind(now, rotation.id),
    ];
    if (rotation.aircraft_id) {
      statements.push(
        this.env.DB.prepare(
          `UPDATE aircraft SET operational_state = 'AVAILABLE',
                  operational_state_changed_at = CASE
                  WHEN operational_state <> 'AVAILABLE' THEN ?1
                  ELSE operational_state_changed_at END,
                  version = version + 1, updated_at = ?1 WHERE id = ?2`,
        ).bind(now, rotation.aircraft_id),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, '${rotationRecoveryAuditEventTypes.revokeCall}', ?3, ?4, 'ROTATION', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({ corrects: "FLIGHT_GROUP_CALLED", calledAt: rotation.called_at }),
      ),
      this.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         VALUES (?1, ?2, ?3, 'REVOKE_CALL', ?4, ?5)`,
      ).bind(command.commandId, command.eventId, command.deviceId, now, JSON.stringify(result)),
      this.env.DB.prepare(
        "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }
}
