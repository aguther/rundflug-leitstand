import type { CommandResult } from "@rundflug/contracts";
import type { DeviceRole } from "@rundflug/domain";
import { plannedOperationAuditReason } from "./planned-operation-audit-reason";
import {
  type ExistingPlannedOperation,
  type PlannedOperationCommand,
  PlannedOperationValidator,
} from "./planned-operation-validator";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class PlannedOperationCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  private eventType(
    command: PlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
  ): string {
    if (command.type === "UPSERT_PLANNED_OPERATION") {
      return existing ? "PLANNED_OPERATION_UPDATED" : "PLANNED_OPERATION_CREATED";
    }
    if (command.type === "CANCEL_PLANNED_OPERATION") {
      return existing?.recurring_rule_id
        ? "RECURRING_OPERATION_OCCURRENCE_SKIPPED"
        : "PLANNED_OPERATION_CANCELED";
    }
    return command.payload.active ? "PLANNED_SLOWDOWN_STARTED" : "PLANNED_SLOWDOWN_ENDED";
  }

  private auditReason(
    command: PlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
    role: DeviceRole,
  ): string {
    let action: "CANCEL" | "START" | "END" | "UPDATE" | "CREATE";
    if (command.type === "CANCEL_PLANNED_OPERATION") {
      action = "CANCEL";
    } else if (command.type === "SET_PLANNED_SLOWDOWN_ACTIVE") {
      action = command.payload.active ? "START" : "END";
    } else {
      action = existing ? "UPDATE" : "CREATE";
    }
    const kind =
      command.type === "UPSERT_PLANNED_OPERATION"
        ? command.payload.kind
        : (existing?.constraint_kind ?? "OTHER");
    const scopeType =
      command.type === "UPSERT_PLANNED_OPERATION"
        ? command.payload.scopeType
        : (existing?.scope_type ?? "EVENT");
    return plannedOperationAuditReason({ role, action, kind, scopeType });
  }

  private planStatement(
    command: PlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
    auditReason: string,
    now: string,
    nextPlanVersion: number,
  ): D1PreparedStatement {
    if (command.type === "UPSERT_PLANNED_OPERATION") {
      if (existing) {
        return this.env.DB.prepare(
          `UPDATE planned_operational_constraints
              SET scope_type = ?1, scope_id = ?2, constraint_kind = ?3, start_mode = ?4,
                  earliest_start_at = ?5, latest_start_at = ?6, after_rotation_id = ?7,
                  effect_mode = ?8, duration_multiplier_percent = ?9,
                  minimum_duration_minutes = ?10, typical_duration_minutes = ?11,
                  maximum_duration_minutes = ?12, reason = ?13, public_note = ?14,
                  version = ?15, updated_at = ?16
            WHERE id = ?17 AND operation_day_id = ?18 AND version = ?19 AND status = 'PLANNED'`,
        ).bind(
          command.payload.scopeType,
          command.payload.scopeId,
          command.payload.kind,
          command.payload.startMode,
          command.payload.earliestStartAt,
          command.payload.latestStartAt,
          command.payload.afterRotationId,
          command.payload.effectMode,
          command.payload.durationMultiplierPercent,
          command.payload.minimumDurationMinutes,
          command.payload.typicalDurationMinutes,
          command.payload.maximumDurationMinutes,
          auditReason,
          command.payload.publicNote,
          nextPlanVersion,
          now,
          command.payload.planId,
          command.eventId,
          existing.version,
        );
      }
      return this.env.DB.prepare(
        `INSERT INTO planned_operational_constraints
          (id, operation_day_id, scope_type, scope_id, constraint_kind, start_mode,
           earliest_start_at, latest_start_at, after_rotation_id,
           effect_mode, duration_multiplier_percent,
           minimum_duration_minutes, typical_duration_minutes, maximum_duration_minutes,
           status, reason, public_note, version, created_by_device_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 'PLANNED', ?15, ?16, 0, ?17, ?18, ?18)`,
      ).bind(
        command.payload.planId,
        command.eventId,
        command.payload.scopeType,
        command.payload.scopeId,
        command.payload.kind,
        command.payload.startMode,
        command.payload.earliestStartAt,
        command.payload.latestStartAt,
        command.payload.afterRotationId,
        command.payload.effectMode,
        command.payload.durationMultiplierPercent,
        command.payload.minimumDurationMinutes,
        command.payload.typicalDurationMinutes,
        command.payload.maximumDurationMinutes,
        auditReason,
        command.payload.publicNote,
        command.deviceId,
        now,
      );
    }
    if (command.type === "CANCEL_PLANNED_OPERATION") {
      return this.env.DB.prepare(
        `UPDATE planned_operational_constraints
            SET status = 'CANCELED', reason = ?1, canceled_at = ?2, updated_at = ?2,
                version = ?3
          WHERE id = ?4 AND operation_day_id = ?5 AND version = ?6
            AND status = 'PLANNED'`,
      ).bind(
        auditReason,
        now,
        nextPlanVersion,
        command.payload.planId,
        command.eventId,
        existing?.version,
      );
    }
    const nextStatus = command.payload.active ? "ACTIVE" : "CLEARED";
    const expectedStatus = command.payload.active ? "PLANNED" : "ACTIVE";
    return this.env.DB.prepare(
      `UPDATE planned_operational_constraints
          SET status = ?1, reason = ?2, updated_at = ?3, version = ?4,
              activated_at = CASE WHEN ?1 = 'ACTIVE' THEN ?3 ELSE activated_at END,
              cleared_at = CASE WHEN ?1 = 'CLEARED' THEN ?3 ELSE cleared_at END
        WHERE id = ?5 AND operation_day_id = ?6 AND version = ?7
          AND effect_mode = 'SLOWDOWN' AND status = ?8`,
    ).bind(
      nextStatus,
      auditReason,
      now,
      nextPlanVersion,
      command.payload.planId,
      command.eventId,
      existing?.version,
      expectedStatus,
    );
  }

  private auditPayload(
    command: PlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
    auditReason: string,
  ): Record<string, unknown> {
    if (command.type === "UPSERT_PLANNED_OPERATION") {
      return { ...command.payload, planExpectedVersion: undefined, reason: auditReason };
    }
    if (command.type === "CANCEL_PLANNED_OPERATION") {
      return { planId: command.payload.planId, reason: auditReason };
    }
    return {
      planId: command.payload.planId,
      active: command.payload.active,
      durationMultiplierPercent: existing?.duration_multiplier_percent,
      reason: auditReason,
      informationalOnly: true,
    };
  }

  private recurringRuleResetStatements(
    command: PlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
    now: string,
  ): D1PreparedStatement[] {
    if (command.type !== "CANCEL_PLANNED_OPERATION" || !existing?.recurring_rule_id) return [];
    return [
      this.env.DB.prepare(
        `UPDATE recurring_operational_rules
            SET progress_value = 0, last_reset_at = ?1, updated_at = ?1,
                version = version + 1
          WHERE id = ?2 AND operation_day_id = ?3 AND status = 'ACTIVE'`,
      ).bind(now, existing.recurring_rule_id, command.eventId),
    ];
  }

  async handlePlannedOperation(
    command: PlannedOperationCommand,
    current: StoredEventRow,
    role: DeviceRole,
  ): Promise<Response> {
    const validator = new PlannedOperationValidator(this.env);
    const existing = await validator.findExisting(command);
    const validationError = await validator.validateCommand(command, existing);
    if (validationError) return validationError;

    const now = new Date().toISOString();
    const nextEventVersion = current.version + 1;
    const nextPlanVersion = existing ? existing.version + 1 : 0;
    const eventType = this.eventType(command, existing);
    const auditReason = this.auditReason(command, existing, role);
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        version: nextEventVersion,
        updated_at: now,
      }),
      eventType,
      aggregate: { type: "OPERATIONAL_PLAN", id: command.payload.planId },
    };
    const planStatement = this.planStatement(command, existing, auditReason, now, nextPlanVersion);
    const auditPayload = this.auditPayload(command, existing, auditReason);
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextEventVersion, now, command.eventId, current.version),
      planStatement,
      ...this.recurringRuleResetStatements(command, existing, now),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'OPERATIONAL_PLAN', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        command.payload.planId,
        nextPlanVersion,
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
        "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    ]);
    this.broadcast(result);
    return json(result);
  }
}
