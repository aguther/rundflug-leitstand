import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import {
  assertManualGroupMoveAllowed,
  DomainRuleError,
  type NonCanceledRotationState,
  planRotationCapacityReduction,
} from "@rundflug/domain";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class RotationCorrectionCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleRotationCapacity(
    command: Extract<CommandEnvelope, { type: "SET_ROTATION_CAPACITY" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status, r.version, r.called_at, r.usable_capacity, r.aircraft_id,
              fg.id AS flight_group_id, fg.resource_group_id,
              COALESCE(a.passenger_seats, MIN(p.reference_capacity), rg.reference_capacity)
                AS baseline_capacity
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         LEFT JOIN tickets t ON t.id = rt.ticket_id
         LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         LEFT JOIN products p ON p.id = tg.product_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2 AND r.status <> 'CANCELED'
        GROUP BY r.id, r.status, r.version, r.called_at, r.usable_capacity, r.aircraft_id,
                 fg.id, fg.resource_group_id, a.passenger_seats, rg.reference_capacity`,
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: NonCanceledRotationState;
        version: number;
        called_at: string | null;
        usable_capacity: number | null;
        aircraft_id: string | null;
        flight_group_id: string;
        resource_group_id: string;
        baseline_capacity: number;
      }>();
    if (!rotation) {
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    }
    const segmentRows = await this.env.DB.prepare(
      `SELECT tg.id AS ticket_group_id, tg.product_id, tg.queue_sequence,
              p.gate_id, COUNT(rt.ticket_id) AS segment_size, MIN(rt.assigned_at) AS assigned_at
         FROM rotation_tickets rt
         JOIN tickets t ON t.id = rt.ticket_id
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         JOIN products p ON p.id = tg.product_id
        WHERE rt.rotation_id = ?1 AND rt.released_at IS NULL
        GROUP BY tg.id, tg.product_id, tg.queue_sequence, p.gate_id
        ORDER BY tg.queue_sequence, assigned_at, tg.id`,
    )
      .bind(rotation.id)
      .all<{
        ticket_group_id: string;
        product_id: string;
        queue_sequence: number;
        gate_id: string;
        segment_size: number;
        assigned_at: string;
      }>();
    let reduction: ReturnType<typeof planRotationCapacityReduction>;
    try {
      reduction = planRotationCapacityReduction({
        rotationState: rotation.status,
        called: rotation.called_at !== null,
        baselineCapacity: rotation.baseline_capacity,
        currentUsableCapacity: rotation.usable_capacity,
        requestedUsableCapacity: command.payload.usableCapacity,
        segments: segmentRows.results.map((segment) => ({
          ticketGroupId: segment.ticket_group_id,
          size: segment.segment_size,
        })),
      });
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    const evictedSegments = reduction.evictedGroupIds.map((ticketGroupId) => {
      const segment = segmentRows.results.find((entry) => entry.ticket_group_id === ticketGroupId);
      if (!segment) throw new Error("Zu verdrängende Buchungsgruppe fehlt.");
      return segment;
    });
    const communication = await this.env.DB.prepare(
      `SELECT COALESCE(MAX(communication_number), 100) + 1 AS next_number
         FROM flight_groups WHERE operation_day_id = ?1 AND resource_group_id = ?2`,
    )
      .bind(command.eventId, rotation.resource_group_id)
      .first<{ next_number: number }>();
    const requeuedSlots = evictedSegments.map((segment, index) => ({
      ...segment,
      flightGroupId: crypto.randomUUID(),
      rotationId: crypto.randomUUID(),
      communicationNumber: (communication?.next_number ?? 101) + index,
      queuePosition: index + 1,
    }));
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const targetCanceled = reduction.keptGroupIds.length === 0;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "ROTATION_CAPACITY_CHANGED",
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE flight_groups
            SET queue_position = COALESCE(queue_position, communication_number) + ?1
          WHERE operation_day_id = ?2 AND resource_group_id = ?3
            AND id IN (SELECT flight_group_id FROM rotations WHERE status IN ('DRAFT', 'CALLED'))`,
      ).bind(requeuedSlots.length, command.eventId, rotation.resource_group_id),
      this.env.DB.prepare(
        `UPDATE rotations SET usable_capacity = ?1, status = ?2,
                version = version + 1, updated_at = ?3 WHERE id = ?4 AND version = ?5`,
      ).bind(
        command.payload.usableCapacity,
        targetCanceled ? "CANCELED" : rotation.status,
        now,
        rotation.id,
        rotation.version,
      ),
    ];
    if (targetCanceled && rotation.aircraft_id) {
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
    for (const slot of requeuedSlots) {
      statements.push(
        this.env.DB.prepare(
          `UPDATE rotation_tickets SET released_at = ?1
            WHERE rotation_id = ?2 AND released_at IS NULL
              AND ticket_id IN (SELECT id FROM tickets WHERE ticket_group_id = ?3)`,
        ).bind(now, rotation.id, slot.ticket_group_id),
        this.env.DB.prepare(
          `UPDATE ticket_groups SET status = 'QUEUED', version = version + 1 WHERE id = ?1`,
        ).bind(slot.ticket_group_id),
        this.env.DB.prepare(
          `UPDATE tickets SET status = 'QUEUED'
            WHERE id IN (
              SELECT rt.ticket_id FROM rotation_tickets rt
               WHERE rt.rotation_id = ?1 AND rt.released_at = ?2
            )`,
        ).bind(rotation.id, now),
        this.env.DB.prepare(
          `INSERT INTO flight_groups
            (id, operation_day_id, resource_group_id, product_id, communication_number, queue_position,
             status, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'DRAFT', 0, ?7, ?7)`,
        ).bind(
          slot.flightGroupId,
          command.eventId,
          rotation.resource_group_id,
          slot.product_id,
          slot.communicationNumber,
          slot.queuePosition,
          now,
        ),
        this.env.DB.prepare(
          `INSERT INTO rotations
            (id, operation_day_id, flight_group_id, gate_id, status, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
        ).bind(slot.rotationId, command.eventId, slot.flightGroupId, slot.gate_id, now),
        this.env.DB.prepare(
          `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
           SELECT ?1, rt.ticket_id, ?2
             FROM rotation_tickets rt
             JOIN tickets t ON t.id = rt.ticket_id
            WHERE rt.rotation_id = ?3 AND rt.released_at = ?2 AND t.ticket_group_id = ?4`,
        ).bind(slot.rotationId, now, rotation.id, slot.ticket_group_id),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'ROTATION_CAPACITY_CHANGED', ?3, ?4, 'ROTATION', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({
          reason: command.payload.reason,
          baselineCapacity: rotation.baseline_capacity,
          previousUsableCapacity: rotation.usable_capacity ?? rotation.baseline_capacity,
          usableCapacity: command.payload.usableCapacity,
          keptTicketGroupIds: reduction.keptGroupIds,
          requeuedTicketGroupIds: reduction.evictedGroupIds,
          requeuedRotationIds: requeuedSlots.map((slot) => slot.rotationId),
          targetCanceled,
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

  async handleManualTicketGroupMove(
    command: Extract<CommandEnvelope, { type: "MOVE_TICKET_GROUP" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const group = await this.env.DB.prepare(
      `SELECT tg.id, tg.product_id, tg.version, p.resource_group_id, COUNT(t.id) AS group_size
         FROM ticket_groups tg
         JOIN products p ON p.id = tg.product_id
         JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE tg.id = ?1 AND tg.operation_day_id = ?2
        GROUP BY tg.id, tg.product_id, tg.version, p.resource_group_id`,
    )
      .bind(command.payload.ticketGroupId, command.eventId)
      .first<{
        id: string;
        product_id: string;
        version: number;
        resource_group_id: string;
        group_size: number;
      }>();
    if (!group) {
      return json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Ticketgruppe nicht gefunden." } },
        { status: 404 },
      );
    }
    const sourceRotations = await this.env.DB.prepare(
      `SELECT DISTINCT r.id, r.status, r.aircraft_id,
              (SELECT COUNT(DISTINCT source_ticket.ticket_group_id)
                 FROM rotation_tickets source_rt
                 JOIN tickets source_ticket ON source_ticket.id = source_rt.ticket_id
                WHERE source_rt.rotation_id = r.id AND source_rt.released_at IS NULL)
                AS rotation_group_count
         FROM tickets t
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
        WHERE t.ticket_group_id = ?1
        ORDER BY r.created_at, r.id`,
    )
      .bind(group.id)
      .all<{
        id: string;
        status: NonCanceledRotationState;
        aircraft_id: string | null;
        rotation_group_count: number;
      }>();
    if (sourceRotations.results.length === 0) {
      return json(
        {
          error: { code: "TICKET_GROUP_UNASSIGNED", message: "Ticketgruppe ist nicht zugeordnet." },
        },
        { status: 409 },
      );
    }
    if (
      sourceRotations.results.length === 1 &&
      sourceRotations.results[0]?.id === command.payload.targetRotationId
    ) {
      return json(
        {
          error: {
            code: "TICKET_GROUP_ALREADY_ASSIGNED",
            message: "Die Buchungsgruppe ist diesem Umlauf bereits vollständig zugeordnet.",
          },
        },
        { status: 409 },
      );
    }
    const target = await this.env.DB.prepare(
      `SELECT r.id, r.status, fg.resource_group_id,
              COALESCE(r.usable_capacity, a.passenger_seats, MIN(p.reference_capacity), rg.reference_capacity)
                AS target_capacity,
              SUM(CASE WHEN tg.id IS NOT NULL AND tg.id <> ?3 THEN 1 ELSE 0 END)
                AS occupied_seats,
              SUM(CASE WHEN tg.id IS NOT NULL AND tg.id <> ?3 AND tg.product_id <> ?4
                       THEN 1 ELSE 0 END) AS incompatible_product_tickets
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         LEFT JOIN tickets t ON t.id = rt.ticket_id
         LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         LEFT JOIN products p ON p.id = tg.product_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2 AND r.status <> 'CANCELED'
        GROUP BY r.id, r.status, r.usable_capacity, fg.resource_group_id,
                 a.passenger_seats, rg.reference_capacity`,
    )
      .bind(command.payload.targetRotationId, command.eventId, group.id, group.product_id)
      .first<{
        id: string;
        status: NonCanceledRotationState;
        resource_group_id: string;
        target_capacity: number;
        occupied_seats: number;
        incompatible_product_tickets: number;
      }>();
    if (!target) {
      return json(
        { error: { code: "TARGET_ROTATION_NOT_FOUND", message: "Zielumlauf nicht gefunden." } },
        { status: 404 },
      );
    }
    try {
      assertManualGroupMoveAllowed({
        sourceStates: sourceRotations.results.map((rotation) => rotation.status),
        targetState: target.status,
        sameResourceGroup: target.resource_group_id === group.resource_group_id,
        sameProduct: target.incompatible_product_tickets === 0,
        groupSize: group.group_size,
        targetOccupiedSeats: target.occupied_seats,
        targetCapacity: target.target_capacity,
      });
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const changedAfterCall =
      target.status === "CALLED" ||
      sourceRotations.results.some((rotation) => rotation.status === "CALLED");
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "TICKET_GROUP_MOVED",
      aggregate: { type: "TICKET_GROUP", id: group.id, relatedRotationId: target.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE rotation_tickets SET released_at = ?1
          WHERE released_at IS NULL
            AND ticket_id IN (SELECT id FROM tickets WHERE ticket_group_id = ?2)`,
      ).bind(now, group.id),
      this.env.DB.prepare(
        `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
         SELECT ?1, id, ?2 FROM tickets WHERE ticket_group_id = ?3 ORDER BY created_at, id`,
      ).bind(target.id, now, group.id),
      this.env.DB.prepare(
        `UPDATE tickets
            SET status = CASE
              WHEN ?1 = 'CALLED' AND attendance_status = 'CHECKED_IN' THEN 'BOARDING'
              WHEN ?1 = 'CALLED' THEN 'CALLED'
              WHEN attendance_status = 'CHECKED_IN' THEN 'CHECKED_IN'
              ELSE 'QUEUED'
            END
          WHERE ticket_group_id = ?2`,
      ).bind(target.status, group.id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET status = ?1, version = version + 1
          WHERE id = ?2 AND version = ?3`,
      ).bind(target.status === "CALLED" ? "CALLED" : "QUEUED", group.id, group.version),
    ];
    for (const source of sourceRotations.results) {
      if (source.id === target.id || source.rotation_group_count !== 1) continue;
      statements.push(
        this.env.DB.prepare(
          "UPDATE rotations SET status = 'CANCELED', version = version + 1, updated_at = ?1 WHERE id = ?2",
        ).bind(now, source.id),
      );
      if (source.aircraft_id) {
        statements.push(
          this.env.DB.prepare(
            `UPDATE aircraft SET operational_state = 'AVAILABLE',
                    operational_state_changed_at = CASE
                      WHEN operational_state <> 'AVAILABLE' THEN ?1
                      ELSE operational_state_changed_at END,
                    version = version + 1, updated_at = ?1 WHERE id = ?2`,
          ).bind(now, source.aircraft_id),
        );
      }
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'TICKET_GROUP_MOVED', ?3, ?4, 'TICKET_GROUP', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        group.id,
        group.version + 1,
        JSON.stringify({
          reason: command.payload.reason,
          sourceRotationIds: sourceRotations.results.map((rotation) => rotation.id),
          targetRotationId: target.id,
          groupSize: group.group_size,
          targetCapacity: target.target_capacity,
          targetOccupiedSeatsBeforeMove: target.occupied_seats,
          changedAfterCall,
          manualDeviationFromAutomaticQueue: true,
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

  async handleRotationManifestCorrection(
    command: Extract<CommandEnvelope, { type: "CORRECT_ROTATION_MANIFEST" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const group = await this.env.DB.prepare(
      `SELECT tg.id, tg.version, COUNT(t.id) AS group_size
         FROM ticket_groups tg
         JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE tg.id = ?1 AND tg.operation_day_id = ?2
        GROUP BY tg.id, tg.version`,
    )
      .bind(command.payload.ticketGroupId, command.eventId)
      .first<{ id: string; version: number; group_size: number }>();
    if (!group) {
      return json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Ticketgruppe nicht gefunden." } },
        { status: 404 },
      );
    }
    const sourceRows = await this.env.DB.prepare(
      `SELECT r.id, r.status, COUNT(rt.ticket_id) AS assigned_tickets
         FROM tickets t
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
        WHERE t.ticket_group_id = ?1
        GROUP BY r.id, r.status
        ORDER BY r.created_at, r.id`,
    )
      .bind(group.id)
      .all<{
        id: string;
        status: NonCanceledRotationState;
        assigned_tickets: number;
      }>();
    const assignedTicketCount = sourceRows.results.reduce(
      (sum, source) => sum + source.assigned_tickets,
      0,
    );
    if (sourceRows.results.length === 0 || assignedTicketCount !== group.group_size) {
      return json(
        {
          error: {
            code: "TICKET_GROUP_ASSIGNMENT_INCOMPLETE",
            message:
              "Die vollständige Buchungsgruppe muss einer aktiven Besetzung zugeordnet sein.",
          },
        },
        { status: 409 },
      );
    }
    if (
      sourceRows.results.length === 1 &&
      sourceRows.results[0]?.id === command.payload.targetRotationId
    ) {
      return json(
        {
          error: {
            code: "MANIFEST_CORRECTION_UNCHANGED",
            message: "Die dokumentierte Besetzung entspricht bereits dem Zielumlauf.",
          },
        },
        { status: 409 },
      );
    }
    const target = await this.env.DB.prepare(
      `SELECT r.id, r.status,
              COALESCE(r.usable_capacity, a.passenger_seats, rg.reference_capacity) AS capacity,
              COUNT(rt.ticket_id) AS occupied_seats
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
        WHERE r.id = ?1 AND r.operation_day_id = ?2
        GROUP BY r.id, r.status, r.usable_capacity, a.passenger_seats, rg.reference_capacity`,
    )
      .bind(command.payload.targetRotationId, command.eventId)
      .first<{
        id: string;
        status: NonCanceledRotationState;
        capacity: number;
        occupied_seats: number;
      }>();
    if (!target) {
      return json(
        { error: { code: "TARGET_ROTATION_NOT_FOUND", message: "Zielumlauf nicht gefunden." } },
        { status: 404 },
      );
    }
    if (
      target.status !== "IN_FLIGHT" &&
      target.status !== "LANDED" &&
      target.status !== "COMPLETED"
    ) {
      return json(
        {
          error: {
            code: "MANIFEST_CORRECTION_NOT_POST_DEPARTURE",
            message: "Der Administrator-Sonderpfad ist erst ab IM FLUG zulässig.",
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const sourceRotationIds = sourceRows.results.map((source) => source.id);
    const capacityExceeded = target.occupied_seats + group.group_size > target.capacity;
    const correctionId = crypto.randomUUID();
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "ROTATION_MANIFEST_CORRECTED",
      aggregate: { type: "TICKET_GROUP", id: group.id, relatedRotationId: target.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE rotation_tickets SET released_at = ?1
          WHERE released_at IS NULL
            AND ticket_id IN (SELECT id FROM tickets WHERE ticket_group_id = ?2)`,
      ).bind(now, group.id),
      this.env.DB.prepare(
        `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at, released_at)
         SELECT ?1, id, ?2, NULL FROM tickets WHERE ticket_group_id = ?3 ORDER BY created_at, id
         ON CONFLICT(rotation_id, ticket_id) DO UPDATE
           SET assigned_at = excluded.assigned_at, released_at = NULL`,
      ).bind(target.id, now, group.id),
      this.env.DB.prepare("UPDATE tickets SET status = ?1 WHERE ticket_group_id = ?2").bind(
        target.status,
        group.id,
      ),
      this.env.DB.prepare(
        "UPDATE ticket_groups SET status = ?1, version = version + 1 WHERE id = ?2 AND version = ?3",
      ).bind(target.status, group.id, group.version),
      this.env.DB.prepare(
        `INSERT INTO rotation_manifest_corrections
          (id, operation_day_id, ticket_group_id, source_rotation_ids_json, target_rotation_id,
           reason, corrected_at, device_id, event_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      ).bind(
        correctionId,
        command.eventId,
        group.id,
        JSON.stringify(sourceRotationIds),
        target.id,
        command.payload.reason,
        now,
        command.deviceId,
        nextVersion,
      ),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'ROTATION_MANIFEST_CORRECTED', ?3, ?4, 'TICKET_GROUP', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        group.id,
        group.version + 1,
        JSON.stringify({
          correctionId,
          reason: command.payload.reason,
          sourceRotationIds,
          targetRotationId: target.id,
          targetStatus: target.status,
          groupSize: group.group_size,
          targetCapacity: target.capacity,
          targetOccupiedSeatsBeforeCorrection: target.occupied_seats,
          capacityExceeded,
          wholeGroupPreserved: true,
          administrativeCorrection: true,
          safetyApproval: false,
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
    ]);
    this.broadcast(result);
    return json(result);
  }
}
