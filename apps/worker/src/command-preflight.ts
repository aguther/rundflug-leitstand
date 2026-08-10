import type { CommandEnvelope, CommandPrecondition } from "@rundflug/contracts";
import type { DeviceRole } from "@rundflug/domain";
import type {
  ActiveOperatorClaimRow,
  CommandAggregateTarget,
  CommandPreflightReads,
  PlannedOperationExpectation,
  PlannedOperationRow,
} from "./command-preflight-types";
import type { StoredEventRow } from "./types";

type CommandPreflightRow =
  | StoredEventRow
  | { response_json: string }
  | { version: number }
  | PlannedOperationRow
  | ActiveOperatorClaimRow
  | { aircraft_id: string | null };

interface CommandPreflightInput {
  db: D1Database;
  command: CommandEnvelope;
  deviceRole: DeviceRole;
  operatorAccountId: string | null;
  nowIso: string;
  includeIdempotencyReceipt?: boolean;
}

interface StatementIndexes {
  idempotencyReceipt?: number;
  current?: number;
  aggregateVersion?: number;
  plannedOperation?: number;
  activeOperatorClaim?: number;
  targetRotation?: number;
}

const EVENT_PROJECTION = `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
       emergency_mode, operational_interrupted, version,
       operational_note, operations_start_at, operations_end_at, sale_opens_at,
       no_show_after_minutes,
       max_ticket_deferrals,
       notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
       automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
       precall_min_quality, precall_gate_cooldown_minutes,
       heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
       planned_buffer_minutes, logo_object_key, logo_dark_object_key, updated_at
  FROM operation_days
 WHERE id = ?1`;

export function scopedCommandTarget(command: CommandEnvelope): CommandAggregateTarget | null {
  switch (command.type) {
    case "MARK_OFF_BLOCK":
    case "MARK_ON_BLOCK":
    case "COMPLETE_TURNAROUND":
    case "CANCEL_ROTATION":
      return { aggregateType: "ROTATION", aggregateId: command.payload.rotationId };
    case "SET_AIRCRAFT_OPERATIONAL_STATE":
    case "SCHEDULE_AIRCRAFT_REFUEL":
    case "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD":
      return { aggregateType: "AIRCRAFT", aggregateId: command.payload.aircraftId };
    default:
      return null;
  }
}

export function plannedOperationExpectation(command: CommandEnvelope): PlannedOperationExpectation {
  const plannedOperationId = (command.payload as { plannedOperationId?: string })
    .plannedOperationId;
  if (!plannedOperationId) return { kind: "none" };
  if (command.type === "SET_EVENT_INTERRUPTION") {
    return {
      kind: "supported",
      plannedOperationId,
      scopeType: "EVENT",
      scopeId: command.eventId,
      activating: command.payload.interrupted,
    };
  }
  if (command.type === "SET_RESOURCE_GROUP_STATUS") {
    return {
      kind: "supported",
      plannedOperationId,
      scopeType: "RESOURCE_GROUP",
      scopeId: command.payload.resourceGroupId,
      activating: command.payload.status !== "ACTIVE",
    };
  }
  if (command.type === "SET_PILOT_PAUSE") {
    return {
      kind: "supported",
      plannedOperationId,
      scopeType: "PILOT",
      scopeId: command.payload.pilotId,
      activating: command.payload.paused,
    };
  }
  if (command.type === "SET_AIRCRAFT_OPERATIONAL_STATE") {
    return {
      kind: "supported",
      plannedOperationId,
      scopeType: "AIRCRAFT",
      scopeId: command.payload.aircraftId,
      activating: command.payload.state !== "AVAILABLE",
    };
  }
  return { kind: "unsupported", plannedOperationId };
}

function matchingAggregatePrecondition(command: CommandEnvelope): CommandPrecondition | null {
  const target = scopedCommandTarget(command);
  const preconditions = command.preconditions;
  if (
    !target ||
    preconditions?.length !== 1 ||
    preconditions[0]?.aggregateType !== target.aggregateType ||
    preconditions[0].aggregateId !== target.aggregateId
  ) {
    return null;
  }
  return preconditions[0];
}

function addStatement(statements: D1PreparedStatement[], statement: D1PreparedStatement): number {
  statements.push(statement);
  return statements.length - 1;
}

function firstRow<T extends CommandPreflightRow>(
  results: D1Result<CommandPreflightRow>[],
  index: number | undefined,
): T | null {
  if (index === undefined) return null;
  return (results[index]?.results[0] as T | undefined) ?? null;
}

export async function loadCommandPreflightReads({
  db,
  command,
  deviceRole,
  operatorAccountId,
  nowIso,
  includeIdempotencyReceipt = false,
}: CommandPreflightInput): Promise<CommandPreflightReads> {
  const statements: D1PreparedStatement[] = [];
  const indexes: StatementIndexes = {};
  if (includeIdempotencyReceipt) {
    indexes.idempotencyReceipt = addStatement(
      statements,
      db
        .prepare("SELECT response_json FROM idempotency_receipts WHERE command_id = ?1")
        .bind(command.commandId),
    );
  }
  indexes.current = addStatement(statements, db.prepare(EVENT_PROJECTION).bind(command.eventId));

  const aggregatePrecondition = matchingAggregatePrecondition(command);
  if (aggregatePrecondition) {
    indexes.aggregateVersion = addStatement(
      statements,
      aggregatePrecondition.aggregateType === "ROTATION"
        ? db
            .prepare("SELECT version FROM rotations WHERE id = ?1 AND operation_day_id = ?2")
            .bind(aggregatePrecondition.aggregateId, command.eventId)
        : db
            .prepare(
              `SELECT a.version
                 FROM aircraft a
                WHERE a.id = ?1
                  AND EXISTS (
                    SELECT 1 FROM resource_group_memberships membership
                     WHERE membership.aircraft_id = a.id
                       AND membership.operation_day_id = ?2
                  )`,
            )
            .bind(aggregatePrecondition.aggregateId, command.eventId),
    );
  }

  const planExpectation = plannedOperationExpectation(command);
  if (planExpectation.kind === "supported") {
    indexes.plannedOperation = addStatement(
      statements,
      db
        .prepare(
          `SELECT scope_type, scope_id, status, effect_mode
             FROM planned_operational_constraints
            WHERE id = ?1 AND operation_day_id = ?2`,
        )
        .bind(planExpectation.plannedOperationId, command.eventId),
    );
  }

  if (operatorAccountId) {
    indexes.activeOperatorClaim = addStatement(
      statements,
      db
        .prepare(
          `SELECT aircraft_id, revision
             FROM flight_line_assist_claims
            WHERE operation_day_id = ?1 AND operator_account_id = ?2 AND expires_at > ?3`,
        )
        .bind(command.eventId, operatorAccountId, nowIso),
    );
  }

  const payload = command.payload as Record<string, unknown>;
  if (
    deviceRole === "FLIGHT_LINE" &&
    operatorAccountId &&
    typeof payload.aircraftId !== "string" &&
    typeof payload.rotationId === "string"
  ) {
    indexes.targetRotation = addStatement(
      statements,
      db
        .prepare("SELECT aircraft_id FROM rotations WHERE id = ?1 AND operation_day_id = ?2")
        .bind(payload.rotationId, command.eventId),
    );
  }

  const startedAt = performance.now();
  const results = await db.batch<CommandPreflightRow>(statements);
  const durationMs = Math.max(0, performance.now() - startedAt);
  const aggregate = firstRow<{ version: number }>(results, indexes.aggregateVersion);
  const targetRotation = firstRow<{ aircraft_id: string | null }>(results, indexes.targetRotation);

  return {
    idempotencyResponseJson:
      firstRow<{ response_json: string }>(results, indexes.idempotencyReceipt)?.response_json ??
      null,
    current: firstRow<StoredEventRow>(results, indexes.current),
    aggregateVersion: aggregate?.version ?? null,
    plannedOperation: firstRow<PlannedOperationRow>(results, indexes.plannedOperation),
    activeOperatorClaim: firstRow<ActiveOperatorClaimRow>(results, indexes.activeOperatorClaim),
    targetRotationAircraftId: targetRotation?.aircraft_id ?? null,
    batchCount: 1,
    statementCount: statements.length,
    durationMs,
  };
}
