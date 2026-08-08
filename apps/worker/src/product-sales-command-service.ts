import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { validateProductSalesUpdate } from "./product-sales-policy";
import { rowToSnapshot } from "./snapshot";
import type { Env, StoredEventRow } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class ProductSalesCommandService {
  constructor(
    private readonly env: Env,
    private readonly broadcast: (result: CommandResult) => void,
  ) {}

  async handleProductSalesConfiguration(
    command: Extract<CommandEnvelope, { type: "CONFIGURE_PRODUCT_SALES" }>,
    current: StoredEventRow,
  ): Promise<Response> {
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
      "SELECT id, sale_enabled FROM products WHERE id = ?1 AND operation_day_id = ?2",
    )
      .bind(command.payload.productId, command.eventId)
      .first<{ id: string; sale_enabled: number }>();
    if (!product) {
      return json(
        { error: { code: "PRODUCT_NOT_FOUND", message: "Produkt nicht gefunden." } },
        { status: 404 },
      );
    }
    const policyError = validateProductSalesUpdate(
      current.status,
      Boolean(product.sale_enabled),
      command.payload.saleEnabled,
    );
    if (policyError) {
      return json(
        {
          error: {
            code: policyError,
            message:
              policyError === "PRODUCT_SALES_EVENT_READ_ONLY"
                ? "Die Verkaufssteuerung ist nach Betriebsende nur lesbar."
                : "Die Live-Verkaufssteuerung ist erst nach Betriebsfreigabe verfügbar.",
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
}
