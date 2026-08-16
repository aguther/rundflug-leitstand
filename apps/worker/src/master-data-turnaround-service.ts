import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}
export class MasterDataTurnaroundService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

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
}
