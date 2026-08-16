import {
  type CommandEnvelope,
  type CommandResult,
  type GateDisplayFilter,
  gateDisplayFilterSchema,
} from "@rundflug/contracts";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

type GateUpsertCommand = Extract<CommandEnvelope, { type: "UPSERT_GATE" }>;

interface MasterDataMutationPlan {
  eventType: "GATE_UPSERTED" | "PRODUCT_UPSERTED";
  aggregate: { type: "GATE" | "PRODUCT"; id: string };
  mutation: D1PreparedStatement;
  auditPayload: Record<string, unknown>;
}
export class MasterDataGateProductService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleMasterData(
    command: Extract<CommandEnvelope, { type: "UPSERT_GATE" | "UPSERT_PRODUCT" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const plan =
      command.type === "UPSERT_GATE"
        ? await this.prepareGateUpsert(command, now)
        : await this.prepareProductUpsert(command, now);
    if (plan instanceof Response) return plan;
    const { eventType, aggregate, mutation, auditPayload } = plan;

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

  private async prepareProductUpsert(
    command: Extract<CommandEnvelope, { type: "UPSERT_PRODUCT" }>,
    now: string,
  ): Promise<MasterDataMutationPlan | Response> {
    const [resourceGroup, gate, duplicateCode, existing, nextOrder] = await Promise.all([
      this.env.DB.prepare("SELECT id FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2")
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
        `SELECT p.resource_group_id, p.sort_order,
              (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
                WHERE tg.product_id = p.id AND t.status NOT IN ('CANCELED', 'COMPLETED')) AS open_tickets
             FROM products p WHERE p.id = ?1 AND p.operation_day_id = ?2`,
      )
        .bind(command.payload.productId, command.eventId)
        .first<{ resource_group_id: string; sort_order: number; open_tickets: number }>(),
      this.env.DB.prepare(
        "SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_sort_order FROM products WHERE operation_day_id = ?1",
      )
        .bind(command.eventId)
        .first<{ next_sort_order: number }>(),
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
    const eventType = "PRODUCT_UPSERTED";
    const aggregate: MasterDataMutationPlan["aggregate"] = {
      type: "PRODUCT",
      id: command.payload.productId,
    };
    const cashierSortOrder = existing?.sort_order ?? nextOrder?.next_sort_order ?? 10;
    const auditPayload = {
      resourceGroupId: command.payload.resourceGroupId,
      gateId: command.payload.gateId,
      name: command.payload.name,
      code: command.payload.code,
      publicDescription: command.payload.publicDescription,
      priceCents: command.payload.priceCents,
      referenceCapacity: command.payload.referenceCapacity,
      referenceDurationMinutes: command.payload.referenceDurationMinutes,
      promisedFlightMinutes: command.payload.promisedFlightMinutes,
      plannedBoardingMinutesOverride: command.payload.plannedBoardingMinutesOverride,
      plannedDeboardingMinutesOverride: command.payload.plannedDeboardingMinutesOverride,
      plannedBufferMinutesOverride: command.payload.plannedBufferMinutesOverride,
      childCompanionRequired: command.payload.childCompanionRequired,
      weightClasses: command.payload.weightClasses,
      cashierSortOrder,
      reason: command.payload.reason,
    };
    const mutation = this.env.DB.prepare(
      `INSERT INTO products
            (id, operation_day_id, resource_group_id, gate_id, name, code, public_description,
             price_cents, sale_enabled, reference_capacity, reference_duration_minutes,
             promised_flight_minutes, planned_boarding_minutes_override,
             planned_deboarding_minutes_override, planned_buffer_minutes_override,
             child_companion_required, weight_classes_json, sort_order, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11, ?12, ?13, ?14,
                   ?15, ?16, ?17, ?18, ?18)
           ON CONFLICT(id) DO UPDATE SET resource_group_id = excluded.resource_group_id,
            gate_id = excluded.gate_id, name = excluded.name, code = excluded.code,
            public_description = excluded.public_description, price_cents = excluded.price_cents,
             reference_capacity = excluded.reference_capacity,
             reference_duration_minutes = excluded.reference_duration_minutes,
             promised_flight_minutes = excluded.promised_flight_minutes,
             planned_boarding_minutes_override = excluded.planned_boarding_minutes_override,
             planned_deboarding_minutes_override = excluded.planned_deboarding_minutes_override,
             planned_buffer_minutes_override = excluded.planned_buffer_minutes_override,
             child_companion_required = excluded.child_companion_required,
             weight_classes_json = excluded.weight_classes_json,
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
      command.payload.promisedFlightMinutes,
      command.payload.plannedBoardingMinutesOverride,
      command.payload.plannedDeboardingMinutesOverride,
      command.payload.plannedBufferMinutesOverride,
      command.payload.childCompanionRequired ? 1 : 0,
      JSON.stringify(command.payload.weightClasses),
      cashierSortOrder,
      now,
    );
    return { eventType, aggregate, mutation, auditPayload };
  }

  private async prepareGateUpsert(
    command: GateUpsertCommand,
    now: string,
  ): Promise<MasterDataMutationPlan | Response> {
    const [duplicate, existing] = await Promise.all([
      this.env.DB.prepare(
        "SELECT id FROM gates WHERE operation_day_id = ?1 AND label = ?2 AND id <> ?3",
      )
        .bind(command.eventId, command.payload.label, command.payload.gateId)
        .first<{ id: string }>(),
      this.env.DB.prepare(
        "SELECT display_filter_json FROM gates WHERE id = ?1 AND operation_day_id = ?2",
      )
        .bind(command.payload.gateId, command.eventId)
        .first<{ display_filter_json: string }>(),
    ]);
    if (duplicate) {
      return json(
        {
          error: { code: "GATE_LABEL_EXISTS", message: "Gate-Bezeichnung ist bereits vergeben." },
        },
        { status: 409 },
      );
    }
    const displayFilter: GateDisplayFilter =
      command.payload.displayFilter ??
      (existing
        ? gateDisplayFilterSchema.parse(JSON.parse(existing.display_filter_json))
        : { productIds: [], rotationStatuses: [] });
    if (displayFilter.productIds.length > 0) {
      const placeholders = displayFilter.productIds.map((_, index) => `?${index + 2}`).join(",");
      const products = await this.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM products
            WHERE operation_day_id = ?1 AND id IN (${placeholders})`,
      )
        .bind(command.eventId, ...displayFilter.productIds)
        .first<{ count: number }>();
      if ((products?.count ?? 0) !== displayFilter.productIds.length) {
        return json(
          {
            error: {
              code: "GATE_DISPLAY_FILTER_REFERENCE_INVALID",
              message: "Der Anzeigefilter verweist auf ein unbekanntes Produkt.",
            },
          },
          { status: 409 },
        );
      }
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
    return {
      eventType: "GATE_UPSERTED",
      aggregate: { type: "GATE", id: command.payload.gateId },
      auditPayload: {
        label: command.payload.label,
        gateType: command.payload.gateType,
        active: command.payload.active,
        sortOrder: command.payload.sortOrder,
        travelLeadMinutes: command.payload.travelLeadMinutes,
        displayFilter,
        reason: command.payload.reason,
      },
      mutation: this.env.DB.prepare(
        `INSERT INTO gates
            (id, operation_day_id, label, gate_type, active, sort_order, travel_lead_minutes,
             display_filter_json, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
           ON CONFLICT(id) DO UPDATE SET label = excluded.label, gate_type = excluded.gate_type,
            active = excluded.active, sort_order = excluded.sort_order,
            travel_lead_minutes = excluded.travel_lead_minutes,
            display_filter_json = excluded.display_filter_json, updated_at = excluded.updated_at
           WHERE gates.operation_day_id = excluded.operation_day_id`,
      ).bind(
        command.payload.gateId,
        command.eventId,
        command.payload.label,
        command.payload.gateType,
        command.payload.active ? 1 : 0,
        command.payload.sortOrder,
        command.payload.travelLeadMinutes,
        JSON.stringify(displayFilter),
        now,
      ),
    };
  }
}
