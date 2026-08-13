import type { CommandResult } from "@rundflug/contracts";
import {
  disabledRuleValues,
  RecurringOperationalRuleMutationPlanner,
  type RecurringRuleCommand,
  type RuleProgress,
  recurringRuleEventType,
  type StoredRecurringRule,
} from "./recurring-operational-rule-mutation-planner";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class RecurringOperationalRuleCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

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

    const mutationPlanner = new RecurringOperationalRuleMutationPlanner(this.env);
    const validationResponse = await mutationPlanner.validateCommand(command, existing);
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
      progress = await mutationPlanner.resolveRuleProgress(command, existing, current.updated_at);
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
    const ruleStatement = mutationPlanner.ruleStatement(
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
