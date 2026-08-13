import { type CloneEventRequest, gateDisplayFilterSchema } from "@rundflug/contracts";
import {
  adminEventCloneErrorResult as errorResult,
  remapOptionalId,
} from "./admin-event-clone-support";
import type { Env } from "./types";

export interface AdminEventCloneResponse {
  eventId: string;
  templateSourceId: string;
  adminDeviceId?: string;
}

export interface AdminEventCloneErrorResponse {
  error: {
    code: "IDEMPOTENCY_CONFLICT" | "EVENT_ID_EXISTS" | "EVENT_NOT_FOUND" | "STALE_VERSION";
    message: string;
  };
}

export type AdminEventCloneResult =
  | { status: 200 | 201; body: AdminEventCloneResponse }
  | { status: 404 | 409; body: AdminEventCloneErrorResponse };

const defaultDependencies = {
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
};

type AdminEventCloneDependencies = typeof defaultDependencies;

export async function cloneAdminEvent(
  env: Env,
  sourceEventId: string,
  sourceAdminDeviceId: string,
  input: CloneEventRequest,
  dependencies: AdminEventCloneDependencies = defaultDependencies,
): Promise<AdminEventCloneResult> {
  const legacySourceCredential =
    env.APP_ENV === "development"
      ? await env.DB.prepare(
          `SELECT credential_hash FROM paired_devices
            WHERE id = ?1 AND operation_day_id = ?2 AND active = 1`,
        )
          .bind(sourceAdminDeviceId, sourceEventId)
          .first<{ credential_hash: string | null }>()
      : null;
  const receipt = await env.DB.prepare(
    `SELECT operation_day_id, device_id, response_json FROM idempotency_receipts
      WHERE command_id = ?1`,
  )
    .bind(input.commandId)
    .first<{ operation_day_id: string; device_id: string; response_json: string }>();
  if (receipt) {
    if (receipt.operation_day_id !== sourceEventId || receipt.device_id !== sourceAdminDeviceId) {
      return errorResult(409, "IDEMPOTENCY_CONFLICT", "Kommando-ID ist bereits belegt.");
    }
    return { status: 200, body: JSON.parse(receipt.response_json) as AdminEventCloneResponse };
  }

  const existing = await env.DB.prepare("SELECT id FROM operation_days WHERE id = ?1")
    .bind(input.eventId)
    .first();
  if (existing) {
    return errorResult(409, "EVENT_ID_EXISTS", "Diese Veranstaltungs-ID ist bereits vergeben.");
  }

  const source = await env.DB.prepare("SELECT * FROM operation_days WHERE id = ?1")
    .bind(sourceEventId)
    .first<Record<string, unknown>>();
  if (!source) {
    return errorResult(404, "EVENT_NOT_FOUND", "Vorveranstaltung nicht gefunden.");
  }
  if (Number(source.version) !== input.expectedSourceVersion) {
    return errorResult(
      409,
      "STALE_VERSION",
      "Die Vorveranstaltung wurde zwischenzeitlich geändert. Bitte neu laden.",
    );
  }

  const [gates, groups, products, pilots, memberships, turnaroundOverrides] = await Promise.all([
    env.DB.prepare("SELECT * FROM gates WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM resource_groups WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM products WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM pilots WHERE operation_day_id = ?1")
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT * FROM resource_group_memberships WHERE operation_day_id = ?1 AND active_until IS NULL",
    )
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT * FROM aircraft_product_turnaround_overrides WHERE operation_day_id = ?1",
    )
      .bind(sourceEventId)
      .all<Record<string, unknown>>(),
  ]);

  const now = dependencies.now().toISOString();
  const keepMasterData = input.restartMode === "KEEP_MASTER_DATA";
  const gateIds = new Map(gates.results.map((row) => [String(row.id), dependencies.randomUUID()]));
  const groupIds = new Map(
    groups.results.map((row) => [String(row.id), dependencies.randomUUID()]),
  );
  const productIds = new Map(
    products.results.map((row) => [String(row.id), dependencies.randomUUID()]),
  );
  const adminDeviceId = dependencies.randomUUID();
  const responseBody: AdminEventCloneResponse = {
    eventId: input.eventId,
    templateSourceId: sourceEventId,
    ...(env.APP_ENV === "development" ? { adminDeviceId } : {}),
  };
  const statements = [
    env.DB.prepare(
      `INSERT INTO operation_days
        (id, name, event_date, time_zone, status, emergency_mode, operational_note, version,
         created_at, updated_at, operations_end_at, operational_interrupted, sale_opens_at,
         no_show_after_minutes, max_ticket_deferrals, notification_lead_minutes,
         child_reference_weight_kg,
         normal_reference_weight_kg, heavy_reference_weight_kg, planned_boarding_minutes,
         planned_deboarding_minutes, planned_buffer_minutes, aerodrome, template_source_id)
       VALUES (?1, ?2, ?3, ?4, 'PREPARATION', 0, '', 0, ?5, ?5, NULL, 0, NULL,
         ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    ).bind(
      input.eventId,
      input.name,
      input.eventDate,
      input.timeZone,
      now,
      source.no_show_after_minutes,
      source.max_ticket_deferrals,
      source.notification_lead_minutes,
      source.child_reference_weight_kg,
      source.normal_reference_weight_kg,
      source.heavy_reference_weight_kg,
      source.planned_boarding_minutes,
      source.planned_deboarding_minutes,
      source.planned_buffer_minutes,
      input.aerodrome,
      sourceEventId,
    ),
    ...(keepMasterData ? gates.results : []).map((row) => {
      const displayFilter = gateDisplayFilterSchema.parse(
        JSON.parse(String(row.display_filter_json)),
      );
      return env.DB.prepare(
        `INSERT INTO gates
          (id, operation_day_id, label, gate_type, active, sort_order, travel_lead_minutes,
           display_filter_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      ).bind(
        gateIds.get(String(row.id)),
        input.eventId,
        row.label,
        row.gate_type,
        row.active,
        row.sort_order,
        row.travel_lead_minutes,
        JSON.stringify({
          ...displayFilter,
          productIds: displayFilter.productIds.flatMap((id) => {
            const mappedId = productIds.get(id);
            return mappedId ? [mappedId] : [];
          }),
        }),
        now,
      );
    }),
    ...(keepMasterData ? groups.results : []).map((row) =>
      env.DB.prepare(
        `INSERT INTO resource_groups
        (id, operation_day_id, name, short_code, status, version, created_at, updated_at, gate_id,
         reference_capacity, compatible_aircraft_types_json)
       VALUES (?1, ?2, ?3, ?4, 'ACTIVE', 0, ?5, ?5, ?6, ?7, ?8)`,
      ).bind(
        groupIds.get(String(row.id)),
        input.eventId,
        row.name,
        row.short_code,
        now,
        remapOptionalId(row.gate_id, gateIds, "resource_groups.gate_id"),
        row.reference_capacity,
        row.compatible_aircraft_types_json,
      ),
    ),
    ...(keepMasterData ? products.results : []).map((row) =>
      env.DB.prepare(
        `INSERT INTO products
        (id, operation_day_id, resource_group_id, name, price_cents, sale_enabled, created_at,
          updated_at, sale_closes_at, capacity_warning_threshold, capacity_critical_threshold,
          code, public_description, child_companion_required, sort_order, weight_classes_json, gate_id,
          reference_capacity, reference_duration_minutes, promised_flight_minutes,
          planned_boarding_minutes_override, planned_deboarding_minutes_override,
          planned_buffer_minutes_override)
        VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6, NULL, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
          ?15, ?16, ?17, ?18, ?19, ?20)`,
      ).bind(
        productIds.get(String(row.id)),
        input.eventId,
        groupIds.get(String(row.resource_group_id)),
        row.name,
        row.price_cents,
        now,
        row.capacity_warning_threshold,
        row.capacity_critical_threshold,
        row.code,
        row.public_description,
        row.child_companion_required,
        row.sort_order,
        row.weight_classes_json,
        remapOptionalId(row.gate_id, gateIds, "products.gate_id"),
        row.reference_capacity,
        row.reference_duration_minutes,
        row.promised_flight_minutes,
        row.planned_boarding_minutes_override,
        row.planned_deboarding_minutes_override,
        row.planned_buffer_minutes_override,
      ),
    ),
    ...(keepMasterData ? pilots.results : []).map((row) =>
      env.DB.prepare(
        `INSERT INTO pilots (id, operation_day_id, operational_code, active, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
      ).bind(dependencies.randomUUID(), input.eventId, row.operational_code, row.active, now),
    ),
    ...(keepMasterData ? memberships.results : []).map((row) =>
      env.DB.prepare(
        `INSERT INTO resource_group_memberships
        (id, operation_day_id, resource_group_id, aircraft_id, active_from, created_at,
         change_reason, changed_by_device_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'Aus Vorveranstaltung übernommen', ?6)`,
      ).bind(
        dependencies.randomUUID(),
        input.eventId,
        groupIds.get(String(row.resource_group_id)),
        row.aircraft_id,
        now,
        adminDeviceId,
      ),
    ),
    ...(keepMasterData ? turnaroundOverrides.results : []).map((row) =>
      env.DB.prepare(
        `INSERT INTO aircraft_product_turnaround_overrides
          (operation_day_id, aircraft_id, product_id, planned_boarding_minutes_override,
           planned_deboarding_minutes_override, planned_buffer_minutes_override, version,
           created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)`,
      ).bind(
        input.eventId,
        row.aircraft_id,
        productIds.get(String(row.product_id)),
        row.planned_boarding_minutes_override,
        row.planned_deboarding_minutes_override,
        row.planned_buffer_minutes_override,
        now,
      ),
    ),
    env.DB.prepare(
      `INSERT INTO paired_devices
        (id, operation_day_id, label, role, active, paired_at, last_seen_at, credential_hash)
       VALUES (?1, ?2, 'Übernommene Administrationssitzung', 'ADMIN', 1, ?3, ?3, ?4)`,
    ).bind(adminDeviceId, input.eventId, now, legacySourceCredential?.credential_hash ?? null),
    env.DB.prepare(
      `INSERT INTO operational_events
        (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
         aggregate_id, aggregate_version, payload_json)
       VALUES (?1, ?2, 'EVENT_CREATED_FROM_TEMPLATE', ?3, ?4, 'OPERATION_DAY', ?2, 0, ?5)`,
    ).bind(
      dependencies.randomUUID(),
      input.eventId,
      now,
      adminDeviceId,
      JSON.stringify({ templateSourceId: sourceEventId, restartMode: input.restartMode }),
    ),
    env.DB.prepare(
      `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
       VALUES (?1, ?2, 'EVENT_CREATED_FROM_TEMPLATE', ?3, ?4)`,
    ).bind(dependencies.randomUUID(), input.eventId, JSON.stringify(responseBody), now),
    env.DB.prepare(
      `INSERT INTO idempotency_receipts
        (command_id, operation_day_id, device_id, command_type, received_at, response_json)
       VALUES (?1, ?2, ?3, 'CREATE_EVENT_FROM_TEMPLATE', ?4, ?5)`,
    ).bind(input.commandId, sourceEventId, sourceAdminDeviceId, now, JSON.stringify(responseBody)),
  ];
  await env.DB.batch(statements);
  return { status: 201, body: responseBody };
}
