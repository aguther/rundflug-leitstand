import {
  type GateDisplayFilter,
  gateDisplayFilterSchema,
  type MasterDataTemplate,
  masterDataTemplateSchema,
  type SimulationPlanSchedule,
} from "@rundflug/contracts";

export interface MasterDataExportProjection {
  template: MasterDataTemplate;
  schedule: SimulationPlanSchedule | null;
  keys: {
    resourceGroups: ReadonlyMap<string, string>;
    aircraft: ReadonlyMap<string, string>;
    pilots: ReadonlyMap<string, string>;
  };
}

function parseGateDisplayFilterJson(value: string): GateDisplayFilter {
  try {
    const parsed = gateDisplayFilterSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // A malformed legacy value is exported as the safe empty filter.
  }
  return { productIds: [], rotationStatuses: [] };
}

export async function loadMasterDataExportProjection(
  db: D1Database,
  eventId: string,
  exportedAt = new Date().toISOString(),
): Promise<MasterDataExportProjection | null> {
  const event = await db
    .prepare(
      `SELECT name, version, time_zone, sale_opens_at, operations_start_at, operations_end_at,
              no_show_after_minutes, max_ticket_deferrals, notification_lead_minutes,
              automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
              precall_min_quality, precall_gate_cooldown_minutes,
              child_reference_weight_kg, normal_reference_weight_kg, heavy_reference_weight_kg,
              planned_boarding_minutes, planned_deboarding_minutes, planned_buffer_minutes,
              departed_visibility_seconds
         FROM operation_days WHERE id = ?1`,
    )
    .bind(eventId)
    .first<Record<string, string | number | null>>();
  if (!event) return null;

  const [gates, resourceGroups, products, pilots, assignments, turnaroundOverrides] =
    await Promise.all([
      db
        .prepare(
          `SELECT id, label, gate_type, active, sort_order, travel_lead_minutes,
                  display_filter_json
           FROM gates WHERE operation_day_id = ?1 ORDER BY sort_order, label, id`,
        )
        .bind(eventId)
        .all<Record<string, string | number>>(),
      db
        .prepare(
          `SELECT id, name, short_code, gate_id, reference_capacity,
                compatible_aircraft_types_json, automatic_precall_enabled
           FROM resource_groups WHERE operation_day_id = ?1 ORDER BY name, id`,
        )
        .bind(eventId)
        .all<Record<string, string | number>>(),
      db
        .prepare(
          `SELECT id, resource_group_id, gate_id, name, code, public_description, price_cents,
                reference_capacity, reference_duration_minutes, promised_flight_minutes,
                planned_boarding_minutes_override, planned_deboarding_minutes_override,
                planned_buffer_minutes_override,
                child_companion_required, weight_classes_json, sort_order,
                capacity_warning_threshold, capacity_critical_threshold
           FROM products WHERE operation_day_id = ?1 ORDER BY sort_order, name, id`,
        )
        .bind(eventId)
        .all<Record<string, string | number | null>>(),
      db
        .prepare(
          `SELECT id, operational_code, active
           FROM pilots WHERE operation_day_id = ?1 ORDER BY operational_code, id`,
        )
        .bind(eventId)
        .all<Record<string, string | number>>(),
      db
        .prepare(
          `SELECT m.aircraft_id, m.resource_group_id, a.registration, a.aircraft_type,
                a.passenger_seats, a.maximum_passenger_payload_kg, a.refuel_reminder_threshold
           FROM resource_group_memberships m
           JOIN aircraft a ON a.id = m.aircraft_id
          WHERE m.operation_day_id = ?1 AND m.active_until IS NULL
          ORDER BY a.registration, a.id`,
        )
        .bind(eventId)
        .all<Record<string, string | number | null>>(),
      db
        .prepare(
          `SELECT aircraft_id, product_id, planned_boarding_minutes_override,
                planned_deboarding_minutes_override, planned_buffer_minutes_override
           FROM aircraft_product_turnaround_overrides
          WHERE operation_day_id = ?1 ORDER BY product_id, aircraft_id`,
        )
        .bind(eventId)
        .all<Record<string, string | number | null>>(),
    ]);

  const gateKeys = new Map(
    gates.results.map((gate, index) => [String(gate.id), `gate-${index + 1}`]),
  );
  const resourceGroupKeys = new Map(
    resourceGroups.results.map((group, index) => [String(group.id), `resource-group-${index + 1}`]),
  );
  const productKeys = new Map(
    products.results.map((product, index) => [String(product.id), `product-${index + 1}`]),
  );
  const pilotKeys = new Map(
    pilots.results.map((pilot, index) => [String(pilot.id), `pilot-${index + 1}`]),
  );
  const aircraftRows = [
    ...new Map(
      assignments.results.map((assignment) => [String(assignment.aircraft_id), assignment]),
    ).values(),
  ];
  const aircraftKeys = new Map(
    aircraftRows.map((aircraft, index) => [String(aircraft.aircraft_id), `aircraft-${index + 1}`]),
  );

  const template = masterDataTemplateSchema.parse({
    format: "rundflug-master-data-template",
    formatVersion: 2,
    exportedAt,
    source: { name: event.name, version: Number(event.version) },
    eventParameters: {
      noShowAfterMinutes: Number(event.no_show_after_minutes),
      maxTicketDeferrals: Number(event.max_ticket_deferrals),
      notificationLeadMinutes: Number(event.notification_lead_minutes),
      automaticPrecallEnabled: Boolean(event.automatic_precall_enabled),
      precallLeadMinutes: Number(event.precall_lead_minutes),
      maximumGateWaitMinutes: Number(event.max_gate_wait_minutes),
      precallMinimumQuality: String(event.precall_min_quality),
      precallGateCooldownMinutes: Number(event.precall_gate_cooldown_minutes),
      referenceWeightsKg: {
        child: Number(event.child_reference_weight_kg),
        normal: Number(event.normal_reference_weight_kg),
        heavy: Number(event.heavy_reference_weight_kg),
      },
      plannedBoardingMinutes: Number(event.planned_boarding_minutes),
      plannedDeboardingMinutes: Number(event.planned_deboarding_minutes),
      plannedBufferMinutes: Number(event.planned_buffer_minutes),
      departedVisibilitySeconds: Number(event.departed_visibility_seconds),
    },
    gates: gates.results.map((gate) => {
      const displayFilter = parseGateDisplayFilterJson(String(gate.display_filter_json));
      return {
        key: gateKeys.get(String(gate.id)),
        label: String(gate.label),
        gateType: String(gate.gate_type),
        active: Boolean(gate.active),
        sortOrder: Number(gate.sort_order),
        travelLeadMinutes: Number(gate.travel_lead_minutes),
        displayFilter: {
          productKeys: displayFilter.productIds.flatMap((productId) => {
            const productKey = productKeys.get(productId);
            return productKey ? [productKey] : [];
          }),
          rotationStatuses: displayFilter.rotationStatuses,
        },
      };
    }),
    resourceGroups: resourceGroups.results.map((group) => ({
      key: resourceGroupKeys.get(String(group.id)),
      name: String(group.name),
      shortCode: String(group.short_code),
      gateKey: gateKeys.get(String(group.gate_id)),
      referenceCapacity: Number(group.reference_capacity),
      compatibleAircraftTypes: JSON.parse(String(group.compatible_aircraft_types_json)),
      automaticPrecallEnabled: Boolean(group.automatic_precall_enabled),
    })),
    aircraft: aircraftRows.map((aircraft) => ({
      key: aircraftKeys.get(String(aircraft.aircraft_id)),
      registration: String(aircraft.registration),
      aircraftType: String(aircraft.aircraft_type),
      passengerSeats: Number(aircraft.passenger_seats),
      maximumPassengerPayloadKg:
        aircraft.maximum_passenger_payload_kg === null
          ? null
          : Number(aircraft.maximum_passenger_payload_kg),
      refuelReminderThreshold: Number(aircraft.refuel_reminder_threshold),
    })),
    assignments: assignments.results.map((assignment) => ({
      aircraftKey: aircraftKeys.get(String(assignment.aircraft_id)),
      resourceGroupKey: resourceGroupKeys.get(String(assignment.resource_group_id)),
    })),
    pilots: pilots.results.map((pilot) => ({
      key: pilotKeys.get(String(pilot.id)),
      operationalCode: String(pilot.operational_code),
      operationalNote: "",
      active: Boolean(pilot.active),
    })),
    products: products.results.map((product) => ({
      key: productKeys.get(String(product.id)),
      resourceGroupKey: resourceGroupKeys.get(String(product.resource_group_id)),
      gateKey: gateKeys.get(String(product.gate_id)),
      name: String(product.name),
      code: String(product.code),
      publicDescription: String(product.public_description),
      priceCents: Number(product.price_cents),
      referenceCapacity: Number(product.reference_capacity),
      referenceDurationMinutes: Number(product.reference_duration_minutes),
      promisedFlightMinutes: Number(product.promised_flight_minutes),
      plannedBoardingMinutesOverride:
        product.planned_boarding_minutes_override === null
          ? null
          : Number(product.planned_boarding_minutes_override),
      plannedDeboardingMinutesOverride:
        product.planned_deboarding_minutes_override === null
          ? null
          : Number(product.planned_deboarding_minutes_override),
      plannedBufferMinutesOverride:
        product.planned_buffer_minutes_override === null
          ? null
          : Number(product.planned_buffer_minutes_override),
      childCompanionRequired: Boolean(product.child_companion_required),
      weightClasses: JSON.parse(String(product.weight_classes_json)),
      sortOrder: Number(product.sort_order),
      capacityWarningThreshold: Number(product.capacity_warning_threshold),
      capacityCriticalThreshold: Number(product.capacity_critical_threshold),
    })),
    aircraftProductTurnaroundOverrides: turnaroundOverrides.results.map((override) => ({
      aircraftKey: aircraftKeys.get(String(override.aircraft_id)),
      productKey: productKeys.get(String(override.product_id)),
      plannedBoardingMinutesOverride:
        override.planned_boarding_minutes_override === null
          ? null
          : Number(override.planned_boarding_minutes_override),
      plannedDeboardingMinutesOverride:
        override.planned_deboarding_minutes_override === null
          ? null
          : Number(override.planned_deboarding_minutes_override),
      plannedBufferMinutesOverride:
        override.planned_buffer_minutes_override === null
          ? null
          : Number(override.planned_buffer_minutes_override),
    })),
  });

  const saleOpensAt = typeof event.sale_opens_at === "string" ? event.sale_opens_at : null;
  const operationsStartAt =
    typeof event.operations_start_at === "string" ? event.operations_start_at : null;
  const operationsEndAt =
    typeof event.operations_end_at === "string" ? event.operations_end_at : null;
  const schedule =
    saleOpensAt && operationsStartAt && operationsEndAt
      ? {
          timeZone: String(event.time_zone),
          salesStartAt: saleOpensAt,
          salesEndAt: operationsEndAt,
          operationsStartAt,
          operationsEndAt,
        }
      : null;

  return {
    template,
    schedule,
    keys: {
      resourceGroups: resourceGroupKeys,
      aircraft: aircraftKeys,
      pilots: pilotKeys,
    },
  };
}
