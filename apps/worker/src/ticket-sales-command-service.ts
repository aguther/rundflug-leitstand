import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import {
  assertSaleAllowed,
  DomainRuleError,
  formatBookingGroupLabel,
  planBookingGroupSplit,
} from "@rundflug/domain";
import { allocatePublicSaleCodes, PublicCodeAllocationError } from "./public-code-service";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class TicketSalesCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleTicketSale(
    command: Extract<CommandEnvelope, { type: "SELL_TICKET_GROUP" }>,
    current: StoredEventRow,
    operatorAccountId: string | null,
  ): Promise<Response> {
    const salePreflightStartedAt = performance.now();
    const product = await this.env.DB.prepare(
      `SELECT p.id, p.code, p.name, p.resource_group_id, p.gate_id, g.label AS gate_label,
          p.price_cents, p.sale_enabled, p.sale_closes_at, p.weight_classes_json,
          rg.status AS resource_group_status,
          (SELECT COALESCE(MAX(a.passenger_seats), 0)
             FROM resource_group_memberships m
             JOIN aircraft a ON a.id = m.aircraft_id
            WHERE m.operation_day_id = p.operation_day_id
              AND m.resource_group_id = p.resource_group_id
              AND m.active_until IS NULL) AS effective_group_capacity
     FROM products p
     JOIN resource_groups rg ON rg.id = p.resource_group_id
     JOIN gates g ON g.id = p.gate_id
    WHERE p.id = ?1 AND p.operation_day_id = ?2`,
    )
      .bind(command.payload.productId, command.eventId)
      .first<{
        id: string;
        code: string;
        name: string;
        resource_group_id: string;
        gate_id: string;
        gate_label: string;
        price_cents: number;
        sale_enabled: number;
        sale_closes_at: string | null;
        weight_classes_json: string;
        resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
        effective_group_capacity: number;
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
    const effectiveGroupCapacity = product.effective_group_capacity;
    if (effectiveGroupCapacity === 0) {
      return json(
        {
          error: {
            code: "SALE_BLOCKED_NO_AIRCRAFT",
            message: "Der Ressourcengruppe ist kein aktives Flugzeug zugeordnet.",
          },
        },
        { status: 409 },
      );
    }
    let splitPlan: ReturnType<typeof planBookingGroupSplit>;
    try {
      splitPlan = planBookingGroupSplit({
        groupSize: command.payload.ticketCount,
        referenceCapacity: effectiveGroupCapacity,
        splitAcknowledged: command.payload.oversizeSplitAcknowledged,
      });
    } catch (reason: unknown) {
      if (reason instanceof DomainRuleError) {
        return json({ error: { code: reason.code, message: reason.message } }, { status: 409 });
      }
      throw reason;
    }
    const requiredFlightGroupCount = splitPlan.slotSizes.length;

    const allowedWeightClasses = JSON.parse(product.weight_classes_json) as Array<
      "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
    >;
    const ticketDetailsProvided = command.payload.ticketDetails !== undefined;
    const ticketDetails =
      command.payload.ticketDetails ??
      Array.from({ length: command.payload.ticketCount }, () => ({
        weightClass: "NOT_CAPTURED" as const,
        individualWeightKg: null,
      }));
    if (ticketDetails.length !== command.payload.ticketCount) {
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
      ticketDetailsProvided &&
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
    let publicCodes: Awaited<ReturnType<typeof allocatePublicSaleCodes>>;
    try {
      publicCodes = await allocatePublicSaleCodes(this.env.DB, command.payload.ticketCount);
    } catch (reason: unknown) {
      if (reason instanceof PublicCodeAllocationError) {
        return json(
          {
            error: {
              code: "PUBLIC_CODE_ALLOCATION_FAILED",
              message: "Öffentliche Ticketcodes konnten nicht sicher reserviert werden.",
            },
          },
          { status: 503 },
        );
      }
      throw reason;
    }
    const { groupCode, groupCodeHash, ticketCodes, ticketCodeHashes } = publicCodes;
    const saleState = await this.env.DB.prepare(
      `SELECT
     (SELECT COALESCE(MAX(tg.queue_sequence), 0) + 1
        FROM ticket_groups tg
        JOIN products p ON p.id = tg.product_id
       WHERE tg.operation_day_id = ? AND p.resource_group_id = ?) AS next_queue_sequence,
     (SELECT COALESCE(MAX(communication_number), 100) + 1
        FROM flight_groups
       WHERE operation_day_id = ? AND resource_group_id = ?) AS next_flight_number,
     (SELECT COALESCE(MAX(communication_number), 100) + 1
        FROM ticket_groups
       WHERE operation_day_id = ?) AS next_ticket_number`,
    )
      .bind(
        command.eventId,
        product.resource_group_id,
        command.eventId,
        product.resource_group_id,
        command.eventId,
      )
      .first<{
        next_queue_sequence: number;
        next_flight_number: number;
        next_ticket_number: number;
      }>();
    const splitAcrossFlightGroups = splitPlan.splitAcknowledged;
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const ticketGroupId = crypto.randomUUID();
    const ticketCommunicationNumber = saleState?.next_ticket_number ?? 101;
    const slots = Array.from({ length: requiredFlightGroupCount }, (_, index) => ({
      flightGroupId: crypto.randomUUID(),
      rotationId: crypto.randomUUID(),
      communicationNumber: (saleState?.next_flight_number ?? 101) + index,
      bookingSegmentOrder: index + 1,
    }));
    const primarySlot = slots[0];
    if (!primarySlot) throw new Error("Mindestens ein Fluggruppen-Slot wurde erwartet.");
    const ticketIds = ticketCodeHashes.map(() => crypto.randomUUID());
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
      saleReceipt: {
        ticketGroupId,
        eventName: current.name,
        productName: product.name,
        gateLabel: product.gate_label,
        communicationLabel: formatBookingGroupLabel(product.code, ticketCommunicationNumber),
        code: groupCode,
        groupSize: ticketCodes.length,
        ticketCodes,
      },
    };
    const stateChangeResult: CommandResult = {
      accepted: result.accepted,
      duplicate: result.duplicate,
      event: result.event,
      eventType: result.eventType,
      aggregate: result.aggregate,
    };
    const statements = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      this.env.DB.prepare(`INSERT INTO ticket_groups
    (id, operation_day_id, product_id, queue_sequence, communication_number, standby,
     status, sold_at, version, public_status_code_hash, public_status_code,
     sold_by_operator_account_id)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'QUEUED', ?7, 0, ?8, ?9, ?10)`).bind(
        ticketGroupId,
        command.eventId,
        product.id,
        saleState?.next_queue_sequence ?? 1,
        ticketCommunicationNumber,
        command.payload.standby ? 1 : 0,
        now,
        groupCodeHash,
        groupCode,
        operatorAccountId,
      ),
      ...slots.flatMap((slot) => [
        this.env.DB.prepare(`INSERT INTO flight_groups
          (id, operation_day_id, resource_group_id, product_id, communication_number,
           status, version, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, 'DRAFT', 0, ?6, ?6)`).bind(
          slot.flightGroupId,
          command.eventId,
          product.resource_group_id,
          product.id,
          slot.communicationNumber,
          now,
        ),
        this.env.DB.prepare(`INSERT INTO rotations
          (id, operation_day_id, flight_group_id, gate_id, booking_segment_order,
           status, version, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, 'DRAFT', 0, ?6, ?6)`).bind(
          slot.rotationId,
          command.eventId,
          slot.flightGroupId,
          product.gate_id,
          slot.bookingSegmentOrder,
          now,
        ),
      ]),
      ...ticketCodeHashes.flatMap((hash, index) => {
        const slotIndex = splitAcrossFlightGroups ? Math.floor(index / effectiveGroupCapacity) : 0;
        const ticketSlot = slots[slotIndex];
        if (!ticketSlot) throw new Error("Fluggruppen-Slot für Ticket fehlt.");
        return [
          this.env.DB.prepare(`INSERT INTO tickets
        (id, ticket_group_id, public_code_hash, public_code, status, weight_class,
         individual_weight_kg, payment_status, payment_method, price_cents, created_at)
        VALUES (?1, ?2, ?3, ?4, 'QUEUED', ?5, ?6, ?7, ?8, ?9, ?10)`).bind(
            ticketIds[index],
            ticketGroupId,
            hash,
            ticketCodes[index],
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
          joinedExistingFlightGroup: false,
          oversizeSplitAcknowledged: splitPlan.splitAcknowledged,
          slotSizes: splitPlan.slotSizes,
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
      ).bind(crypto.randomUUID(), command.eventId, JSON.stringify(stateChangeResult), now),
    ];
    const salePersistStartedAt = performance.now();
    await this.env.DB.batch(statements);
    const salePersistCompletedAt = performance.now();
    this.broadcast(result);
    const response = json(result);
    response.headers.set(
      "server-timing",
      `sale-preflight;dur=${(salePersistStartedAt - salePreflightStartedAt).toFixed(1)}, sale-persist;dur=${(salePersistCompletedAt - salePersistStartedAt).toFixed(1)}`,
    );
    return response;
  }
}
