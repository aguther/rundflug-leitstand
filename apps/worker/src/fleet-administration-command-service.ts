import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { FleetAdministrationMutationPlanner } from "./fleet-administration-mutation-planner";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class FleetAdministrationCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleFleetAdministration(
    command: Extract<
      CommandEnvelope,
      {
        type:
          | "SET_AIRCRAFT_OPERATIONAL_STATE"
          | "SCHEDULE_AIRCRAFT_REFUEL"
          | "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD"
          | "SET_PILOT_PAUSE"
          | "UPSERT_PILOT";
      }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
    ];
    let aggregateType: "AIRCRAFT" | "PILOT";
    let aggregateId: string;
    let eventType: string;
    let auditPayload: Record<string, unknown>;
    const mutationPlanner = new FleetAdministrationMutationPlanner(this.env);

    if (command.type === "UPSERT_PILOT" || command.type === "SET_PILOT_PAUSE") {
      const plan =
        command.type === "SET_PILOT_PAUSE"
          ? await mutationPlanner.preparePilotPause(command, now)
          : await mutationPlanner.preparePilotUpsert(command, now);
      if (plan instanceof Response) return plan;
      ({ aggregateType, aggregateId, eventType, auditPayload } = plan);
      statements.push(...plan.statements);
    } else {
      const plan = await mutationPlanner.prepareAircraftCommand(command, now);
      if (plan instanceof Response) return plan;
      ({ aggregateType, aggregateId, eventType, auditPayload } = plan);
      statements.push(...plan.statements);
    }

    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: aggregateType, id: aggregateId },
    };
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
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }
}
