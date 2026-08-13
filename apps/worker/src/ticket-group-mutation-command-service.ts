import type { CommandResult } from "@rundflug/contracts";
import {
  assertQueueMutationAllowed,
  DomainRuleError,
  planBookingGroupSplit,
} from "@rundflug/domain";
import { rowToSnapshot } from "./snapshot";
import {
  ticketGroupMutationJson as json,
  queueMutationAction,
  type TicketGroupMutationCommand,
  type TicketGroupMutationRow,
  type TicketGroupRotationRow,
  terminalTicketStatus,
} from "./ticket-group-mutation-support";
import type {
  StoredTicketGroupRecall,
  TicketGroupRecallClosureInput,
} from "./ticket-group-recall-persistence-service";
import type { Env, StoredEventRow } from "./types";

export class TicketGroupMutationCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
    private readonly loadOpenTicketGroupRecalls: (
      eventId: string,
      ticketGroupIds: readonly string[],
      onlyUnexpiredAt?: string,
    ) => Promise<StoredTicketGroupRecall[]>,
    private readonly ticketGroupRecallClosureStatements: (
      input: TicketGroupRecallClosureInput,
    ) => D1PreparedStatement[],
  ) {}

  private async loadTicketGroup(command: TicketGroupMutationCommand) {
    return this.env.DB.prepare(
      `SELECT tg.id, tg.product_id, tg.version, tg.deferral_count,
              p.resource_group_id, COUNT(t.id) AS group_size
         FROM ticket_groups tg
         JOIN products p ON p.id = tg.product_id
         JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE tg.id = ?1 AND tg.operation_day_id = ?2
        GROUP BY tg.id, tg.product_id, tg.version, tg.deferral_count, p.resource_group_id`,
    )
      .bind(command.payload.ticketGroupId, command.eventId)
      .first<TicketGroupMutationRow>();
  }

  private async loadTicketGroupRotations(groupId: string): Promise<TicketGroupRotationRow[]> {
    const rows = await this.env.DB.prepare(
      `SELECT DISTINCT r.id, r.status, r.called_at, r.aircraft_id,
              (SELECT COUNT(DISTINCT grouped_ticket.ticket_group_id)
                 FROM rotation_tickets grouped_rt
                 JOIN tickets grouped_ticket ON grouped_ticket.id = grouped_rt.ticket_id
                WHERE grouped_rt.rotation_id = r.id AND grouped_rt.released_at IS NULL)
                AS rotation_group_count
         FROM tickets t
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
        WHERE t.ticket_group_id = ?1
        ORDER BY r.created_at, r.id`,
    )
      .bind(groupId)
      .all<TicketGroupRotationRow>();
    return rows.results;
  }

  private validateRotationMutation(
    command: TicketGroupMutationCommand,
    current: StoredEventRow,
    rotations: readonly TicketGroupRotationRow[],
  ): Response | null {
    if (rotations.length === 0) {
      return json(
        {
          error: { code: "TICKET_GROUP_UNASSIGNED", message: "Ticketgruppe ist nicht zugeordnet." },
        },
        { status: 409 },
      );
    }
    const noShowDeadlinePending =
      command.type === "MARK_NO_SHOW" &&
      rotations.some(
        (rotation) =>
          rotation.status !== "CALLED" ||
          !rotation.called_at ||
          Date.now() - Date.parse(rotation.called_at) <
            (current.no_show_after_minutes ?? 10) * 60_000,
      );
    if (noShowDeadlinePending) {
      return json(
        {
          error: {
            code: "NO_SHOW_DEADLINE_NOT_REACHED",
            message: "Die konfigurierte No-Show-Frist ist noch nicht erreicht.",
          },
        },
        { status: 409 },
      );
    }
    const action = queueMutationAction(command.type);
    try {
      for (const rotation of rotations) {
        assertQueueMutationAllowed({ rotationState: rotation.status, action });
      }
      return null;
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
  }

  private appendReleasedRotationStatements(
    statements: D1PreparedStatement[],
    rotations: readonly TicketGroupRotationRow[],
    now: string,
  ): void {
    for (const rotation of rotations) {
      if (rotation.rotation_group_count !== 1) continue;
      statements.push(
        this.env.DB.prepare(
          "UPDATE rotations SET status = 'CANCELED', version = version + 1, updated_at = ?1 WHERE id = ?2",
        ).bind(now, rotation.id),
      );
      if (!rotation.aircraft_id) continue;
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
  }

  async handleTicketGroupMutation(
    command: TicketGroupMutationCommand,
    current: StoredEventRow,
  ): Promise<Response> {
    const group = await this.loadTicketGroup(command);
    if (!group) {
      return json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Ticketgruppe nicht gefunden." } },
        { status: 404 },
      );
    }
    const rotations = await this.loadTicketGroupRotations(group.id);
    const validationFailure = this.validateRotationMutation(command, current, rotations);
    if (validationFailure) return validationFailure;
    const targetProductId = group.product_id;
    const targetResourceGroupId = group.resource_group_id;
    const currentProduct = await this.env.DB.prepare(
      "SELECT gate_id, reference_capacity FROM products WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(targetProductId, command.eventId)
      .first<{ gate_id: string; reference_capacity: number }>();
    const targetGateId = currentProduct?.gate_id ?? null;
    const targetReferenceCapacity = currentProduct?.reference_capacity ?? 0;
    if (command.type === "DEFER_TICKET_GROUP" && !targetGateId) {
      return json(
        {
          error: {
            code: "PRODUCT_GATE_REQUIRED",
            message: "Für den neuen Umlauf muss ein Produkt-Gate konfiguriert sein.",
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const nextDeferralCount =
      command.type === "DEFER_TICKET_GROUP" ? group.deferral_count + 1 : group.deferral_count;
    const requiresCashierClarification =
      command.type === "DEFER_TICKET_GROUP" &&
      nextDeferralCount >= (current.max_ticket_deferrals ?? 2);
    const eventType = {
      CANCEL_TICKET_GROUP: "TICKET_GROUP_CANCELED",
      DEFER_TICKET_GROUP: "TICKET_GROUP_DEFERRED",
      MARK_NO_SHOW: "TICKET_GROUP_NO_SHOW",
    } as const;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: eventType[command.type],
      aggregate: { type: "TICKET_GROUP", id: group.id },
    };
    const recallClosures = await this.loadOpenTicketGroupRecalls(command.eventId, [group.id], now);
    const recallClosureReason = {
      CANCEL_TICKET_GROUP: "CANCELED",
      DEFER_TICKET_GROUP: "DEFERRED",
      MARK_NO_SHOW: "NO_SHOW",
    } as const;
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE rotation_tickets SET released_at = ?1
          WHERE released_at IS NULL
            AND ticket_id IN (SELECT id FROM tickets WHERE ticket_group_id = ?2)`,
      ).bind(now, group.id),
      ...this.ticketGroupRecallClosureStatements({
        recalls: recallClosures,
        eventId: command.eventId,
        reason: recallClosureReason[command.type],
        deviceId: command.deviceId,
        now,
        event: result.event,
      }),
    ];
    this.appendReleasedRotationStatements(statements, rotations, now);

    if (
      command.type === "CANCEL_TICKET_GROUP" ||
      command.type === "MARK_NO_SHOW" ||
      requiresCashierClarification
    ) {
      const status = terminalTicketStatus(command.type);
      statements.push(
        this.env.DB.prepare(
          `UPDATE ticket_groups SET status = ?1, deferral_count = ?2,
                  version = version + 1 WHERE id = ?3 AND version = ?4`,
        ).bind(status, nextDeferralCount, group.id, group.version),
        this.env.DB.prepare("UPDATE tickets SET status = ?1 WHERE ticket_group_id = ?2").bind(
          status,
          group.id,
        ),
      );
    } else {
      const queue = await this.env.DB.prepare(
        `SELECT COALESCE(MAX(tg.queue_sequence), 0) + 1 AS next_sequence
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
          WHERE tg.operation_day_id = ?1 AND p.resource_group_id = ?2`,
      )
        .bind(command.eventId, targetResourceGroupId)
        .first<{ next_sequence: number }>();
      const communication = await this.env.DB.prepare(
        "SELECT COALESCE(MAX(communication_number), 100) + 1 AS next_number FROM flight_groups WHERE operation_day_id = ?1 AND resource_group_id = ?2",
      )
        .bind(command.eventId, targetResourceGroupId)
        .first<{ next_number: number }>();
      const reassignmentPlan = planBookingGroupSplit({
        groupSize: group.group_size,
        referenceCapacity: targetReferenceCapacity,
        splitAcknowledged: true,
      });
      const reassignmentSlots = reassignmentPlan.slotSizes.map((slotSize, index) => ({
        flightGroupId: crypto.randomUUID(),
        rotationId: crypto.randomUUID(),
        communicationNumber: (communication?.next_number ?? 101) + index,
        ticketOffset: index * targetReferenceCapacity,
        ticketCount: slotSize,
      }));
      statements.push(
        this.env.DB.prepare(
          `UPDATE ticket_groups SET product_id = ?1, queue_sequence = ?2, status = 'QUEUED',
                  deferral_count = ?3, version = version + 1 WHERE id = ?4 AND version = ?5`,
        ).bind(
          targetProductId,
          queue?.next_sequence ?? 1,
          nextDeferralCount,
          group.id,
          group.version,
        ),
        this.env.DB.prepare("UPDATE tickets SET status = 'QUEUED' WHERE ticket_group_id = ?1").bind(
          group.id,
        ),
      );
      for (const slot of reassignmentSlots) {
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO flight_groups
            (id, operation_day_id, resource_group_id, product_id, communication_number,
             status, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'DRAFT', 0, ?6, ?6)`,
          ).bind(
            slot.flightGroupId,
            command.eventId,
            targetResourceGroupId,
            targetProductId,
            slot.communicationNumber,
            now,
          ),
          this.env.DB.prepare(
            `INSERT INTO rotations (id, operation_day_id, flight_group_id, gate_id, status, version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
          ).bind(slot.rotationId, command.eventId, slot.flightGroupId, targetGateId, now),
          this.env.DB.prepare(
            `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
             SELECT ?1, id, ?2 FROM tickets WHERE ticket_group_id = ?3
              ORDER BY created_at, id LIMIT ?4 OFFSET ?5`,
          ).bind(slot.rotationId, now, group.id, slot.ticketCount, slot.ticketOffset),
        );
      }
    }

    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type, aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'TICKET_GROUP', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType[command.type],
        now,
        command.deviceId,
        group.id,
        group.version + 1,
        JSON.stringify({
          reason: command.payload.reason,
          targetProductId,
          deferralCount: nextDeferralCount,
          maxTicketDeferrals: current.max_ticket_deferrals ?? 2,
          requiresCashierClarification,
        }),
      ),
      this.env.DB.prepare(
        `INSERT INTO idempotency_receipts (command_id, operation_day_id, device_id, command_type, received_at, response_json)
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
}
