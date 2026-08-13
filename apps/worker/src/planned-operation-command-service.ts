import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import type { DeviceRole } from "@rundflug/domain";
import {
  type PlannedOperationKind,
  type PlannedOperationScope,
  plannedOperationAuditReason,
} from "./planned-operation-audit-reason";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

type PlannedOperationCommand = Extract<
  CommandEnvelope,
  {
    type: "UPSERT_PLANNED_OPERATION" | "CANCEL_PLANNED_OPERATION" | "SET_PLANNED_SLOWDOWN_ACTIVE";
  }
>;
type UpsertPlannedOperationCommand = Extract<
  PlannedOperationCommand,
  { type: "UPSERT_PLANNED_OPERATION" }
>;
type CancelPlannedOperationCommand = Extract<
  PlannedOperationCommand,
  { type: "CANCEL_PLANNED_OPERATION" }
>;
type SetPlannedSlowdownCommand = Extract<
  PlannedOperationCommand,
  { type: "SET_PLANNED_SLOWDOWN_ACTIVE" }
>;

interface ExistingPlannedOperation {
  id: string;
  version: number;
  status: "PLANNED" | "ACTIVE" | "CLEARED" | "CANCELED";
  constraint_kind: PlannedOperationKind;
  scope_type: PlannedOperationScope;
  effect_mode: "BLOCKING" | "SLOWDOWN";
  duration_multiplier_percent: number | null;
  recurring_rule_id: string | null;
}

interface RotationScopeRow {
  id: string;
  status: string;
  aircraft_id: string | null;
  pilot_id: string | null;
  resource_group_id: string;
}

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

  private errorResponse(
    code: string,
    message: string,
    status: number,
    currentVersion?: number,
  ): Response {
    return json(
      {
        error: {
          code,
          message,
          ...(currentVersion === undefined ? {} : { currentVersion }),
        },
      },
      { status },
    );
  }

  private async findExisting(command: PlannedOperationCommand) {
    return this.env.DB.prepare(
      `SELECT id, version, status, constraint_kind, scope_type, effect_mode,
              duration_multiplier_percent, recurring_rule_id
         FROM planned_operational_constraints
        WHERE id = ?1 AND operation_day_id = ?2`,
    )
      .bind(command.payload.planId, command.eventId)
      .first<ExistingPlannedOperation>();
  }

  private async plannedScopeExists(command: UpsertPlannedOperationCommand): Promise<boolean> {
    const { scopeId, scopeType } = command.payload;
    if (scopeType === "EVENT") return scopeId === command.eventId;
    if (scopeType === "RESOURCE_GROUP") {
      return Boolean(
        await this.env.DB.prepare(
          "SELECT id FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2",
        )
          .bind(scopeId, command.eventId)
          .first(),
      );
    }
    if (scopeType === "AIRCRAFT") {
      return Boolean(
        await this.env.DB.prepare(
          `SELECT a.id FROM aircraft a
             JOIN resource_group_memberships m ON m.aircraft_id = a.id
            WHERE a.id = ?1 AND m.operation_day_id = ?2 AND m.active_until IS NULL`,
        )
          .bind(scopeId, command.eventId)
          .first(),
      );
    }
    return Boolean(
      await this.env.DB.prepare("SELECT id FROM pilots WHERE id = ?1 AND operation_day_id = ?2")
        .bind(scopeId, command.eventId)
        .first(),
    );
  }

  private rotationMatchesScope(
    command: UpsertPlannedOperationCommand,
    rotation: RotationScopeRow,
  ): boolean {
    const { scopeId, scopeType } = command.payload;
    if (scopeType === "EVENT") return true;
    if (scopeType === "RESOURCE_GROUP") return rotation.resource_group_id === scopeId;
    if (scopeType === "AIRCRAFT") return rotation.aircraft_id === scopeId;
    return rotation.pilot_id === scopeId;
  }

  private async validateRotationScope(
    command: UpsertPlannedOperationCommand,
  ): Promise<Response | null> {
    if (!command.payload.afterRotationId) return null;
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status, r.aircraft_id, r.pilot_id, fg.resource_group_id
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2`,
    )
      .bind(command.payload.afterRotationId, command.eventId)
      .first<RotationScopeRow>();
    if (!rotation) {
      return this.errorResponse(
        "PLANNED_OPERATION_ROTATION_NOT_FOUND",
        "Der Bezugsumlauf des Planeintrags wurde nicht gefunden.",
        404,
      );
    }
    if (
      !["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status) ||
      !this.rotationMatchesScope(command, rotation)
    ) {
      return this.errorResponse(
        "PLANNED_OPERATION_ROTATION_SCOPE_MISMATCH",
        "Der Bezugsumlauf ist nicht der aktuelle Umlauf des gewählten Ziels.",
        409,
      );
    }
    return null;
  }

  private async validateUpsert(
    command: UpsertPlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
  ): Promise<Response | null> {
    const expectedVersion = command.payload.planExpectedVersion;
    if (
      (expectedVersion === null && existing) ||
      (expectedVersion !== null && (!existing || existing.version !== expectedVersion))
    ) {
      return this.errorResponse(
        "PLANNED_OPERATION_VERSION_CONFLICT",
        "Der Betriebsplan wurde inzwischen geändert.",
        409,
        existing?.version,
      );
    }
    if (existing && existing.status !== "PLANNED") {
      return this.errorResponse(
        "PLANNED_OPERATION_NOT_EDITABLE",
        "Nur noch nicht gestartete Planeinträge können bearbeitet werden.",
        409,
      );
    }
    if (existing?.recurring_rule_id) {
      return this.errorResponse(
        "RECURRING_OCCURRENCE_NOT_EDITABLE",
        "Ein automatisch erzeugtes Vorkommen wird über seine Regel gepflegt oder einmalig übersprungen.",
        409,
      );
    }
    if (!(await this.plannedScopeExists(command))) {
      return this.errorResponse(
        "PLANNED_OPERATION_SCOPE_NOT_FOUND",
        "Das Ziel des Planeintrags wurde nicht gefunden.",
        404,
      );
    }
    return this.validateRotationScope(command);
  }

  private validateCancel(
    command: CancelPlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
  ): Response | null {
    if (!existing) {
      return this.errorResponse("PLANNED_OPERATION_NOT_FOUND", "Planeintrag nicht gefunden.", 404);
    }
    if (existing.version !== command.payload.planExpectedVersion) {
      return this.errorResponse(
        "PLANNED_OPERATION_VERSION_CONFLICT",
        "Der Betriebsplan wurde inzwischen geändert.",
        409,
        existing.version,
      );
    }
    if (existing.status !== "PLANNED") {
      return this.errorResponse(
        "PLANNED_OPERATION_NOT_CANCELABLE",
        "Nur noch nicht gestartete Planeinträge können abgesagt werden.",
        409,
      );
    }
    return null;
  }

  private validateSlowdown(
    command: SetPlannedSlowdownCommand,
    existing: ExistingPlannedOperation | null,
  ): Response | null {
    if (!existing) {
      return this.errorResponse("PLANNED_OPERATION_NOT_FOUND", "Planeintrag nicht gefunden.", 404);
    }
    if (existing.version !== command.payload.planExpectedVersion) {
      return this.errorResponse(
        "PLANNED_OPERATION_VERSION_CONFLICT",
        "Der Betriebsplan wurde inzwischen geändert.",
        409,
        existing.version,
      );
    }
    if (existing.effect_mode !== "SLOWDOWN") {
      return this.errorResponse(
        "PLANNED_OPERATION_EFFECT_MISMATCH",
        "Nur ein verzögerter Betrieb wird ohne Ressourcenstopp bestätigt.",
        409,
      );
    }
    const expectedStatus = command.payload.active ? "PLANNED" : "ACTIVE";
    if (existing.status !== expectedStatus) {
      return this.errorResponse(
        "PLANNED_OPERATION_STATUS_MISMATCH",
        "Der Planeintrag ist für diese Bestätigung nicht im passenden Zustand.",
        409,
      );
    }
    return null;
  }

  private validateCommand(
    command: PlannedOperationCommand,
    existing: ExistingPlannedOperation | null,
  ): Promise<Response | null> | Response | null {
    if (command.type === "UPSERT_PLANNED_OPERATION") {
      return this.validateUpsert(command, existing);
    }
    if (command.type === "CANCEL_PLANNED_OPERATION") {
      return this.validateCancel(command, existing);
    }
    return this.validateSlowdown(command, existing);
  }

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
    const existing = await this.findExisting(command);
    const validationError = await this.validateCommand(command, existing);
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
