import { DurableObject } from "cloudflare:workers";
import {
  type CommandEnvelope,
  type CommandResult,
  commandEnvelopeSchema,
  commandResultSchema,
} from "@rundflug/contracts";
import {
  assertPublicTicketCode,
  assertRoleMayExecute,
  assertSaleAllowed,
  type DeviceRole,
  DomainRuleError,
  type OperationalCommandType,
  transitionRotation,
} from "@rundflug/domain";
import { rowToSnapshot, safeErrorMessage } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

      const device = await this.env.DB.prepare(
        `SELECT role
           FROM paired_devices
          WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
      )
        .bind(command.deviceId, command.eventId)
        .first<{ role: DeviceRole }>();
      if (!device) {
        return json(
          { error: { code: "DEVICE_NOT_PAIRED", message: "Gerät ist nicht aktiv gekoppelt." } },
          { status: 401 },
        );
      }

      if (command.type === "SET_OPERATIONAL_NOTE") {
        if (device.role !== "ADMIN") {
          return json(
            { error: { code: "ROLE_NOT_AUTHORIZED", message: "Geräterolle nicht berechtigt." } },
            { status: 403 },
          );
        }
      } else {
        try {
          assertRoleMayExecute(device.role, command.type as OperationalCommandType);
        } catch (reason: unknown) {
          if (reason instanceof DomainRuleError) {
            return json({ error: { code: reason.code, message: reason.message } }, { status: 403 });
          }
          throw reason;
        }
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

      if (command.type === "SELL_TICKET_GROUP") {
        const product = await this.env.DB.prepare(
          `SELECT p.id, p.resource_group_id, p.price_cents, p.sale_enabled, p.sale_closes_at,
                  rg.status AS resource_group_status
             FROM products p
             JOIN resource_groups rg ON rg.id = p.resource_group_id
            WHERE p.id = ?1 AND p.operation_day_id = ?2`,
        )
          .bind(command.payload.productId, command.eventId)
          .first<{
            id: string;
            resource_group_id: string;
            price_cents: number;
            sale_enabled: number;
            sale_closes_at: string | null;
            resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
          }>();
        if (!product) {
          return json(
            { error: { code: "PRODUCT_NOT_FOUND", message: "Produkt nicht gefunden." } },
            { status: 404 },
          );
        }
        try {
          assertSaleAllowed({
            productSaleEnabled: product.sale_enabled === 1,
            resourceGroupStatus: product.resource_group_status,
            emergencyMode: current.emergency_mode === 1,
            saleClosingReached:
              product.sale_closes_at !== null && Date.parse(product.sale_closes_at) <= Date.now(),
          });
        } catch (reason: unknown) {
          if (reason instanceof DomainRuleError) {
            return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
          }
          throw reason;
        }

        const normalizedCodes = command.payload.publicTicketCodes.map(assertPublicTicketCode);
        if (new Set(normalizedCodes).size !== normalizedCodes.length) {
          return json(
            {
              error: {
                code: "DUPLICATE_TICKET_CODE",
                message: "Ticketcodes müssen eindeutig sein.",
              },
            },
            { status: 409 },
          );
        }
        const hashes = await Promise.all(normalizedCodes.map(sha256));
        const queueRow = await this.env.DB.prepare(
          "SELECT COALESCE(MAX(queue_sequence), 0) + 1 AS next_sequence FROM ticket_groups WHERE operation_day_id = ?1",
        )
          .bind(command.eventId)
          .first<{ next_sequence: number }>();
        const communicationRow = await this.env.DB.prepare(
          "SELECT COALESCE(MAX(communication_number), 100) + 1 AS next_number FROM flight_groups WHERE operation_day_id = ?1 AND resource_group_id = ?2",
        )
          .bind(command.eventId, product.resource_group_id)
          .first<{ next_number: number }>();
        const now = new Date().toISOString();
        const nextVersion = current.version + 1;
        const ticketGroupId = crypto.randomUUID();
        const flightGroupId = crypto.randomUUID();
        const rotationId = crypto.randomUUID();
        const ticketIds = hashes.map(() => crypto.randomUUID());
        const eventId = crypto.randomUUID();
        const result: CommandResult = {
          accepted: true,
          duplicate: false,
          event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
          eventType: "TICKET_GROUP_SOLD",
          aggregate: { type: "TICKET_GROUP", id: ticketGroupId, relatedRotationId: rotationId },
        };
        const statements = [
          this.env.DB.prepare(
            "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
          ).bind(nextVersion, now, command.eventId, current.version),
          this.env.DB.prepare(`INSERT INTO ticket_groups
            (id, operation_day_id, product_id, queue_sequence, standby, status, sold_at, version)
            VALUES (?1, ?2, ?3, ?4, ?5, 'QUEUED', ?6, 0)`).bind(
            ticketGroupId,
            command.eventId,
            product.id,
            queueRow?.next_sequence ?? 1,
            command.payload.standby ? 1 : 0,
            now,
          ),
          this.env.DB.prepare(`INSERT INTO flight_groups
            (id, operation_day_id, resource_group_id, communication_number, status, version, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`).bind(
            flightGroupId,
            command.eventId,
            product.resource_group_id,
            communicationRow?.next_number ?? 101,
            now,
          ),
          this.env.DB.prepare(`INSERT INTO rotations
            (id, operation_day_id, flight_group_id, status, version, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'DRAFT', 0, ?4, ?4)`).bind(
            rotationId,
            command.eventId,
            flightGroupId,
            now,
          ),
          ...hashes.flatMap((hash, index) => [
            this.env.DB.prepare(`INSERT INTO tickets
              (id, ticket_group_id, public_code_hash, status, weight_class, payment_status, payment_method, price_cents, created_at)
              VALUES (?1, ?2, ?3, 'QUEUED', 'NOT_CAPTURED', ?4, ?5, ?6, ?7)`).bind(
              ticketIds[index],
              ticketGroupId,
              hash,
              command.payload.paymentStatus,
              command.payload.paymentMethod,
              product.price_cents,
              now,
            ),
            this.env.DB.prepare(
              "INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at) VALUES (?1, ?2, ?3)",
            ).bind(rotationId, ticketIds[index], now),
          ]),
          this.env.DB.prepare(`INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type, aggregate_id, aggregate_version, payload_json)
            VALUES (?1, ?2, 'TICKET_GROUP_SOLD', ?3, ?4, 'TICKET_GROUP', ?5, 0, ?6)`).bind(
            eventId,
            command.eventId,
            now,
            command.deviceId,
            ticketGroupId,
            JSON.stringify({
              ticketGroupId,
              flightGroupId,
              rotationId,
              ticketCount: ticketIds.length,
              productId: product.id,
            }),
          ),
          this.env.DB.prepare(`INSERT INTO idempotency_receipts
            (command_id, operation_day_id, device_id, command_type, received_at, response_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
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
        ];
        await this.env.DB.batch(statements);
        this.broadcast(result);
        return json(result);
      }

      if (command.type !== "SET_OPERATIONAL_NOTE") {
        return this.handleRotationTransition(command, current);
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

      this.broadcast(result);
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

  private broadcast(result: CommandResult): void {
    const broadcast = JSON.stringify({ type: "event-state-changed", data: result });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(broadcast);
      } catch {
        socket.close(1011, "Broadcast fehlgeschlagen");
      }
    }
  }

  private async handleRotationTransition(
    command: Extract<
      CommandEnvelope,
      { type: "CALL_NEXT" | "MARK_IN_FLIGHT" | "MARK_LANDED" | "MARK_COMPLETED" }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      "SELECT id, status, version, aircraft_id FROM rotations WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        version: number;
        aircraft_id: string | null;
      }>();
    if (!rotation)
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    const target = {
      CALL_NEXT: "CALLED",
      MARK_IN_FLIGHT: "IN_FLIGHT",
      MARK_LANDED: "LANDED",
      MARK_COMPLETED: "COMPLETED",
    } as const;
    const timestampColumn = {
      CALL_NEXT: "called_at",
      MARK_IN_FLIGHT: "departed_at",
      MARK_LANDED: "landed_at",
      MARK_COMPLETED: "completed_at",
    } as const;
    let nextState: typeof rotation.status;
    try {
      nextState = transitionRotation(rotation.status, target[command.type]);
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError)
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      throw reason;
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = {
      CALL_NEXT: "FLIGHT_GROUP_CALLED",
      MARK_IN_FLIGHT: "ROTATION_STARTED",
      MARK_LANDED: "ROTATION_LANDED",
      MARK_COMPLETED: "ROTATION_COMPLETED",
    } as const;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: eventType[command.type],
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE rotations SET status = ?1, ${timestampColumn[command.type]} = ?2, version = version + 1, updated_at = ?2 WHERE id = ?3 AND version = ?4`,
      ).bind(nextState, now, rotation.id, rotation.version),
      this.env.DB.prepare(`INSERT INTO operational_events (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type, aggregate_id, aggregate_version, payload_json)
        VALUES (?1, ?2, ?3, ?4, ?5, 'ROTATION', ?6, ?7, ?8)`).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType[command.type],
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({ from: rotation.status, to: nextState }),
      ),
      this.env.DB.prepare(`INSERT INTO idempotency_receipts (command_id, operation_day_id, device_id, command_type, received_at, response_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
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
