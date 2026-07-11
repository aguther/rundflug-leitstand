import { DurableObject } from "cloudflare:workers";
import {
  type CommandEnvelope,
  type CommandResult,
  commandEnvelopeSchema,
  commandResultSchema,
} from "@rundflug/contracts";
import {
  type AircraftOperationalState,
  assertPublicTicketCode,
  assertQueueMutationAllowed,
  assertRoleMayExecute,
  assertSaleAllowed,
  assessRemainingCapacity,
  type DeviceRole,
  DomainRuleError,
  type OperationalCommandType,
  transitionAircraft,
  transitionRotation,
} from "@rundflug/domain";
import { sha256Hex, verifyCredential } from "./crypto";
import { rowToSnapshot, safeErrorMessage } from "./snapshot";
import type { Env, StoredEventRow } from "./types";
import { sendRotationPushNotifications } from "./web-push";

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
      await this.env.DB.prepare("UPDATE paired_devices SET last_seen_at = ?1 WHERE id = ?2")
        .bind(new Date().toISOString(), command.deviceId)
        .run();

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
        `SELECT id, name, event_date, time_zone, status, emergency_mode, operational_interrupted, version,
                operational_note, operations_end_at, updated_at
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
                  p.reference_duration_minutes, p.capacity_warning_threshold,
                  p.capacity_critical_threshold, rg.status AS resource_group_status
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
            reference_duration_minutes: number;
            capacity_warning_threshold: number;
            capacity_critical_threshold: number;
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
            eventInterrupted: current.operational_interrupted === 1,
            saleClosingReached:
              product.sale_closes_at !== null && Date.parse(product.sale_closes_at) <= Date.now(),
          });
        } catch (reason: unknown) {
          if (reason instanceof DomainRuleError) {
            return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
          }
          throw reason;
        }
        const [aircraftRows, openTicketRow, pilotCountRow] = await Promise.all([
          this.env.DB.prepare(
            `SELECT a.passenger_seats, a.refuel_planned FROM aircraft a
               JOIN resource_group_memberships m ON m.aircraft_id = a.id
              WHERE m.operation_day_id = ?1 AND m.resource_group_id = ?2 AND m.active_until IS NULL
                AND a.operational_state NOT IN ('INACTIVE', 'PAUSED', 'REFUELING')`,
          )
            .bind(command.eventId, product.resource_group_id)
            .all<{ passenger_seats: number; refuel_planned: number }>(),
          this.env.DB.prepare(
            `SELECT COUNT(*) AS open_tickets FROM tickets t
               JOIN ticket_groups tg ON tg.id = t.ticket_group_id
               JOIN products p ON p.id = tg.product_id
              WHERE p.resource_group_id = ?1 AND t.status = 'QUEUED'`,
          )
            .bind(product.resource_group_id)
            .first<{ open_tickets: number }>(),
          this.env.DB.prepare(
            "SELECT COUNT(*) AS count FROM pilots WHERE operation_day_id = ?1 AND active = 1 AND paused = 0",
          )
            .bind(command.eventId)
            .first<{ count: number }>(),
        ]);
        if (!current.operations_end_at) {
          return json(
            {
              error: {
                code: "OPERATING_END_REQUIRED",
                message: "Betriebsende muss vor dem Verkauf konfiguriert sein.",
              },
            },
            { status: 409 },
          );
        }
        const capacity = assessRemainingCapacity({
          remainingOperatingMinutes: Math.max(
            0,
            (Date.parse(current.operations_end_at) - Date.now()) / 60_000,
          ),
          expectedRotationMinutes: product.reference_duration_minutes,
          activeAircraftSeats: aircraftRows.results
            .map((row) => row.passenger_seats)
            .slice(0, pilotCountRow?.count ?? 0),
          reservedSeats: aircraftRows.results
            .filter((row) => row.refuel_planned === 1)
            .reduce((sum, row) => sum + row.passenger_seats, 0),
          openTickets: openTicketRow?.open_tickets ?? 0,
          predictionQuality: "CHANGING",
          warningThreshold: product.capacity_warning_threshold,
          criticalThreshold: product.capacity_critical_threshold,
        });
        if (
          !capacity.saleRecommended ||
          capacity.remainingSellableSeats < command.payload.publicTicketCodes.length
        ) {
          return json(
            {
              error: {
                code: "SALE_BLOCKED_CAPACITY",
                message: "Verbleibende Kapazität reicht für diesen Verkauf nicht sicher aus.",
              },
            },
            { status: 409 },
          );
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
          command.type === "SET_AIRCRAFT_OPERATIONAL_STATE" ||
          command.type === "SCHEDULE_AIRCRAFT_REFUEL" ||
          command.type === "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD" ||
          command.type === "SET_PILOT_PAUSE" ||
          command.type === "UPSERT_PILOT"
        ) {
          return this.handleFleetAdministration(command, current);
        }
        if (command.type === "PAIR_DEVICE" || command.type === "REVOKE_DEVICE") {
          return this.handleDeviceAdministration(command, current);
        }
        if (command.type === "CONFIGURE_PRODUCT_SALES") {
          return this.handleProductSalesConfiguration(command, current);
        }
        if (
          command.type === "TRIGGER_EMERGENCY" ||
          command.type === "CLEAR_EMERGENCY" ||
          command.type === "SET_EVENT_INTERRUPTION" ||
          command.type === "SET_RESOURCE_GROUP_STATUS" ||
          command.type === "SET_RESOURCE_GROUP_NOTICE"
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
          if (command.type === "CALL_NEXT" && current.operational_interrupted === 1) {
            return json(
              {
                error: {
                  code: "CALL_BLOCKED_INTERRUPTION",
                  message: "Neue Aufrufe sind während der Betriebsunterbrechung gesperrt.",
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

  private async handleFleetAdministration(
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
    if (
      (command.type === "UPSERT_PILOT" || command.type === "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD") &&
      !(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))
    ) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
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

    if (command.type === "UPSERT_PILOT" || command.type === "SET_PILOT_PAUSE") {
      if (command.type === "SET_PILOT_PAUSE") {
        const pilot = await this.env.DB.prepare(
          "SELECT id, operational_code, active, paused FROM pilots WHERE id = ?1 AND operation_day_id = ?2",
        )
          .bind(command.payload.pilotId, command.eventId)
          .first<{ id: string; operational_code: string; active: number; paused: number }>();
        if (!pilot) {
          return json(
            { error: { code: "PILOT_NOT_FOUND", message: "Pilotencode nicht gefunden." } },
            { status: 404 },
          );
        }
        if (command.payload.paused) {
          const activeRotation = await this.env.DB.prepare(
            `SELECT id FROM rotations WHERE operation_day_id = ?1 AND pilot_id = ?2
              AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED') LIMIT 1`,
          )
            .bind(command.eventId, pilot.id)
            .first<{ id: string }>();
          if (activeRotation) {
            return json(
              {
                error: {
                  code: "PILOT_ASSIGNED_ACTIVE_ROTATION",
                  message: "Pilotencode ist noch an einen aktiven Umlauf gebunden.",
                },
              },
              { status: 409 },
            );
          }
        }
        statements.push(
          this.env.DB.prepare(
            `UPDATE pilots SET paused = ?1, pause_expected_review_at = ?2, updated_at = ?3
              WHERE id = ?4 AND operation_day_id = ?5`,
          ).bind(
            command.payload.paused ? 1 : 0,
            command.payload.paused ? command.payload.expectedReviewAt : null,
            now,
            pilot.id,
            command.eventId,
          ),
        );
        aggregateType = "PILOT";
        aggregateId = pilot.id;
        eventType = command.payload.paused ? "PILOT_PAUSE_STARTED" : "PILOT_PAUSE_ENDED";
        auditPayload = {
          operationalCode: pilot.operational_code,
          paused: command.payload.paused,
          reason: command.payload.reason,
          expectedReviewAt: command.payload.expectedReviewAt,
        };
      } else {
        const duplicateCode = await this.env.DB.prepare(
          "SELECT id FROM pilots WHERE operation_day_id = ?1 AND operational_code = ?2 AND id <> ?3",
        )
          .bind(command.eventId, command.payload.operationalCode, command.payload.pilotId)
          .first<{ id: string }>();
        if (duplicateCode) {
          return json(
            {
              error: {
                code: "PILOT_CODE_EXISTS",
                message: "Operatives Pilotenkürzel ist vergeben.",
              },
            },
            { status: 409 },
          );
        }
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO pilots (id, operation_day_id, operational_code, active, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT(id) DO UPDATE SET operational_code = excluded.operational_code,
             active = excluded.active, updated_at = excluded.updated_at`,
          ).bind(
            command.payload.pilotId,
            command.eventId,
            command.payload.operationalCode,
            command.payload.active ? 1 : 0,
            now,
          ),
        );
        aggregateType = "PILOT";
        aggregateId = command.payload.pilotId;
        eventType = "PILOT_CONFIGURATION_CHANGED";
        auditPayload = {
          operationalCode: command.payload.operationalCode,
          active: command.payload.active,
          reason: command.payload.reason,
        };
      }
    } else {
      const aircraft = await this.env.DB.prepare(
        `SELECT id, operational_state, rotations_since_refuel, refuel_planned, operational_interrupted
           FROM aircraft WHERE id = ?1 AND EXISTS
             (SELECT 1 FROM resource_group_memberships m
               WHERE m.aircraft_id = aircraft.id AND m.operation_day_id = ?2)`,
      )
        .bind(command.payload.aircraftId, command.eventId)
        .first<{
          id: string;
          operational_state: AircraftOperationalState;
          rotations_since_refuel: number;
          refuel_planned: number;
          operational_interrupted: number;
        }>();
      if (!aircraft) {
        return json(
          { error: { code: "AIRCRAFT_NOT_FOUND", message: "Flugzeug nicht gefunden." } },
          { status: 404 },
        );
      }
      aggregateType = "AIRCRAFT";
      aggregateId = aircraft.id;
      if (command.type === "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD") {
        statements.push(
          this.env.DB.prepare(
            "UPDATE aircraft SET refuel_reminder_threshold = ?1, updated_at = ?2 WHERE id = ?3",
          ).bind(command.payload.reminderThreshold, now, aircraft.id),
        );
        eventType = "AIRCRAFT_REFUEL_THRESHOLD_CONFIGURED";
        auditPayload = {
          reminderThreshold: command.payload.reminderThreshold,
          reason: command.payload.reason,
          informationalOnly: true,
        };
      } else if (command.type === "SCHEDULE_AIRCRAFT_REFUEL") {
        statements.push(
          this.env.DB.prepare(
            "UPDATE aircraft SET refuel_planned = ?1, updated_at = ?2 WHERE id = ?3",
          ).bind(command.payload.planned ? 1 : 0, now, aircraft.id),
        );
        eventType = command.payload.planned
          ? "AIRCRAFT_REFUEL_PLANNED"
          : "AIRCRAFT_REFUEL_PLAN_CLEARED";
        auditPayload = { planned: command.payload.planned, reason: command.payload.reason };
      } else {
        if (
          !(["AVAILABLE", "REFUELING", "PAUSED", "INACTIVE"] as const).includes(
            aircraft.operational_state as "AVAILABLE" | "REFUELING" | "PAUSED" | "INACTIVE",
          )
        ) {
          return json(
            {
              error: {
                code: "AIRCRAFT_LIFECYCLE_ACTIVE",
                message:
                  "Der operative Umlaufzustand darf nicht über die Flottensteuerung geändert werden.",
              },
            },
            { status: 409 },
          );
        }
        let nextState: AircraftOperationalState;
        try {
          nextState = transitionAircraft(
            aircraft.operational_state,
            command.payload.state === "INTERRUPTED" ? "INACTIVE" : command.payload.state,
          );
        } catch (reason: unknown) {
          if (reason instanceof DomainRuleError) {
            return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
          }
          throw reason;
        }
        const resetCounter =
          aircraft.operational_state === "REFUELING" && nextState === "AVAILABLE"
            ? 0
            : aircraft.rotations_since_refuel;
        statements.push(
          this.env.DB.prepare(
            `UPDATE aircraft SET operational_state = ?1, rotations_since_refuel = ?2,
                    refuel_planned = CASE WHEN ?1 = 'REFUELING' THEN 0 ELSE refuel_planned END,
                    operational_interrupted = ?3, updated_at = ?4 WHERE id = ?5`,
          ).bind(
            nextState,
            resetCounter,
            command.payload.state === "INTERRUPTED" ? 1 : 0,
            now,
            aircraft.id,
          ),
        );
        if (nextState === "AVAILABLE") {
          statements.push(
            this.env.DB.prepare(
              `UPDATE operational_blocks SET status = 'CLEARED', cleared_at = ?1
                WHERE operation_day_id = ?2 AND scope_type = 'AIRCRAFT' AND scope_id = ?3
                  AND status = 'ACTIVE'`,
            ).bind(now, command.eventId, aircraft.id),
          );
        } else {
          const blockType =
            nextState === "REFUELING"
              ? "REFUELING"
              : nextState === "PAUSED"
                ? "PAUSE"
                : "INTERRUPTION";
          statements.push(
            this.env.DB.prepare(
              `INSERT INTO operational_blocks
                (id, operation_day_id, scope_type, scope_id, block_type, status, reason,
                 started_at, expected_review_at, device_id)
               VALUES (?1, ?2, 'AIRCRAFT', ?3, ?4, 'ACTIVE', ?5, ?6, ?7, ?8)`,
            ).bind(
              crypto.randomUUID(),
              command.eventId,
              aircraft.id,
              blockType,
              command.payload.reason,
              now,
              command.payload.expectedReviewAt,
              command.deviceId,
            ),
          );
        }
        eventType = "AIRCRAFT_OPERATIONAL_STATE_CHANGED";
        auditPayload = {
          from: aircraft.operational_state,
          to: command.payload.state,
          reason: command.payload.reason,
          expectedReviewAt: command.payload.expectedReviewAt,
          informationalOnly: true,
        };
      }
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

  private async handleProductSalesConfiguration(
    command: Extract<CommandEnvelope, { type: "CONFIGURE_PRODUCT_SALES" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    if (!(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
    if (command.payload.criticalThreshold > command.payload.warningThreshold) {
      return json(
        {
          error: {
            code: "CAPACITY_THRESHOLDS_INVALID",
            message: "Die kritische Schwelle darf die Warnschwelle nicht überschreiten.",
          },
        },
        { status: 400 },
      );
    }
    const product = await this.env.DB.prepare(
      "SELECT id FROM products WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.productId, command.eventId)
      .first<{ id: string }>();
    if (!product) {
      return json(
        { error: { code: "PRODUCT_NOT_FOUND", message: "Produkt nicht gefunden." } },
        { status: 404 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "PRODUCT_SALES_CONFIGURED",
      aggregate: { type: "PRODUCT", id: product.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE products SET sale_enabled = ?1, sale_closes_at = ?2,
                capacity_warning_threshold = ?3, capacity_critical_threshold = ?4, updated_at = ?5
          WHERE id = ?6 AND operation_day_id = ?7`,
      ).bind(
        command.payload.saleEnabled ? 1 : 0,
        command.payload.saleClosesAt,
        command.payload.warningThreshold,
        command.payload.criticalThreshold,
        now,
        product.id,
        command.eventId,
      ),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'PRODUCT_SALES_CONFIGURED', ?3, ?4, 'PRODUCT', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        product.id,
        nextVersion,
        JSON.stringify({
          saleEnabled: command.payload.saleEnabled,
          saleClosesAt: command.payload.saleClosesAt,
          warningThreshold: command.payload.warningThreshold,
          criticalThreshold: command.payload.criticalThreshold,
          reason: command.payload.reason,
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

  private async handleDeviceAdministration(
    command: Extract<CommandEnvelope, { type: "PAIR_DEVICE" | "REVOKE_DEVICE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    if (!(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
    const targetId = command.payload.pairedDeviceId;
    if (command.type === "REVOKE_DEVICE") {
      const target = await this.env.DB.prepare(
        "SELECT id, role, active FROM paired_devices WHERE id = ?1 AND operation_day_id = ?2",
      )
        .bind(targetId, command.eventId)
        .first<{ id: string; role: DeviceRole; active: number }>();
      if (!target) {
        return json(
          { error: { code: "DEVICE_NOT_FOUND", message: "Gerät nicht gefunden." } },
          { status: 404 },
        );
      }
      if (target.role === "ADMIN" && target.active === 1) {
        const admins = await this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM paired_devices WHERE operation_day_id = ?1 AND role = 'ADMIN' AND active = 1",
        )
          .bind(command.eventId)
          .first<{ count: number }>();
        if ((admins?.count ?? 0) <= 1) {
          return json(
            {
              error: {
                code: "LAST_ADMIN_DEVICE",
                message: "Das letzte aktive Administrationsgerät kann nicht widerrufen werden.",
              },
            },
            { status: 409 },
          );
        }
      }
    } else {
      const existing = await this.env.DB.prepare("SELECT id FROM paired_devices WHERE id = ?1")
        .bind(targetId)
        .first<{ id: string }>();
      if (existing) {
        return json(
          { error: { code: "DEVICE_ID_EXISTS", message: "Geräte-ID ist bereits vergeben." } },
          { status: 409 },
        );
      }
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = command.type === "PAIR_DEVICE" ? "DEVICE_PAIRED" : "DEVICE_REVOKED";
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: "DEVICE", id: targetId },
    };
    const deviceMutation =
      command.type === "PAIR_DEVICE"
        ? this.env.DB.prepare(
            `INSERT INTO paired_devices
              (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, '1970-01-01T00:00:00.000Z', ?6)`,
          ).bind(
            targetId,
            command.eventId,
            command.payload.label,
            command.payload.role,
            now,
            command.payload.credentialHash,
          )
        : this.env.DB.prepare(
            `UPDATE paired_devices SET active = 0, revoked_at = ?1, credential_hash = NULL
              WHERE id = ?2 AND operation_day_id = ?3`,
          ).bind(now, targetId, command.eventId);
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      deviceMutation,
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'DEVICE', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        targetId,
        nextVersion,
        JSON.stringify(
          command.type === "PAIR_DEVICE"
            ? { label: command.payload.label, role: command.payload.role }
            : { reason: command.payload.reason },
        ),
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

  private async handleRotationTransition(
    command: Extract<
      CommandEnvelope,
      { type: "CALL_NEXT" | "MARK_IN_FLIGHT" | "MARK_LANDED" | "MARK_COMPLETED" }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      "SELECT id, status, version, aircraft_id, pilot_id FROM rotations WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        version: number;
        aircraft_id: string | null;
        pilot_id: string | null;
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
      const pilot = await this.env.DB.prepare(
        `SELECT p.id FROM pilots p
          WHERE p.id = ?1 AND p.operation_day_id = ?2 AND p.active = 1 AND p.paused = 0
            AND NOT EXISTS (
              SELECT 1 FROM rotations active_rotation
               WHERE active_rotation.operation_day_id = p.operation_day_id
                 AND active_rotation.pilot_id = p.id
                 AND active_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
            )`,
      )
        .bind(command.payload.pilotId, command.eventId)
        .first<{ id: string }>();
      if (!pilot) {
        return json(
          {
            error: {
              code: "PILOT_NOT_AVAILABLE",
              message: "Pilotencode ist nicht aktiv verfügbar.",
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
    const selectedPilotId =
      command.type === "CALL_NEXT" ? command.payload.pilotId : rotation.pilot_id;
    if (!selectedPilotId) {
      return json(
        { error: { code: "PILOT_ASSIGNMENT_REQUIRED", message: "Pilotenzuordnung fehlt." } },
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
                pilot_id = ?4, version = version + 1, updated_at = ?2
          WHERE id = ?5 AND version = ?6`,
      ).bind(nextState, now, selectedAircraftId, selectedPilotId, rotation.id, rotation.version),
      this.env.DB.prepare(
        `UPDATE aircraft SET operational_state = ?1, updated_at = ?2,
                rotations_since_refuel = rotations_since_refuel + ?4 WHERE id = ?3`,
      ).bind(
        aircraftState[command.type],
        now,
        selectedAircraftId,
        command.type === "MARK_COMPLETED" ? 1 : 0,
      ),
      this.env.DB.prepare(
        `UPDATE tickets SET status = ?1
          WHERE id IN (
            SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?2 AND released_at IS NULL
          )`,
      ).bind(nextState, rotation.id),
      this.env.DB.prepare(`INSERT INTO operational_events (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type, aggregate_id, aggregate_version, payload_json)
        VALUES (?1, ?2, ?3, ?4, ?5, 'ROTATION', ?6, ?7, ?8)`).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType[command.type],
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({
          from: rotation.status,
          to: nextState,
          aircraftId: selectedAircraftId,
          pilotId: selectedPilotId,
        }),
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
    this.ctx.waitUntil(
      sendRotationPushNotifications(this.env, rotation.id, eventType[command.type]),
    );
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
    if (
      (command.type === "CANCEL_TICKET_GROUP" || command.type === "REBOOK_TICKET_GROUP") &&
      !(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))
    ) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
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
    let targetPriceCents: number | null = null;
    if (command.type === "REBOOK_TICKET_GROUP") {
      const target = await this.env.DB.prepare(
        "SELECT id, resource_group_id, price_cents FROM products WHERE id = ?1 AND operation_day_id = ?2 AND sale_enabled = 1",
      )
        .bind(command.payload.newProductId, command.eventId)
        .first<{ id: string; resource_group_id: string; price_cents: number }>();
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
      targetPriceCents = target.price_cents;
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
        targetPriceCents === null
          ? this.env.DB.prepare(
              "UPDATE tickets SET status = 'QUEUED' WHERE ticket_group_id = ?1",
            ).bind(group.id)
          : this.env.DB.prepare(
              "UPDATE tickets SET status = 'QUEUED', price_cents = ?1 WHERE ticket_group_id = ?2",
            ).bind(targetPriceCents, group.id),
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
      {
        type:
          | "TRIGGER_EMERGENCY"
          | "CLEAR_EMERGENCY"
          | "SET_EVENT_INTERRUPTION"
          | "SET_RESOURCE_GROUP_STATUS"
          | "SET_RESOURCE_GROUP_NOTICE";
      }
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
    if (
      command.type === "SET_RESOURCE_GROUP_STATUS" ||
      command.type === "SET_RESOURCE_GROUP_NOTICE"
    ) {
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
          : command.type === "SET_EVENT_INTERRUPTION"
            ? command.payload.interrupted
              ? "EVENT_OPERATION_INTERRUPTED"
              : "EVENT_OPERATION_RESUMED"
            : command.type === "SET_RESOURCE_GROUP_STATUS"
              ? "RESOURCE_GROUP_STATUS_CHANGED"
              : "RESOURCE_GROUP_NOTICE_SET";
    const emergencyMode =
      command.type === "TRIGGER_EMERGENCY"
        ? 1
        : command.type === "CLEAR_EMERGENCY"
          ? 0
          : current.emergency_mode;
    const operationalInterrupted =
      command.type === "SET_EVENT_INTERRUPTION"
        ? command.payload.interrupted
          ? 1
          : 0
        : (current.operational_interrupted ?? 0);
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
      aggregate:
        command.type === "SET_RESOURCE_GROUP_STATUS" || command.type === "SET_RESOURCE_GROUP_NOTICE"
          ? { type: "RESOURCE_GROUP", id: command.payload.resourceGroupId }
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
      if (command.payload.interrupted) {
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO operational_blocks
              (id, operation_day_id, scope_type, scope_id, block_type, status, reason,
               started_at, expected_review_at, device_id)
             VALUES (?1, ?2, 'EVENT', ?2, 'INTERRUPTION', 'ACTIVE', ?3, ?4, ?5, ?6)`,
          ).bind(
            crypto.randomUUID(),
            command.eventId,
            command.payload.reason,
            now,
            command.payload.expectedReviewAt,
            command.deviceId,
          ),
        );
      } else {
        statements.push(
          this.env.DB.prepare(
            `UPDATE operational_blocks SET status = 'CLEARED', cleared_at = ?1
              WHERE operation_day_id = ?2 AND scope_type = 'EVENT' AND scope_id = ?2
                AND status = 'ACTIVE'`,
          ).bind(now, command.eventId),
        );
      }
    }

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

    if (command.type === "SET_RESOURCE_GROUP_NOTICE") {
      statements.push(
        this.env.DB.prepare(
          "UPDATE resource_groups SET operational_note = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
        ).bind(command.payload.note, now, command.payload.resourceGroupId),
      );
    }

    const reason =
      command.type === "SET_RESOURCE_GROUP_NOTICE" ? command.payload.note : command.payload.reason;
    const payload =
      command.type === "SET_RESOURCE_GROUP_STATUS"
        ? {
            reason,
            resourceGroupId: command.payload.resourceGroupId,
            status: command.payload.status,
            expectedReviewAt: command.payload.expectedReviewAt,
          }
        : command.type === "SET_RESOURCE_GROUP_NOTICE"
          ? {
              note: command.payload.note,
              resourceGroupId: command.payload.resourceGroupId,
              informationalOnly: true,
            }
          : command.type === "SET_EVENT_INTERRUPTION"
            ? {
                reason,
                interrupted: command.payload.interrupted,
                expectedReviewAt: command.payload.expectedReviewAt,
                informationalOnly: true,
              }
            : { reason };
    const aggregateType =
      command.type === "SET_RESOURCE_GROUP_STATUS" || command.type === "SET_RESOURCE_GROUP_NOTICE"
        ? "RESOURCE_GROUP"
        : "OPERATION_DAY";
    const aggregateId =
      command.type === "SET_RESOURCE_GROUP_STATUS" || command.type === "SET_RESOURCE_GROUP_NOTICE"
        ? command.payload.resourceGroupId
        : command.eventId;
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
        `UPDATE rotations SET status = 'DRAFT', aircraft_id = NULL, pilot_id = NULL, call_revoked_at = ?1,
                version = version + 1, updated_at = ?1 WHERE id = ?2 AND version = ?3`,
      ).bind(now, rotation.id, rotation.version),
      this.env.DB.prepare(
        `UPDATE tickets SET status = 'QUEUED'
          WHERE id IN (
            SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?1 AND released_at IS NULL
          )`,
      ).bind(rotation.id),
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
