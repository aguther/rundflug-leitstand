import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class OperationalNoteCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handle(
    command: Extract<CommandEnvelope, { type: "SET_OPERATIONAL_NOTE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const nextVersion = current.version + 1;
    const persistedAt = new Date().toISOString();
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        version: nextVersion,
        operational_note: command.payload.note,
        updated_at: persistedAt,
      }),
      eventType: "OPERATIONAL_NOTE_SET",
    };

    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE operation_days
            SET operational_note = ?1, version = ?2, updated_at = ?3
          WHERE id = ?4 AND version = ?5`,
      ).bind(command.payload.note, nextVersion, persistedAt, command.eventId, current.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
           (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
            aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'OPERATION_DAY', ?2, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        "OPERATIONAL_NOTE_SET",
        persistedAt,
        command.deviceId,
        nextVersion,
        JSON.stringify({ note: command.payload.note }),
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
        persistedAt,
        JSON.stringify(result),
      ),
      this.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)`,
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), persistedAt),
    ]);

    this.broadcast(result);
    return json(result, { status: 200 });
  }
}
