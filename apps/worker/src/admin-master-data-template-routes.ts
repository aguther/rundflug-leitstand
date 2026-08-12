import {
  importMasterDataTemplateRequestSchema,
  importMasterDataTemplateResponseSchema,
  type MasterDataTemplate,
  type MasterDataTemplateCounts,
  masterDataTemplateValidationRequestSchema,
  masterDataTemplateValidationSchema,
} from "@rundflug/contracts";
import type { Hono } from "hono";
import { validateTemplateAircraft } from "./admin-master-data-template-aircraft-validation";
import { loadAdminMasterDataTemplate } from "./admin-master-data-template-export";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import { API_BODY_LIMIT_BYTES } from "./request-body-boundaries";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = {
  authorizeDevice,
  loadAdminMasterDataTemplate,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
};

type AdminMasterDataTemplateRouteDependencies = typeof defaultDependencies;

function masterDataTemplateCounts(template: MasterDataTemplate): MasterDataTemplateCounts {
  return {
    gates: template.gates.length,
    resourceGroups: template.resourceGroups.length,
    aircraft: template.aircraft.length,
    assignments: template.assignments.length,
    pilots: template.pilots.length,
    products: template.products.length,
  };
}

async function boundedJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > API_BODY_LIMIT_BYTES) {
    throw new Error("TEMPLATE_TOO_LARGE");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > API_BODY_LIMIT_BYTES) {
    throw new Error("TEMPLATE_TOO_LARGE");
  }
  return JSON.parse(text);
}

interface MasterDataTemplateTargetRow {
  status: string;
  version: number;
  gates: number;
  resource_groups: number;
  memberships: number;
  pilots: number;
  products: number;
}

function templateTargetEligible(target: MasterDataTemplateTargetRow | null): boolean {
  return Boolean(
    target?.status === "PREPARATION" &&
      target.gates === 0 &&
      target.resource_groups === 0 &&
      target.memberships === 0 &&
      target.pilots === 0 &&
      target.products === 0,
  );
}

async function loadTemplateTarget(
  database: D1Database,
  eventId: string,
): Promise<MasterDataTemplateTargetRow | null> {
  return database
    .prepare(
      `SELECT od.status, od.version,
              (SELECT COUNT(*) FROM gates WHERE operation_day_id = od.id) AS gates,
              (SELECT COUNT(*) FROM resource_groups WHERE operation_day_id = od.id) AS resource_groups,
              (SELECT COUNT(*) FROM resource_group_memberships
                WHERE operation_day_id = od.id AND active_until IS NULL) AS memberships,
              (SELECT COUNT(*) FROM pilots WHERE operation_day_id = od.id) AS pilots,
              (SELECT COUNT(*) FROM products WHERE operation_day_id = od.id) AS products
         FROM operation_days od WHERE od.id = ?1`,
    )
    .bind(eventId)
    .first<MasterDataTemplateTargetRow>();
}

function invalidTemplateResponse(cause: unknown) {
  return {
    error: {
      code:
        cause instanceof Error && cause.message === "TEMPLATE_TOO_LARGE"
          ? "TEMPLATE_TOO_LARGE"
          : "TEMPLATE_INVALID",
      message: "Die Vorlagendatei ist ungültig oder größer als 1 MiB.",
    },
  };
}

export function registerAdminMasterDataTemplateRoutes(
  app: WorkerApp,
  dependencies: AdminMasterDataTemplateRouteDependencies = defaultDependencies,
) {
  app.get("/api/admin/events/:eventId/master-data-template", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (device?.role !== "ADMIN") {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    const template = await dependencies.loadAdminMasterDataTemplate(context.env.DB, eventId, () =>
      dependencies.now().toISOString(),
    );
    if (!template) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    return context.json(template, 200, {
      "content-disposition": `attachment; filename="stammdaten-${eventId}.json"`,
    });
  });

  app.post("/api/admin/events/:eventId/master-data-template/validate", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (device?.role !== "ADMIN") {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    let body: unknown;
    try {
      body = await boundedJsonBody(context.req.raw);
    } catch (cause) {
      return context.json(invalidTemplateResponse(cause), 400);
    }
    const parsed = masterDataTemplateValidationRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "TEMPLATE_INVALID",
            message: parsed.error.issues[0]?.message ?? "Ungültige Vorlage.",
          },
        },
        400,
      );
    }
    const target = await loadTemplateTarget(context.env.DB, eventId);
    if (!target) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    const aircraftValidation = await validateTemplateAircraft(context.env.DB, parsed.data.template);
    const response = masterDataTemplateValidationSchema.parse({
      valid: aircraftValidation.errors.length === 0,
      targetEligible: templateTargetEligible(target),
      counts: masterDataTemplateCounts(parsed.data.template),
      errors: aircraftValidation.errors,
      warnings:
        aircraftValidation.existingByRegistration.size > 0
          ? [
              `${aircraftValidation.existingByRegistration.size} bestehende Flugzeuge werden anhand ihrer Kennung wiederverwendet.`,
            ]
          : [],
    });
    return context.json(response);
  });

  app.post("/api/admin/events/:eventId/master-data-template/import", async (context) => {
    const eventId = context.req.param("eventId");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw);
    if (device?.role !== "ADMIN") {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    let body: unknown;
    try {
      body = await boundedJsonBody(context.req.raw);
    } catch (cause) {
      return context.json(invalidTemplateResponse(cause), 400);
    }
    const parsed = importMasterDataTemplateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "TEMPLATE_INVALID",
            message: parsed.error.issues[0]?.message ?? "Ungültige Vorlage.",
          },
        },
        400,
      );
    }
    const input = parsed.data;
    const priorReceipt = await context.env.DB.prepare(
      `SELECT operation_day_id, device_id, response_json
         FROM idempotency_receipts WHERE command_id = ?1`,
    )
      .bind(input.commandId)
      .first<{ operation_day_id: string; device_id: string; response_json: string }>();
    if (priorReceipt) {
      if (priorReceipt.operation_day_id !== eventId || priorReceipt.device_id !== device.id) {
        return context.json(
          { error: { code: "IDEMPOTENCY_CONFLICT", message: "Kommando-ID ist bereits belegt." } },
          409,
        );
      }
      const stored = importMasterDataTemplateResponseSchema.parse(
        JSON.parse(priorReceipt.response_json),
      );
      return context.json({ ...stored, duplicate: true });
    }
    const target = await loadTemplateTarget(context.env.DB, eventId);
    if (!target) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    if (target.version !== input.expectedVersion) {
      return context.json(
        {
          error: {
            code: "STALE_VERSION",
            message: "Veranstaltung wurde zwischenzeitlich geändert.",
          },
        },
        409,
      );
    }
    if (!templateTargetEligible(target)) {
      return context.json(
        {
          error: {
            code: "TEMPLATE_TARGET_NOT_EMPTY",
            message: "Import ist nur in eine leere Veranstaltung in Vorbereitung möglich.",
          },
        },
        409,
      );
    }
    const aircraftValidation = await validateTemplateAircraft(context.env.DB, input.template);
    if (aircraftValidation.errors.length > 0) {
      return context.json(
        {
          error: {
            code: "TEMPLATE_AIRCRAFT_CONFLICT",
            message: aircraftValidation.errors[0]?.message,
          },
        },
        409,
      );
    }

    const now = dependencies.now().toISOString();
    const gateIds = new Map(
      input.template.gates.map((entry) => [entry.key, dependencies.randomUUID()]),
    );
    const resourceGroupIds = new Map(
      input.template.resourceGroups.map((entry) => [entry.key, dependencies.randomUUID()]),
    );
    const productIds = new Map(
      input.template.products.map((entry) => [entry.key, dependencies.randomUUID()]),
    );
    const aircraftIds = new Map(
      input.template.aircraft.map((entry) => [
        entry.key,
        aircraftValidation.existingByRegistration.get(entry.registration)?.id ??
          dependencies.randomUUID(),
      ]),
    );
    const counts = masterDataTemplateCounts(input.template);
    const responseBody = importMasterDataTemplateResponseSchema.parse({
      accepted: true,
      duplicate: false,
      eventId,
      version: input.expectedVersion + 1,
      counts,
    });
    const receiptGuard = `EXISTS (
      SELECT 1 FROM idempotency_receipts
       WHERE operation_day_id = ?1 AND command_id = ?2
    )`;
    const statements: D1PreparedStatement[] = [
      context.env.DB.prepare(
        `INSERT INTO idempotency_receipts
          (command_id, operation_day_id, device_id, command_type, received_at, response_json)
         SELECT ?1, ?2, ?3, 'IMPORT_MASTER_DATA_TEMPLATE', ?4, ?5
          WHERE EXISTS (
            SELECT 1 FROM operation_days
             WHERE id = ?2 AND version = ?6 AND status = 'PREPARATION'
          )`,
      ).bind(
        input.commandId,
        eventId,
        device.id,
        now,
        JSON.stringify(responseBody),
        input.expectedVersion,
      ),
    ];
    for (const aircraft of input.template.aircraft) {
      if (aircraftValidation.existingByRegistration.has(aircraft.registration)) continue;
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO aircraft
            (id, registration, aircraft_type, passenger_seats, created_at, updated_at,
             maximum_passenger_payload_kg, refuel_reminder_threshold)
           SELECT ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9 WHERE ${receiptGuard}`,
        ).bind(
          eventId,
          input.commandId,
          aircraftIds.get(aircraft.key),
          aircraft.registration,
          aircraft.aircraftType,
          aircraft.passengerSeats,
          now,
          aircraft.maximumPassengerPayloadKg,
          aircraft.refuelReminderThreshold,
        ),
      );
    }
    for (const gate of input.template.gates) {
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO gates
            (id, operation_day_id, label, gate_type, active, sort_order, travel_lead_minutes,
             display_filter_json, created_at, updated_at)
           SELECT ?3, ?1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10 WHERE ${receiptGuard}`,
        ).bind(
          eventId,
          input.commandId,
          gateIds.get(gate.key),
          gate.label,
          gate.gateType,
          gate.active ? 1 : 0,
          gate.sortOrder,
          gate.travelLeadMinutes,
          JSON.stringify({
            productIds: gate.displayFilter.productKeys.map((key) => productIds.get(key)),
            rotationStatuses: gate.displayFilter.rotationStatuses,
          }),
          now,
        ),
      );
    }
    for (const group of input.template.resourceGroups) {
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO resource_groups
            (id, operation_day_id, name, short_code, status, version, created_at, updated_at,
             gate_id, reference_capacity,
             compatible_aircraft_types_json, automatic_precall_enabled)
           SELECT ?3, ?1, ?4, ?5, 'ACTIVE', 0, ?6, ?6, ?7, ?8, ?9, ?10
            WHERE ${receiptGuard}`,
        ).bind(
          eventId,
          input.commandId,
          resourceGroupIds.get(group.key),
          group.name,
          group.shortCode,
          now,
          gateIds.get(group.gateKey),
          group.referenceCapacity,
          JSON.stringify(group.compatibleAircraftTypes),
          group.automaticPrecallEnabled ? 1 : 0,
        ),
      );
    }
    for (const product of input.template.products) {
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO products
            (id, operation_day_id, resource_group_id, name, price_cents, sale_enabled,
             created_at, updated_at, capacity_warning_threshold, capacity_critical_threshold,
             code, public_description, child_companion_required, sort_order, weight_classes_json,
             gate_id, reference_capacity, reference_duration_minutes, promised_flight_minutes,
             planned_boarding_minutes_override, planned_deboarding_minutes_override,
             planned_buffer_minutes_override)
           SELECT ?3, ?1, ?4, ?5, ?6, 0, ?7, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                  ?15, ?16, ?17, ?18, ?19, ?20, ?21 WHERE ${receiptGuard}`,
        ).bind(
          eventId,
          input.commandId,
          productIds.get(product.key),
          resourceGroupIds.get(product.resourceGroupKey),
          product.name,
          product.priceCents,
          now,
          product.capacityWarningThreshold,
          product.capacityCriticalThreshold,
          product.code,
          product.publicDescription,
          product.childCompanionRequired ? 1 : 0,
          product.sortOrder,
          JSON.stringify(product.weightClasses),
          gateIds.get(product.gateKey),
          product.referenceCapacity,
          product.referenceDurationMinutes,
          product.promisedFlightMinutes,
          product.plannedBoardingMinutesOverride,
          product.plannedDeboardingMinutesOverride,
          product.plannedBufferMinutesOverride,
        ),
      );
    }
    for (const pilot of input.template.pilots) {
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO pilots
            (id, operation_day_id, operational_code, operational_note, active, created_at, updated_at)
           SELECT ?3, ?1, ?4, ?5, ?6, ?7, ?7 WHERE ${receiptGuard}`,
        ).bind(
          eventId,
          input.commandId,
          dependencies.randomUUID(),
          pilot.operationalCode,
          pilot.operationalNote,
          pilot.active ? 1 : 0,
          now,
        ),
      );
    }
    for (const assignment of input.template.assignments) {
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO resource_group_memberships
            (id, operation_day_id, resource_group_id, aircraft_id, active_from, created_at,
             change_reason, changed_by_device_id)
           SELECT ?3, ?1, ?4, ?5, ?6, ?6, 'Stammdatenvorlage importiert', ?7
            WHERE ${receiptGuard}`,
        ).bind(
          eventId,
          input.commandId,
          dependencies.randomUUID(),
          resourceGroupIds.get(assignment.resourceGroupKey),
          aircraftIds.get(assignment.aircraftKey),
          now,
          device.id,
        ),
      );
    }
    for (const override of input.template.aircraftProductTurnaroundOverrides) {
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO aircraft_product_turnaround_overrides
            (operation_day_id, aircraft_id, product_id, planned_boarding_minutes_override,
             planned_deboarding_minutes_override, planned_buffer_minutes_override, version,
             created_at, updated_at)
           SELECT ?1, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8 WHERE ${receiptGuard}`,
        ).bind(
          eventId,
          input.commandId,
          aircraftIds.get(override.aircraftKey),
          productIds.get(override.productKey),
          override.plannedBoardingMinutesOverride,
          override.plannedDeboardingMinutesOverride,
          override.plannedBufferMinutesOverride,
          now,
        ),
      );
    }
    const parameters = input.template.eventParameters;
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         SELECT ?3, ?1, 'MASTER_DATA_TEMPLATE_IMPORTED', ?4, ?5, 'OPERATION_DAY', ?1, ?6, ?7
          WHERE ${receiptGuard}`,
      ).bind(
        eventId,
        input.commandId,
        dependencies.randomUUID(),
        now,
        device.id,
        input.expectedVersion + 1,
        JSON.stringify({ formatVersion: input.template.formatVersion, counts }),
      ),
      context.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         SELECT ?3, ?1, 'MASTER_DATA_TEMPLATE_IMPORTED', ?4, ?5 WHERE ${receiptGuard}`,
      ).bind(
        eventId,
        input.commandId,
        dependencies.randomUUID(),
        JSON.stringify({ eventId, version: input.expectedVersion + 1, counts }),
        now,
      ),
      context.env.DB.prepare(
        `UPDATE operation_days
            SET no_show_after_minutes = ?3, max_ticket_deferrals = ?4,
                notification_lead_minutes = ?5, automatic_precall_enabled = ?6,
                precall_lead_minutes = ?7, max_gate_wait_minutes = ?8,
                precall_min_quality = ?9, precall_gate_cooldown_minutes = ?10,
                child_reference_weight_kg = ?11, normal_reference_weight_kg = ?12,
                heavy_reference_weight_kg = ?13, planned_boarding_minutes = ?14,
                planned_deboarding_minutes = ?15, planned_buffer_minutes = ?16,
                departed_visibility_seconds = ?17, version = version + 1, updated_at = ?18
          WHERE id = ?1 AND version = ?2 AND status = 'PREPARATION'
            AND EXISTS (
              SELECT 1 FROM idempotency_receipts
               WHERE operation_day_id = ?1 AND command_id = ?19
            )`,
      ).bind(
        eventId,
        input.expectedVersion,
        parameters.noShowAfterMinutes,
        parameters.maxTicketDeferrals,
        parameters.notificationLeadMinutes,
        parameters.automaticPrecallEnabled ? 1 : 0,
        parameters.precallLeadMinutes,
        parameters.maximumGateWaitMinutes,
        parameters.precallMinimumQuality,
        parameters.precallGateCooldownMinutes,
        parameters.referenceWeightsKg.child,
        parameters.referenceWeightsKg.normal,
        parameters.referenceWeightsKg.heavy,
        parameters.plannedBoardingMinutes,
        parameters.plannedDeboardingMinutes,
        parameters.plannedBufferMinutes,
        parameters.departedVisibilitySeconds,
        now,
        input.commandId,
      ),
    );
    const results = await context.env.DB.batch(statements);
    const updateResult = results.at(-1);
    if (updateResult?.meta.changes !== 1) {
      const concurrentReceipt = await context.env.DB.prepare(
        "SELECT response_json, device_id FROM idempotency_receipts WHERE command_id = ?1",
      )
        .bind(input.commandId)
        .first<{ response_json: string; device_id: string }>();
      if (concurrentReceipt?.device_id === device.id) {
        const stored = importMasterDataTemplateResponseSchema.parse(
          JSON.parse(concurrentReceipt.response_json),
        );
        return context.json({ ...stored, duplicate: true });
      }
      return context.json(
        {
          error: {
            code: "STALE_VERSION",
            message: "Veranstaltung wurde zwischenzeitlich geändert.",
          },
        },
        409,
      );
    }
    return context.json(responseBody, 201);
  });
}
