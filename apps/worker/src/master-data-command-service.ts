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

export class MasterDataCommandService {
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
    let eventType: "GATE_UPSERTED" | "PRODUCT_UPSERTED";
    let aggregate: { type: "GATE" | "PRODUCT"; id: string };
    let mutation: D1PreparedStatement;
    let auditPayload: Record<string, unknown>;

    if (command.type === "UPSERT_GATE") {
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
      eventType = "GATE_UPSERTED";
      aggregate = { type: "GATE", id: command.payload.gateId };
      auditPayload = {
        label: command.payload.label,
        gateType: command.payload.gateType,
        active: command.payload.active,
        sortOrder: command.payload.sortOrder,
        travelLeadMinutes: command.payload.travelLeadMinutes,
        displayFilter,
        reason: command.payload.reason,
      };
      mutation = this.env.DB.prepare(
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
      );
    } else {
      const [resourceGroup, gate, duplicateCode, existing, nextOrder] = await Promise.all([
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
      eventType = "PRODUCT_UPSERTED";
      aggregate = { type: "PRODUCT", id: command.payload.productId };
      const cashierSortOrder = existing?.sort_order ?? nextOrder?.next_sort_order ?? 10;
      auditPayload = {
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
      mutation = this.env.DB.prepare(
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

  async handleAircraftProductTurnaroundOverride(
    command: Extract<
      CommandEnvelope,
      {
        type:
          | "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"
          | "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE";
      }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    const [product, aircraft, existing] = await Promise.all([
      this.env.DB.prepare("SELECT id FROM products WHERE id = ?1 AND operation_day_id = ?2")
        .bind(command.payload.productId, command.eventId)
        .first<{ id: string }>(),
      this.env.DB.prepare(
        `SELECT a.id
           FROM aircraft a
          WHERE a.id = ?1
            AND EXISTS (
              SELECT 1 FROM resource_group_memberships membership
               WHERE membership.aircraft_id = a.id
                 AND membership.operation_day_id = ?2
            )`,
      )
        .bind(command.payload.aircraftId, command.eventId)
        .first<{ id: string }>(),
      this.env.DB.prepare(
        `SELECT version
           FROM aircraft_product_turnaround_overrides
          WHERE operation_day_id = ?1 AND aircraft_id = ?2 AND product_id = ?3`,
      )
        .bind(command.eventId, command.payload.aircraftId, command.payload.productId)
        .first<{ version: number }>(),
    ]);
    if (!product || !aircraft) {
      return json(
        {
          error: {
            code: "TURNAROUND_OVERRIDE_REFERENCE_INVALID",
            message: "Produkt oder Flugzeug gehört nicht zu dieser Veranstaltung.",
          },
        },
        { status: 409 },
      );
    }
    if (command.type === "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE" && !existing) {
      return json(
        {
          error: {
            code: "TURNAROUND_OVERRIDE_NOT_FOUND",
            message: "Die Flugzeugausnahme ist nicht mehr vorhanden.",
          },
        },
        { status: 404 },
      );
    }
    const expectedOverrideVersion = command.payload.expectedOverrideVersion;
    if (
      (existing && expectedOverrideVersion !== existing.version) ||
      (!existing && expectedOverrideVersion !== undefined && expectedOverrideVersion !== 0)
    ) {
      return json(
        {
          error: {
            code: "TURNAROUND_OVERRIDE_STALE_VERSION",
            message: "Die Flugzeugausnahme wurde zwischenzeitlich geändert.",
            currentVersion: existing?.version ?? 0,
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventType =
      command.type === "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"
        ? "AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE_UPSERTED"
        : "AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE_DELETED";
    const aggregateId = `${command.payload.aircraftId}:${command.payload.productId}`;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType,
      aggregate: { type: "AIRCRAFT", id: command.payload.aircraftId },
    };
    const mutation =
      command.type === "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"
        ? this.env.DB.prepare(
            `INSERT INTO aircraft_product_turnaround_overrides
              (operation_day_id, aircraft_id, product_id, planned_boarding_minutes_override,
               planned_deboarding_minutes_override, planned_buffer_minutes_override, version,
               created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)
             ON CONFLICT(operation_day_id, aircraft_id, product_id) DO UPDATE SET
               planned_boarding_minutes_override =
                 excluded.planned_boarding_minutes_override,
               planned_deboarding_minutes_override =
                 excluded.planned_deboarding_minutes_override,
               planned_buffer_minutes_override = excluded.planned_buffer_minutes_override,
               version = aircraft_product_turnaround_overrides.version + 1,
               updated_at = excluded.updated_at`,
          ).bind(
            command.eventId,
            command.payload.aircraftId,
            command.payload.productId,
            command.payload.plannedBoardingMinutesOverride,
            command.payload.plannedDeboardingMinutesOverride,
            command.payload.plannedBufferMinutesOverride,
            now,
          )
        : this.env.DB.prepare(
            `DELETE FROM aircraft_product_turnaround_overrides
              WHERE operation_day_id = ?1 AND aircraft_id = ?2 AND product_id = ?3
                AND version = ?4`,
          ).bind(
            command.eventId,
            command.payload.aircraftId,
            command.payload.productId,
            command.payload.expectedOverrideVersion,
          );
    const auditPayload =
      command.type === "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"
        ? {
            aircraftId: command.payload.aircraftId,
            productId: command.payload.productId,
            plannedBoardingMinutesOverride: command.payload.plannedBoardingMinutesOverride,
            plannedDeboardingMinutesOverride: command.payload.plannedDeboardingMinutesOverride,
            plannedBufferMinutesOverride: command.payload.plannedBufferMinutesOverride,
            priorVersion: existing?.version ?? null,
            reason: command.payload.reason,
          }
        : {
            aircraftId: command.payload.aircraftId,
            productId: command.payload.productId,
            deletedVersion: existing?.version ?? null,
            reason: command.payload.reason,
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
         VALUES (?1, ?2, ?3, ?4, ?5, 'AIRCRAFT', ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        eventType,
        now,
        command.deviceId,
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
    ]);
    this.broadcast(result);
    return json(result);
  }

  async handleCashierProductReorder(
    command: Extract<CommandEnvelope, { type: "REORDER_CASHIER_PRODUCTS" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    const products = await this.env.DB.prepare(
      `SELECT id
         FROM products
        WHERE operation_day_id = ?1
        ORDER BY sort_order, name, id`,
    )
      .bind(command.eventId)
      .all<{ id: string }>();
    const currentProductIds = products.results.map((product) => product.id);
    const expectedProductIds = command.payload.expectedProductIds;
    const orderedProductIds = command.payload.orderedProductIds;
    const sameOrder = (left: readonly string[], right: readonly string[]) =>
      left.length === right.length && left.every((value, index) => value === right[index]);

    if (!sameOrder(currentProductIds, expectedProductIds)) {
      return json(
        {
          error: {
            code: "CASHIER_PRODUCT_ORDER_CONFLICT",
            message:
              "Die Kassenreihenfolge oder die Produktliste wurde zwischenzeitlich geändert. Bitte neu laden.",
            currentVersion: current.version,
          },
        },
        { status: 409 },
      );
    }

    const currentIds = new Set(currentProductIds);
    if (
      orderedProductIds.length !== currentProductIds.length ||
      orderedProductIds.some((productId) => !currentIds.has(productId))
    ) {
      return json(
        {
          error: {
            code: "CASHIER_PRODUCT_ORDER_INVALID",
            message:
              "Die Kassenreihenfolge muss jedes Produkt der Veranstaltung genau einmal enthalten.",
          },
        },
        { status: 409 },
      );
    }

    if (sameOrder(currentProductIds, orderedProductIds)) {
      return json(
        {
          error: {
            code: "CASHIER_PRODUCT_ORDER_UNCHANGED",
            message: "Die Kassenreihenfolge wurde nicht verändert.",
          },
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const result: CommandResult = {
      accepted: true,
      duplicate: false,
      event: rowToSnapshot({ ...current, version: nextVersion, updated_at: now }),
      eventType: "CASHIER_PRODUCT_ORDER_CHANGED",
      aggregate: { type: "OPERATION_DAY", id: command.eventId },
    };
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE operation_days SET version = ?1, updated_at = ?2 WHERE id = ?3 AND version = ?4",
      ).bind(nextVersion, now, command.eventId, current.version),
      ...orderedProductIds.map((productId, index) =>
        this.env.DB.prepare(
          `UPDATE products
              SET sort_order = ?1, updated_at = ?2
            WHERE id = ?3 AND operation_day_id = ?4`,
        ).bind((index + 1) * 10, now, productId, command.eventId),
      ),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'CASHIER_PRODUCT_ORDER_CHANGED', ?3, ?4, 'OPERATION_DAY', ?2, ?5, ?6)`,
      ).bind(
        crypto.randomUUID(),
        command.eventId,
        now,
        command.deviceId,
        nextVersion,
        JSON.stringify({
          previousProductIds: currentProductIds,
          orderedProductIds,
          affectsOperationalPriority: false,
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
    ];

    await this.env.DB.batch(statements);
    this.broadcast(result);
    return json(result);
  }

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

    const { entityId, entityType } = command.payload;
    const blockers: string[] = [];
    let label = entityId;
    let eventType: string;
    let aggregate: NonNullable<CommandResult["aggregate"]>;
    let deletion: D1PreparedStatement;
    let removedMembershipCount = 0;

    if (entityType === "GATE") {
      const [entity, groups, products, rotations] = await Promise.all([
        this.env.DB.prepare("SELECT label FROM gates WHERE id = ?1 AND operation_day_id = ?2")
          .bind(entityId, command.eventId)
          .first<{ label: string }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM resource_groups WHERE gate_id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ count: number }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM products WHERE gate_id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ count: number }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM rotations WHERE gate_id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ count: number }>(),
      ]);
      if (!entity)
        return json(
          { error: { code: "GATE_NOT_FOUND", message: "Gate nicht gefunden." } },
          { status: 404 },
        );
      label = entity.label;
      if ((groups?.count ?? 0) > 0) blockers.push(`${groups?.count} Ressourcengruppe(n)`);
      if ((products?.count ?? 0) > 0) blockers.push(`${products?.count} Produkt(e)`);
      if ((rotations?.count ?? 0) > 0) blockers.push(`${rotations?.count} Umlauf/Umläufe`);
      eventType = "GATE_DELETED";
      aggregate = { type: "GATE", id: entityId };
      deletion = this.env.DB.prepare(
        "DELETE FROM gates WHERE id = ?1 AND operation_day_id = ?2",
      ).bind(entityId, command.eventId);
    } else if (entityType === "RESOURCE_GROUP") {
      const [entity, products, memberships, flightGroups] = await Promise.all([
        this.env.DB.prepare(
          "SELECT name FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ name: string }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM products WHERE resource_group_id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ count: number }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM resource_group_memberships WHERE resource_group_id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ count: number }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM flight_groups WHERE resource_group_id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ count: number }>(),
      ]);
      if (!entity)
        return json(
          {
            error: {
              code: "RESOURCE_GROUP_NOT_FOUND",
              message: "Ressourcengruppe nicht gefunden.",
            },
          },
          { status: 404 },
        );
      label = entity.name;
      if ((products?.count ?? 0) > 0) blockers.push(`${products?.count} Produkt(e)`);
      if ((memberships?.count ?? 0) > 0)
        blockers.push(`${memberships?.count} Flugzeugzuordnung(en)`);
      if ((flightGroups?.count ?? 0) > 0) blockers.push(`${flightGroups?.count} Fluggruppe(n)`);
      eventType = "RESOURCE_GROUP_DELETED";
      aggregate = { type: "RESOURCE_GROUP", id: entityId };
      deletion = this.env.DB.prepare(
        "DELETE FROM resource_groups WHERE id = ?1 AND operation_day_id = ?2",
      ).bind(entityId, command.eventId);
    } else if (entityType === "PRODUCT") {
      const [entity, ticketGroups] = await Promise.all([
        this.env.DB.prepare("SELECT name FROM products WHERE id = ?1 AND operation_day_id = ?2")
          .bind(entityId, command.eventId)
          .first<{ name: string }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM ticket_groups WHERE product_id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ count: number }>(),
      ]);
      if (!entity)
        return json(
          { error: { code: "PRODUCT_NOT_FOUND", message: "Produkt nicht gefunden." } },
          { status: 404 },
        );
      label = entity.name;
      if ((ticketGroups?.count ?? 0) > 0) blockers.push(`${ticketGroups?.count} Ticketgruppe(n)`);
      eventType = "PRODUCT_DELETED";
      aggregate = { type: "PRODUCT", id: entityId };
      deletion = this.env.DB.prepare(
        "DELETE FROM products WHERE id = ?1 AND operation_day_id = ?2",
      ).bind(entityId, command.eventId);
    } else if (entityType === "PILOT") {
      const [entity, rotations, aircraft] = await Promise.all([
        this.env.DB.prepare(
          "SELECT operational_code FROM pilots WHERE id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ operational_code: string }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM rotations WHERE pilot_id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ count: number }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM resource_group_memberships WHERE current_pilot_id = ?1 AND operation_day_id = ?2",
        )
          .bind(entityId, command.eventId)
          .first<{ count: number }>(),
      ]);
      if (!entity)
        return json(
          { error: { code: "PILOT_NOT_FOUND", message: "Pilotencode nicht gefunden." } },
          { status: 404 },
        );
      label = entity.operational_code;
      if ((rotations?.count ?? 0) > 0) blockers.push(`${rotations?.count} Umlauf/Umläufe`);
      if ((aircraft?.count ?? 0) > 0) blockers.push(`${aircraft?.count} Flugzeugbindung(en)`);
      eventType = "PILOT_DELETED";
      aggregate = { type: "PILOT", id: entityId };
      deletion = this.env.DB.prepare(
        "DELETE FROM pilots WHERE id = ?1 AND operation_day_id = ?2",
      ).bind(entityId, command.eventId);
    } else if (entityType === "AIRCRAFT") {
      const [entity, memberships, rotations] = await Promise.all([
        this.env.DB.prepare("SELECT registration FROM aircraft WHERE id = ?1")
          .bind(entityId)
          .first<{ registration: string }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM resource_group_memberships WHERE aircraft_id = ?1",
        )
          .bind(entityId)
          .first<{ count: number }>(),
        this.env.DB.prepare("SELECT COUNT(*) AS count FROM rotations WHERE aircraft_id = ?1")
          .bind(entityId)
          .first<{ count: number }>(),
      ]);
      if (!entity)
        return json(
          { error: { code: "AIRCRAFT_NOT_FOUND", message: "Flugzeug nicht gefunden." } },
          { status: 404 },
        );
      label = entity.registration;
      if ((memberships?.count ?? 0) > 0)
        blockers.push(`${memberships?.count} Flugzeugzuordnung(en)`);
      if ((rotations?.count ?? 0) > 0) blockers.push(`${rotations?.count} Umlauf/Umläufe`);
      eventType = "AIRCRAFT_DELETED";
      aggregate = { type: "AIRCRAFT", id: entityId };
      deletion = this.env.DB.prepare("DELETE FROM aircraft WHERE id = ?1").bind(entityId);
    } else {
      const [memberships, rotations] = await Promise.all([
        this.env.DB.prepare(
          `SELECT m.id, a.registration FROM resource_group_memberships m
             JOIN aircraft a ON a.id = m.aircraft_id
            WHERE m.operation_day_id = ?1 AND m.aircraft_id = ?2`,
        )
          .bind(command.eventId, entityId)
          .all<{ id: string; registration: string }>(),
        this.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM rotations WHERE operation_day_id = ?1 AND aircraft_id = ?2",
        )
          .bind(command.eventId, entityId)
          .first<{ count: number }>(),
      ]);
      if (memberships.results.length === 0) {
        return json(
          { error: { code: "ASSIGNMENT_NOT_FOUND", message: "Flugzeugzuordnung nicht gefunden." } },
          { status: 404 },
        );
      }
      label = memberships.results[0]?.registration ?? entityId;
      if ((rotations?.count ?? 0) > 0) blockers.push(`${rotations?.count} Umlauf/Umläufe`);
      removedMembershipCount = memberships.results.length;
      eventType = "AIRCRAFT_RESOURCE_GROUP_ASSIGNMENT_DELETED";
      aggregate = { type: "AIRCRAFT", id: entityId };
      deletion = this.env.DB.prepare(
        "DELETE FROM resource_group_memberships WHERE operation_day_id = ?1 AND aircraft_id = ?2",
      ).bind(command.eventId, entityId);
    }

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

  async handleResourceAndAircraftMasterData(
    command: Extract<
      CommandEnvelope,
      {
        type: "UPSERT_RESOURCE_GROUP" | "UPSERT_AIRCRAFT" | "ASSIGN_AIRCRAFT_RESOURCE_GROUP";
      }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
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
      const [gate, duplicateName, duplicateShortCode] = await Promise.all([
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
        this.env.DB.prepare(
          "SELECT id FROM resource_groups WHERE operation_day_id = ?1 AND short_code = ?2 AND id <> ?3",
        )
          .bind(command.eventId, command.payload.shortCode, command.payload.resourceGroupId)
          .first<{ id: string }>(),
      ]);
      if (!gate || duplicateName || duplicateShortCode) {
        return json(
          {
            error: {
              code: duplicateName
                ? "RESOURCE_GROUP_NAME_EXISTS"
                : duplicateShortCode
                  ? "RESOURCE_GROUP_SHORT_CODE_EXISTS"
                  : "GATE_NOT_AVAILABLE",
              message: duplicateName
                ? "Ressourcengruppen-Bezeichnung ist bereits vergeben."
                : duplicateShortCode
                  ? "Ressourcengruppen-Kurzzeichen ist bereits vergeben."
                  : "Das ausgewählte Gate ist nicht aktiv verfügbar.",
            },
          },
          { status: 409 },
        );
      }
      const desiredAircraftIds = [...new Set(command.payload.aircraftIds ?? [])];
      const [availableAircraft, activeMemberships, activeRotations] = await Promise.all([
        this.env.DB.prepare("SELECT id FROM aircraft").all<{ id: string }>(),
        this.env.DB.prepare(
          `SELECT id, aircraft_id, resource_group_id FROM resource_group_memberships
            WHERE operation_day_id = ?1 AND active_until IS NULL`,
        )
          .bind(command.eventId)
          .all<{ id: string; aircraft_id: string; resource_group_id: string }>(),
        this.env.DB.prepare(
          `SELECT aircraft_id FROM rotations WHERE operation_day_id = ?1
            AND aircraft_id IS NOT NULL AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')`,
        )
          .bind(command.eventId)
          .all<{ aircraft_id: string }>(),
      ]);
      const knownAircraftIds = new Set(availableAircraft.results.map((aircraft) => aircraft.id));
      if (desiredAircraftIds.some((aircraftId) => !knownAircraftIds.has(aircraftId))) {
        return json(
          {
            error: {
              code: "RESOURCE_GROUP_AIRCRAFT_INVALID",
              message: "Mindestens ein ausgewähltes Flugzeug ist nicht mehr verfügbar.",
            },
          },
          { status: 409 },
        );
      }
      const desiredAircraftIdSet = new Set(desiredAircraftIds);
      const changedAircraftIds = new Set(
        activeMemberships.results
          .filter(
            (membership) =>
              (membership.resource_group_id === command.payload.resourceGroupId &&
                !desiredAircraftIdSet.has(membership.aircraft_id)) ||
              (desiredAircraftIdSet.has(membership.aircraft_id) &&
                membership.resource_group_id !== command.payload.resourceGroupId),
          )
          .map((membership) => membership.aircraft_id),
      );
      const activeAircraftIds = new Set(
        activeRotations.results.map((rotation) => rotation.aircraft_id),
      );
      if ([...changedAircraftIds].some((aircraftId) => activeAircraftIds.has(aircraftId))) {
        return json(
          {
            error: {
              code: "AIRCRAFT_LIFECYCLE_ACTIVE",
              message: "Flugzeugzuordnungen sind während eines aktiven Umlaufs gesperrt.",
            },
          },
          { status: 409 },
        );
      }
      eventType = "RESOURCE_GROUP_UPSERTED";
      aggregate = { type: "RESOURCE_GROUP", id: command.payload.resourceGroupId };
      auditPayload = {
        name: command.payload.name,
        shortCode: command.payload.shortCode,
        gateId: command.payload.gateId,
        referenceCapacity: command.payload.referenceCapacity,
        compatibleAircraftTypes: command.payload.compatibleAircraftTypes,
        automaticPrecallEnabled: command.payload.automaticPrecallEnabled,
        aircraftIds: desiredAircraftIds,
        reason: command.payload.reason,
      };
      mutations.push(
        this.env.DB.prepare(
          `INSERT INTO resource_groups
            (id, operation_day_id, name, short_code, status, gate_id, reference_capacity,
             compatible_aircraft_types_json, automatic_precall_enabled,
             version, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'ACTIVE', ?5, ?6, ?7, ?8, 0, ?9, ?9)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, short_code = excluded.short_code,
            gate_id = excluded.gate_id,
            reference_capacity = excluded.reference_capacity,
            compatible_aircraft_types_json = excluded.compatible_aircraft_types_json,
            automatic_precall_enabled = excluded.automatic_precall_enabled,
            version = resource_groups.version + 1, updated_at = excluded.updated_at
           WHERE resource_groups.operation_day_id = excluded.operation_day_id`,
        ).bind(
          command.payload.resourceGroupId,
          command.eventId,
          command.payload.name,
          command.payload.shortCode,
          command.payload.gateId,
          command.payload.referenceCapacity,
          JSON.stringify([...new Set(command.payload.compatibleAircraftTypes)]),
          command.payload.automaticPrecallEnabled ? 1 : 0,
          now,
        ),
      );
      if (command.payload.aircraftIds) {
        for (const membership of activeMemberships.results) {
          if (
            membership.resource_group_id === command.payload.resourceGroupId &&
            !desiredAircraftIdSet.has(membership.aircraft_id)
          ) {
            mutations.push(
              this.env.DB.prepare(
                "UPDATE resource_group_memberships SET active_until = ?1 WHERE id = ?2 AND active_until IS NULL",
              ).bind(now, membership.id),
            );
          }
        }
        for (const aircraftId of desiredAircraftIds) {
          const activeMembership = activeMemberships.results.find(
            (membership) => membership.aircraft_id === aircraftId,
          );
          if (activeMembership?.resource_group_id === command.payload.resourceGroupId) continue;
          if (activeMembership) {
            mutations.push(
              this.env.DB.prepare(
                "UPDATE resource_group_memberships SET active_until = ?1 WHERE id = ?2 AND active_until IS NULL",
              ).bind(now, activeMembership.id),
            );
          }
          mutations.push(
            this.env.DB.prepare(
              `INSERT INTO resource_group_memberships
                (id, operation_day_id, resource_group_id, aircraft_id, active_from, active_until,
                 created_at, change_reason, changed_by_device_id)
               VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?5, ?6, ?7)`,
            ).bind(
              crypto.randomUUID(),
              command.eventId,
              command.payload.resourceGroupId,
              aircraftId,
              now,
              command.payload.reason,
              command.deviceId,
            ),
          );
        }
      }
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
             operational_state_changed_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
           ON CONFLICT(id) DO UPDATE SET registration = excluded.registration,
            aircraft_type = excluded.aircraft_type, passenger_seats = excluded.passenger_seats,
            maximum_passenger_payload_kg = excluded.maximum_passenger_payload_kg,
            version = aircraft.version + 1, updated_at = excluded.updated_at`,
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
}
