import { DurableObject } from "cloudflare:workers";
import {
  type CommandEnvelope,
  type CommandResult,
  commandEnvelopeSchema,
  commandResultSchema,
} from "@rundflug/contracts";
import { rowToSnapshot, safeErrorMessage } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class EventCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.openWebSocket();
    }
    if (request.method === "POST" && url.pathname.endsWith("/command")) {
      return this.handleCommand(request);
    }
    return json(
      { error: { code: "NOT_FOUND", message: "Durable-Object-Route nicht gefunden." } },
      { status: 404 },
    );
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && message === "ping") {
      socket.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
    }
  }

  async webSocketClose(
    _socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // The runtime acknowledges close frames for the configured compatibility date.
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, "Verbindung beendet");
  }

  private openWebSocket(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleCommand(request: Request): Promise<Response> {
    let command: CommandEnvelope;
    try {
      command = commandEnvelopeSchema.parse(await request.json());
    } catch {
      return json(
        { error: { code: "INVALID_COMMAND", message: "Kommando ist formal ungültig." } },
        { status: 400 },
      );
    }

    const eventIdFromPath = new URL(request.url).pathname.split("/").at(-2);
    if (eventIdFromPath !== command.eventId) {
      return json(
        {
          error: {
            code: "EVENT_MISMATCH",
            message: "Event-ID in URL und Kommando stimmen nicht überein.",
          },
        },
        { status: 400 },
      );
    }

    try {
      const prior = await this.env.DB.prepare(
        "SELECT response_json FROM idempotency_receipts WHERE command_id = ?1",
      )
        .bind(command.commandId)
        .first<{ response_json: string }>();
      if (prior) {
        const stored = commandResultSchema.parse(JSON.parse(prior.response_json));
        return json({ ...stored, duplicate: true });
      }

      const current = await this.env.DB.prepare(
        `SELECT id, name, event_date, time_zone, status, emergency_mode, version,
                operational_note, updated_at
           FROM operation_days
          WHERE id = ?1`,
      )
        .bind(command.eventId)
        .first<StoredEventRow>();
      if (!current) {
        return json(
          { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
          { status: 404 },
        );
      }
      if (current.version !== command.expectedVersion) {
        return json(
          {
            error: {
              code: "STALE_VERSION",
              message: "Der Zustand wurde zwischenzeitlich geändert.",
              currentVersion: current.version,
            },
          },
          { status: 409 },
        );
      }

      const nextVersion = current.version + 1;
      const persistedAt = new Date().toISOString();
      const eventRecordId = crypto.randomUUID();
      const outboxId = crypto.randomUUID();
      const nextSnapshot = rowToSnapshot({
        ...current,
        version: nextVersion,
        operational_note: command.payload.note,
        updated_at: persistedAt,
      });
      const result: CommandResult = {
        accepted: true,
        duplicate: false,
        event: nextSnapshot,
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
          eventRecordId,
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
        ).bind(outboxId, command.eventId, JSON.stringify(result), persistedAt),
      ]);

      const broadcast = JSON.stringify({ type: "event-state-changed", data: result });
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(broadcast);
        } catch {
          socket.close(1011, "Broadcast fehlgeschlagen");
        }
      }
      return json(result, { status: 200 });
    } catch (reason: unknown) {
      console.error(
        JSON.stringify({
          level: "error",
          code: "COMMAND_PROCESSING_FAILED",
          message: safeErrorMessage(reason),
          eventId: command.eventId,
          commandType: command.type,
        }),
      );
      return json(
        { error: { code: "INTERNAL_ERROR", message: "Kommando konnte nicht verarbeitet werden." } },
        { status: 500 },
      );
    }
  }
}
