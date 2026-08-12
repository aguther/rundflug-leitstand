import type { CommandEnvelope } from "@rundflug/contracts";
import type { Env, StoredEventRow } from "./types";

export type OperationalControlCommand = Extract<
  CommandEnvelope,
  {
    type:
      | "TRIGGER_EMERGENCY"
      | "CLEAR_EMERGENCY"
      | "SET_EVENT_INTERRUPTION"
      | "SET_RESOURCE_GROUP_STATUS"
      | "SET_RESOURCE_GROUP_NOTICE";
  }
>;

export function resourceGroupId(command: OperationalControlCommand): string | null {
  if (
    command.type === "SET_RESOURCE_GROUP_STATUS" ||
    command.type === "SET_RESOURCE_GROUP_NOTICE"
  ) {
    return command.payload.resourceGroupId;
  }
  return null;
}

export function operationalControlEventType(command: OperationalControlCommand): string {
  switch (command.type) {
    case "TRIGGER_EMERGENCY":
      return "EMERGENCY_MODE_TRIGGERED";
    case "CLEAR_EMERGENCY":
      return "EMERGENCY_MODE_CLEARED";
    case "SET_EVENT_INTERRUPTION":
      return command.payload.interrupted
        ? "EVENT_OPERATION_INTERRUPTED"
        : "EVENT_OPERATION_RESUMED";
    case "SET_RESOURCE_GROUP_STATUS":
      return "RESOURCE_GROUP_STATUS_CHANGED";
    case "SET_RESOURCE_GROUP_NOTICE":
      return "RESOURCE_GROUP_NOTICE_SET";
  }
}

export function emergencyModeAfter(
  command: OperationalControlCommand,
  current: StoredEventRow,
): number {
  if (command.type === "TRIGGER_EMERGENCY") return 1;
  if (command.type === "CLEAR_EMERGENCY") return 0;
  return current.emergency_mode;
}

export function interruptionAfter(
  command: OperationalControlCommand,
  current: StoredEventRow,
): number {
  if (command.type !== "SET_EVENT_INTERRUPTION") return current.operational_interrupted ?? 0;
  return command.payload.interrupted ? 1 : 0;
}

function plannedOperationStatusStatement(input: {
  env: Env;
  status: "ACTIVE" | "CLEARED";
  now: string;
  plannedOperationId: string;
  eventId: string;
}): D1PreparedStatement {
  return input.env.DB.prepare(
    `UPDATE planned_operational_constraints
        SET status = ?1, version = version + 1, updated_at = ?2,
            activated_at = CASE WHEN ?1 = 'ACTIVE' THEN ?2 ELSE activated_at END,
            cleared_at = CASE WHEN ?1 = 'CLEARED' THEN ?2 ELSE cleared_at END
      WHERE id = ?3 AND operation_day_id = ?4`,
  ).bind(input.status, input.now, input.plannedOperationId, input.eventId);
}

export function eventInterruptionStatements(
  env: Env,
  command: Extract<OperationalControlCommand, { type: "SET_EVENT_INTERRUPTION" }>,
  now: string,
): D1PreparedStatement[] {
  const statements = [
    command.payload.interrupted
      ? env.DB.prepare(
          `INSERT INTO operational_blocks
            (id, operation_day_id, scope_type, scope_id, block_type, status, reason,
             started_at, expected_review_at, device_id, planned_operation_id)
            VALUES (?1, ?2, 'EVENT', ?2, 'INTERRUPTION', 'ACTIVE', ?3, ?4, ?5, ?6, ?7)`,
        ).bind(
          crypto.randomUUID(),
          command.eventId,
          command.payload.reason,
          now,
          command.payload.expectedReviewAt,
          command.deviceId,
          command.payload.plannedOperationId ?? null,
        )
      : env.DB.prepare(
          `UPDATE operational_blocks SET status = 'CLEARED', cleared_at = ?1
            WHERE operation_day_id = ?2 AND scope_type = 'EVENT' AND scope_id = ?2
              AND status = 'ACTIVE'`,
        ).bind(now, command.eventId),
  ];
  if (command.payload.plannedOperationId) {
    statements.push(
      plannedOperationStatusStatement({
        env,
        status: command.payload.interrupted ? "ACTIVE" : "CLEARED",
        now,
        plannedOperationId: command.payload.plannedOperationId,
        eventId: command.eventId,
      }),
    );
  }
  return statements;
}

export function resourceGroupStatusStatements(
  env: Env,
  command: Extract<OperationalControlCommand, { type: "SET_RESOURCE_GROUP_STATUS" }>,
  now: string,
): D1PreparedStatement[] {
  const active = command.payload.status === "ACTIVE";
  const blockType = command.payload.status === "PAUSED" ? "PAUSE" : "INTERRUPTION";
  const statements = [
    env.DB.prepare(
      "UPDATE resource_groups SET status = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
    ).bind(command.payload.status, now, command.payload.resourceGroupId),
    active
      ? env.DB.prepare(
          `UPDATE operational_blocks SET status = 'CLEARED', cleared_at = ?1
            WHERE operation_day_id = ?2 AND scope_type = 'RESOURCE_GROUP' AND scope_id = ?3 AND status = 'ACTIVE'`,
        ).bind(now, command.eventId, command.payload.resourceGroupId)
      : env.DB.prepare(
          `INSERT INTO operational_blocks
            (id, operation_day_id, scope_type, scope_id, block_type, status, reason,
             started_at, expected_review_at, device_id, planned_operation_id)
            VALUES (?1, ?2, 'RESOURCE_GROUP', ?3, ?4, 'ACTIVE', ?5, ?6, ?7, ?8, ?9)`,
        ).bind(
          crypto.randomUUID(),
          command.eventId,
          command.payload.resourceGroupId,
          blockType,
          command.payload.reason,
          now,
          command.payload.expectedReviewAt,
          command.deviceId,
          command.payload.plannedOperationId ?? null,
        ),
  ];
  if (command.payload.plannedOperationId) {
    statements.push(
      plannedOperationStatusStatement({
        env,
        status: active ? "CLEARED" : "ACTIVE",
        now,
        plannedOperationId: command.payload.plannedOperationId,
        eventId: command.eventId,
      }),
    );
  }
  return statements;
}

export function operationalControlPayload(
  command: OperationalControlCommand,
): Record<string, unknown> {
  if (command.type === "SET_RESOURCE_GROUP_STATUS") {
    return {
      reason: command.payload.reason,
      resourceGroupId: command.payload.resourceGroupId,
      status: command.payload.status,
      expectedReviewAt: command.payload.expectedReviewAt,
      plannedOperationId: command.payload.plannedOperationId,
    };
  }
  if (command.type === "SET_RESOURCE_GROUP_NOTICE") {
    return {
      note: command.payload.note,
      resourceGroupId: command.payload.resourceGroupId,
      informationalOnly: true,
    };
  }
  if (command.type === "SET_EVENT_INTERRUPTION") {
    return {
      reason: command.payload.reason,
      interrupted: command.payload.interrupted,
      expectedReviewAt: command.payload.expectedReviewAt,
      plannedOperationId: command.payload.plannedOperationId,
      informationalOnly: true,
    };
  }
  return { reason: command.payload.reason };
}
