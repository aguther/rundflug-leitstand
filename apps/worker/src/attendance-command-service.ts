import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import {
  assertTicketNoShowAllowed,
  DomainRuleError,
  TICKET_GROUP_RECALL_DURATION_MS,
  ticketGroupRecallEligibility,
} from "@rundflug/domain";
import {
  attendanceJson as json,
  ticketGroupStatusForAttendance,
  ticketStatusForAttendance,
} from "./attendance-command-response";
import { rowToSnapshot } from "./snapshot";
import type {
  StoredTicketGroupRecall,
  TicketGroupRecallClosureInput,
} from "./ticket-group-recall-persistence-service";
import type { Env, StoredEventRow } from "./types";
import { sendTicketGroupRecallPushNotifications } from "./web-push";
export class AttendanceCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
    private readonly waitUntil: (promise: Promise<unknown>) => void,
    private readonly loadOpenTicketGroupRecalls: (
      eventId: string,
      ticketGroupIds: readonly string[],
      onlyUnexpiredAt?: string,
    ) => Promise<StoredTicketGroupRecall[]>,
    private readonly ticketGroupRecallClosureStatements: (
      input: TicketGroupRecallClosureInput,
    ) => D1PreparedStatement[],
  ) {}

  async handleTicketAttendance(
    command: Extract<CommandEnvelope, { type: "SET_TICKET_ATTENDANCE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const ticket = await this.env.DB.prepare(
      `SELECT t.id, t.status, t.attendance_status, r.status AS rotation_status
         FROM tickets t
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
        WHERE t.id = ?1 AND tg.operation_day_id = ?2`,
    )
      .bind(command.payload.ticketId, command.eventId)
      .first<{
        id: string;
        status: string;
        attendance_status: "NOT_CHECKED_IN" | "CHECKED_IN";
        rotation_status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      }>();
    if (!ticket) {
      return json(
        { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
        { status: 404 },
      );
    }
    if (!["DRAFT", "CALLED"].includes(ticket.rotation_status)) {
      return json(
        {
          error: {
            code: "ATTENDANCE_LOCKED",
            message: "Der Anwesenheitsstatus ist nach IM FLUG nicht mehr änderbar.",
          },
        },
        { status: 409 },
      );
    }
    const nextAttendance = command.payload.checkedIn ? "CHECKED_IN" : "NOT_CHECKED_IN";
    const nextTicketStatus = ticketStatusForAttendance(
      command.payload.checkedIn,
      ticket.rotation_status,
    );
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = command.payload.checkedIn ? "TICKET_CHECKED_IN" : "TICKET_CHECK_IN_REVOKED";
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: "TICKET", id: ticket.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        "UPDATE tickets SET attendance_status = ?1, status = ?2 WHERE id = ?3",
      ).bind(nextAttendance, nextTicketStatus, ticket.id),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'TICKET', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        ticket.id,
        nextVersion,
        JSON.stringify({
          attendanceFrom: ticket.attendance_status,
          attendanceTo: nextAttendance,
          ticketStatusFrom: ticket.status,
          ticketStatusTo: nextTicketStatus,
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

  async handleTicketGroupAttendance(
    command: Extract<CommandEnvelope, { type: "SET_TICKET_GROUP_ATTENDANCE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const group = await this.env.DB.prepare(
      `SELECT tg.id, tg.status, tg.version, r.status AS rotation_status
         FROM ticket_groups tg
         JOIN tickets t ON t.ticket_group_id = tg.id
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
        WHERE tg.id = ?1 AND tg.operation_day_id = ?2
        LIMIT 1`,
    )
      .bind(command.payload.ticketGroupId, command.eventId)
      .first<{ id: string; status: string; version: number; rotation_status: string }>();
    if (!group) {
      return json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Buchungsgruppe nicht gefunden." } },
        { status: 404 },
      );
    }
    if (!["DRAFT", "CALLED"].includes(group.rotation_status)) {
      return json(
        {
          error: {
            code: "ATTENDANCE_LOCKED",
            message: "Die Anwesenheit kann nach Off-Block nicht mehr geändert werden.",
          },
        },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const checkedIn = command.payload.checkedIn;
    const ticketStatus = ticketGroupStatusForAttendance(checkedIn, group.rotation_status);
    const eventType = checkedIn ? "TICKET_GROUP_CHECKED_IN" : "TICKET_GROUP_CHECK_IN_REVOKED";
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: "TICKET_GROUP", id: group.id },
    };
    const recallClosures = checkedIn
      ? await this.loadOpenTicketGroupRecalls(command.eventId, [group.id], now)
      : [];
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        "UPDATE ticket_groups SET status = ?1, version = version + 1 WHERE id = ?2 AND version = ?3",
      ).bind(checkedIn ? "PRESENT" : "QUEUED", group.id, group.version),
      this.env.DB.prepare(
        "UPDATE tickets SET attendance_status = ?1, status = ?2 WHERE ticket_group_id = ?3",
      ).bind(checkedIn ? "CHECKED_IN" : "NOT_CHECKED_IN", ticketStatus, group.id),
      ...this.ticketGroupRecallClosureStatements({
        recalls: recallClosures,
        eventId: command.eventId,
        reason: "PRESENT",
        deviceId: command.deviceId,
        now,
        event: result.event,
      }),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'TICKET_GROUP', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        group.id,
        group.version + 1,
        JSON.stringify({ checkedIn }),
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

  async handleTicketGroupRecall(
    command: Extract<
      CommandEnvelope,
      { type: "START_TICKET_GROUP_RECALL" | "CLEAR_TICKET_GROUP_RECALL" }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    const group = await this.env.DB.prepare(
      `SELECT tg.id, tg.status, g.label AS gate_label,
              COALESCE((
                SELECT MAX(recall.sequence)
                  FROM ticket_group_recalls recall
                 WHERE recall.ticket_group_id = tg.id
              ), 0) AS recall_count
         FROM ticket_groups tg
         JOIN products p ON p.id = tg.product_id
         JOIN gates g ON g.id = p.gate_id
        WHERE tg.id = ?1 AND tg.operation_day_id = ?2`,
    )
      .bind(command.payload.ticketGroupId, command.eventId)
      .first<{
        id: string;
        status: string;
        gate_label: string;
        recall_count: number;
      }>();
    if (!group) {
      return json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Buchungsgruppe nicht gefunden." } },
        { status: 404 },
      );
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const openRecalls = await this.loadOpenTicketGroupRecalls(command.eventId, [group.id]);
    const openRecall = openRecalls[0] ?? null;
    const activeRecall =
      openRecall && Date.parse(openRecall.expires_at) > nowDate.getTime() ? openRecall : null;
    const nextVersion = current.version + 1;
    const nextEvent = rowToSnapshot({ ...current, version: nextVersion, updated_at: now });

    if (command.type === "CLEAR_TICKET_GROUP_RECALL") {
      if (!activeRecall) {
        return json(
          {
            error: {
              code: "TICKET_GROUP_RECALL_NOT_ACTIVE",
              message: "Für diese Buchungsgruppe ist kein Nachruf mehr aktiv.",
            },
          },
          { status: 409 },
        );
      }
      if (activeRecall.id !== command.payload.recallId) {
        return json(
          {
            error: {
              code: "TICKET_GROUP_RECALL_STALE",
              message: "Der Nachruf wurde inzwischen ersetzt oder beendet.",
            },
          },
          { status: 409 },
        );
      }
      const result: CommandResult = {
        accepted: true,
        duplicate: false,
        event: nextEvent,
        eventType: "TICKET_GROUP_RECALL_CLEARED",
        aggregate: { type: "TICKET_GROUP_RECALL", id: activeRecall.id },
      };
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE operation_days SET version = ?1, updated_at = ?2
            WHERE id = ?3 AND version = ?4`,
        ).bind(nextVersion, now, command.eventId, current.version),
        ...this.ticketGroupRecallClosureStatements({
          recalls: [activeRecall],
          eventId: command.eventId,
          reason: "MANUAL",
          deviceId: command.deviceId,
          now,
          event: nextEvent,
        }),
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
      ]);
      this.broadcast(result);
      return json(result);
    }

    if (current.status !== "ACTIVE") {
      return json(
        {
          error: {
            code: "TICKET_GROUP_RECALL_EVENT_NOT_ACTIVE",
            message: "Nachrufe sind nur während der aktiven Veranstaltung möglich.",
          },
        },
        { status: 409 },
      );
    }
    const eligibility = ticketGroupRecallEligibility({
      status: group.status,
      gateLabel: group.gate_label,
      activeRecall: activeRecall !== null,
    });
    if (!eligibility.eligible) {
      const error = {
        ALREADY_ACTIVE: {
          code: "TICKET_GROUP_RECALL_ALREADY_ACTIVE",
          message: "Für diese Buchungsgruppe ist bereits ein Nachruf aktiv.",
        },
        STATUS_NOT_ELIGIBLE: {
          code: "TICKET_GROUP_RECALL_STATUS_NOT_ELIGIBLE",
          message: "Die Buchungsgruppe ist in diesem Zustand nicht für einen Nachruf geeignet.",
        },
        GATE_REQUIRED: {
          code: "TICKET_GROUP_RECALL_GATE_REQUIRED",
          message: "Für einen Nachruf muss ein Gate festgelegt sein.",
        },
        ELIGIBLE: {
          code: "TICKET_GROUP_RECALL_NOT_ELIGIBLE",
          message: "Der Nachruf kann nicht gestartet werden.",
        },
      }[eligibility.reason];
      return json({ error }, { status: 409 });
    }

    const expiredRecall = openRecall && !activeRecall ? openRecall : null;
    const recallId = crypto.randomUUID();
    const recallSequence = group.recall_count + 1;
    const expiresAt = new Date(nowDate.getTime() + TICKET_GROUP_RECALL_DURATION_MS).toISOString();
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: nextEvent,
      eventType: "TICKET_GROUP_RECALL_STARTED",
      aggregate: { type: "TICKET_GROUP_RECALL", id: recallId },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE operation_days SET version = ?1, updated_at = ?2
          WHERE id = ?3 AND version = ?4`,
      ).bind(nextVersion, now, command.eventId, current.version),
      ...(expiredRecall
        ? this.ticketGroupRecallClosureStatements({
            recalls: [expiredRecall],
            eventId: command.eventId,
            reason: "EXPIRED",
            deviceId: "SYSTEM",
            now,
            event: nextEvent,
          })
        : []),
      this.env.DB.prepare(
        `INSERT INTO ticket_group_recalls
          (id, operation_day_id, ticket_group_id, sequence, started_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(recallId, command.eventId, group.id, recallSequence, now, expiresAt),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'TICKET_GROUP_RECALL_STARTED', ?3, ?4,
                 'TICKET_GROUP_RECALL', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        recallId,
        recallSequence,
        JSON.stringify({
          recallId,
          ticketGroupId: group.id,
          sequence: recallSequence,
          startedAt: now,
          expiresAt,
          template: "FIXED_V1",
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
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)`,
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    ]);
    this.waitUntil(sendTicketGroupRecallPushNotifications(this.env, recallId));
    this.broadcast(result);
    return json(result);
  }

  async handleTicketGroupPresence(
    command: Extract<
      CommandEnvelope,
      {
        type: "MARK_TICKET_GROUP_MISSING" | "RESTORE_TICKET_GROUP_TO_QUEUE" | "RECALL_TICKET_GROUP";
      }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    const group = await this.env.DB.prepare(
      "SELECT id, status, version FROM ticket_groups WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.ticketGroupId, command.eventId)
      .first<{ id: string; status: string; version: number }>();
    if (!group) {
      return json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Buchungsgruppe nicht gefunden." } },
        { status: 404 },
      );
    }
    const restored = command.type !== "MARK_TICKET_GROUP_MISSING";
    if (restored && group.status !== "MISSING") {
      return json(
        {
          error: {
            code: "TICKET_GROUP_NOT_MISSING",
            message: "Nur eine als nicht anwesend markierte Gruppe kann zurück in die Queue.",
          },
        },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = restored ? "TICKET_GROUP_RESTORED_TO_QUEUE" : "TICKET_GROUP_MARKED_MISSING";
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: "TICKET_GROUP", id: group.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      restored
        ? this.env.DB.prepare(
            "UPDATE ticket_groups SET status = 'QUEUED', version = version + 1 WHERE id = ?1 AND version = ?2",
          ).bind(group.id, group.version)
        : this.env.DB.prepare(
            "UPDATE ticket_groups SET status = 'MISSING', version = version + 1 WHERE id = ?1 AND version = ?2",
          ).bind(group.id, group.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'TICKET_GROUP', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        group.id,
        group.version + 1,
        JSON.stringify(
          restored
            ? { legacyCommand: command.type === "RECALL_TICKET_GROUP" }
            : { reason: command.payload.reason },
        ),
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

  async handleAttendanceException(
    command: Extract<
      CommandEnvelope,
      { type: "MARK_TICKET_NO_SHOW" | "CONFIRM_ATTENDANCE_DECISION" }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    if (command.type === "MARK_TICKET_NO_SHOW") {
      return this.handleTicketNoShow(command, current);
    }
    return this.handleAttendanceDecision(command, current);
  }

  private async handleTicketNoShow(
    command: Extract<CommandEnvelope, { type: "MARK_TICKET_NO_SHOW" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const ticket = await this.env.DB.prepare(
      `SELECT t.id, t.ticket_group_id, t.attendance_status, tg.version AS group_version,
                r.id AS rotation_id, r.status AS rotation_status, r.called_at, r.aircraft_id,
                (SELECT COUNT(*) FROM rotation_tickets group_rt
                  JOIN tickets group_ticket ON group_ticket.id = group_rt.ticket_id
                 WHERE group_ticket.ticket_group_id = t.ticket_group_id
                   AND group_rt.released_at IS NULL AND group_ticket.id <> t.id)
                  AS remaining_group_tickets,
                (SELECT COUNT(*) FROM rotation_tickets rotation_rt
                 WHERE rotation_rt.rotation_id = r.id AND rotation_rt.released_at IS NULL
                   AND rotation_rt.ticket_id <> t.id) AS remaining_rotation_tickets
           FROM tickets t
           JOIN ticket_groups tg ON tg.id = t.ticket_group_id
           JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
           JOIN rotations r ON r.id = rt.rotation_id
          WHERE t.id = ?1 AND tg.operation_day_id = ?2`,
    )
      .bind(command.payload.ticketId, command.eventId)
      .first<{
        id: string;
        ticket_group_id: string;
        attendance_status: "NOT_CHECKED_IN" | "CHECKED_IN";
        group_version: number;
        rotation_id: string;
        rotation_status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        called_at: string | null;
        aircraft_id: string | null;
        remaining_group_tickets: number;
        remaining_rotation_tickets: number;
      }>();
    if (!ticket) {
      return json(
        { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
        { status: 404 },
      );
    }
    const now = new Date().toISOString();
    try {
      assertTicketNoShowAllowed({
        rotationState: ticket.rotation_status,
        calledAt: ticket.called_at,
        attendanceStatus: ticket.attendance_status,
        noShowAfterMinutes: current.no_show_after_minutes ?? 10,
        now,
      });
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    const nextVersion = current.version + 1;
    const rotationEmptied = ticket.remaining_rotation_tickets === 0;
    const groupEmptied = ticket.remaining_group_tickets === 0;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "TICKET_NO_SHOW",
      aggregate: { type: "TICKET", id: ticket.id, relatedRotationId: ticket.rotation_id },
    };
    const recallClosures = groupEmptied
      ? await this.loadOpenTicketGroupRecalls(command.eventId, [ticket.ticket_group_id], now)
      : [];
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        "UPDATE rotation_tickets SET released_at = ?1 WHERE ticket_id = ?2 AND released_at IS NULL",
      ).bind(now, ticket.id),
      this.env.DB.prepare("UPDATE tickets SET status = 'NO_SHOW' WHERE id = ?1").bind(ticket.id),
    ];
    if (groupEmptied) {
      statements.push(
        this.env.DB.prepare(
          "UPDATE ticket_groups SET status = 'NO_SHOW', version = version + 1 WHERE id = ?1 AND version = ?2",
        ).bind(ticket.ticket_group_id, ticket.group_version),
        ...this.ticketGroupRecallClosureStatements({
          recalls: recallClosures,
          eventId: command.eventId,
          reason: "NO_SHOW",
          deviceId: command.deviceId,
          now,
          event: result.event,
        }),
      );
    }
    if (rotationEmptied) {
      statements.push(
        this.env.DB.prepare(
          "UPDATE rotations SET status = 'CANCELED', version = version + 1, updated_at = ?1 WHERE id = ?2",
        ).bind(now, ticket.rotation_id),
      );
      if (ticket.aircraft_id) {
        statements.push(
          this.env.DB.prepare(
            `UPDATE aircraft SET operational_state = 'AVAILABLE',
                      operational_state_changed_at = CASE
                        WHEN operational_state <> 'AVAILABLE' THEN ?1
                        ELSE operational_state_changed_at END,
                      version = version + 1, updated_at = ?1 WHERE id = ?2`,
          ).bind(now, ticket.aircraft_id),
        );
      }
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, 'TICKET_NO_SHOW', ?3, ?4, 'TICKET', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        ticket.id,
        nextVersion,
        JSON.stringify({
          reason: command.payload.reason,
          ticketGroupId: ticket.ticket_group_id,
          rotationId: ticket.rotation_id,
          groupEmptied,
          rotationEmptied,
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

  private async handleAttendanceDecision(
    command: Extract<CommandEnvelope, { type: "CONFIRM_ATTENDANCE_DECISION" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status,
              COUNT(rt.ticket_id) AS ticket_count,
              SUM(CASE WHEN t.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS present_count,
              (SELECT oe.payload_json
                 FROM operational_events oe
                WHERE oe.operation_day_id = r.operation_day_id
                  AND oe.aggregate_type = 'ROTATION'
                  AND oe.aggregate_id = r.id
                  AND oe.event_type IN (
                    'ATTENDANCE_FLY_WITH_PRESENT_CONFIRMED',
                    'ATTENDANCE_EMPTY_SEAT_CONFIRMED'
                  )
                ORDER BY oe.aggregate_version DESC
                LIMIT 1) AS latest_decision_payload
         FROM rotations r
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         LEFT JOIN tickets t ON t.id = rt.ticket_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2
        GROUP BY r.id, r.status`,
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: string;
        ticket_count: number;
        present_count: number;
        latest_decision_payload: string | null;
      }>();
    if (!rotation) {
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    }
    if (
      rotation.status !== "CALLED" ||
      rotation.ticket_count < 1 ||
      rotation.present_count < 1 ||
      rotation.present_count >= rotation.ticket_count
    ) {
      return json(
        {
          error: {
            code: "ATTENDANCE_DECISION_NOT_REQUIRED",
            message:
              "Eine Anwesenheitsentscheidung ist nur bei einer unvollständigen aufgerufenen Gruppe erforderlich.",
          },
        },
        { status: 409 },
      );
    }
    const latestDecision = rotation.latest_decision_payload
      ? (JSON.parse(rotation.latest_decision_payload) as {
          presentCount?: number;
          missingCount?: number;
        })
      : null;
    if (
      latestDecision?.presentCount === rotation.present_count &&
      latestDecision.missingCount === rotation.ticket_count - rotation.present_count
    ) {
      return json(
        {
          error: {
            code: "ATTENDANCE_DECISION_ALREADY_CONFIRMED",
            message: "Für diesen Anwesenheitsstand wurde bereits eine Entscheidung dokumentiert.",
          },
        },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType =
      command.payload.decision === "FLY_WITH_PRESENT"
        ? "ATTENDANCE_FLY_WITH_PRESENT_CONFIRMED"
        : "ATTENDANCE_EMPTY_SEAT_CONFIRMED";
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'ROTATION', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        rotation.id,
        nextVersion,
        JSON.stringify({
          decision: command.payload.decision,
          presentCount: rotation.present_count,
          missingCount: rotation.ticket_count - rotation.present_count,
          automaticReplacement: false,
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
