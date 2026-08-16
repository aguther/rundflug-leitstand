import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { resolveMasterDataDeletion } from "./master-data-deletion";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}
export class MasterDataDeletionService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleMasterDataDeletion(
    command: Extract<CommandEnvelope, { type: "DELETE_MASTER_DATA" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    if (current.status !== "PREPARATION") {
      return json(
        {
          error: {
            code: "MASTER_DATA_DELETE_PHASE_LOCKED",
            message:
              "Stammdaten können nur vor der Betriebsfreigabe endgültig gelöscht werden. Im laufenden Betrieb bitte deaktivieren.",
          },
        },
        { status: 409 },
      );
    }

    const { entityType } = command.payload;
    const resolution = await resolveMasterDataDeletion(this.env.DB, command);
    if (resolution.error) {
      return json(
        { error: { code: resolution.error.code, message: resolution.error.message } },
        { status: resolution.error.status },
      );
    }
    const { aggregate, blockers, deletion, eventType, label, removedMembershipCount } =
      resolution.plan;

    if (blockers.length > 0) {
      return json(
        {
          error: {
            code: "MASTER_DATA_DELETE_BLOCKED",
            message: `Löschen nicht möglich. Zuerst entfernen: ${blockers.join(", ")}.`,
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate,
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      deletion,
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
        aggregate.type,
        aggregate.id,
        nextVersion,
        JSON.stringify({
          entityType,
          label,
          reason: command.payload.reason,
          ...(removedMembershipCount > 0 ? { removedMembershipCount } : {}),
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
    ]);
    this.broadcast(result);
    return json(result);
  }
}
