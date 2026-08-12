import type { CommandResult } from "@rundflug/contracts";
import {
  emergencyModeAfter,
  eventInterruptionStatements,
  interruptionAfter,
  type OperationalControlCommand,
  operationalControlEventType,
  operationalControlPayload,
  resourceGroupId,
  resourceGroupStatusStatements,
} from "./operational-control-command-helpers";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
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
