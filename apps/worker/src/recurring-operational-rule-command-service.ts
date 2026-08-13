import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { validateRecurringOperationalRule } from "@rundflug/domain";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

type RecurringRuleCommand = Extract<
  CommandEnvelope,
  { type: "UPSERT_RECURRING_OPERATIONAL_RULE" | "DISABLE_RECURRING_OPERATIONAL_RULE" }
>;
type UpsertRecurringRuleCommand = Extract<
  CommandEnvelope,
  { type: "UPSERT_RECURRING_OPERATIONAL_RULE" }
>;
type RecurringRuleValues = UpsertRecurringRuleCommand["payload"]["rule"];

interface StoredRecurringRule {
  id: string;
  version: number;
  status: "ACTIVE" | "DISABLED";
  scope_type: "AIRCRAFT" | "PILOT";
  scope_id: string;
  operation_kind: "PAUSE" | "REFUELING";
  trigger_metric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
  interval_value: number;
  progress_value: number;
  minimum_duration_minutes: number;
  typical_duration_minutes: number;
  maximum_duration_minutes: number;
  sequence_number: number;
  last_reset_at: string;
  open_plan_id: string | null;
}

function ruleVersionConflict(existing: StoredRecurringRule | null): Response {
  return json(
    {
      error: {
        code: "RECURRING_RULE_VERSION_CONFLICT",
        message: "Die Regel wurde inzwischen geändert oder deaktiviert.",
        currentVersion: existing?.version,
      },
    },
    { status: 409 },
  );
}

function disabledRuleValues(existing: StoredRecurringRule | null): RecurringRuleValues {
  return {
    scopeType: existing?.scope_type ?? "AIRCRAFT",
    scopeId: existing?.scope_id ?? "",
    kind: existing?.operation_kind ?? "PAUSE",
    triggerMetric: existing?.trigger_metric ?? "COMPLETED_ROTATIONS",
    intervalValue: existing?.interval_value ?? 1,
    minimumDurationMinutes: existing?.minimum_duration_minutes ?? 1,
    typicalDurationMinutes: existing?.typical_duration_minutes ?? 1,
    maximumDurationMinutes: existing?.maximum_duration_minutes ?? 1,
  };
}

function recurringRuleEventType(
  command: RecurringRuleCommand,
  existing: StoredRecurringRule | null,
):
  | "RECURRING_OPERATIONAL_RULE_DISABLED"
  | "RECURRING_OPERATIONAL_RULE_UPDATED"
  | "RECURRING_OPERATIONAL_RULE_CREATED" {
  if (command.type === "DISABLE_RECURRING_OPERATIONAL_RULE") {
    return "RECURRING_OPERATIONAL_RULE_DISABLED";
  }
  return existing ? "RECURRING_OPERATIONAL_RULE_UPDATED" : "RECURRING_OPERATIONAL_RULE_CREATED";
}

interface RuleProgress {
  initialProgress: number;
  lastRotationId: string | null;
  progressResetAt: string;
}

function progressBasisChanged(
  command: UpsertRecurringRuleCommand,
  existing: StoredRecurringRule | null,
): boolean {
  return (
    !existing ||
    existing.scope_type !== command.payload.rule.scopeType ||
    existing.scope_id !== command.payload.rule.scopeId ||
    existing.operation_kind !== command.payload.rule.kind ||
    existing.trigger_metric !== command.payload.rule.triggerMetric
  );
}

export class RecurringOperationalRuleCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  private validateDisableCommand(
    command: Extract<RecurringRuleCommand, { type: "DISABLE_RECURRING_OPERATIONAL_RULE" }>,
    existing: StoredRecurringRule | null,
  ): Response | null {
    if (!existing) {
      return json(
        { error: { code: "RECURRING_RULE_NOT_FOUND", message: "Regel nicht gefunden." } },
        { status: 404 },
      );
    }
    if (existing.version !== command.payload.ruleExpectedVersion || existing.status !== "ACTIVE") {
      return ruleVersionConflict(existing);
    }
    return null;
  }

  private async recurringRuleTargetExists(command: UpsertRecurringRuleCommand): Promise<boolean> {
    if (command.payload.rule.scopeType === "AIRCRAFT") {
      return Boolean(
        await this.env.DB.prepare(
          `SELECT a.id FROM aircraft a
             JOIN resource_group_memberships membership
               ON membership.aircraft_id = a.id
              AND membership.operation_day_id = ?2
              AND membership.active_until IS NULL
            WHERE a.id = ?1`,
        )
          .bind(command.payload.rule.scopeId, command.eventId)
          .first(),
      );
    }
    return Boolean(
      await this.env.DB.prepare("SELECT id FROM pilots WHERE id = ?1 AND operation_day_id = ?2")
        .bind(command.payload.rule.scopeId, command.eventId)
        .first(),
    );
  }

  private async validateUpsertCommand(
    command: UpsertRecurringRuleCommand,
    existing: StoredRecurringRule | null,
  ): Promise<Response | null> {
    if (
      (command.payload.ruleExpectedVersion === null && existing) ||
      (command.payload.ruleExpectedVersion !== null &&
        (!existing || existing.version !== command.payload.ruleExpectedVersion)) ||
      existing?.status === "DISABLED"
    ) {
      return ruleVersionConflict(existing);
    }
    const validationErrors = validateRecurringOperationalRule({
      ...command.payload.rule,
      progressValue: existing?.progress_value ?? 0,
    });
    if (validationErrors.length > 0) {
      return json(
        { error: { code: "RECURRING_RULE_INVALID", message: validationErrors.join(" ") } },
        { status: 400 },
      );
    }
    if (!(await this.recurringRuleTargetExists(command))) {
      return json(
        {
          error: {
            code: "RECURRING_RULE_SCOPE_NOT_FOUND",
            message: "Das Ziel der Regel wurde nicht gefunden.",
          },
        },
        { status: 404 },
      );
    }
    const conflicting = await this.env.DB.prepare(
      `SELECT id FROM recurring_operational_rules
        WHERE operation_day_id = ?1 AND scope_type = ?2 AND scope_id = ?3
          AND operation_kind = ?4 AND status = 'ACTIVE' AND id <> ?5`,
    )
      .bind(
        command.eventId,
        command.payload.rule.scopeType,
        command.payload.rule.scopeId,
        command.payload.rule.kind,
        command.payload.ruleId,
      )
      .first<{ id: string }>();
    if (!conflicting) return null;
    return json(
      {
        error: {
          code: "RECURRING_RULE_ALREADY_ACTIVE",
          message: "Für dieses Ziel und diese Art besteht bereits eine aktive Regel.",
        },
      },
      { status: 409 },
    );
  }

  private validateCommand(
    command: RecurringRuleCommand,
    existing: StoredRecurringRule | null,
  ): Promise<Response | null> | Response | null {
    if (command.type === "DISABLE_RECURRING_OPERATIONAL_RULE") {
      return this.validateDisableCommand(command, existing);
    }
    return this.validateUpsertCommand(command, existing);
  }

  private async progressResetBoundary(
    command: UpsertRecurringRuleCommand,
    existing: StoredRecurringRule | null,
    fallback: string,
  ): Promise<string> {
    if (!progressBasisChanged(command, existing)) return existing?.last_reset_at ?? fallback;
    if (command.payload.rule.scopeType === "AIRCRAFT") {
      const boundary = await this.env.DB.prepare(
        `SELECT COALESCE(
            (SELECT MAX(cleared_at) FROM operational_blocks
              WHERE operation_day_id = ?1 AND scope_type = 'AIRCRAFT' AND scope_id = ?2
                AND block_type = ?3 AND status = 'CLEARED'),
            operations_start_at, created_at
          ) AS reset_at
           FROM operation_days WHERE id = ?1`,
      )
        .bind(command.eventId, command.payload.rule.scopeId, command.payload.rule.kind)
        .first<{ reset_at: string }>();
      return boundary?.reset_at ?? fallback;
    }
    const boundary = await this.env.DB.prepare(
      `SELECT COALESCE(
          (SELECT MAX(occurred_at) FROM operational_events
            WHERE operation_day_id = ?1 AND aggregate_type = 'PILOT'
              AND aggregate_id = ?2 AND event_type = 'PILOT_PAUSE_ENDED'),
          operations_start_at, created_at
        ) AS reset_at
         FROM operation_days WHERE id = ?1`,
    )
      .bind(command.eventId, command.payload.rule.scopeId)
      .first<{ reset_at: string }>();
    return boundary?.reset_at ?? fallback;
  }

  private async resolveRuleProgress(
    command: UpsertRecurringRuleCommand,
    existing: StoredRecurringRule | null,
    fallback: string,
  ): Promise<RuleProgress> {
    const progressResetAt = await this.progressResetBoundary(command, existing, fallback);
    const progress = await this.env.DB.prepare(
      `SELECT
          COUNT(*) AS completed_rotations,
          COALESCE(ROUND(SUM(
            MAX(0, (julianday(r.completed_at) - julianday(r.called_at)) * 1440)
          )), 0) AS operating_minutes,
          (SELECT latest.id
             FROM rotations latest
            WHERE latest.operation_day_id = ?1
              AND latest.status = 'COMPLETED'
              AND latest.completed_at >= ?4
              AND CASE WHEN ?2 = 'AIRCRAFT'
                       THEN latest.aircraft_id = ?3 ELSE latest.pilot_id = ?3 END
            ORDER BY latest.completed_at DESC, latest.id DESC LIMIT 1) AS last_rotation_id
         FROM rotations r
        WHERE r.operation_day_id = ?1 AND r.status = 'COMPLETED'
          AND r.completed_at >= ?4
          AND CASE WHEN ?2 = 'AIRCRAFT'
                   THEN r.aircraft_id = ?3 ELSE r.pilot_id = ?3 END`,
    )
      .bind(
        command.eventId,
        command.payload.rule.scopeType,
        command.payload.rule.scopeId,
        progressResetAt,
      )
      .first<{
        completed_rotations: number;
        operating_minutes: number;
        last_rotation_id: string | null;
      }>();
    let initialProgress = existing?.progress_value ?? 0;
    if (progressBasisChanged(command, existing)) {
      initialProgress = Number(
        command.payload.rule.triggerMetric === "COMPLETED_ROTATIONS"
          ? (progress?.completed_rotations ?? 0)
          : (progress?.operating_minutes ?? 0),
      );
    }
    return {
      initialProgress,
      lastRotationId: progress?.last_rotation_id ?? null,
      progressResetAt,
    };
  }

  private ruleStatement(
    command: RecurringRuleCommand,
    existing: StoredRecurringRule | null,
    values: RecurringRuleValues,
    progress: RuleProgress,
    sequenceNumber: number,
    now: string,
    nextRuleVersion: number,
  ): D1PreparedStatement {
    if (command.type === "DISABLE_RECURRING_OPERATIONAL_RULE") {
      return this.env.DB.prepare(
        `UPDATE recurring_operational_rules
            SET status = 'DISABLED', reason = ?1, disabled_at = ?2, updated_at = ?2,
                version = ?3
          WHERE id = ?4 AND operation_day_id = ?5 AND version = ?6 AND status = 'ACTIVE'`,
      ).bind(
        command.payload.reason,
        now,
        nextRuleVersion,
        command.payload.ruleId,
        command.eventId,
        existing?.version,
      );
    }
    if (existing) {
      return this.env.DB.prepare(
        `UPDATE recurring_operational_rules
            SET scope_type = ?1, scope_id = ?2, operation_kind = ?3,
                trigger_metric = ?4, interval_value = ?5,
                minimum_duration_minutes = ?6, typical_duration_minutes = ?7,
                maximum_duration_minutes = ?8, progress_value = ?9,
                sequence_number = ?10, last_reset_at = ?11, reason = ?12,
                updated_at = ?13, version = ?14
          WHERE id = ?15 AND operation_day_id = ?16 AND version = ?17
            AND status = 'ACTIVE'`,
      ).bind(
        values.scopeType,
        values.scopeId,
        values.kind,
        values.triggerMetric,
        values.intervalValue,
        values.minimumDurationMinutes,
        values.typicalDurationMinutes,
        values.maximumDurationMinutes,
        progress.initialProgress,
        sequenceNumber,
        progress.progressResetAt,
        command.payload.reason,
        now,
        nextRuleVersion,
        command.payload.ruleId,
        command.eventId,
        existing.version,
      );
    }
    return this.env.DB.prepare(
      `INSERT INTO recurring_operational_rules
        (id, operation_day_id, scope_type, scope_id, operation_kind, trigger_metric,
         interval_value, progress_value, minimum_duration_minutes,
         typical_duration_minutes, maximum_duration_minutes, status, sequence_number,
         reason, version, created_by_device_id, last_reset_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'ACTIVE', ?12,
               ?13, 0, ?14, ?15, ?16, ?16)`,
    ).bind(
      command.payload.ruleId,
      command.eventId,
      values.scopeType,
      values.scopeId,
      values.kind,
      values.triggerMetric,
      values.intervalValue,
      progress.initialProgress,
      values.minimumDurationMinutes,
      values.typicalDurationMinutes,
      values.maximumDurationMinutes,
      sequenceNumber,
      command.payload.reason,
      command.deviceId,
      progress.progressResetAt,
      now,
    );
  }

  async handleRecurringOperationalRule(
    command: RecurringRuleCommand,
    current: StoredEventRow,
  ): Promise<Response> {
    const existing = await this.env.DB.prepare(
      `SELECT rule.id, rule.version, rule.status, rule.scope_type, rule.scope_id,
              rule.operation_kind, rule.trigger_metric, rule.interval_value,
              rule.progress_value, rule.minimum_duration_minutes,
              rule.typical_duration_minutes, rule.maximum_duration_minutes,
              rule.sequence_number, rule.last_reset_at,
              (SELECT plan.id
                 FROM planned_operational_constraints plan
                WHERE plan.recurring_rule_id = rule.id
                  AND plan.status IN ('PLANNED', 'DUE', 'ACTIVE')
                ORDER BY plan.recurrence_sequence DESC LIMIT 1) AS open_plan_id
         FROM recurring_operational_rules rule
        WHERE rule.id = ?1 AND rule.operation_day_id = ?2`,
    )
      .bind(command.payload.ruleId, command.eventId)
      .first<StoredRecurringRule>();

    const validationResponse = await this.validateCommand(command, existing);
    if (validationResponse) return validationResponse;

    const now = new Date().toISOString();
    const nextEventVersion = current.version + 1;
    const nextRuleVersion = existing ? existing.version + 1 : 0;
    let progress: RuleProgress = {
      initialProgress: existing?.progress_value ?? 0,
      lastRotationId: null,
      progressResetAt: existing?.last_reset_at ?? now,
    };
    if (command.type === "UPSERT_RECURRING_OPERATIONAL_RULE") {
      progress = await this.resolveRuleProgress(command, existing, current.updated_at);
    }

    const ruleValues =
      command.type === "UPSERT_RECURRING_OPERATIONAL_RULE"
        ? command.payload.rule
        : disabledRuleValues(existing);
    const dueOnUpsert =
      command.type === "UPSERT_RECURRING_OPERATIONAL_RULE" &&
      progress.initialProgress >= ruleValues.intervalValue &&
      progress.lastRotationId !== null &&
      !existing?.open_plan_id;
    const occurrenceId = dueOnUpsert ? crypto.randomUUID() : null;
    const sequenceNumber = (existing?.sequence_number ?? 0) + (dueOnUpsert ? 1 : 0);
    const eventType = recurringRuleEventType(command, existing);
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        version: nextEventVersion,
        updated_at: now,
      }),
      eventType,
      aggregate: { type: "OPERATIONAL_RULE", id: command.payload.ruleId },
    };
    const ruleStatement = this.ruleStatement(
      command,
      existing,
      ruleValues,
      progress,
      sequenceNumber,
      now,
      nextRuleVersion,
    );
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextEventVersion, now, command.eventId, current.version),
      ruleStatement,
    ];
    if (dueOnUpsert && occurrenceId && progress.lastRotationId) {
      statements.push(
        this.env.DB.prepare(
          `INSERT INTO planned_operational_constraints
            (id, operation_day_id, scope_type, scope_id, constraint_kind, start_mode,
             earliest_start_at, latest_start_at, after_rotation_id, effect_mode,
             duration_multiplier_percent, minimum_duration_minutes, typical_duration_minutes,
             maximum_duration_minutes, status, reason, public_note, version,
             created_by_device_id, created_at, updated_at, recurring_rule_id, recurrence_sequence)
           VALUES (?1, ?2, ?3, ?4, ?5, 'AFTER_CURRENT_ROTATION', NULL, NULL, ?6,
                   'BLOCKING', NULL, ?7, ?8, ?9, 'PLANNED', ?10, '', 0, ?11, ?12, ?12, ?13, ?14)`,
        ).bind(
          occurrenceId,
          command.eventId,
          ruleValues.scopeType,
          ruleValues.scopeId,
          ruleValues.kind,
          progress.lastRotationId,
          ruleValues.minimumDurationMinutes,
          ruleValues.typicalDurationMinutes,
          ruleValues.maximumDurationMinutes,
          "Wiederkehrende Regel ist aufgrund des bestätigten Fortschritts fällig.",
          command.deviceId,
          now,
          command.payload.ruleId,
          sequenceNumber,
        ),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'OPERATIONAL_RULE', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        command.payload.ruleId,
        nextRuleVersion,
        JSON.stringify({
          ...(command.type === "UPSERT_RECURRING_OPERATIONAL_RULE"
            ? { ...ruleValues, progressValue: progress.initialProgress, occurrenceId }
            : { reason: command.payload.reason }),
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
}
