import { DurableObject } from "cloudflare:workers";
import {
  type CommandEnvelope,
  type CommandResult,
  commandEnvelopeSchema,
  commandResultSchema,
  storedOutageCallPayloadSchema,
  storedOutagePaperSalePayloadSchema,
  storedOutageTransitionPayloadSchema,
} from "@rundflug/contracts";
import {
  type AircraftOperationalState,
  advanceOverduePrediction,
  assertManualGroupMoveAllowed,
  assertMayStageOutageRecoveryEntry,
  assertOutageRecoveryApplication,
  assertOutageRecoveryApproval,
  assertPublicTicketCode,
  assertQueueMutationAllowed,
  assertRoleMayExecute,
  assertSaleAllowed,
  assessRemainingCapacity,
  type DeviceRole,
  DomainRuleError,
  estimateDuration,
  forecastQueueWindows,
  type OperationalCommandType,
  planBookingGroupSplit,
  planRotationCapacityReduction,
  simulateOutageRecovery,
  transitionAircraft,
  transitionRotation,
} from "@rundflug/domain";
import { sha256Hex, verifyCredential } from "./crypto";
import { rowToSnapshot, safeErrorMessage } from "./snapshot";
import type { Env, StoredEventRow } from "./types";
import { queueEligiblePreparationNotifications, sendRotationPushNotifications } from "./web-push";

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
    if (request.method === "POST" && url.pathname.endsWith("/factory-reset")) {
      for (const socket of this.ctx.getWebSockets()) {
        socket.close(1012, "System wird neu eingerichtet");
      }
      await this.ctx.storage.deleteAll();
      return json({ reset: true });
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
          if (command.type === "STAGE_OUTAGE_RECOVERY") {
            for (const entry of command.payload.entries) {
              assertMayStageOutageRecoveryEntry(device.role, entry.type);
            }
          }
        } catch (reason: unknown) {
          if (reason instanceof DomainRuleError) {
            return json({ error: { code: reason.code, message: reason.message } }, { status: 403 });
          }
          throw reason;
        }
      }

      const current = await this.env.DB.prepare(
        `SELECT id, name, event_date, aerodrome, time_zone, status, archived_at, template_source_id,
                emergency_mode, operational_interrupted, version,
                operational_note, operations_end_at, sale_opens_at, no_show_after_minutes,
                max_ticket_deferrals,
                notification_lead_minutes, child_reference_weight_kg, normal_reference_weight_kg,
                heavy_reference_weight_kg, planned_boarding_minutes, planned_deboarding_minutes,
                planned_buffer_minutes, updated_at
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
          `SELECT p.id, p.resource_group_id, p.gate_id, p.price_cents, p.sale_enabled, p.sale_closes_at,
                  p.reference_duration_minutes, p.weight_classes_json, p.capacity_warning_threshold,
                  p.capacity_critical_threshold, p.reference_capacity,
                  rg.status AS resource_group_status
             FROM products p
             JOIN resource_groups rg ON rg.id = p.resource_group_id
            WHERE p.id = ?1 AND p.operation_day_id = ?2`,
        )
          .bind(command.payload.productId, command.eventId)
          .first<{
            id: string;
            resource_group_id: string;
            gate_id: string;
            price_cents: number;
            sale_enabled: number;
            sale_closes_at: string | null;
            reference_duration_minutes: number;
            weight_classes_json: string;
            capacity_warning_threshold: number;
            capacity_critical_threshold: number;
            reference_capacity: number;
            resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
          }>();
        if (!product) {
          return json(
            { error: { code: "PRODUCT_NOT_FOUND", message: "Produkt nicht gefunden." } },
            { status: 404 },
          );
        }
        if (!product.gate_id) {
          return json(
            {
              error: {
                code: "PRODUCT_GATE_REQUIRED",
                message: "Für das Produkt muss vor dem Verkauf ein Gate konfiguriert sein.",
              },
            },
            { status: 409 },
          );
        }
        if (current.sale_opens_at && Date.parse(current.sale_opens_at) > Date.now()) {
          return json(
            {
              error: {
                code: "SALE_NOT_OPEN",
                message: "Der konfigurierte Verkaufsbeginn ist noch nicht erreicht.",
              },
            },
            { status: 409 },
          );
        }
        try {
          assertSaleAllowed({
            eventStatus: current.status,
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
          expectedRotationMinutes:
            product.reference_duration_minutes +
            (current.planned_boarding_minutes ?? 8) +
            (current.planned_deboarding_minutes ?? 5) +
            (current.planned_buffer_minutes ?? 3),
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

        let splitPlan: ReturnType<typeof planBookingGroupSplit>;
        try {
          splitPlan = planBookingGroupSplit({
            groupSize: command.payload.publicTicketCodes.length,
            referenceCapacity: product.reference_capacity,
            splitAcknowledged: command.payload.oversizeSplitAcknowledged,
          });
        } catch (reason: unknown) {
          if (!(reason instanceof DomainRuleError)) throw reason;
          return json(
            {
              error: {
                code: reason.code,
                message: reason.message,
                referenceCapacity: product.reference_capacity,
                groupSize: command.payload.publicTicketCodes.length,
                requiredFlightGroupCount: Math.ceil(
                  command.payload.publicTicketCodes.length / product.reference_capacity,
                ),
              },
            },
            { status: 409 },
          );
        }
        const requiredFlightGroupCount = splitPlan.slotSizes.length;

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
        const allowedWeightClasses = JSON.parse(product.weight_classes_json) as Array<
          "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
        >;
        const ticketDetails =
          command.payload.ticketDetails ??
          normalizedCodes.map(() => ({
            weightClass: "NOT_CAPTURED" as const,
            individualWeightKg: null,
          }));
        if (ticketDetails.length !== normalizedCodes.length) {
          return json(
            {
              error: {
                code: "TICKET_DETAILS_COUNT_MISMATCH",
                message: "Für jedes Ticket muss genau eine Gewichtsklasse angegeben werden.",
              },
            },
            { status: 409 },
          );
        }
        if (
          ticketDetails.some(
            (detail) =>
              !allowedWeightClasses.includes(detail.weightClass) ||
              (detail.weightClass === "INDIVIDUAL" && detail.individualWeightKg === null) ||
              (detail.weightClass !== "INDIVIDUAL" && detail.individualWeightKg !== null),
          )
        ) {
          return json(
            {
              error: {
                code: "WEIGHT_CLASS_NOT_ALLOWED",
                message: "Gewichtsklasse oder individuelle Kilogrammangabe ist nicht zulässig.",
              },
            },
            { status: 409 },
          );
        }
        const hashes = await Promise.all(normalizedCodes.map(sha256Hex));
        const queueRow = await this.env.DB.prepare(
          `SELECT COALESCE(MAX(tg.queue_sequence), 0) + 1 AS next_sequence
             FROM ticket_groups tg
             JOIN products p ON p.id = tg.product_id
            WHERE tg.operation_day_id = ?1 AND p.resource_group_id = ?2`,
        )
          .bind(command.eventId, product.resource_group_id)
          .first<{ next_sequence: number }>();
        const splitAcrossFlightGroups = requiredFlightGroupCount > 1;
        const openFlightGroup = splitAcrossFlightGroups
          ? null
          : await this.env.DB.prepare(
              `SELECT r.id AS rotation_id, fg.id AS flight_group_id
                 FROM rotations r
                 JOIN flight_groups fg ON fg.id = r.flight_group_id
                 JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
                 JOIN tickets t ON t.id = rt.ticket_id
                 JOIN ticket_groups tg ON tg.id = t.ticket_group_id
                WHERE r.operation_day_id = ?1 AND fg.resource_group_id = ?2
                  AND r.status = 'DRAFT' AND r.called_at IS NULL
                GROUP BY r.id, fg.id
               HAVING COUNT(DISTINCT tg.product_id) = 1 AND MIN(tg.product_id) = ?3
                  AND COUNT(rt.ticket_id) + ?4 <= ?5
                ORDER BY fg.communication_number
                LIMIT 1`,
            )
              .bind(
                command.eventId,
                product.resource_group_id,
                product.id,
                normalizedCodes.length,
                product.reference_capacity,
              )
              .first<{ rotation_id: string; flight_group_id: string }>();
        const communicationRow = openFlightGroup
          ? null
          : await this.env.DB.prepare(
              "SELECT COALESCE(MAX(communication_number), 100) + 1 AS next_number FROM flight_groups WHERE operation_day_id = ?1 AND resource_group_id = ?2",
            )
              .bind(command.eventId, product.resource_group_id)
              .first<{ next_number: number }>();
        const now = new Date().toISOString();
        const nextVersion = current.version + 1;
        const ticketGroupId = crypto.randomUUID();
        const slots = openFlightGroup
          ? [
              {
                flightGroupId: openFlightGroup.flight_group_id,
                rotationId: openFlightGroup.rotation_id,
                communicationNumber: null,
              },
            ]
          : Array.from({ length: requiredFlightGroupCount }, (_, index) => ({
              flightGroupId: crypto.randomUUID(),
              rotationId: crypto.randomUUID(),
              communicationNumber: (communicationRow?.next_number ?? 101) + index,
            }));
        const primarySlot = slots[0];
        if (!primarySlot) throw new Error("Mindestens ein Fluggruppen-Slot wurde erwartet.");
        const ticketIds = hashes.map(() => crypto.randomUUID());
        const eventId = crypto.randomUUID();
        const result: CommandResult = {
          accepted: true,
          duplicate: false,
          event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
          eventType: "TICKET_GROUP_SOLD",
          aggregate: {
            type: "TICKET_GROUP",
            id: ticketGroupId,
            relatedRotationId: primarySlot.rotationId,
          },
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
          ...(openFlightGroup
            ? []
            : slots.flatMap((slot) => [
                this.env.DB.prepare(`INSERT INTO flight_groups
                  (id, operation_day_id, resource_group_id, communication_number, status, version, created_at, updated_at)
                  VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`).bind(
                  slot.flightGroupId,
                  command.eventId,
                  product.resource_group_id,
                  slot.communicationNumber,
                  now,
                ),
                this.env.DB.prepare(`INSERT INTO rotations
                  (id, operation_day_id, flight_group_id, gate_id, status, version, created_at, updated_at)
                  VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`).bind(
                  slot.rotationId,
                  command.eventId,
                  slot.flightGroupId,
                  product.gate_id,
                  now,
                ),
              ])),
          ...hashes.flatMap((hash, index) => {
            const slotIndex = splitAcrossFlightGroups
              ? Math.floor(index / product.reference_capacity)
              : 0;
            const ticketSlot = slots[slotIndex];
            if (!ticketSlot) throw new Error("Fluggruppen-Slot für Ticket fehlt.");
            return [
              this.env.DB.prepare(`INSERT INTO tickets
                (id, ticket_group_id, public_code_hash, status, weight_class, individual_weight_kg,
                 payment_status, payment_method, price_cents, created_at)
                VALUES (?1, ?2, ?3, 'QUEUED', ?4, ?5, ?6, ?7, ?8, ?9)`).bind(
                ticketIds[index],
                ticketGroupId,
                hash,
                ticketDetails[index]?.weightClass,
                ticketDetails[index]?.individualWeightKg,
                command.payload.paymentStatus,
                command.payload.paymentMethod,
                product.price_cents,
                now,
              ),
              this.env.DB.prepare(
                "INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at) VALUES (?1, ?2, ?3)",
              ).bind(ticketSlot.rotationId, ticketIds[index], now),
            ];
          }),
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
              flightGroupId: primarySlot.flightGroupId,
              rotationId: primarySlot.rotationId,
              flightGroupIds: slots.map((slot) => slot.flightGroupId),
              rotationIds: slots.map((slot) => slot.rotationId),
              ticketCount: ticketIds.length,
              productId: product.id,
              weightClasses: ticketDetails.map((detail) => detail.weightClass),
              paymentStatus: command.payload.paymentStatus,
              paymentMethod: command.payload.paymentMethod,
              joinedExistingFlightGroup: openFlightGroup !== null,
              oversizeSplitAcknowledged: splitAcrossFlightGroups,
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
        if (command.type === "STAGE_OUTAGE_RECOVERY") {
          return this.handleStageOutageRecovery(command, current);
        }
        if (command.type === "APPROVE_OUTAGE_RECOVERY") {
          return this.handleApproveOutageRecovery(command, current);
        }
        if (command.type === "APPLY_OUTAGE_RECOVERY") {
          return this.handleApplyOutageRecovery(command, current);
        }
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
        if (command.type === "CONFIGURE_EVENT_PARAMETERS") {
          return this.handleEventParameters(command, current);
        }
        if (command.type === "SET_EVENT_LIFECYCLE") {
          return this.handleEventLifecycle(command, current);
        }
        if (command.type === "UPSERT_GATE" || command.type === "UPSERT_PRODUCT") {
          return this.handleMasterData(command, current);
        }
        if (
          command.type === "UPSERT_RESOURCE_GROUP" ||
          command.type === "UPSERT_AIRCRAFT" ||
          command.type === "ASSIGN_AIRCRAFT_RESOURCE_GROUP"
        ) {
          return this.handleResourceAndAircraftMasterData(command, current);
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
        if (command.type === "ABORT_ROTATION") {
          return this.handleAbortRotation(command, current);
        }
        if (command.type === "SET_TICKET_ATTENDANCE") {
          return this.handleTicketAttendance(command, current);
        }
        if (command.type === "SET_ROTATION_NOTE") {
          return this.handleRotationNote(command, current);
        }
        if (command.type === "SET_ROTATION_CAPACITY") {
          return this.handleRotationCapacity(command, current);
        }
        if (command.type === "MOVE_TICKET_GROUP") {
          return this.handleManualTicketGroupMove(command, current);
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
          if (command.type === "CALL_NEXT" && current.status !== "ACTIVE") {
            return json(
              {
                error: {
                  code: "CALL_BLOCKED_EVENT_STATUS",
                  message: "Neue Aufrufe sind nur bei aktiver Veranstaltung zulässig.",
                },
              },
              { status: 409 },
            );
          }
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
    this.ctx.waitUntil(
      this.recalculateForecastTimelines(result.event.eventId).catch((reason: unknown) => {
        console.error(
          JSON.stringify({
            level: "error",
            code: "FORECAST_RECALCULATION_FAILED",
            eventId: result.event.eventId,
            message: safeErrorMessage(reason),
          }),
        );
      }),
    );
    const broadcast = JSON.stringify({
      type: "event-state-changed",
      eventVersion: result.event.version,
    });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(broadcast);
      } catch {
        socket.close(1011, "Broadcast fehlgeschlagen");
      }
    }
  }

  private async recalculateForecastTimelines(eventId: string): Promise<void> {
    const [event, rotationRows, durationRows, capacityRows, pilotRow] = await Promise.all([
      this.env.DB.prepare(
        `SELECT version, operational_interrupted, emergency_mode, planned_boarding_minutes,
                planned_deboarding_minutes, planned_buffer_minutes, updated_at
           FROM operation_days WHERE id = ?1`,
      )
        .bind(eventId)
        .first<{
          version: number;
          operational_interrupted: number;
          emergency_mode: number;
          planned_boarding_minutes: number;
          planned_deboarding_minutes: number;
          planned_buffer_minutes: number;
          updated_at: string;
        }>(),
      this.env.DB.prepare(
        `SELECT r.id, r.status, r.created_at, r.called_at, r.departed_at, r.landed_at,
                r.completed_at, fg.resource_group_id, rg.status AS resource_group_status,
                COALESCE(MIN(tg.queue_sequence), 1) AS queue_sequence,
                COALESCE(MIN(p.reference_duration_minutes), 20) AS reference_duration_minutes,
                COALESCE(MIN(p.code), '') AS product_code, a.aircraft_type
           FROM rotations r
           JOIN flight_groups fg ON fg.id = r.flight_group_id
           JOIN resource_groups rg ON rg.id = fg.resource_group_id
           LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
           LEFT JOIN tickets t ON t.id = rt.ticket_id
           LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
           LEFT JOIN products p ON p.id = tg.product_id
           LEFT JOIN aircraft a ON a.id = r.aircraft_id
          WHERE r.operation_day_id = ?1 AND r.status NOT IN ('COMPLETED', 'CANCELED')
          GROUP BY r.id
          ORDER BY CASE WHEN r.status = 'DRAFT' THEN 1 ELSE 0 END,
                   COALESCE(fg.queue_position, fg.communication_number), r.created_at`,
      )
        .bind(eventId)
        .all<{
          id: string;
          status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED";
          created_at: string;
          called_at: string | null;
          departed_at: string | null;
          landed_at: string | null;
          completed_at: string | null;
          resource_group_id: string;
          resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
          queue_sequence: number;
          reference_duration_minutes: number;
          product_code: string;
          aircraft_type: string | null;
        }>(),
      this.env.DB.prepare(
        `SELECT (julianday(r.completed_at) - julianday(r.called_at)) * 1440.0 AS minutes,
                r.completed_at, p.code AS product_code, a.aircraft_type
           FROM rotations r
           JOIN rotation_tickets rt ON rt.rotation_id = r.id
           JOIN tickets t ON t.id = rt.ticket_id
           JOIN ticket_groups tg ON tg.id = t.ticket_group_id
           JOIN products p ON p.id = tg.product_id
           LEFT JOIN aircraft a ON a.id = r.aircraft_id
          WHERE r.status = 'COMPLETED' AND r.called_at IS NOT NULL AND r.completed_at IS NOT NULL
          GROUP BY r.id, p.code, a.aircraft_type
          ORDER BY r.completed_at DESC LIMIT 200`,
      ).all<{
        minutes: number;
        completed_at: string;
        product_code: string;
        aircraft_type: string | null;
      }>(),
      this.env.DB.prepare(
        `SELECT m.resource_group_id, COUNT(*) AS count
           FROM resource_group_memberships m
           JOIN aircraft a ON a.id = m.aircraft_id
          WHERE m.operation_day_id = ?1 AND m.active_until IS NULL
            AND a.operational_state NOT IN ('INACTIVE', 'PAUSED', 'REFUELING', 'INTERRUPTED')
          GROUP BY m.resource_group_id`,
      )
        .bind(eventId)
        .all<{ resource_group_id: string; count: number }>(),
      this.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM pilots WHERE operation_day_id = ?1 AND active = 1 AND paused = 0",
      )
        .bind(eventId)
        .first<{ count: number }>(),
    ]);
    if (!event || rotationRows.results.length === 0) return;

    const now = new Date();
    const nowIso = now.toISOString();
    const addMinutes = (value: string | Date, minutes: number) =>
      new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
    const capacities = new Map(
      capacityRows.results.map((row) => [
        row.resource_group_id,
        Math.min(row.count, pilotRow?.count ?? 0),
      ]),
    );
    const statements: D1PreparedStatement[] = [];
    for (const rotation of rotationRows.results) {
      const boarding = event.planned_boarding_minutes;
      const deboarding = event.planned_deboarding_minutes;
      const buffer = event.planned_buffer_minutes;
      const referenceTotal = boarding + rotation.reference_duration_minutes + deboarding + buffer;
      const activeCapacity = capacities.get(rotation.resource_group_id) ?? 0;
      const productHistory = durationRows.results.filter(
        (row) => row.product_code === rotation.product_code,
      );
      const aircraftHistory = rotation.aircraft_type
        ? productHistory.filter((row) => row.aircraft_type === rotation.aircraft_type)
        : [];
      const selectedHistory = (aircraftHistory.length > 0 ? aircraftHistory : productHistory).slice(
        0,
        12,
      );
      const actualDurations = [...selectedHistory].reverse().map((row) => row.minutes);
      const lastActualAt = selectedHistory[0]?.completed_at;
      const dataAgeMinutes = lastActualAt
        ? Math.max(0, (now.getTime() - Date.parse(lastActualAt)) / 60_000)
        : 0;
      const estimate = estimateDuration({
        referenceMinutes: referenceTotal,
        actualDurationsMinutes: actualDurations,
        dataAgeMinutes,
        interrupted:
          event.operational_interrupted === 1 ||
          event.emergency_mode === 1 ||
          rotation.resource_group_status !== "ACTIVE",
        activeCapacity,
      });
      const window = forecastQueueWindows({
        queueSequence: rotation.queue_sequence,
        activeAircraft: activeCapacity,
        duration: estimate,
      });
      const planOffset =
        Math.floor(Math.max(0, rotation.queue_sequence - 1) / Math.max(1, activeCapacity)) *
        referenceTotal;
      const plannedBoardingAt = addMinutes(rotation.created_at, planOffset);
      const plannedDepartureAt = addMinutes(plannedBoardingAt, boarding);
      const plannedLandingAt = addMinutes(plannedDepartureAt, rotation.reference_duration_minutes);
      const plannedCompletionAt = addMinutes(plannedLandingAt, deboarding + buffer);
      let predictedBoardingAt = addMinutes(now, window.lowerMinutes);
      if (rotation.called_at) predictedBoardingAt = rotation.called_at;
      let predictedDepartureAt = addMinutes(predictedBoardingAt, boarding);
      if (rotation.departed_at) predictedDepartureAt = rotation.departed_at;
      const expectedFlightMinutes = Math.max(
        rotation.reference_duration_minutes,
        estimate.expectedMinutes - boarding - deboarding - buffer,
      );
      let predictedLandingAt = addMinutes(predictedDepartureAt, expectedFlightMinutes);
      if (rotation.landed_at) predictedLandingAt = rotation.landed_at;
      let predictedCompletionAt = addMinutes(predictedLandingAt, deboarding + buffer);
      if (rotation.status !== "DRAFT") {
        const advanced = advanceOverduePrediction({
          status: rotation.status,
          now: nowIso,
          predictedDepartureAt,
          predictedLandingAt,
          predictedCompletionAt,
        });
        predictedDepartureAt = advanced.predictedDepartureAt;
        predictedLandingAt = advanced.predictedLandingAt;
        predictedCompletionAt = advanced.predictedCompletionAt;
      }
      statements.push(
        this.env.DB.prepare(
          `UPDATE rotations SET
            planned_boarding_at = COALESCE(planned_boarding_at, ?1),
            planned_departure_at = COALESCE(planned_departure_at, ?2),
            planned_landing_at = COALESCE(planned_landing_at, ?3),
            planned_completion_at = COALESCE(planned_completion_at, ?4),
            predicted_boarding_at = ?5, predicted_departure_at = ?6,
            predicted_landing_at = ?7, predicted_completion_at = ?8,
            prediction_quality = ?9, prediction_lower_minutes = ?10,
            prediction_upper_minutes = ?11, prediction_updated_at = ?12
           WHERE id = ?13`,
        ).bind(
          plannedBoardingAt,
          plannedDepartureAt,
          plannedLandingAt,
          plannedCompletionAt,
          predictedBoardingAt,
          predictedDepartureAt,
          predictedLandingAt,
          predictedCompletionAt,
          estimate.quality,
          window.lowerMinutes,
          window.upperMinutes,
          nowIso,
          rotation.id,
        ),
        this.env.DB.prepare(
          `INSERT INTO forecast_snapshots
            (id, operation_day_id, rotation_id, operation_day_version, captured_at, quality,
             lower_minutes, upper_minutes, predicted_boarding_at, predicted_departure_at,
             predicted_landing_at, predicted_completion_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        ).bind(
          crypto.randomUUID(),
          eventId,
          rotation.id,
          event.version,
          nowIso,
          estimate.quality,
          window.lowerMinutes,
          window.upperMinutes,
          predictedBoardingAt,
          predictedDepartureAt,
          predictedLandingAt,
          predictedCompletionAt,
        ),
      );
    }
    for (let index = 0; index < statements.length; index += 80) {
      await this.env.DB.batch(statements.slice(index, index + 80));
    }
    await queueEligiblePreparationNotifications(this.env, eventId);
    const forecastMessage = JSON.stringify({
      type: "forecast-updated",
      eventId,
      eventVersion: event.version,
      updatedAt: nowIso,
    });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(forecastMessage);
      } catch {
        socket.close(1011, "Prognose-Broadcast fehlgeschlagen");
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
            `INSERT INTO pilots
              (id, operation_day_id, operational_code, operational_note, active, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
           ON CONFLICT(id) DO UPDATE SET operational_code = excluded.operational_code,
             operational_note = excluded.operational_note, active = excluded.active,
             updated_at = excluded.updated_at`,
          ).bind(
            command.payload.pilotId,
            command.eventId,
            command.payload.operationalCode,
            command.payload.operationalNote,
            command.payload.active ? 1 : 0,
            now,
          ),
        );
        aggregateType = "PILOT";
        aggregateId = command.payload.pilotId;
        eventType = "PILOT_CONFIGURATION_CHANGED";
        auditPayload = {
          operationalCode: command.payload.operationalCode,
          operationalNote: command.payload.operationalNote,
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

  private async handleMasterData(
    command: Extract<CommandEnvelope, { type: "UPSERT_GATE" | "UPSERT_PRODUCT" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    if (!(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    let eventType: "GATE_UPSERTED" | "PRODUCT_UPSERTED";
    let aggregate: { type: "GATE" | "PRODUCT"; id: string };
    let mutation: D1PreparedStatement;
    let auditPayload: Record<string, unknown>;

    if (command.type === "UPSERT_GATE") {
      const duplicate = await this.env.DB.prepare(
        "SELECT id FROM gates WHERE operation_day_id = ?1 AND label = ?2 AND id <> ?3",
      )
        .bind(command.eventId, command.payload.label, command.payload.gateId)
        .first<{ id: string }>();
      if (duplicate) {
        return json(
          {
            error: { code: "GATE_LABEL_EXISTS", message: "Gate-Bezeichnung ist bereits vergeben." },
          },
          { status: 409 },
        );
      }
      if (!command.payload.active) {
        const usage = await this.env.DB.prepare(
          `SELECT COUNT(*) AS count FROM products
            WHERE operation_day_id = ?1 AND gate_id = ?2 AND sale_enabled = 1`,
        )
          .bind(command.eventId, command.payload.gateId)
          .first<{ count: number }>();
        if ((usage?.count ?? 0) > 0) {
          return json(
            {
              error: {
                code: "GATE_IN_ACTIVE_USE",
                message: "Ein Gate mit verkaufbaren Produkten kann nicht deaktiviert werden.",
              },
            },
            { status: 409 },
          );
        }
      }
      eventType = "GATE_UPSERTED";
      aggregate = { type: "GATE", id: command.payload.gateId };
      auditPayload = {
        label: command.payload.label,
        gateType: command.payload.gateType,
        active: command.payload.active,
        sortOrder: command.payload.sortOrder,
        reason: command.payload.reason,
      };
      mutation = this.env.DB.prepare(
        `INSERT INTO gates
          (id, operation_day_id, label, gate_type, active, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, gate_type = excluded.gate_type,
          active = excluded.active, sort_order = excluded.sort_order, updated_at = excluded.updated_at
         WHERE gates.operation_day_id = excluded.operation_day_id`,
      ).bind(
        command.payload.gateId,
        command.eventId,
        command.payload.label,
        command.payload.gateType,
        command.payload.active ? 1 : 0,
        command.payload.sortOrder,
        now,
      );
    } else {
      const [resourceGroup, gate, duplicateCode, existing] = await Promise.all([
        this.env.DB.prepare(
          "SELECT id FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2",
        )
          .bind(command.payload.resourceGroupId, command.eventId)
          .first<{ id: string }>(),
        this.env.DB.prepare(
          "SELECT id FROM gates WHERE id = ?1 AND operation_day_id = ?2 AND active = 1",
        )
          .bind(command.payload.gateId, command.eventId)
          .first<{ id: string }>(),
        this.env.DB.prepare(
          "SELECT id FROM products WHERE operation_day_id = ?1 AND code = ?2 AND id <> ?3",
        )
          .bind(command.eventId, command.payload.code, command.payload.productId)
          .first<{ id: string }>(),
        this.env.DB.prepare(
          `SELECT p.resource_group_id,
            (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
              WHERE tg.product_id = p.id AND t.status NOT IN ('CANCELED', 'COMPLETED')) AS open_tickets
           FROM products p WHERE p.id = ?1 AND p.operation_day_id = ?2`,
        )
          .bind(command.payload.productId, command.eventId)
          .first<{ resource_group_id: string; open_tickets: number }>(),
      ]);
      if (!resourceGroup || !gate) {
        return json(
          {
            error: {
              code: "PRODUCT_REFERENCE_INVALID",
              message: "Ressourcengruppe oder aktives Gate ist ungültig.",
            },
          },
          { status: 409 },
        );
      }
      if (duplicateCode) {
        return json(
          {
            error: { code: "PRODUCT_CODE_EXISTS", message: "Produktkürzel ist bereits vergeben." },
          },
          { status: 409 },
        );
      }
      if (
        existing &&
        existing.resource_group_id !== command.payload.resourceGroupId &&
        existing.open_tickets > 0
      ) {
        return json(
          {
            error: {
              code: "PRODUCT_RESOURCE_CHANGE_ACTIVE_QUEUE",
              message: "Die Ressourcengruppe kann bei offenen Tickets nicht geändert werden.",
            },
          },
          { status: 409 },
        );
      }
      eventType = "PRODUCT_UPSERTED";
      aggregate = { type: "PRODUCT", id: command.payload.productId };
      auditPayload = {
        resourceGroupId: command.payload.resourceGroupId,
        gateId: command.payload.gateId,
        name: command.payload.name,
        code: command.payload.code,
        publicDescription: command.payload.publicDescription,
        priceCents: command.payload.priceCents,
        referenceCapacity: command.payload.referenceCapacity,
        referenceDurationMinutes: command.payload.referenceDurationMinutes,
        childCompanionRequired: command.payload.childCompanionRequired,
        weightClasses: command.payload.weightClasses,
        sortOrder: command.payload.sortOrder,
        reason: command.payload.reason,
      };
      mutation = this.env.DB.prepare(
        `INSERT INTO products
          (id, operation_day_id, resource_group_id, gate_id, name, code, public_description,
           price_cents, sale_enabled, reference_capacity, reference_duration_minutes,
           child_companion_required, weight_classes_json, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
         ON CONFLICT(id) DO UPDATE SET resource_group_id = excluded.resource_group_id,
          gate_id = excluded.gate_id, name = excluded.name, code = excluded.code,
          public_description = excluded.public_description, price_cents = excluded.price_cents,
          reference_capacity = excluded.reference_capacity,
          reference_duration_minutes = excluded.reference_duration_minutes,
          child_companion_required = excluded.child_companion_required,
          weight_classes_json = excluded.weight_classes_json, sort_order = excluded.sort_order,
          updated_at = excluded.updated_at
         WHERE products.operation_day_id = excluded.operation_day_id`,
      ).bind(
        command.payload.productId,
        command.eventId,
        command.payload.resourceGroupId,
        command.payload.gateId,
        command.payload.name,
        command.payload.code,
        command.payload.publicDescription,
        command.payload.priceCents,
        command.payload.referenceCapacity,
        command.payload.referenceDurationMinutes,
        command.payload.childCompanionRequired ? 1 : 0,
        JSON.stringify(command.payload.weightClasses),
        command.payload.sortOrder,
        now,
      );
    }

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
      mutation,
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
    ]);
    this.broadcast(result);
    return json(result);
  }

  private async handleResourceAndAircraftMasterData(
    command: Extract<
      CommandEnvelope,
      {
        type: "UPSERT_RESOURCE_GROUP" | "UPSERT_AIRCRAFT" | "ASSIGN_AIRCRAFT_RESOURCE_GROUP";
      }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    if (!(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    let eventType:
      | "RESOURCE_GROUP_UPSERTED"
      | "AIRCRAFT_UPSERTED"
      | "AIRCRAFT_RESOURCE_GROUP_ASSIGNED";
    let aggregate: { type: "RESOURCE_GROUP" | "AIRCRAFT"; id: string };
    let auditPayload: Record<string, unknown>;
    const mutations: D1PreparedStatement[] = [];

    if (command.type === "UPSERT_RESOURCE_GROUP") {
      const [gate, duplicate] = await Promise.all([
        this.env.DB.prepare(
          "SELECT id FROM gates WHERE id = ?1 AND operation_day_id = ?2 AND active = 1",
        )
          .bind(command.payload.gateId, command.eventId)
          .first<{ id: string }>(),
        this.env.DB.prepare(
          "SELECT id FROM resource_groups WHERE operation_day_id = ?1 AND name = ?2 AND id <> ?3",
        )
          .bind(command.eventId, command.payload.name, command.payload.resourceGroupId)
          .first<{ id: string }>(),
      ]);
      if (!gate || duplicate) {
        return json(
          {
            error: {
              code: duplicate ? "RESOURCE_GROUP_NAME_EXISTS" : "GATE_NOT_AVAILABLE",
              message: duplicate
                ? "Ressourcengruppen-Bezeichnung ist bereits vergeben."
                : "Das ausgewählte Gate ist nicht aktiv verfügbar.",
            },
          },
          { status: 409 },
        );
      }
      eventType = "RESOURCE_GROUP_UPSERTED";
      aggregate = { type: "RESOURCE_GROUP", id: command.payload.resourceGroupId };
      auditPayload = {
        name: command.payload.name,
        gateId: command.payload.gateId,
        referenceCapacity: command.payload.referenceCapacity,
        plannedRotationMinutes: command.payload.plannedRotationMinutes,
        compatibleAircraftTypes: command.payload.compatibleAircraftTypes,
        reason: command.payload.reason,
      };
      mutations.push(
        this.env.DB.prepare(
          `INSERT INTO resource_groups
            (id, operation_day_id, name, status, gate_id, reference_capacity,
             planned_rotation_minutes, compatible_aircraft_types_json, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'ACTIVE', ?4, ?5, ?6, ?7, 0, ?8, ?8)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, gate_id = excluded.gate_id,
            reference_capacity = excluded.reference_capacity,
            planned_rotation_minutes = excluded.planned_rotation_minutes,
            compatible_aircraft_types_json = excluded.compatible_aircraft_types_json,
            version = resource_groups.version + 1, updated_at = excluded.updated_at
           WHERE resource_groups.operation_day_id = excluded.operation_day_id`,
        ).bind(
          command.payload.resourceGroupId,
          command.eventId,
          command.payload.name,
          command.payload.gateId,
          command.payload.referenceCapacity,
          command.payload.plannedRotationMinutes,
          JSON.stringify([...new Set(command.payload.compatibleAircraftTypes)]),
          now,
        ),
      );
    } else if (command.type === "UPSERT_AIRCRAFT") {
      const [duplicate, activeRotation] = await Promise.all([
        this.env.DB.prepare("SELECT id FROM aircraft WHERE registration = ?1 AND id <> ?2")
          .bind(command.payload.registration, command.payload.aircraftId)
          .first<{ id: string }>(),
        this.env.DB.prepare(
          `SELECT id FROM rotations WHERE aircraft_id = ?1
            AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED') LIMIT 1`,
        )
          .bind(command.payload.aircraftId)
          .first<{ id: string }>(),
      ]);
      if (duplicate || activeRotation) {
        return json(
          {
            error: {
              code: duplicate ? "AIRCRAFT_REGISTRATION_EXISTS" : "AIRCRAFT_LIFECYCLE_ACTIVE",
              message: duplicate
                ? "Kennzeichen ist bereits vergeben."
                : "Flugzeugstammdaten sind während eines aktiven Umlaufs gesperrt.",
            },
          },
          { status: 409 },
        );
      }
      eventType = "AIRCRAFT_UPSERTED";
      aggregate = { type: "AIRCRAFT", id: command.payload.aircraftId };
      auditPayload = {
        registration: command.payload.registration,
        aircraftType: command.payload.aircraftType,
        passengerSeats: command.payload.passengerSeats,
        maximumPassengerPayloadKg: command.payload.maximumPassengerPayloadKg,
        reason: command.payload.reason,
      };
      mutations.push(
        this.env.DB.prepare(
          `INSERT INTO aircraft
            (id, registration, aircraft_type, passenger_seats, maximum_passenger_payload_kg,
             created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
           ON CONFLICT(id) DO UPDATE SET registration = excluded.registration,
            aircraft_type = excluded.aircraft_type, passenger_seats = excluded.passenger_seats,
            maximum_passenger_payload_kg = excluded.maximum_passenger_payload_kg,
            updated_at = excluded.updated_at`,
        ).bind(
          command.payload.aircraftId,
          command.payload.registration,
          command.payload.aircraftType,
          command.payload.passengerSeats,
          command.payload.maximumPassengerPayloadKg,
          now,
        ),
      );
    } else {
      const [aircraft, target, activeMembership, activeRotation] = await Promise.all([
        this.env.DB.prepare("SELECT id, aircraft_type FROM aircraft WHERE id = ?1")
          .bind(command.payload.aircraftId)
          .first<{ id: string; aircraft_type: string }>(),
        this.env.DB.prepare(
          `SELECT id, compatible_aircraft_types_json FROM resource_groups
            WHERE id = ?1 AND operation_day_id = ?2 AND status <> 'ENDED'`,
        )
          .bind(command.payload.resourceGroupId, command.eventId)
          .first<{ id: string; compatible_aircraft_types_json: string }>(),
        this.env.DB.prepare(
          `SELECT id, resource_group_id, active_from FROM resource_group_memberships
            WHERE operation_day_id = ?1 AND aircraft_id = ?2 AND active_until IS NULL`,
        )
          .bind(command.eventId, command.payload.aircraftId)
          .first<{ id: string; resource_group_id: string; active_from: string }>(),
        this.env.DB.prepare(
          `SELECT id FROM rotations WHERE operation_day_id = ?1 AND aircraft_id = ?2
            AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED') LIMIT 1`,
        )
          .bind(command.eventId, command.payload.aircraftId)
          .first<{ id: string }>(),
      ]);
      if (!aircraft || !target) {
        return json(
          {
            error: {
              code: "ASSIGNMENT_REFERENCE_INVALID",
              message: "Flugzeug oder Ressourcengruppe fehlt.",
            },
          },
          { status: 404 },
        );
      }
      if (activeRotation) {
        return json(
          {
            error: {
              code: "AIRCRAFT_LIFECYCLE_ACTIVE",
              message: "Zuordnung ist während eines aktiven Umlaufs gesperrt.",
            },
          },
          { status: 409 },
        );
      }
      if (activeMembership?.resource_group_id === target.id) {
        return json(
          {
            error: {
              code: "ASSIGNMENT_UNCHANGED",
              message: "Flugzeug ist bereits dieser Ressourcengruppe zugeordnet.",
            },
          },
          { status: 409 },
        );
      }
      if (
        activeMembership &&
        Date.parse(command.payload.effectiveAt) <= Date.parse(activeMembership.active_from)
      ) {
        return json(
          {
            error: {
              code: "ASSIGNMENT_TIME_INVALID",
              message: "Wirksamkeit muss nach Beginn der bisherigen Zuordnung liegen.",
            },
          },
          { status: 409 },
        );
      }
      const compatibleTypes = JSON.parse(target.compatible_aircraft_types_json) as string[];
      if (compatibleTypes.length > 0 && !compatibleTypes.includes(aircraft.aircraft_type)) {
        return json(
          {
            error: {
              code: "AIRCRAFT_TYPE_INCOMPATIBLE",
              message: "Flugzeugtyp ist für diese Ressourcengruppe nicht freigegeben.",
            },
          },
          { status: 409 },
        );
      }
      eventType = "AIRCRAFT_RESOURCE_GROUP_ASSIGNED";
      aggregate = { type: "AIRCRAFT", id: aircraft.id };
      auditPayload = {
        fromResourceGroupId: activeMembership?.resource_group_id ?? null,
        toResourceGroupId: target.id,
        effectiveAt: command.payload.effectiveAt,
        reason: command.payload.reason,
      };
      if (activeMembership) {
        mutations.push(
          this.env.DB.prepare(
            `UPDATE resource_group_memberships SET active_until = ?1
              WHERE id = ?2 AND active_until IS NULL`,
          ).bind(command.payload.effectiveAt, activeMembership.id),
        );
      }
      mutations.push(
        this.env.DB.prepare(
          `INSERT INTO resource_group_memberships
            (id, operation_day_id, resource_group_id, aircraft_id, active_from, active_until,
             created_at, change_reason, changed_by_device_id)
           VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)`,
        ).bind(
          crypto.randomUUID(),
          command.eventId,
          target.id,
          aircraft.id,
          command.payload.effectiveAt,
          now,
          command.payload.reason,
          command.deviceId,
        ),
      );
    }

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
      ...mutations,
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
    ]);
    this.broadcast(result);
    return json(result);
  }

  private async handleRotationNote(
    command: Extract<CommandEnvelope, { type: "SET_ROTATION_NOTE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      "SELECT id, version FROM rotations WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{ id: string; version: number }>();
    if (!rotation) {
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "ROTATION_NOTE_SET",
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        "UPDATE rotations SET operational_note = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(command.payload.note, now, rotation.id, rotation.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'ROTATION_NOTE_SET', ?3, ?4, 'ROTATION', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({ note: command.payload.note, reason: command.payload.reason }),
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

  private async handleEventLifecycle(
    command: Extract<CommandEnvelope, { type: "SET_EVENT_LIFECYCLE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    if (!(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
    const target = command.payload.status;
    const allowedTransitions: Record<StoredEventRow["status"], StoredEventRow["status"][]> = {
      PREPARATION: ["ACTIVE"],
      ACTIVE: ["CLOSED"],
      CLOSED: ["ACTIVE", "ARCHIVED"],
      ARCHIVED: [],
    };
    if (target === current.status) {
      return json(
        { error: { code: "EVENT_STATUS_UNCHANGED", message: "Der Status ist bereits gesetzt." } },
        { status: 409 },
      );
    }
    if (!allowedTransitions[current.status].includes(target)) {
      return json(
        {
          error: {
            code: "EVENT_LIFECYCLE_TRANSITION_NOT_ALLOWED",
            message: `Übergang ${current.status} → ${target} ist nicht zulässig.`,
          },
        },
        { status: 409 },
      );
    }
    if (target === "ACTIVE") {
      const readiness = await this.env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM products WHERE operation_day_id = ?1) AS products,
          (SELECT COUNT(*) FROM resource_groups WHERE operation_day_id = ?1 AND status = 'ACTIVE') AS resource_groups,
          (SELECT COUNT(*) FROM resource_group_memberships WHERE operation_day_id = ?1 AND active_until IS NULL) AS aircraft,
          (SELECT COUNT(*) FROM pilots WHERE operation_day_id = ?1 AND active = 1) AS pilots,
          (SELECT COUNT(*) FROM gates WHERE operation_day_id = ?1 AND active = 1) AS gates`,
      )
        .bind(command.eventId)
        .first<{
          products: number;
          resource_groups: number;
          aircraft: number;
          pilots: number;
          gates: number;
        }>();
      if (
        !current.operations_end_at ||
        !readiness ||
        [
          readiness.products,
          readiness.resource_groups,
          readiness.aircraft,
          readiness.pilots,
          readiness.gates,
        ].some((count) => count < 1)
      ) {
        return json(
          {
            error: {
              code: "EVENT_NOT_READY",
              message:
                "Vor Aktivierung sind Betriebsende, Produkt, Ressourcengruppe, Flugzeug, Pilot und Gate erforderlich.",
            },
          },
          { status: 409 },
        );
      }
    }
    if (target === "CLOSED" || target === "ARCHIVED") {
      const open = await this.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM rotations
          WHERE operation_day_id = ?1 AND status NOT IN ('COMPLETED', 'CANCELED')`,
      )
        .bind(command.eventId)
        .first<{ count: number }>();
      if ((open?.count ?? 0) > 0) {
        return json(
          {
            error: {
              code: "EVENT_HAS_OPEN_ROTATIONS",
              message:
                "Offene Fluggruppen oder Umläufe müssen vor dem Schließen abgeschlossen werden.",
            },
          },
          { status: 409 },
        );
      }
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const archivedAt = target === "ARCHIVED" ? now : null;
    const eventType = `EVENT_${target}`;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({
        ...current,
        status: target,
        archived_at: archivedAt,
        version: nextVersion,
        updated_at: now,
      }),
      eventType,
      aggregate: { type: "OPERATION_DAY", id: command.eventId },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE operation_days SET status = ?1, archived_at = ?2, version = ?3, updated_at = ?4
          WHERE id = ?5 AND version = ?6`,
      ).bind(target, archivedAt, nextVersion, now, command.eventId, current.version),
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
        JSON.stringify({
          previousStatus: current.status,
          status: target,
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

  private async handleEventParameters(
    command: Extract<CommandEnvelope, { type: "CONFIGURE_EVENT_PARAMETERS" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    if (!(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
    const payload = command.payload;
    if (
      payload.saleOpensAt &&
      Date.parse(payload.saleOpensAt) >= Date.parse(payload.operationsEndAt)
    ) {
      return json(
        {
          error: {
            code: "EVENT_TIME_RANGE_INVALID",
            message: "Der Verkaufsbeginn muss vor dem Betriebsende liegen.",
          },
        },
        { status: 409 },
      );
    }
    if (
      !(
        payload.childReferenceWeightKg < payload.normalReferenceWeightKg &&
        payload.normalReferenceWeightKg < payload.heavyReferenceWeightKg
      )
    ) {
      return json(
        {
          error: {
            code: "REFERENCE_WEIGHTS_INVALID",
            message: "Referenzgewichte müssen in der Reihenfolge Kind, Normal, Schwer ansteigen.",
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
      event: rowToSnapshot({
        ...current,
        version: nextVersion,
        sale_opens_at: payload.saleOpensAt,
        operations_end_at: payload.operationsEndAt,
        no_show_after_minutes: payload.noShowAfterMinutes,
        max_ticket_deferrals: payload.maxTicketDeferrals,
        notification_lead_minutes: payload.notificationLeadMinutes,
        child_reference_weight_kg: payload.childReferenceWeightKg,
        normal_reference_weight_kg: payload.normalReferenceWeightKg,
        heavy_reference_weight_kg: payload.heavyReferenceWeightKg,
        planned_boarding_minutes: payload.plannedBoardingMinutes,
        planned_deboarding_minutes: payload.plannedDeboardingMinutes,
        planned_buffer_minutes: payload.plannedBufferMinutes,
        updated_at: now,
      }),
      eventType: "EVENT_PARAMETERS_CONFIGURED",
      aggregate: { type: "OPERATION_DAY", id: current.id },
    };
    const auditPayload = {
      saleOpensAt: payload.saleOpensAt,
      operationsEndAt: payload.operationsEndAt,
      noShowAfterMinutes: payload.noShowAfterMinutes,
      maxTicketDeferrals: payload.maxTicketDeferrals,
      notificationLeadMinutes: payload.notificationLeadMinutes,
      referenceWeightsKg: {
        child: payload.childReferenceWeightKg,
        normal: payload.normalReferenceWeightKg,
        heavy: payload.heavyReferenceWeightKg,
      },
      plannedBoardingMinutes: payload.plannedBoardingMinutes,
      plannedDeboardingMinutes: payload.plannedDeboardingMinutes,
      plannedBufferMinutes: payload.plannedBufferMinutes,
      reason: payload.reason,
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE operation_days SET sale_opens_at = ?1, operations_end_at = ?2,
          no_show_after_minutes = ?3, max_ticket_deferrals = ?4, notification_lead_minutes = ?5,
          child_reference_weight_kg = ?6, normal_reference_weight_kg = ?7,
          heavy_reference_weight_kg = ?8, planned_boarding_minutes = ?9,
          planned_deboarding_minutes = ?10, planned_buffer_minutes = ?11,
          version = ?12, updated_at = ?13 WHERE id = ?14 AND version = ?15`,
      ).bind(
        payload.saleOpensAt,
        payload.operationsEndAt,
        payload.noShowAfterMinutes,
        payload.maxTicketDeferrals,
        payload.notificationLeadMinutes,
        payload.childReferenceWeightKg,
        payload.normalReferenceWeightKg,
        payload.heavyReferenceWeightKg,
        payload.plannedBoardingMinutes,
        payload.plannedDeboardingMinutes,
        payload.plannedBufferMinutes,
        nextVersion,
        now,
        command.eventId,
        current.version,
      ),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'EVENT_PARAMETERS_CONFIGURED', ?3, ?4, 'OPERATION_DAY', ?2, ?5, ?6)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
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
      `SELECT r.id, r.status, r.version, r.aircraft_id, r.pilot_id,
              rg.status AS resource_group_status
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2`,
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        version: number;
        aircraft_id: string | null;
        pilot_id: string | null;
        resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
      }>();
    if (!rotation)
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    let previousAircraftPilotId: string | null = null;
    if (command.type === "CALL_NEXT") {
      if (rotation.resource_group_status !== "ACTIVE") {
        return json(
          {
            error: {
              code: "RESOURCE_GROUP_NOT_ACTIVE",
              message: "Ressourcengruppe ist für neue Aufrufe nicht aktiv.",
            },
          },
          { status: 409 },
        );
      }
      const candidate = await this.env.DB.prepare(
        `SELECT a.id, a.passenger_seats, a.operational_state,
                membership.current_pilot_id, COUNT(rt.ticket_id) AS ticket_count
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
          current_pilot_id: string | null;
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
      previousAircraftPilotId = candidate.current_pilot_id;
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
        `UPDATE resource_group_memberships SET current_pilot_id = ?1
          WHERE operation_day_id = ?2 AND aircraft_id = ?3 AND active_until IS NULL
            AND ?4 = 'CALL_NEXT'`,
      ).bind(selectedPilotId, command.eventId, selectedAircraftId, command.type),
      this.env.DB.prepare(
        `UPDATE tickets SET status = CASE
            WHEN ?1 = 'CALL_NEXT' AND attendance_status = 'CHECKED_IN' THEN 'BOARDING'
            WHEN ?1 = 'CALL_NEXT' THEN 'CALLED'
            ELSE ?2
          END
          WHERE id IN (
            SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?3 AND released_at IS NULL
          )`,
      ).bind(command.type, nextState, rotation.id),
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
          previousAircraftPilotId,
          pilotChanged: command.type === "CALL_NEXT" && previousAircraftPilotId !== selectedPilotId,
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

  private async handleApplyOutageRecovery(
    command: Extract<CommandEnvelope, { type: "APPLY_OUTAGE_RECOVERY" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    if (!(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
    const batch = await this.env.DB.prepare(
      `SELECT id, status, created_by_device_id, approved_by_device_id,
              simulated_against_version, version
         FROM outage_recovery_batches
        WHERE id = ?1 AND operation_day_id = ?2`,
    )
      .bind(command.payload.batchId, command.eventId)
      .first<{
        id: string;
        status: "STAGED" | "CONFLICTED" | "APPROVED" | "APPLYING" | "APPLIED" | "REJECTED";
        created_by_device_id: string;
        approved_by_device_id: string | null;
        simulated_against_version: number;
        version: number;
      }>();
    if (!batch) {
      return json(
        {
          error: {
            code: "RECOVERY_BATCH_NOT_FOUND",
            message: "Nacherfassungsbatch nicht gefunden.",
          },
        },
        { status: 404 },
      );
    }
    try {
      assertOutageRecoveryApplication({
        status: batch.status,
        simulatedAgainstVersion: batch.simulated_against_version,
        currentEventVersion: current.version,
      });
    } catch (reason) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    const entries = await this.env.DB.prepare(
      `SELECT id, source_entry_id, entry_type, original_occurred_at, paper_sequence,
              paper_reference, payload_json, status
         FROM outage_recovery_entries
        WHERE batch_id = ?1
        ORDER BY original_occurred_at, paper_sequence, id`,
    )
      .bind(batch.id)
      .all<{
        id: string;
        source_entry_id: string;
        entry_type:
          | "PAPER_SALE"
          | "ROTATION_CALLED"
          | "ROTATION_IN_FLIGHT"
          | "ROTATION_LANDED"
          | "ROTATION_COMPLETED";
        original_occurred_at: string;
        paper_sequence: number;
        paper_reference: string;
        payload_json: string;
        status: "STAGED" | "CONFLICT" | "APPLIED";
      }>();
    if (
      entries.results.length === 0 ||
      entries.results.some((entry) => entry.status !== "STAGED")
    ) {
      return json(
        {
          error: {
            code: "RECOVERY_ENTRIES_NOT_APPLICABLE",
            message: "Der Batch enthält keine vollständig freigegebenen Nacherfassungszeilen.",
          },
        },
        { status: 409 },
      );
    }
    const [products, aircraftRows, pilotRows, existingReferences, queueRows, communicationRows] =
      await Promise.all([
        this.env.DB.prepare(
          "SELECT id, resource_group_id, gate_id, price_cents FROM products WHERE operation_day_id = ?1",
        )
          .bind(command.eventId)
          .all<{ id: string; resource_group_id: string; gate_id: string; price_cents: number }>(),
        this.env.DB.prepare(
          `SELECT a.id, a.passenger_seats, a.operational_state, membership.resource_group_id
             FROM aircraft a
             JOIN resource_group_memberships membership
               ON membership.aircraft_id = a.id AND membership.active_until IS NULL
            WHERE membership.operation_day_id = ?1`,
        )
          .bind(command.eventId)
          .all<{
            id: string;
            passenger_seats: number;
            operational_state: string;
            resource_group_id: string;
          }>(),
        this.env.DB.prepare("SELECT id, active, paused FROM pilots WHERE operation_day_id = ?1")
          .bind(command.eventId)
          .all<{ id: string; active: number; paused: number }>(),
        this.env.DB.prepare(
          `SELECT reference.paper_reference, reference.ticket_group_id, reference.rotation_id,
                  reference.current_state, r.aircraft_id, r.pilot_id, fg.resource_group_id,
                  r.version, COUNT(rt.ticket_id) AS ticket_count
             FROM outage_recovery_references reference
             JOIN rotations r ON r.id = reference.rotation_id
             JOIN flight_groups fg ON fg.id = r.flight_group_id
             LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
            WHERE reference.operation_day_id = ?1
            GROUP BY reference.paper_reference`,
        )
          .bind(command.eventId)
          .all<{
            paper_reference: string;
            ticket_group_id: string;
            rotation_id: string;
            current_state: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
            aircraft_id: string | null;
            pilot_id: string | null;
            resource_group_id: string;
            version: number;
            ticket_count: number;
          }>(),
        this.env.DB.prepare(
          `SELECT p.resource_group_id, COALESCE(MAX(tg.queue_sequence), 0) AS maximum
             FROM products p
             LEFT JOIN ticket_groups tg ON tg.product_id = p.id AND tg.operation_day_id = p.operation_day_id
            WHERE p.operation_day_id = ?1 GROUP BY p.resource_group_id`,
        )
          .bind(command.eventId)
          .all<{ resource_group_id: string; maximum: number }>(),
        this.env.DB.prepare(
          `SELECT resource_group_id, COALESCE(MAX(communication_number), 100) AS maximum
             FROM flight_groups WHERE operation_day_id = ?1 GROUP BY resource_group_id`,
        )
          .bind(command.eventId)
          .all<{ resource_group_id: string; maximum: number }>(),
      ]);
    const productById = new Map(products.results.map((product) => [product.id, product]));
    const aircraftById = new Map(aircraftRows.results.map((aircraft) => [aircraft.id, aircraft]));
    const pilotById = new Map(pilotRows.results.map((pilot) => [pilot.id, pilot]));
    const nextQueue = new Map(queueRows.results.map((row) => [row.resource_group_id, row.maximum]));
    const nextCommunication = new Map(
      communicationRows.results.map((row) => [row.resource_group_id, row.maximum]),
    );
    type WorkingReference = {
      ticketGroupId: string;
      rotationId: string;
      flightGroupId?: string;
      state: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      resourceGroupId: string;
      ticketCount: number;
      rotationVersion: number;
      aircraftId: string | null;
      pilotId: string | null;
    };
    const references = new Map<string, WorkingReference>(
      existingReferences.results.map((reference) => [
        reference.paper_reference,
        {
          ticketGroupId: reference.ticket_group_id,
          rotationId: reference.rotation_id,
          state: reference.current_state,
          resourceGroupId: reference.resource_group_id,
          ticketCount: reference.ticket_count,
          rotationVersion: reference.version,
          aircraftId: reference.aircraft_id,
          pilotId: reference.pilot_id,
        },
      ]),
    );
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
    ];
    const completedRotationsByAircraft = new Map<string, number>();
    const activeRecoveredAircraft = new Map<string, string>();
    const activeRecoveredPilots = new Map<string, string>();
    try {
      for (const entry of entries.results) {
        if (entry.entry_type === "PAPER_SALE") {
          if (references.has(entry.paper_reference)) {
            throw new DomainRuleError(
              "PAPER_REFERENCE_ALREADY_EXISTS",
              "Die Papier-Belegreferenz wurde bereits angewendet.",
            );
          }
          const payload = storedOutagePaperSalePayloadSchema.parse(JSON.parse(entry.payload_json));
          const product = productById.get(payload.productId);
          if (!product) {
            throw new DomainRuleError(
              "RECOVERY_PRODUCT_NOT_FOUND",
              "Das Produkt des Papierverkaufs ist nicht mehr vorhanden.",
            );
          }
          if (!product.gate_id) {
            throw new DomainRuleError(
              "RECOVERY_PRODUCT_GATE_REQUIRED",
              "Für das Produkt des Papierverkaufs fehlt ein Gate.",
            );
          }
          const queueSequence = (nextQueue.get(product.resource_group_id) ?? 0) + 1;
          nextQueue.set(product.resource_group_id, queueSequence);
          const communicationNumber = (nextCommunication.get(product.resource_group_id) ?? 100) + 1;
          nextCommunication.set(product.resource_group_id, communicationNumber);
          const ticketGroupId = crypto.randomUUID();
          const flightGroupId = crypto.randomUUID();
          const rotationId = crypto.randomUUID();
          const ticketIds = payload.publicTicketCodeHashes.map(() => crypto.randomUUID());
          const reference: WorkingReference = {
            ticketGroupId,
            flightGroupId,
            rotationId,
            state: "DRAFT",
            resourceGroupId: product.resource_group_id,
            ticketCount: ticketIds.length,
            rotationVersion: 0,
            aircraftId: null,
            pilotId: null,
          };
          references.set(entry.paper_reference, reference);
          statements.push(
            this.env.DB.prepare(
              `INSERT INTO ticket_groups
                (id, operation_day_id, product_id, queue_sequence, standby, status, sold_at, version)
               VALUES (?1, ?2, ?3, ?4, 0, 'QUEUED', ?5, 0)`,
            ).bind(
              ticketGroupId,
              command.eventId,
              product.id,
              queueSequence,
              entry.original_occurred_at,
            ),
            this.env.DB.prepare(
              `INSERT INTO flight_groups
                (id, operation_day_id, resource_group_id, communication_number, status,
                 version, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
            ).bind(
              flightGroupId,
              command.eventId,
              product.resource_group_id,
              communicationNumber,
              entry.original_occurred_at,
            ),
            this.env.DB.prepare(
              `INSERT INTO rotations
                (id, operation_day_id, flight_group_id, gate_id, status, version, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
            ).bind(
              rotationId,
              command.eventId,
              flightGroupId,
              product.gate_id,
              entry.original_occurred_at,
            ),
            this.env.DB.prepare(
              `INSERT INTO outage_recovery_references
                (operation_day_id, paper_reference, ticket_group_id, rotation_id, current_state,
                 last_source_entry_id, created_by_batch_id, updated_at)
               VALUES (?1, ?2, ?3, ?4, 'DRAFT', ?5, ?6, ?7)`,
            ).bind(
              command.eventId,
              entry.paper_reference,
              ticketGroupId,
              rotationId,
              entry.source_entry_id,
              batch.id,
              now,
            ),
          );
          for (let index = 0; index < ticketIds.length; index += 1) {
            statements.push(
              this.env.DB.prepare(
                `INSERT INTO tickets
                  (id, ticket_group_id, public_code_hash, status, weight_class,
                   individual_weight_kg, payment_status, payment_method, price_cents, created_at)
                 VALUES (?1, ?2, ?3, 'QUEUED', 'NOT_CAPTURED', NULL, ?4, ?5, ?6, ?7)`,
              ).bind(
                ticketIds[index],
                ticketGroupId,
                payload.publicTicketCodeHashes[index],
                payload.paymentStatus,
                payload.paymentMethod,
                product.price_cents,
                entry.original_occurred_at,
              ),
              this.env.DB.prepare(
                `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
                 VALUES (?1, ?2, ?3)`,
              ).bind(rotationId, ticketIds[index], entry.original_occurred_at),
            );
          }
          statements.push(
            this.recoveryLedgerStatement({
              eventId: command.eventId,
              eventType: "TICKET_GROUP_SOLD",
              occurredAt: entry.original_occurred_at,
              deviceId: batch.created_by_device_id,
              aggregateType: "TICKET_GROUP",
              aggregateId: ticketGroupId,
              aggregateVersion: 0,
              payload: { productId: product.id, ticketCount: ticketIds.length, rotationId },
              batchId: batch.id,
              paperReference: entry.paper_reference,
            }),
          );
          continue;
        }
        const reference = references.get(entry.paper_reference);
        if (!reference) {
          throw new DomainRuleError(
            "PAPER_REFERENCE_UNKNOWN",
            "Für das Umlaufereignis fehlt ein angewendeter Papierverkauf.",
          );
        }
        const target = {
          ROTATION_CALLED: "CALLED",
          ROTATION_IN_FLIGHT: "IN_FLIGHT",
          ROTATION_LANDED: "LANDED",
          ROTATION_COMPLETED: "COMPLETED",
        } as const;
        const nextState = transitionRotation(reference.state, target[entry.entry_type]);
        if (entry.entry_type === "ROTATION_CALLED") {
          const payload = storedOutageCallPayloadSchema.parse(JSON.parse(entry.payload_json));
          const aircraft = aircraftById.get(payload.aircraftId);
          if (
            !aircraft ||
            aircraft.resource_group_id !== reference.resourceGroupId ||
            aircraft.passenger_seats < reference.ticketCount
          ) {
            throw new DomainRuleError(
              "RECOVERY_AIRCRAFT_INCOMPATIBLE",
              "Flugzeugzuordnung oder Kapazität passt nicht zum Papierumlauf.",
            );
          }
          if (!pilotById.has(payload.pilotId)) {
            throw new DomainRuleError(
              "RECOVERY_PILOT_NOT_FOUND",
              "Der anonyme Pilotencode des Papierumlaufs ist nicht vorhanden.",
            );
          }
          reference.aircraftId = payload.aircraftId;
          reference.pilotId = payload.pilotId;
        } else {
          storedOutageTransitionPayloadSchema.parse(JSON.parse(entry.payload_json));
        }
        if (!reference.aircraftId || !reference.pilotId) {
          throw new DomainRuleError(
            "RECOVERY_ASSIGNMENT_REQUIRED",
            "Flugzeug- und Pilotenzuordnung fehlen im Papierumlauf.",
          );
        }
        reference.rotationVersion += 1;
        reference.state = nextState;
        const timestampColumn = {
          ROTATION_CALLED: "called_at",
          ROTATION_IN_FLIGHT: "departed_at",
          ROTATION_LANDED: "landed_at",
          ROTATION_COMPLETED: "completed_at",
        } as const;
        const eventType = {
          ROTATION_CALLED: "FLIGHT_GROUP_CALLED",
          ROTATION_IN_FLIGHT: "ROTATION_STARTED",
          ROTATION_LANDED: "ROTATION_LANDED",
          ROTATION_COMPLETED: "ROTATION_COMPLETED",
        } as const;
        statements.push(
          this.env.DB.prepare(
            `UPDATE rotations SET status = ?1, ${timestampColumn[entry.entry_type]} = ?2,
                    aircraft_id = ?3, pilot_id = ?4, version = version + 1, updated_at = ?5
              WHERE id = ?6 AND version = ?7`,
          ).bind(
            nextState,
            entry.original_occurred_at,
            reference.aircraftId,
            reference.pilotId,
            now,
            reference.rotationId,
            reference.rotationVersion - 1,
          ),
          this.env.DB.prepare(
            `UPDATE tickets SET status = ?1
              WHERE id IN (SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?2 AND released_at IS NULL)`,
          ).bind(nextState, reference.rotationId),
          this.env.DB.prepare(
            `UPDATE outage_recovery_references
                SET current_state = ?1, last_source_entry_id = ?2, updated_at = ?3
              WHERE operation_day_id = ?4 AND paper_reference = ?5`,
          ).bind(nextState, entry.source_entry_id, now, command.eventId, entry.paper_reference),
          this.recoveryLedgerStatement({
            eventId: command.eventId,
            eventType: eventType[entry.entry_type],
            occurredAt: entry.original_occurred_at,
            deviceId: batch.created_by_device_id,
            aggregateType: "ROTATION",
            aggregateId: reference.rotationId,
            aggregateVersion: reference.rotationVersion,
            payload: {
              to: nextState,
              aircraftId: reference.aircraftId,
              pilotId: reference.pilotId,
            },
            batchId: batch.id,
            paperReference: entry.paper_reference,
          }),
        );
        if (nextState === "COMPLETED") {
          completedRotationsByAircraft.set(
            reference.aircraftId,
            (completedRotationsByAircraft.get(reference.aircraftId) ?? 0) + 1,
          );
        }
      }
      const activeRotationIds = new Set(
        [...references.values()]
          .filter((reference) => reference.state !== "COMPLETED" && reference.state !== "DRAFT")
          .map((reference) => reference.rotationId),
      );
      const activeRows = await this.env.DB.prepare(
        `SELECT id, aircraft_id, pilot_id FROM rotations
          WHERE operation_day_id = ?1 AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')`,
      )
        .bind(command.eventId)
        .all<{ id: string; aircraft_id: string | null; pilot_id: string | null }>();
      const preexistingActiveRotationIds = new Set(activeRows.results.map((row) => row.id));
      for (const active of activeRows.results) {
        if (activeRotationIds.has(active.id)) continue;
        if (active.aircraft_id) activeRecoveredAircraft.set(active.aircraft_id, active.id);
        if (active.pilot_id) activeRecoveredPilots.set(active.pilot_id, active.id);
      }
      for (const reference of references.values()) {
        if (reference.state === "DRAFT" || reference.state === "COMPLETED") continue;
        if (!reference.aircraftId || !reference.pilotId) continue;
        const aircraftConflict = activeRecoveredAircraft.get(reference.aircraftId);
        const pilotConflict = activeRecoveredPilots.get(reference.pilotId);
        const aircraft = aircraftById.get(reference.aircraftId);
        const pilot = pilotById.get(reference.pilotId);
        if (aircraftConflict && aircraftConflict !== reference.rotationId) {
          throw new DomainRuleError(
            "RECOVERY_AIRCRAFT_CONFLICT",
            "Das Flugzeug ist bereits einem anderen aktiven Umlauf zugeordnet.",
          );
        }
        if (pilotConflict && pilotConflict !== reference.rotationId) {
          throw new DomainRuleError(
            "RECOVERY_PILOT_CONFLICT",
            "Der Pilotencode ist bereits einem anderen aktiven Umlauf zugeordnet.",
          );
        }
        if (
          !aircraft ||
          (!preexistingActiveRotationIds.has(reference.rotationId) &&
            aircraft.operational_state !== "AVAILABLE")
        ) {
          throw new DomainRuleError(
            "RECOVERY_AIRCRAFT_NOT_AVAILABLE",
            "Das Flugzeug ist für den wiederhergestellten aktiven Umlauf nicht verfügbar.",
          );
        }
        if (pilot?.active !== 1 || pilot.paused === 1) {
          throw new DomainRuleError(
            "RECOVERY_PILOT_NOT_AVAILABLE",
            "Der Pilotencode ist für den wiederhergestellten aktiven Umlauf nicht verfügbar.",
          );
        }
        activeRecoveredAircraft.set(reference.aircraftId, reference.rotationId);
        activeRecoveredPilots.set(reference.pilotId, reference.rotationId);
        const aircraftState =
          reference.state === "CALLED"
            ? "BOARDING"
            : reference.state === "IN_FLIGHT"
              ? "IN_FLIGHT"
              : "LANDED";
        statements.push(
          this.env.DB.prepare(
            "UPDATE aircraft SET operational_state = ?1, updated_at = ?2 WHERE id = ?3",
          ).bind(aircraftState, now, reference.aircraftId),
        );
      }
      for (const [aircraftId, completedCount] of completedRotationsByAircraft) {
        statements.push(
          this.env.DB.prepare(
            `UPDATE aircraft SET rotations_since_refuel = rotations_since_refuel + ?1,
                    updated_at = ?2 WHERE id = ?3`,
          ).bind(completedCount, now, aircraftId),
        );
      }
    } catch (reason) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      return json(
        {
          error: {
            code: "RECOVERY_PAYLOAD_INVALID",
            message: "Gespeicherte Nacherfassungsdaten sind ungültig; Anwendung wurde abgebrochen.",
          },
        },
        { status: 409 },
      );
    }
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "OUTAGE_RECOVERY_APPLIED",
      aggregate: { type: "RECOVERY_BATCH", id: batch.id },
    };
    statements.push(
      this.env.DB.prepare(
        "UPDATE outage_recovery_entries SET status = 'APPLIED' WHERE batch_id = ?1 AND status = 'STAGED'",
      ).bind(batch.id),
      this.env.DB.prepare(
        `UPDATE outage_recovery_batches SET status = 'APPLIED', applied_at = ?1,
                version = version + 1 WHERE id = ?2 AND version = ?3 AND status = 'APPROVED'`,
      ).bind(now, batch.id, batch.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'OUTAGE_RECOVERY_APPLIED', ?3, ?4, 'RECOVERY_BATCH', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        batch.id,
        batch.version + 1,
        JSON.stringify({
          entryCount: entries.results.length,
          createdByDeviceId: batch.created_by_device_id,
          approvedByDeviceId: batch.approved_by_device_id,
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
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }

  private recoveryLedgerStatement(input: {
    eventId: string;
    eventType: string;
    occurredAt: string;
    deviceId: string;
    aggregateType: "TICKET_GROUP" | "ROTATION";
    aggregateId: string;
    aggregateVersion: number;
    payload: Record<string, unknown>;
    batchId: string;
    paperReference: string;
  }): D1PreparedStatement {
    return this.env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json, recorded_after_outage,
         original_occurred_at, recovery_batch_id, paper_reference)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?4, ?10, ?11)`,
    ).bind(
      crypto.randomUUID(),
      input.eventId,
      input.eventType,
      input.occurredAt,
      input.deviceId,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion,
      JSON.stringify(input.payload),
      input.batchId,
      input.paperReference,
    );
  }

  private async handleApproveOutageRecovery(
    command: Extract<CommandEnvelope, { type: "APPROVE_OUTAGE_RECOVERY" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    if (!(await verifyCredential(command.payload.adminPin, this.env.ADMIN_PIN_HASH))) {
      return json(
        { error: { code: "ADMIN_PIN_INVALID", message: "Administrator-PIN ist ungültig." } },
        { status: 403 },
      );
    }
    const batch = await this.env.DB.prepare(
      `SELECT id, status, created_by_device_id, simulated_against_version, version
         FROM outage_recovery_batches
        WHERE id = ?1 AND operation_day_id = ?2`,
    )
      .bind(command.payload.batchId, command.eventId)
      .first<{
        id: string;
        status: "STAGED" | "CONFLICTED" | "APPROVED" | "APPLYING" | "APPLIED" | "REJECTED";
        created_by_device_id: string;
        simulated_against_version: number;
        version: number;
      }>();
    if (!batch) {
      return json(
        {
          error: {
            code: "RECOVERY_BATCH_NOT_FOUND",
            message: "Nacherfassungsbatch nicht gefunden.",
          },
        },
        { status: 404 },
      );
    }
    try {
      assertOutageRecoveryApproval({
        status: batch.status,
        createdByDeviceId: batch.created_by_device_id,
        approvedByDeviceId: command.deviceId,
        simulatedAgainstVersion: batch.simulated_against_version,
        currentEventVersion: current.version,
      });
    } catch (reason) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "OUTAGE_RECOVERY_APPROVED",
      aggregate: { type: "RECOVERY_BATCH", id: batch.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE outage_recovery_batches
            SET status = 'APPROVED', approved_by_device_id = ?1, approved_at = ?2,
                version = version + 1
          WHERE id = ?3 AND version = ?4 AND status = 'STAGED'`,
      ).bind(command.deviceId, now, batch.id, batch.version),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'OUTAGE_RECOVERY_APPROVED', ?3, ?4, 'RECOVERY_BATCH', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        batch.id,
        batch.version + 1,
        JSON.stringify({
          createdByDeviceId: batch.created_by_device_id,
          simulatedAgainstVersion: batch.simulated_against_version,
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

  private async handleStageOutageRecovery(
    command: Extract<CommandEnvelope, { type: "STAGE_OUTAGE_RECOVERY" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const existingBatch = await this.env.DB.prepare(
      "SELECT id FROM outage_recovery_batches WHERE id = ?1",
    )
      .bind(command.payload.batchId)
      .first<{ id: string }>();
    if (existingBatch) {
      return json(
        {
          error: {
            code: "RECOVERY_BATCH_ALREADY_EXISTS",
            message: "Der Nacherfassungsbatch existiert bereits.",
          },
        },
        { status: 409 },
      );
    }
    const existingReferences = await this.env.DB.prepare(
      `SELECT DISTINCT ore.paper_reference
         FROM outage_recovery_entries ore
         JOIN outage_recovery_batches orb ON orb.id = ore.batch_id
        WHERE orb.operation_day_id = ?1 AND orb.status <> 'REJECTED'`,
    )
      .bind(command.eventId)
      .all<{ paper_reference: string }>();
    const existingTicketKeys = await this.env.DB.prepare(
      `SELECT t.public_code_hash
         FROM tickets t
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
        WHERE tg.operation_day_id = ?1`,
    )
      .bind(command.eventId)
      .all<{ public_code_hash: string }>();
    const appliedRecoveryReferences = await this.env.DB.prepare(
      `SELECT paper_reference, current_state
         FROM outage_recovery_references
        WHERE operation_day_id = ?1`,
    )
      .bind(command.eventId)
      .all<{
        paper_reference: string;
        current_state: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      }>();
    const appliedReferenceStates: Record<
      string,
      "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED"
    > = {};
    for (const entry of appliedRecoveryReferences.results) {
      appliedReferenceStates[entry.paper_reference] = entry.current_state;
    }
    const preparedEntries = await Promise.all(
      command.payload.entries.map(async (entry) => {
        const ticketKeys =
          entry.type === "PAPER_SALE"
            ? await Promise.all(entry.payload.publicTicketCodes.map(sha256Hex))
            : [];
        return {
          entry,
          ticketKeys,
          storedPayload:
            entry.type === "PAPER_SALE"
              ? {
                  productId: entry.payload.productId,
                  publicTicketCodeHashes: ticketKeys,
                  paymentStatus: entry.payload.paymentStatus,
                  paymentMethod: entry.payload.paymentMethod,
                }
              : entry.payload,
        };
      }),
    );
    const now = new Date().toISOString();
    const simulation = simulateOutageRecovery({
      entries: preparedEntries.map(({ entry, ticketKeys }) => ({
        id: entry.id,
        type: entry.type,
        originalOccurredAt: entry.originalOccurredAt,
        paperSequence: entry.paperSequence,
        paperReference: entry.paperReference,
        ticketKeys,
      })),
      existingPaperReferences: existingReferences.results.map((row) => row.paper_reference),
      existingReferenceStates: appliedReferenceStates,
      existingTicketKeys: existingTicketKeys.results.map((row) => row.public_code_hash),
      recordedAt: now,
    });
    const nextVersion = current.version + 1;
    const eventType = simulation.canCommit
      ? "OUTAGE_RECOVERY_STAGED"
      : "OUTAGE_RECOVERY_CONFLICTED";
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: "RECOVERY_BATCH", id: command.payload.batchId },
    };
    const simulationPayload = {
      batchId: command.payload.batchId,
      simulatedAgainstVersion: current.version,
      canCommit: simulation.canCommit,
      orderedEntryIds: simulation.orderedEntries.map((entry) => entry.id),
      conflicts: simulation.conflicts,
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `INSERT INTO outage_recovery_batches
          (id, operation_day_id, created_by_device_id, created_at, simulated_against_version,
           status, simulation_json, version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)`,
      ).bind(
        command.payload.batchId,
        command.eventId,
        command.deviceId,
        now,
        current.version,
        simulation.canCommit ? "STAGED" : "CONFLICTED",
        JSON.stringify(simulationPayload),
      ),
    ];
    for (const { entry, storedPayload } of preparedEntries) {
      const entryConflicts = simulation.conflicts.filter(
        (conflict) => conflict.entryId === entry.id,
      );
      statements.push(
        this.env.DB.prepare(
          `INSERT INTO outage_recovery_entries
            (id, source_entry_id, batch_id, entry_type, original_occurred_at, paper_sequence,
             paper_reference, payload_json, status, conflict_json)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        ).bind(
          crypto.randomUUID(),
          entry.id,
          command.payload.batchId,
          entry.type,
          entry.originalOccurredAt,
          entry.paperSequence,
          entry.paperReference,
          JSON.stringify(storedPayload),
          entryConflicts.length === 0 ? "STAGED" : "CONFLICT",
          entryConflicts.length === 0 ? null : JSON.stringify(entryConflicts),
        ),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'RECOVERY_BATCH', ?6, 0, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        command.payload.batchId,
        JSON.stringify({
          entryCount: command.payload.entries.length,
          conflictCount: simulation.conflicts.length,
          simulatedAgainstVersion: current.version,
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
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }

  private async handleRotationCapacity(
    command: Extract<CommandEnvelope, { type: "SET_ROTATION_CAPACITY" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status, r.version, r.called_at, r.usable_capacity, r.aircraft_id,
              fg.id AS flight_group_id, fg.resource_group_id,
              COALESCE(a.passenger_seats, MIN(p.reference_capacity), rg.reference_capacity)
                AS baseline_capacity
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         LEFT JOIN tickets t ON t.id = rt.ticket_id
         LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         LEFT JOIN products p ON p.id = tg.product_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2 AND r.status <> 'CANCELED'
        GROUP BY r.id, r.status, r.version, r.called_at, r.usable_capacity, r.aircraft_id,
                 fg.id, fg.resource_group_id, a.passenger_seats, rg.reference_capacity`,
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        version: number;
        called_at: string | null;
        usable_capacity: number | null;
        aircraft_id: string | null;
        flight_group_id: string;
        resource_group_id: string;
        baseline_capacity: number;
      }>();
    if (!rotation) {
      return json(
        { error: { code: "ROTATION_NOT_FOUND", message: "Umlauf nicht gefunden." } },
        { status: 404 },
      );
    }
    const segmentRows = await this.env.DB.prepare(
      `SELECT tg.id AS ticket_group_id, tg.product_id, tg.queue_sequence,
              p.gate_id, COUNT(rt.ticket_id) AS segment_size, MIN(rt.assigned_at) AS assigned_at
         FROM rotation_tickets rt
         JOIN tickets t ON t.id = rt.ticket_id
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         JOIN products p ON p.id = tg.product_id
        WHERE rt.rotation_id = ?1 AND rt.released_at IS NULL
        GROUP BY tg.id, tg.product_id, tg.queue_sequence, p.gate_id
        ORDER BY tg.queue_sequence, assigned_at, tg.id`,
    )
      .bind(rotation.id)
      .all<{
        ticket_group_id: string;
        product_id: string;
        queue_sequence: number;
        gate_id: string;
        segment_size: number;
        assigned_at: string;
      }>();
    let reduction: ReturnType<typeof planRotationCapacityReduction>;
    try {
      reduction = planRotationCapacityReduction({
        rotationState: rotation.status,
        called: rotation.called_at !== null,
        baselineCapacity: rotation.baseline_capacity,
        currentUsableCapacity: rotation.usable_capacity,
        requestedUsableCapacity: command.payload.usableCapacity,
        segments: segmentRows.results.map((segment) => ({
          ticketGroupId: segment.ticket_group_id,
          size: segment.segment_size,
        })),
      });
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    const evictedSegments = reduction.evictedGroupIds.map((ticketGroupId) => {
      const segment = segmentRows.results.find((entry) => entry.ticket_group_id === ticketGroupId);
      if (!segment) throw new Error("Zu verdrängende Buchungsgruppe fehlt.");
      return segment;
    });
    const communication = await this.env.DB.prepare(
      `SELECT COALESCE(MAX(communication_number), 100) + 1 AS next_number
         FROM flight_groups WHERE operation_day_id = ?1 AND resource_group_id = ?2`,
    )
      .bind(command.eventId, rotation.resource_group_id)
      .first<{ next_number: number }>();
    const requeuedSlots = evictedSegments.map((segment, index) => ({
      ...segment,
      flightGroupId: crypto.randomUUID(),
      rotationId: crypto.randomUUID(),
      communicationNumber: (communication?.next_number ?? 101) + index,
      queuePosition: index + 1,
    }));
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const targetCanceled = reduction.keptGroupIds.length === 0;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "ROTATION_CAPACITY_CHANGED",
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE flight_groups
            SET queue_position = COALESCE(queue_position, communication_number) + ?1
          WHERE operation_day_id = ?2 AND resource_group_id = ?3
            AND id IN (SELECT flight_group_id FROM rotations WHERE status IN ('DRAFT', 'CALLED'))`,
      ).bind(requeuedSlots.length, command.eventId, rotation.resource_group_id),
      this.env.DB.prepare(
        `UPDATE rotations SET usable_capacity = ?1, status = ?2,
                version = version + 1, updated_at = ?3 WHERE id = ?4 AND version = ?5`,
      ).bind(
        command.payload.usableCapacity,
        targetCanceled ? "CANCELED" : rotation.status,
        now,
        rotation.id,
        rotation.version,
      ),
    ];
    if (targetCanceled && rotation.aircraft_id) {
      statements.push(
        this.env.DB.prepare(
          "UPDATE aircraft SET operational_state = 'AVAILABLE', updated_at = ?1 WHERE id = ?2",
        ).bind(now, rotation.aircraft_id),
      );
    }
    for (const slot of requeuedSlots) {
      statements.push(
        this.env.DB.prepare(
          `UPDATE rotation_tickets SET released_at = ?1
            WHERE rotation_id = ?2 AND released_at IS NULL
              AND ticket_id IN (SELECT id FROM tickets WHERE ticket_group_id = ?3)`,
        ).bind(now, rotation.id, slot.ticket_group_id),
        this.env.DB.prepare(
          `UPDATE ticket_groups SET status = 'QUEUED', version = version + 1 WHERE id = ?1`,
        ).bind(slot.ticket_group_id),
        this.env.DB.prepare(
          `UPDATE tickets SET status = 'QUEUED'
            WHERE id IN (
              SELECT rt.ticket_id FROM rotation_tickets rt
               WHERE rt.rotation_id = ?1 AND rt.released_at = ?2
            )`,
        ).bind(rotation.id, now),
        this.env.DB.prepare(
          `INSERT INTO flight_groups
            (id, operation_day_id, resource_group_id, communication_number, queue_position,
             status, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'DRAFT', 0, ?6, ?6)`,
        ).bind(
          slot.flightGroupId,
          command.eventId,
          rotation.resource_group_id,
          slot.communicationNumber,
          slot.queuePosition,
          now,
        ),
        this.env.DB.prepare(
          `INSERT INTO rotations
            (id, operation_day_id, flight_group_id, gate_id, status, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
        ).bind(slot.rotationId, command.eventId, slot.flightGroupId, slot.gate_id, now),
        this.env.DB.prepare(
          `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
           SELECT ?1, rt.ticket_id, ?2
             FROM rotation_tickets rt
             JOIN tickets t ON t.id = rt.ticket_id
            WHERE rt.rotation_id = ?3 AND rt.released_at = ?2 AND t.ticket_group_id = ?4`,
        ).bind(slot.rotationId, now, rotation.id, slot.ticket_group_id),
      );
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'ROTATION_CAPACITY_CHANGED', ?3, ?4, 'ROTATION', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({
          reason: command.payload.reason,
          baselineCapacity: rotation.baseline_capacity,
          previousUsableCapacity: rotation.usable_capacity ?? rotation.baseline_capacity,
          usableCapacity: command.payload.usableCapacity,
          keptTicketGroupIds: reduction.keptGroupIds,
          requeuedTicketGroupIds: reduction.evictedGroupIds,
          requeuedRotationIds: requeuedSlots.map((slot) => slot.rotationId),
          targetCanceled,
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
    );
    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }

  private async handleManualTicketGroupMove(
    command: Extract<CommandEnvelope, { type: "MOVE_TICKET_GROUP" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const group = await this.env.DB.prepare(
      `SELECT tg.id, tg.product_id, tg.version, p.resource_group_id, COUNT(t.id) AS group_size
         FROM ticket_groups tg
         JOIN products p ON p.id = tg.product_id
         JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE tg.id = ?1 AND tg.operation_day_id = ?2
        GROUP BY tg.id, tg.product_id, tg.version, p.resource_group_id`,
    )
      .bind(command.payload.ticketGroupId, command.eventId)
      .first<{
        id: string;
        product_id: string;
        version: number;
        resource_group_id: string;
        group_size: number;
      }>();
    if (!group) {
      return json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Ticketgruppe nicht gefunden." } },
        { status: 404 },
      );
    }
    const sourceRotations = await this.env.DB.prepare(
      `SELECT DISTINCT r.id, r.status, r.aircraft_id,
              (SELECT COUNT(DISTINCT source_ticket.ticket_group_id)
                 FROM rotation_tickets source_rt
                 JOIN tickets source_ticket ON source_ticket.id = source_rt.ticket_id
                WHERE source_rt.rotation_id = r.id AND source_rt.released_at IS NULL)
                AS rotation_group_count
         FROM tickets t
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
        WHERE t.ticket_group_id = ?1
        ORDER BY r.created_at, r.id`,
    )
      .bind(group.id)
      .all<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        aircraft_id: string | null;
        rotation_group_count: number;
      }>();
    if (sourceRotations.results.length === 0) {
      return json(
        {
          error: { code: "TICKET_GROUP_UNASSIGNED", message: "Ticketgruppe ist nicht zugeordnet." },
        },
        { status: 409 },
      );
    }
    if (
      sourceRotations.results.length === 1 &&
      sourceRotations.results[0]?.id === command.payload.targetRotationId
    ) {
      return json(
        {
          error: {
            code: "TICKET_GROUP_ALREADY_ASSIGNED",
            message: "Die Buchungsgruppe ist diesem Umlauf bereits vollständig zugeordnet.",
          },
        },
        { status: 409 },
      );
    }
    const target = await this.env.DB.prepare(
      `SELECT r.id, r.status, fg.resource_group_id,
              COALESCE(r.usable_capacity, a.passenger_seats, MIN(p.reference_capacity), rg.reference_capacity)
                AS target_capacity,
              SUM(CASE WHEN tg.id IS NOT NULL AND tg.id <> ?3 THEN 1 ELSE 0 END)
                AS occupied_seats,
              SUM(CASE WHEN tg.id IS NOT NULL AND tg.id <> ?3 AND tg.product_id <> ?4
                       THEN 1 ELSE 0 END) AS incompatible_product_tickets
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rg ON rg.id = fg.resource_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         LEFT JOIN tickets t ON t.id = rt.ticket_id
         LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         LEFT JOIN products p ON p.id = tg.product_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2 AND r.status <> 'CANCELED'
        GROUP BY r.id, r.status, r.usable_capacity, fg.resource_group_id,
                 a.passenger_seats, rg.reference_capacity`,
    )
      .bind(command.payload.targetRotationId, command.eventId, group.id, group.product_id)
      .first<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        resource_group_id: string;
        target_capacity: number;
        occupied_seats: number;
        incompatible_product_tickets: number;
      }>();
    if (!target) {
      return json(
        { error: { code: "TARGET_ROTATION_NOT_FOUND", message: "Zielumlauf nicht gefunden." } },
        { status: 404 },
      );
    }
    try {
      assertManualGroupMoveAllowed({
        sourceStates: sourceRotations.results.map((rotation) => rotation.status),
        targetState: target.status,
        sameResourceGroup: target.resource_group_id === group.resource_group_id,
        sameProduct: target.incompatible_product_tickets === 0,
        groupSize: group.group_size,
        targetOccupiedSeats: target.occupied_seats,
        targetCapacity: target.target_capacity,
      });
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const changedAfterCall =
      target.status === "CALLED" ||
      sourceRotations.results.some((rotation) => rotation.status === "CALLED");
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "TICKET_GROUP_MOVED",
      aggregate: { type: "TICKET_GROUP", id: group.id, relatedRotationId: target.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE rotation_tickets SET released_at = ?1
          WHERE released_at IS NULL
            AND ticket_id IN (SELECT id FROM tickets WHERE ticket_group_id = ?2)`,
      ).bind(now, group.id),
      this.env.DB.prepare(
        `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
         SELECT ?1, id, ?2 FROM tickets WHERE ticket_group_id = ?3 ORDER BY created_at, id`,
      ).bind(target.id, now, group.id),
      this.env.DB.prepare(
        `UPDATE tickets
            SET status = CASE
              WHEN ?1 = 'CALLED' AND attendance_status = 'CHECKED_IN' THEN 'BOARDING'
              WHEN ?1 = 'CALLED' THEN 'CALLED'
              WHEN attendance_status = 'CHECKED_IN' THEN 'CHECKED_IN'
              ELSE 'QUEUED'
            END
          WHERE ticket_group_id = ?2`,
      ).bind(target.status, group.id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET status = ?1, version = version + 1
          WHERE id = ?2 AND version = ?3`,
      ).bind(target.status === "CALLED" ? "CALLED" : "QUEUED", group.id, group.version),
    ];
    for (const source of sourceRotations.results) {
      if (source.id === target.id || source.rotation_group_count !== 1) continue;
      statements.push(
        this.env.DB.prepare(
          "UPDATE rotations SET status = 'CANCELED', version = version + 1, updated_at = ?1 WHERE id = ?2",
        ).bind(now, source.id),
      );
      if (source.aircraft_id) {
        statements.push(
          this.env.DB.prepare(
            "UPDATE aircraft SET operational_state = 'AVAILABLE', updated_at = ?1 WHERE id = ?2",
          ).bind(now, source.aircraft_id),
        );
      }
    }
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'TICKET_GROUP_MOVED', ?3, ?4, 'TICKET_GROUP', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        group.id,
        group.version + 1,
        JSON.stringify({
          reason: command.payload.reason,
          sourceRotationIds: sourceRotations.results.map((rotation) => rotation.id),
          targetRotationId: target.id,
          groupSize: group.group_size,
          targetCapacity: target.target_capacity,
          targetOccupiedSeatsBeforeMove: target.occupied_seats,
          changedAfterCall,
          manualDeviationFromAutomaticQueue: true,
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
    );
    await this.env.DB.batch(statements);
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
      `SELECT tg.id, tg.product_id, tg.version, tg.deferral_count,
              p.resource_group_id, COUNT(t.id) AS group_size
         FROM ticket_groups tg
         JOIN products p ON p.id = tg.product_id
         JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE tg.id = ?1 AND tg.operation_day_id = ?2
        GROUP BY tg.id, tg.product_id, tg.version, tg.deferral_count, p.resource_group_id`,
    )
      .bind(command.payload.ticketGroupId, command.eventId)
      .first<{
        id: string;
        product_id: string;
        version: number;
        deferral_count: number;
        resource_group_id: string;
        group_size: number;
      }>();
    if (!group) {
      return json(
        { error: { code: "TICKET_GROUP_NOT_FOUND", message: "Ticketgruppe nicht gefunden." } },
        { status: 404 },
      );
    }
    const rotationRows = await this.env.DB.prepare(
      `SELECT DISTINCT r.id, r.status, r.called_at, r.aircraft_id,
              (SELECT COUNT(DISTINCT grouped_ticket.ticket_group_id)
                 FROM rotation_tickets grouped_rt
                 JOIN tickets grouped_ticket ON grouped_ticket.id = grouped_rt.ticket_id
                WHERE grouped_rt.rotation_id = r.id AND grouped_rt.released_at IS NULL)
                AS rotation_group_count
         FROM tickets t
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
        WHERE t.ticket_group_id = ?1
        ORDER BY r.created_at, r.id`,
    )
      .bind(group.id)
      .all<{
        id: string;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        called_at: string | null;
        aircraft_id: string | null;
        rotation_group_count: number;
      }>();
    if (rotationRows.results.length === 0) {
      return json(
        {
          error: { code: "TICKET_GROUP_UNASSIGNED", message: "Ticketgruppe ist nicht zugeordnet." },
        },
        { status: 409 },
      );
    }
    if (
      command.type === "MARK_NO_SHOW" &&
      rotationRows.results.some(
        (rotation) =>
          rotation.status !== "CALLED" ||
          !rotation.called_at ||
          Date.now() - Date.parse(rotation.called_at) <
            (current.no_show_after_minutes ?? 10) * 60_000,
      )
    ) {
      return json(
        {
          error: {
            code: "NO_SHOW_DEADLINE_NOT_REACHED",
            message: "Die konfigurierte No-Show-Frist ist noch nicht erreicht.",
          },
        },
        { status: 409 },
      );
    }
    try {
      for (const rotation of rotationRows.results) {
        assertQueueMutationAllowed({
          rotationState: rotation.status,
          action:
            command.type === "CANCEL_TICKET_GROUP"
              ? "CANCEL"
              : command.type === "REBOOK_TICKET_GROUP"
                ? "REBOOK"
                : command.type === "MARK_NO_SHOW"
                  ? "NO_SHOW"
                  : "DEFER",
        });
      }
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }

    let targetProductId = group.product_id;
    let targetResourceGroupId = group.resource_group_id;
    let targetGateId: string | null = null;
    let targetPriceCents: number | null = null;
    let targetReferenceCapacity = 0;
    if (command.type === "REBOOK_TICKET_GROUP") {
      const target = await this.env.DB.prepare(
        "SELECT id, resource_group_id, gate_id, price_cents, reference_capacity FROM products WHERE id = ?1 AND operation_day_id = ?2 AND sale_enabled = 1",
      )
        .bind(command.payload.newProductId, command.eventId)
        .first<{
          id: string;
          resource_group_id: string;
          gate_id: string;
          price_cents: number;
          reference_capacity: number;
        }>();
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
      targetGateId = target.gate_id;
      targetPriceCents = target.price_cents;
      targetReferenceCapacity = target.reference_capacity;
    } else {
      const currentProduct = await this.env.DB.prepare(
        "SELECT gate_id, reference_capacity FROM products WHERE id = ?1 AND operation_day_id = ?2",
      )
        .bind(targetProductId, command.eventId)
        .first<{ gate_id: string; reference_capacity: number }>();
      targetGateId = currentProduct?.gate_id ?? null;
      targetReferenceCapacity = currentProduct?.reference_capacity ?? 0;
    }
    if (
      (command.type === "REBOOK_TICKET_GROUP" || command.type === "DEFER_TICKET_GROUP") &&
      !targetGateId
    ) {
      return json(
        {
          error: {
            code: "PRODUCT_GATE_REQUIRED",
            message: "Für den neuen Umlauf muss ein Produkt-Gate konfiguriert sein.",
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const nextDeferralCount =
      command.type === "DEFER_TICKET_GROUP" ? group.deferral_count + 1 : group.deferral_count;
    const requiresCashierClarification =
      command.type === "DEFER_TICKET_GROUP" &&
      nextDeferralCount >= (current.max_ticket_deferrals ?? 2);
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
        `UPDATE rotation_tickets SET released_at = ?1
          WHERE released_at IS NULL
            AND ticket_id IN (SELECT id FROM tickets WHERE ticket_group_id = ?2)`,
      ).bind(now, group.id),
    ];
    for (const rotation of rotationRows.results) {
      if (rotation.rotation_group_count === 1) {
        statements.push(
          this.env.DB.prepare(
            "UPDATE rotations SET status = 'CANCELED', version = version + 1, updated_at = ?1 WHERE id = ?2",
          ).bind(now, rotation.id),
        );
      }
      if (rotation.rotation_group_count === 1 && rotation.aircraft_id) {
        statements.push(
          this.env.DB.prepare(
            "UPDATE aircraft SET operational_state = 'AVAILABLE', updated_at = ?1 WHERE id = ?2",
          ).bind(now, rotation.aircraft_id),
        );
      }
    }

    if (
      command.type === "CANCEL_TICKET_GROUP" ||
      command.type === "MARK_NO_SHOW" ||
      requiresCashierClarification
    ) {
      const status =
        command.type === "CANCEL_TICKET_GROUP"
          ? "CANCELED"
          : command.type === "MARK_NO_SHOW"
            ? "NO_SHOW"
            : "CLARIFICATION";
      statements.push(
        this.env.DB.prepare(
          `UPDATE ticket_groups SET status = ?1, deferral_count = ?2,
                  version = version + 1 WHERE id = ?3 AND version = ?4`,
        ).bind(status, nextDeferralCount, group.id, group.version),
        this.env.DB.prepare("UPDATE tickets SET status = ?1 WHERE ticket_group_id = ?2").bind(
          status,
          group.id,
        ),
      );
    } else {
      const queue = await this.env.DB.prepare(
        `SELECT COALESCE(MAX(tg.queue_sequence), 0) + 1 AS next_sequence
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
          WHERE tg.operation_day_id = ?1 AND p.resource_group_id = ?2`,
      )
        .bind(command.eventId, targetResourceGroupId)
        .first<{ next_sequence: number }>();
      const communication = await this.env.DB.prepare(
        "SELECT COALESCE(MAX(communication_number), 100) + 1 AS next_number FROM flight_groups WHERE operation_day_id = ?1 AND resource_group_id = ?2",
      )
        .bind(command.eventId, targetResourceGroupId)
        .first<{ next_number: number }>();
      const reassignmentPlan = planBookingGroupSplit({
        groupSize: group.group_size,
        referenceCapacity: targetReferenceCapacity,
        splitAcknowledged: true,
      });
      const reassignmentSlots = reassignmentPlan.slotSizes.map((slotSize, index) => ({
        flightGroupId: crypto.randomUUID(),
        rotationId: crypto.randomUUID(),
        communicationNumber: (communication?.next_number ?? 101) + index,
        ticketOffset: index * targetReferenceCapacity,
        ticketCount: slotSize,
      }));
      statements.push(
        this.env.DB.prepare(
          `UPDATE ticket_groups SET product_id = ?1, queue_sequence = ?2, status = 'QUEUED',
                  deferral_count = ?3, version = version + 1 WHERE id = ?4 AND version = ?5`,
        ).bind(
          targetProductId,
          queue?.next_sequence ?? 1,
          nextDeferralCount,
          group.id,
          group.version,
        ),
        targetPriceCents === null
          ? this.env.DB.prepare(
              "UPDATE tickets SET status = 'QUEUED' WHERE ticket_group_id = ?1",
            ).bind(group.id)
          : this.env.DB.prepare(
              "UPDATE tickets SET status = 'QUEUED', price_cents = ?1 WHERE ticket_group_id = ?2",
            ).bind(targetPriceCents, group.id),
      );
      for (const slot of reassignmentSlots) {
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO flight_groups
            (id, operation_day_id, resource_group_id, communication_number, status, version, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
          ).bind(
            slot.flightGroupId,
            command.eventId,
            targetResourceGroupId,
            slot.communicationNumber,
            now,
          ),
          this.env.DB.prepare(
            `INSERT INTO rotations (id, operation_day_id, flight_group_id, gate_id, status, version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'DRAFT', 0, ?5, ?5)`,
          ).bind(slot.rotationId, command.eventId, slot.flightGroupId, targetGateId, now),
          this.env.DB.prepare(
            `INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
             SELECT ?1, id, ?2 FROM tickets WHERE ticket_group_id = ?3
              ORDER BY created_at, id LIMIT ?4 OFFSET ?5`,
          ).bind(slot.rotationId, now, group.id, slot.ticketCount, slot.ticketOffset),
        );
      }
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
        JSON.stringify({
          reason: command.payload.reason,
          targetProductId,
          deferralCount: nextDeferralCount,
          maxTicketDeferrals: current.max_ticket_deferrals ?? 2,
          requiresCashierClarification,
        }),
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

  private async handleTicketAttendance(
    command: Extract<CommandEnvelope, { type: "SET_TICKET_ATTENDANCE" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const ticket = await this.env.DB.prepare(
      `SELECT t.id, t.status, t.attendance_status, r.status AS rotation_status
         FROM tickets t
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
         JOIN rotations r ON r.id = rt.rotation_id
        WHERE t.id = ?1 AND tg.operation_day_id = ?2`,
    )
      .bind(command.payload.ticketId, command.eventId)
      .first<{
        id: string;
        status: string;
        attendance_status: "NOT_CHECKED_IN" | "CHECKED_IN";
        rotation_status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
      }>();
    if (!ticket) {
      return json(
        { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
        { status: 404 },
      );
    }
    if (!["DRAFT", "CALLED"].includes(ticket.rotation_status)) {
      return json(
        {
          error: {
            code: "ATTENDANCE_LOCKED",
            message: "Der Anwesenheitsstatus ist nach IM FLUG nicht mehr änderbar.",
          },
        },
        { status: 409 },
      );
    }
    const nextAttendance = command.payload.checkedIn ? "CHECKED_IN" : "NOT_CHECKED_IN";
    const nextTicketStatus = command.payload.checkedIn
      ? ticket.rotation_status === "CALLED"
        ? "BOARDING"
        : "CHECKED_IN"
      : ticket.rotation_status === "CALLED"
        ? "CALLED"
        : "QUEUED";
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType = command.payload.checkedIn ? "TICKET_CHECKED_IN" : "TICKET_CHECK_IN_REVOKED";
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: "TICKET", id: ticket.id },
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        "UPDATE tickets SET attendance_status = ?1, status = ?2 WHERE id = ?3",
      ).bind(nextAttendance, nextTicketStatus, ticket.id),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'TICKET', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
        ticket.id,
        nextVersion,
        JSON.stringify({
          attendanceFrom: ticket.attendance_status,
          attendanceTo: nextAttendance,
          ticketStatusFrom: ticket.status,
          ticketStatusTo: nextTicketStatus,
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

  private async handleAbortRotation(
    command: Extract<CommandEnvelope, { type: "ABORT_ROTATION" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const rotation = await this.env.DB.prepare(
      `SELECT r.id, r.status, r.version, r.aircraft_id, fg.id AS flight_group_id,
              fg.resource_group_id,
              tg.id AS ticket_group_id, tg.product_id
         FROM rotations r
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         JOIN tickets t ON t.id = rt.ticket_id
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
        WHERE r.id = ?1 AND r.operation_day_id = ?2
        LIMIT 1`,
    )
      .bind(command.payload.rotationId, command.eventId)
      .first<{
        id: string;
        status: string;
        version: number;
        aircraft_id: string | null;
        flight_group_id: string;
        resource_group_id: string;
        ticket_group_id: string;
        product_id: string;
      }>();
    if (rotation?.status !== "CALLED") {
      return json(
        {
          error: {
            code: "ROTATION_ABORT_NOT_ALLOWED",
            message: "Nur ein aufgerufener, noch nicht gestarteter Umlauf kann abgebrochen werden.",
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
      eventType: "ROTATION_ABORTED_TO_QUEUE",
      aggregate: { type: "ROTATION", id: rotation.id },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET queue_sequence = queue_sequence + 100000
          WHERE operation_day_id = ?1 AND id <> ?3 AND status = 'QUEUED'
            AND product_id IN (SELECT id FROM products WHERE operation_day_id = ?1 AND resource_group_id = ?2)`,
      ).bind(command.eventId, rotation.resource_group_id, rotation.ticket_group_id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET queue_sequence = 1, status = 'QUEUED', version = version + 1
          WHERE id = ?1`,
      ).bind(rotation.ticket_group_id),
      this.env.DB.prepare(
        `UPDATE ticket_groups SET queue_sequence = queue_sequence - 99999
          WHERE operation_day_id = ?1 AND id <> ?3 AND status = 'QUEUED' AND queue_sequence >= 100000
            AND product_id IN (SELECT id FROM products WHERE operation_day_id = ?1 AND resource_group_id = ?2)`,
      ).bind(command.eventId, rotation.resource_group_id, rotation.ticket_group_id),
      this.env.DB.prepare(
        `UPDATE rotations SET status = 'DRAFT', aircraft_id = NULL, pilot_id = NULL,
                called_at = NULL, version = version + 1, updated_at = ?1
          WHERE id = ?2 AND version = ?3`,
      ).bind(now, rotation.id, rotation.version),
      this.env.DB.prepare(
        "UPDATE flight_groups SET status = 'DRAFT', version = version + 1, updated_at = ?1 WHERE id = ?2",
      ).bind(now, rotation.flight_group_id),
      this.env.DB.prepare(
        `UPDATE tickets SET status = CASE
            WHEN attendance_status = 'CHECKED_IN' THEN 'CHECKED_IN' ELSE 'QUEUED' END
          WHERE id IN (SELECT ticket_id FROM rotation_tickets WHERE rotation_id = ?1 AND released_at IS NULL)`,
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
         VALUES (?1, ?2, 'ROTATION_ABORTED_TO_QUEUE', ?3, ?4, 'ROTATION', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        rotation.id,
        rotation.version + 1,
        JSON.stringify({
          reason: command.payload.reason,
          ticketGroupId: rotation.ticket_group_id,
          returnedToQueueSequence: 1,
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
        `UPDATE tickets SET status = CASE
            WHEN attendance_status = 'CHECKED_IN' THEN 'CHECKED_IN' ELSE 'QUEUED' END
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
