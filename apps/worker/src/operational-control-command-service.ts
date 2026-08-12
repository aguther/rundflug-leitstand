import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

type OperationalControlCommand = Extract<
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

function resourceGroupId(command: OperationalControlCommand): string | null {
  if (
    command.type === "SET_RESOURCE_GROUP_STATUS" ||
    command.type === "SET_RESOURCE_GROUP_NOTICE"
  ) {
    return command.payload.resourceGroupId;
  }
  return null;
}

function operationalControlEventType(command: OperationalControlCommand): string {
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

function emergencyModeAfter(command: OperationalControlCommand, current: StoredEventRow): number {
  if (command.type === "TRIGGER_EMERGENCY") return 1;
  if (command.type === "CLEAR_EMERGENCY") return 0;
  return current.emergency_mode;
}

function interruptionAfter(command: OperationalControlCommand, current: StoredEventRow): number {
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

function eventInterruptionStatements(
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

function resourceGroupStatusStatements(
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

function operationalControlPayload(command: OperationalControlCommand): Record<string, unknown> {
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

export class OperationalControlCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handle(command: OperationalControlCommand, current: StoredEventRow): Promise<Response> {
    const targetResourceGroupId = resourceGroupId(command);
    if (targetResourceGroupId) {
      const exists = await this.env.DB.prepare(
        "SELECT id FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2",
      )
        .bind(targetResourceGroupId, command.eventId)
        .first<{ id: string }>();
      if (!exists) {
        return json(
          {
            error: {
              code: "RESOURCE_GROUP_NOT_FOUND",
              message: "Ressourcengruppe nicht gefunden.",
            },
          },
          { status: 404 },
        );
      }
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = operationalControlEventType(command);
    const emergencyMode = emergencyModeAfter(command, current);
    const operationalInterrupted = interruptionAfter(command, current);
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        emergency_mode: emergencyMode,
        operational_interrupted: operationalInterrupted,
        version: nextVersion,
        updated_at: now,
      }),
      eventType,
      aggregate: targetResourceGroupId
        ? { type: "RESOURCE_GROUP", id: targetResourceGroupId }
        : { type: "OPERATION_DAY", id: command.eventId },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        `UPDATE operation_days SET emergency_mode = ?1, operational_interrupted = ?2,
                version = ?3, updated_at = ?4 WHERE id = ?5 AND version = ?6`,
      ).bind(
        emergencyMode,
        operationalInterrupted,
        nextVersion,
        now,
        command.eventId,
        current.version,
      ),
    ];

    if (command.type === "SET_EVENT_INTERRUPTION") {
      statements.push(...eventInterruptionStatements(this.env, command, now));
    }

    if (command.type === "SET_RESOURCE_GROUP_STATUS") {
      statements.push(...resourceGroupStatusStatements(this.env, command, now));
    }

    if (command.type === "SET_RESOURCE_GROUP_NOTICE") {
      statements.push(
        this.env.DB.prepare(
          "UPDATE resource_groups SET operational_note = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
        ).bind(command.payload.note, now, command.payload.resourceGroupId),
      );
    }

    const payload = operationalControlPayload(command);
    const aggregateType = targetResourceGroupId ? "RESOURCE_GROUP" : "OPERATION_DAY";
    const aggregateId = targetResourceGroupId ?? command.eventId;
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        aggregateType,
        aggregateId,
        nextVersion,
        JSON.stringify(payload),
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
