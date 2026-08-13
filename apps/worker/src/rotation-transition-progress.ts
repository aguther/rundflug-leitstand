import {
  type ConfirmedOvertakeIncrement,
  calculateConfirmedOvertakeIncrements,
} from "@rundflug/domain";
import type { SelectedRotationGroup, StoredTransitionRotation } from "./rotation-call-preparation";
import type { RotationTransitionCommand } from "./rotation-transition-command-service";
import type { Env, StoredEventRow } from "./types";

type EligibleDraftMemberLoader = (
  eventId: string,
  resourceGroupId: string,
) => Promise<Array<{ rotationId: string; queueSequence: number }>>;

type RecurringRuleRow = {
  id: string;
  version: number;
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
  open_plan_id: string | null;
};

export async function calculateTransitionOvertakes(input: {
  command: RotationTransitionCommand;
  selectedGroups: readonly SelectedRotationGroup[];
  loadEligibleDraftMembers: EligibleDraftMemberLoader;
}): Promise<ConfirmedOvertakeIncrement[]> {
  if (input.command.type !== "CALL_NEXT") return [];
  const selectedMemberQueueSequence = new Map<string, number>();
  for (const group of input.selectedGroups) {
    selectedMemberQueueSequence.set(
      group.rotation_id,
      Math.min(
        selectedMemberQueueSequence.get(group.rotation_id) ?? Number.MAX_SAFE_INTEGER,
        Number(group.queue_sequence),
      ),
    );
  }
  const waitingMembers = await input.loadEligibleDraftMembers(
    input.command.eventId,
    input.selectedGroups[0]?.resource_group_id ?? "",
  );
  return calculateConfirmedOvertakeIncrements({
    selectedMembers: [...selectedMemberQueueSequence].map(([rotationId, queueSequence]) => ({
      rotationId,
      queueSequence,
    })),
    waitingMembers,
  });
}

export async function buildRecurringProgressStatements(input: {
  env: Env;
  command: RotationTransitionCommand;
  current: StoredEventRow;
  rotation: StoredTransitionRotation;
  selectedAircraftId: string;
  selectedPilotId: string;
  now: string;
}): Promise<D1PreparedStatement[]> {
  if (input.command.type !== "COMPLETE_TURNAROUND") return [];
  const recurringRules = await loadRecurringRules(input);
  const operatingMinutes = input.rotation.called_at
    ? Math.max(
        0,
        Math.round((Date.parse(input.now) - Date.parse(input.rotation.called_at)) / 60_000),
      )
    : 0;
  const withinOperations =
    !input.current.operations_end_at ||
    Date.parse(input.now) < Date.parse(input.current.operations_end_at);
  return recurringRules.flatMap((rule) =>
    recurringRuleStatements(input, rule, operatingMinutes, withinOperations),
  );
}

async function loadRecurringRules(input: {
  env: Env;
  command: RotationTransitionCommand;
  selectedAircraftId: string;
  selectedPilotId: string;
}): Promise<RecurringRuleRow[]> {
  const recurringRules = await input.env.DB.prepare(
    `SELECT rule.id, rule.version, rule.scope_type, rule.scope_id, rule.operation_kind,
            rule.trigger_metric, rule.interval_value, rule.progress_value,
            rule.minimum_duration_minutes, rule.typical_duration_minutes,
            rule.maximum_duration_minutes, rule.sequence_number,
            (SELECT plan.id FROM planned_operational_constraints plan
              WHERE plan.recurring_rule_id = rule.id
                AND plan.status IN ('PLANNED', 'ACTIVE')
              ORDER BY plan.recurrence_sequence DESC LIMIT 1) AS open_plan_id
       FROM recurring_operational_rules rule
      WHERE rule.operation_day_id = ?1 AND rule.status = 'ACTIVE'
        AND (
          (rule.scope_type = 'AIRCRAFT' AND rule.scope_id = ?2)
          OR (rule.scope_type = 'PILOT' AND rule.scope_id = ?3)
        )
      ORDER BY rule.scope_type, rule.scope_id, rule.operation_kind, rule.id`,
  )
    .bind(input.command.eventId, input.selectedAircraftId, input.selectedPilotId)
    .all<RecurringRuleRow>();
  return recurringRules.results;
}

function recurringRuleStatements(
  input: {
    env: Env;
    command: RotationTransitionCommand;
    rotation: StoredTransitionRotation;
    now: string;
  },
  rule: RecurringRuleRow,
  operatingMinutes: number,
  withinOperations: boolean,
): D1PreparedStatement[] {
  const increment = rule.trigger_metric === "COMPLETED_ROTATIONS" ? 1 : operatingMinutes;
  const progressValue = rule.progress_value + increment;
  const becomesDue =
    withinOperations && progressValue >= rule.interval_value && rule.open_plan_id === null;
  const nextSequence = rule.sequence_number + (becomesDue ? 1 : 0);
  const statements = [
    input.env.DB.prepare(
      `UPDATE recurring_operational_rules
          SET progress_value = ?1, sequence_number = ?2, version = version + 1,
              updated_at = ?3
        WHERE id = ?4 AND operation_day_id = ?5 AND version = ?6
          AND status = 'ACTIVE'`,
    ).bind(progressValue, nextSequence, input.now, rule.id, input.command.eventId, rule.version),
  ];
  if (!becomesDue) return statements;
  return [
    ...statements,
    ...recurringOccurrenceStatements(input, rule, progressValue, nextSequence),
  ];
}

function recurringOccurrenceStatements(
  input: {
    env: Env;
    command: RotationTransitionCommand;
    rotation: StoredTransitionRotation;
    now: string;
  },
  rule: RecurringRuleRow,
  progressValue: number,
  nextSequence: number,
): D1PreparedStatement[] {
  const occurrenceId = crypto.randomUUID();
  return [
    input.env.DB.prepare(
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
      input.command.eventId,
      rule.scope_type,
      rule.scope_id,
      rule.operation_kind,
      input.rotation.id,
      rule.minimum_duration_minutes,
      rule.typical_duration_minutes,
      rule.maximum_duration_minutes,
      "Wiederkehrende Regel nach bestätigtem Umlauf fällig.",
      input.command.deviceId,
      input.now,
      rule.id,
      nextSequence,
    ),
    input.env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json)
       VALUES (?1, ?2, 'RECURRING_OPERATION_DUE', ?3, ?4, 'OPERATIONAL_RULE', ?5, ?6, ?7)`,
    ).bind(
      crypto.randomUUID(),
      input.command.eventId,
      input.now,
      input.command.deviceId,
      rule.id,
      rule.version + 1,
      JSON.stringify({
        occurrenceId,
        recurrenceSequence: nextSequence,
        afterRotationId: input.rotation.id,
        progressValue,
        intervalValue: rule.interval_value,
        triggerMetric: rule.trigger_metric,
      }),
    ),
  ];
}
