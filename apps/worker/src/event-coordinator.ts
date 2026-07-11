import { DurableObject } from "cloudflare:workers";
import {
  type CommandEnvelope,
  type CommandResult,
  commandEnvelopeSchema,
  commandResultSchema,
} from "@rundflug/contracts";
import {
  assertPublicTicketCode,
  assertQueueMutationAllowed,
  assertRoleMayExecute,
  assertSaleAllowed,
  type DeviceRole,
  DomainRuleError,
  type OperationalCommandType,
  transitionRotation,
} from "@rundflug/domain";
import { sha256Hex, verifyCredential } from "./crypto";
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

      const device = await this.env.DB.prepare(
        `SELECT role, credential_hash
           FROM paired_devices
          WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
      )
        .bind(command.deviceId, command.eventId)
        .first<{ role: DeviceRole; credential_hash: string | null }>();
      if (
        !device ||
        !(await verifyCredential(request.headers.get("x-device-token"), device.credential_hash))
      ) {
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
        const hashes = await Promise.all(normalizedCodes.map(sha256Hex));
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
        if (
          command.type === "TRIGGER_EMERGENCY" ||
          command.type === "CLEAR_EMERGENCY" ||
          command.type === "SET_RESOURCE_GROUP_STATUS"
        ) {
          return this.handleOperationalControl(command, current);
        }
        if (command.type === "REVOKE_CALL") {
          return this.handleRevokeCall(command, current);
        }
        if (
          command.type === "CANCEL_TICKET_GROUP" ||
          command.type === "REBOOK_TICKET_GROUP" ||
          command.type === "DEFER_TICKET_GROUP" ||
          command.type === "MARK_NO_SHOW"
        ) {
          return this.handleTicketGroupMutation(command, current);
        }
        if (
          command.type === "CALL_NEXT" ||
          command.type === "MARK_IN_FLIGHT" ||
          command.type === "MARK_LANDED" ||
          command.type === "MARK_COMPLETED"
        ) {
          if (command.type === "CALL_NEXT" && current.emergency_mode === 1) {
            return json(
              {
                error: {
                  code: "CALL_BLOCKED_EMERGENCY",
                  message: "Neue Aufrufe sind im Notfallmodus gesperrt.",
                },
              },
              { status: 409 },
            );
          }
          return this.handleRotationTransition(command, current);
        }
        return json(
          { error: { code: "COMMAND_NOT_IMPLEMENTED", message: "Kommando nicht implementiert." } },
          { status: 501 },
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
    if (command.type === "CALL_NEXT") {
      const candidate = await this.env.DB.prepare(
        `SELECT a.id, a.passenger_seats, a.operational_state, COUNT(rt.ticket_id) AS ticket_count
           FROM rotations r
           JOIN flight_groups fg ON fg.id = r.flight_group_id
           JOIN resource_group_memberships membership
             ON membership.resource_group_id = fg.resource_group_id
            AND membership.operation_day_id = r.operation_day_id
            AND membership.active_until IS NULL
           JOIN aircraft a ON a.id = membership.aircraft_id
           LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
          WHERE r.id = ?1 AND a.id = ?2
          GROUP BY a.id`,
      )
        .bind(rotation.id, command.payload.aircraftId)
        .first<{
          id: string;
          passenger_seats: number;
          operational_state: string;
          ticket_count: number;
        }>();
      if (candidate?.operational_state !== "AVAILABLE") {
        return json(
          { error: { code: "AIRCRAFT_NOT_AVAILABLE", message: "Flugzeug ist nicht verfügbar." } },
          { status: 409 },
        );
      }
      if (candidate.ticket_count > candidate.passenger_seats) {
        return json(
          {
            error: {
              code: "AIRCRAFT_CAPACITY_EXCEEDED",
              message: "Flugzeugkapazität reicht nicht aus.",
            },
          },
          { status: 409 },
        );
      }
    }
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
    const selectedAircraftId =
      command.type === "CALL_NEXT" ? command.payload.aircraftId : rotation.aircraft_id;
    if (!selectedAircraftId) {
      return json(
        { error: { code: "AIRCRAFT_ASSIGNMENT_REQUIRED", message: "Flugzeugzuordnung fehlt." } },
        { status: 409 },
      );
    }
    const aircraftState = {
      CALL_NEXT: "BOARDING",
      MARK_IN_FLIGHT: "IN_FLIGHT",
      MARK_LANDED: "LANDED",
      MARK_COMPLETED: "AVAILABLE",
    } as const;
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE rotations SET status = ?1, ${timestampColumn[command.type]} = ?2, aircraft_id = ?3,
                version = version + 1, updated_at = ?2 WHERE id = ?4 AND version = ?5`,
      ).bind(nextState, now, selectedAircraftId, rotation.id, rotation.version),
      this.env.DB.prepare(
        "UPDATE aircraft SET operational_state = ?1, updated_at = ?2 WHERE id = ?3",
      ).bind(aircraftState[command.type], now, selectedAircraftId),
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

  private async handleTicketGroupMutation(
    command: Extract<
      CommandEnvelope,
      {
        type: "CANCEL_TICKET_GROUP" | "REBOOK_TICKET_GROUP" | "DEFER_TICKET_GROUP" | "MARK_NO_SHOW";
      }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    const group = await this.env.DB.prepare(
      `SELECT tg.id, tg.product_id, tg.version, r.id AS rotation_id, r.status AS rotation_status,
              r.aircraft_id, fg.resource_group_id
         FROM ticket_groups tg
         JOIN tickets t ON t.ticket_group_id = tg.id
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
         JOIN flight_groups fg ON fg.id = r.flight_group_id
        WHERE tg.id = ?1 AND tg.operation_day_id = ?2
        LIMIT 1`,
    )
      .bind(command.payload.ticketGroupId, command.eventId)
      .first<{
        id: string;
        product_id: string;
        version: number;
        rotation_id: string;
        rotation_status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        aircraft_id: string | null;
        resource_group_id: string;
      }>();
    if (!group) {
      return json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Ticketgruppe nicht gefunden." } },
        { status: 404 },
      );
    }
    try {
      assertQueueMutationAllowed({
        rotationState: group.rotation_status,
        action:
          command.type === "CANCEL_TICKET_GROUP"
            ? "CANCEL"
            : command.type === "REBOOK_TICKET_GROUP"
              ? "REBOOK"
              : command.type === "MARK_NO_SHOW"
                ? "NO_SHOW"
                : "DEFER",
      });
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }

    let targetProductId = group.product_id;
    let targetResourceGroupId = group.resource_group_id;
    if (command.type === "REBOOK_TICKET_GROUP") {
      const target = await this.env.DB.prepare(
        "SELECT id, resource_group_id FROM products WHERE id = ?1 AND operation_day_id = ?2 AND sale_enabled = 1",
      )
        .bind(command.payload.newProductId, command.eventId)
        .first<{ id: string; resource_group_id: string }>();
      if (!target) {
        return json(
          {
            error: {
              code: "TARGET_PRODUCT_NOT_AVAILABLE",
              message: "Zielprodukt ist nicht verfügbar.",
            },
          },
          { status: 409 },
        );
      }
      targetProductId = target.id;
      targetResourceGroupId = target.resource_group_id;
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = {
      CANCEL_TICKET_GROUP: "TICKET_GROUP_CANCELED",
      REBOOK_TICKET_GROUP: "TICKET_GROUP_REBOOKED",
      DEFER_TICKET_GROUP: "TICKET_GROUP_DEFERRED",
      MARK_NO_SHOW: "TICKET_GROUP_NO_SHOW",
    } as const;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: eventType[command.type],
      aggregate: { type: "TICKET_GROUP", id: group.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        "UPDATE rotation_tickets SET released_at = ?1 WHERE rotation_id = ?2 AND released_at IS NULL",
      ).bind(now, group.rotation_id),
      this.env.DB.prepare(
        "UPDATE rotations SET status = 'CANCELED', version = version + 1, updated_at = ?1 WHERE id = ?2",
      ).bind(now, group.rotation_id),
    ];
    if (group.aircraft_id) {
      statements.push(
        this.env.DB.prepare(
          "UPDATE aircraft SET operational_state = 'AVAILABLE', updated_at = ?1 WHERE id = ?2",
        ).bind(now, group.aircraft_id),
      );
    }

    if (command.type === "CANCEL_TICKET_GROUP" || command.type === "MARK_NO_SHOW") {
      const status = command.type === "CANCEL_TICKET_GROUP" ? "CANCELED" : "NO_SHOW";
      statements.push(
        this.env.DB.prepare(
          "UPDATE ticket_groups SET status = ?1, version = version + 1 WHERE id = ?2 AND version = ?3",
        ).bind(status, group.id, group.version),
        this.env.DB.prepare("UPDATE tickets SET status = ?1 WHERE ticket_group_id = ?2").bind(
          status,
          group.id,
        ),
      );
    } else {
      const queue = await this.env.DB.prepare(
        "SELECT COALESCE(MAX(queue_sequence), 0) + 1 AS next_sequence FROM ticket_groups WHERE operation_day_id = ?1 AND product_id = ?2",
      )
        .bind(command.eventId, targetProductId)
        .first<{ next_sequence: number }>();
      const communication = await this.env.DB.prepare(
        "SELECT COALESCE(MAX(communication_number), 100) + 1 AS next_number FROM flight_groups WHERE operation_day_id = ?1 AND resource_group_id = ?2",
      )
        .bind(command.eventId, targetResourceGroupId)
        .first<{ next_number: number }>();
      const flightGroupId = crypto.randomUUID();
      const rotationId = crypto.randomUUID();
      statements.push(
        this.env.DB.prepare(
          `UPDATE ticket_groups SET product_id = ?1, queue_sequence = ?2, status = 'QUEUED',
                  version = version + 1 WHERE id = ?3 AND version = ?4`,
        ).bind(targetProductId, queue?.next_sequence ?? 1, group.id, group.version),
        this.env.DB.prepare("UPDATE tickets SET status = 'QUEUED' WHERE ticket_group_id = ?1").bind(
          group.id,
        ),
        this.env.DB.prepare(
          `INSERT INTO flight_groups
            (id, operation_day_id, resource_group_id, communication_number, status, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
        ).bind(
          flightGroupId,
          command.eventId,
          targetResourceGroupId,
          communication?.next_number ?? 101,
          now,
        ),
        this.env.DB.prepare(
          `INSERT INTO rotations (id, operation_day_id, flight_group_id, status, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'DRAFT', 0, ?4, ?4)`,
        ).bind(rotationId, command.eventId, flightGroupId, now),
        this.env.DB.prepare(
          `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
           SELECT ?1, id, ?2 FROM tickets WHERE ticket_group_id = ?3`,
        ).bind(rotationId, now, group.id),
      );
    }

    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type, aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'TICKET_GROUP', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType[command.type],
        now,
        command.deviceId,
        group.id,
        group.version + 1,
        JSON.stringify({ reason: command.payload.reason, targetProductId }),
      ),
      this.env.DB.prepare(
        `INSERT INTO idempotency_receipts (command_id, operation_day_id, device_id, command_type, received_at, response_json)
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

  private async handleOperationalControl(
    command: Extract<
      CommandEnvelope,
      { type: "TRIGGER_EMERGENCY" | "CLEAR_EMERGENCY" | "SET_RESOURCE_GROUP_STATUS" }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    if (
      command.type === "CLEAR_EMERGENCY" &&
      !(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))
    ) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
    if (command.type === "SET_RESOURCE_GROUP_STATUS") {
      const exists = await this.env.DB.prepare(
        "SELECT id FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2",
      )
        .bind(command.payload.resourceGroupId, command.eventId)
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
    const eventType =
      command.type === "TRIGGER_EMERGENCY"
        ? "EMERGENCY_MODE_TRIGGERED"
        : command.type === "CLEAR_EMERGENCY"
          ? "EMERGENCY_MODE_CLEARED"
          : "RESOURCE_GROUP_STATUS_CHANGED";
    const emergencyMode =
      command.type === "TRIGGER_EMERGENCY"
        ? 1
        : command.type === "CLEAR_EMERGENCY"
          ? 0
          : current.emergency_mode;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        emergency_mode: emergencyMode,
        version: nextVersion,
        updated_at: now,
      }),
      eventType,
      aggregate: { type: "OPERATION_DAY", id: command.eventId },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET emergency_mode = ?1, version = ?2, updated_at = ?3 WHERE id = ?4 AND version = ?5",
      ).bind(emergencyMode, nextVersion, now, command.eventId, current.version),
    ];

    if (command.type === "SET_RESOURCE_GROUP_STATUS") {
      statements.push(
        this.env.DB.prepare(
          "UPDATE resource_groups SET status = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
        ).bind(command.payload.status, now, command.payload.resourceGroupId),
      );
      if (command.payload.status === "ACTIVE") {
        statements.push(
          this.env.DB.prepare(
            `UPDATE operational_blocks SET status = 'CLEARED', cleared_at = ?1
              WHERE operation_day_id = ?2 AND scope_type = 'RESOURCE_GROUP' AND scope_id = ?3 AND status = 'ACTIVE'`,
          ).bind(now, command.eventId, command.payload.resourceGroupId),
        );
      } else {
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO operational_blocks
              (id, operation_day_id, scope_type, scope_id, block_type, status, reason,
               started_at, expected_review_at, device_id)
             VALUES (?1, ?2, 'RESOURCE_GROUP', ?3, ?4, 'ACTIVE', ?5, ?6, ?7, ?8)`,
          ).bind(
            crypto.randomUUID(),
            command.eventId,
            command.payload.resourceGroupId,
            command.payload.status === "PAUSED" ? "PAUSE" : "INTERRUPTION",
            command.payload.reason,
            now,
            command.payload.expectedReviewAt,
            command.deviceId,
          ),
        );
      }
    }

    const reason = command.payload.reason;
    const payload =
      command.type === "SET_RESOURCE_GROUP_STATUS"
        ? {
            reason,
            resourceGroupId: command.payload.resourceGroupId,
            status: command.payload.status,
            expectedReviewAt: command.payload.expectedReviewAt,
          }
        : { reason };
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'OPERATION_DAY', ?2, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
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

  private async handleRevokeCall(
    command: Extract<CommandEnvelope, { type: "REVOKE_CALL" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      "SELECT id, status, version, aircraft_id, called_at FROM rotations WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: string;
        version: number;
        aircraft_id: string | null;
        called_at: string | null;
      }>();
    if (rotation?.status !== "CALLED" || !rotation.called_at) {
      return json(
        {
          error: {
            code: "CALL_NOT_REVERSIBLE",
            message: "Aufruf kann nicht zurückgenommen werden.",
          },
        },
        { status: 409 },
      );
    }
    if (Date.now() - Date.parse(rotation.called_at) > 10_000) {
      return json(
        { error: { code: "UNDO_WINDOW_EXPIRED", message: "Zehn-Sekunden-Frist ist abgelaufen." } },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "CALL_REVOKED",
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE rotations SET status = 'DRAFT', aircraft_id = NULL, call_revoked_at = ?1,
                version = version + 1, updated_at = ?1 WHERE id = ?2 AND version = ?3`,
      ).bind(now, rotation.id, rotation.version),
    ];
    if (rotation.aircraft_id) {
      statements.push(
        this.env.DB.prepare(
          "UPDATE aircraft SET operational_state = 'AVAILABLE', updated_at = ?1 WHERE id = ?2",
        ).bind(now, rotation.aircraft_id),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'CALL_REVOKED', ?3, ?4, 'ROTATION', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({ corrects: "FLIGHT_GROUP_CALLED", calledAt: rotation.called_at }),
      ),
      this.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         VALUES (?1, ?2, ?3, 'REVOKE_CALL', ?4, ?5)`,
      ).bind(command.commandId, command.eventId, command.deviceId, now, JSON.stringify(result)),
      this.env.DB.prepare(
        "INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at) VALUES (?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4)",
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(result), now),
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }
}
