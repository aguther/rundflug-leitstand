import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizedDevice } from "./device-authorization";
import { type OperationsRouteDependencies, registerOperationsRoutes } from "./operations-routes";
import type { Env, StoredEventRow } from "./types";

const EVENT_ID = "synthetic-event";
const NOW = "2026-08-10T12:00:00.000Z";

const operatorDevice: AuthorizedDevice = {
  id: "device-a",
  role: "FLIGHT_LINE",
  accountId: "account-a",
  loginCode: "FLIGHT-LINE-01",
};

const eventRow: StoredEventRow = {
  id: EVENT_ID,
  name: "Synthetic event",
  event_date: "2026-08-10",
  aerodrome: "EDXX",
  time_zone: "Europe/Berlin",
  status: "ACTIVE",
  archived_at: null,
  template_source_id: null,
  emergency_mode: 0,
  operational_interrupted: 0,
  version: 7,
  operational_note: "Synthetic operations",
  operations_start_at: "2026-08-10T10:00:00.000Z",
  operations_end_at: "2026-08-10T13:00:00.000Z",
  sale_opens_at: "2026-08-10T09:00:00.000Z",
  no_show_after_minutes: 10,
  max_ticket_deferrals: 2,
  notification_lead_minutes: 15,
  automatic_precall_enabled: 1,
  precall_lead_minutes: 15,
  max_gate_wait_minutes: 20,
  precall_min_quality: "CHANGING",
  precall_gate_cooldown_minutes: 2,
  child_reference_weight_kg: 35,
  normal_reference_weight_kg: 80,
  heavy_reference_weight_kg: 110,
  planned_boarding_minutes: 8,
  planned_deboarding_minutes: 5,
  planned_buffer_minutes: 3,
  logo_object_key: null,
  logo_dark_object_key: null,
  updated_at: "2026-08-10T11:59:00.000Z",
};

function emptyReadModels() {
  const empty = () => ({ results: [] });
  return {
    products: empty(),
    aircraftProductTurnaroundOverrideRows: empty(),
    rotations: empty(),
    queueGroupRows: empty(),
    dispatchLeaseRows: empty(),
    durationRows: empty(),
    aircraftRows: empty(),
    fleetRows: empty(),
    pilotRows: empty(),
    gatesRows: empty(),
    resourceGroupRows: empty(),
    plannedOperationRows: empty(),
    recurringRuleRows: empty(),
    metricsRow: null,
    assistClaims: [],
  };
}

function representativeReadModels() {
  return {
    ...emptyReadModels(),
    products: {
      results: [
        {
          id: "product-a",
          code: "PA",
          name: "Product A",
          public_description: "Synthetic product",
          resource_group_id: "group-a",
          resource_group_name: "Group A",
          resource_group_status: "ACTIVE",
          resource_group_operational_note: "",
          price_cents: 5000,
          sale_enabled: 1,
          reference_capacity: 4,
          reference_duration_minutes: 20,
          promised_flight_minutes: 15,
          planned_boarding_minutes_override: 7,
          planned_deboarding_minutes_override: null,
          planned_buffer_minutes_override: null,
          sale_closes_at: null,
          capacity_warning_threshold: 4,
          capacity_critical_threshold: 2,
          child_companion_required: 0,
          weight_classes_json: '["NOT_CAPTURED","CHILD","NORMAL","HEAVY"]',
          sort_order: 1,
          gate_id: "gate-a",
          gate_label: "Gate A",
          queued_tickets: 2,
          resource_group_open_tickets: 2,
        },
      ],
    },
    aircraftProductTurnaroundOverrideRows: {
      results: [
        {
          aircraft_id: "aircraft-a",
          product_id: "product-a",
          version: 3,
          planned_boarding_minutes_override: 6,
          planned_deboarding_minutes_override: 4,
          planned_buffer_minutes_override: 2,
        },
      ],
    },
    rotations: {
      results: [
        {
          id: "rotation-a",
          version: 5,
          flight_group_id: "flight-group-a",
          communication_number: 17,
          resource_group_id: "group-a",
          resource_group_short_code: "GA",
          queue_position: 2,
          product_code: "PA",
          product_name: "Product A",
          status: "DRAFT",
          booking_groups_json: '[{"id":"booking-a"}]',
          ticket_group_id: "ticket-group-a",
          gate_id: "gate-a",
          gate_label: "Gate A",
          aircraft_id: "aircraft-a",
          aircraft_registration: "D-EAAA",
          pilot_id: "pilot-a",
          pilot_operational_code: "P-01",
          suggested_pilot_id: "pilot-a",
          suggested_pilot_operational_code: "P-01",
          suggested_aircraft_id: "aircraft-a",
          suggested_aircraft_registration: "D-EAAA",
          ticket_count: 2,
          baseline_capacity: 4,
          usable_capacity: 3,
          estimated_passenger_payload_kg: 160,
          reference_duration_minutes: 20,
          prediction_lower_minutes: 10,
          prediction_upper_minutes: 20,
          prediction_quality: "STABLE",
          prediction_updated_at: "2026-08-10T11:59:00.000Z",
          planned_boarding_at: "2026-08-10T12:10:00.000Z",
          planned_departure_at: "2026-08-10T12:20:00.000Z",
          planned_landing_at: "2026-08-10T12:35:00.000Z",
          planned_completion_at: "2026-08-10T12:45:00.000Z",
          predicted_boarding_at: "2026-08-10T12:15:00.000Z",
          predicted_departure_at: "2026-08-10T12:25:00.000Z",
          predicted_landing_at: "2026-08-10T12:40:00.000Z",
          predicted_completion_at: "2026-08-10T12:50:00.000Z",
          called_at: null,
          departed_at: null,
          landed_at: null,
          completed_at: null,
          forecast_assumed_aircraft_id: "aircraft-a",
          precalled_at: "2026-08-10T11:55:00.000Z",
          precall_decision_status: "PRECALLED",
          precall_decision_reason: "WINDOW_REACHED",
          precall_dispatch_reason: null,
          precall_decision_at: "2026-08-10T11:55:00.000Z",
          precall_predicted_boarding_at: "2026-08-10T12:15:00.000Z",
          precall_adaptive_lead_minutes: 20,
          precall_gate_id: "gate-a",
          precall_adaptive_base_lead_minutes: 15,
          precall_gate_travel_lead_minutes: 5,
          precall_effective_lead_minutes: 20,
          precall_boarding_window_lower_at: "2026-08-10T12:10:00.000Z",
          precall_boarding_window_upper_at: "2026-08-10T12:20:00.000Z",
          dispatch_plan_id: "dispatch-plan-a",
          dispatch_plan_revision: 2,
          dispatch_operation_day_version: 7,
          dispatch_batch_id: "batch-a",
          dispatch_order: 1,
          dispatch_wave: 1,
          dispatch_lane_id: "aircraft-a:pilot-a",
          dispatch_group_ids_json: '["ticket-group-a"]',
          dispatch_occupied_seats: 2,
          dispatch_available_seats: 2,
          dispatch_commitment_level: "PROVISIONAL",
          dispatch_decision_reasons_json: '["CAPACITY_OPTIMIZED"]',
          dispatch_confirmed_overtake_count: 0,
          dispatch_projected_overtake_count: 0,
          dispatch_unplanned_reason: null,
          deferral_count: 0,
          operational_note: "",
          turnaround_boarding_minutes: 6,
          turnaround_deboarding_minutes: 4,
          turnaround_buffer_minutes: 2,
          turnaround_boarding_source: "AIRCRAFT_PRODUCT:aircraft-a:product-a",
          turnaround_deboarding_source: "AIRCRAFT_PRODUCT:aircraft-a:product-a",
          turnaround_buffer_source: "AIRCRAFT_PRODUCT:aircraft-a:product-a",
          tickets_json: '[{"id":"ticket-a","status":"QUEUED","attendanceStatus":"CHECKED_IN"}]',
        },
      ],
    },
    queueGroupRows: {
      results: [
        {
          id: "ticket-group-a",
          communication_number: 17,
          product_id: "product-a",
          product_code: "PA",
          product_name: "Product A",
          resource_group_id: "group-a",
          gate_id: "gate-a",
          gate_label: "Gate A",
          queue_sequence: 4,
          status: "QUEUED",
          ticket_count: 5,
          present_count: 4,
          next_segment_ticket_count: 2,
          next_segment_present_count: 2,
          segment_index: 2,
          segment_count: 3,
          precalled_at: "2026-08-10T11:55:00.000Z",
          recall_id: "recall-a",
          recall_sequence: 1,
          recall_started_at: "2026-08-10T11:56:00.000Z",
          recall_expires_at: "2026-08-10T12:06:00.000Z",
          recall_count: 1,
        },
      ],
    },
    dispatchLeaseRows: {
      results: [
        {
          ticket_group_id: "ticket-group-a",
          operator_account_id: "account-a",
          device_id: "device-a",
        },
      ],
    },
    durationRows: { results: [{ duration_minutes: 31 }] },
    aircraftRows: {
      results: [
        {
          id: "aircraft-a",
          resource_group_id: "group-a",
          passenger_seats: 4,
          operational_state: "AVAILABLE",
          operational_interrupted: 0,
        },
      ],
    },
    fleetRows: {
      results: [
        {
          id: "aircraft-a",
          version: 4,
          registration: "D-EAAA",
          aircraft_type: "C172",
          passenger_seats: 4,
          maximum_passenger_payload_kg: 360,
          operational_state: "AVAILABLE",
          operational_state_changed_at: "2026-08-10T11:50:00.000Z",
          operational_interrupted: 0,
          resource_group_id: "group-a",
          resource_group_name: "Group A",
          resource_group_short_code: "GA",
          refuel_planned: 0,
          rotations_since_refuel: 2,
          refuel_reminder_threshold: 5,
          expected_review_at: null,
          current_pilot_id: "pilot-a",
          current_pilot_operational_code: "P-01",
        },
      ],
    },
    pilotRows: {
      results: [
        {
          id: "pilot-a",
          operational_code: "P-01",
          operational_note: "",
          active: 1,
          paused: 0,
          pause_expected_review_at: null,
          current_rotation_id: null,
          current_communication_number: null,
        },
      ],
    },
    gatesRows: {
      results: [
        {
          id: "gate-a",
          label: "Gate A",
          gate_type: "PHYSICAL",
          active: 1,
          sort_order: 1,
          travel_lead_minutes: 5,
          display_filter_json: '{"productIds":["product-a"],"rotationStatuses":["DRAFT"]}',
          assigned_resource_group_ids_json: '["group-a"]',
        },
      ],
    },
    resourceGroupRows: {
      results: [
        {
          id: "group-a",
          version: 2,
          name: "Group A",
          short_code: "GA",
          status: "ACTIVE",
          operational_note: "",
          gate_id: "gate-a",
          gate_label: "Gate A",
          compatible_aircraft_types_json: '["C172"]',
          automatic_precall_enabled: 1,
          aircraft_ids_json: '["aircraft-a"]',
        },
      ],
    },
    plannedOperationRows: {
      results: [
        {
          id: "plan-a",
          version: 1,
          scope_type: "EVENT",
          scope_id: null,
          constraint_kind: "PAUSE",
          effect_mode: "BLOCKING",
          duration_multiplier_percent: null,
          start_mode: "TIME_WINDOW",
          earliest_start_at: "2026-08-10T11:30:00.000Z",
          latest_start_at: "2026-08-10T11:45:00.000Z",
          after_rotation_id: null,
          after_rotation_status: null,
          minimum_duration_minutes: 5,
          typical_duration_minutes: 10,
          maximum_duration_minutes: 15,
          status: "PLANNED",
          public_note: "Operational pause",
          created_at: "2026-08-10T10:00:00.000Z",
          updated_at: "2026-08-10T10:00:00.000Z",
          activated_at: null,
          cleared_at: null,
          canceled_at: null,
          recurring_rule_id: null,
          recurrence_sequence: null,
        },
      ],
    },
    recurringRuleRows: {
      results: [
        {
          id: "rule-a",
          operation_day_id: EVENT_ID,
          version: 1,
          scope_type: "AIRCRAFT",
          scope_id: "aircraft-a",
          operation_kind: "REFUELING",
          trigger_metric: "COMPLETED_ROTATIONS",
          interval_value: 5,
          progress_value: 2,
          minimum_duration_minutes: 8,
          typical_duration_minutes: 12,
          maximum_duration_minutes: 18,
          status: "ACTIVE",
          sequence_number: 1,
          open_plan_id: null,
          reason: "Synthetic rule",
          last_reset_at: null,
          created_at: "2026-08-10T10:00:00.000Z",
          updated_at: "2026-08-10T10:00:00.000Z",
        },
      ],
    },
    metricsRow: {
      open_tickets: 2,
      sold_tickets: 5,
      completed_rotations: 3,
      active_rotations: 1,
      average_boarding_minutes: 7,
      average_flight_minutes: 18,
      average_turnaround_minutes: 12,
      average_rotation_minutes: 30,
      average_wait_minutes: 20,
      informational_revenue_cents: 25_000,
      active_devices: 2,
      active_push_subscriptions: 1,
    },
    assistClaims: [
      {
        aircraft_id: "aircraft-a",
        operator_account_id: "account-a",
        login_code: "FLIGHT-LINE-01",
        revision: 2,
        claimed_at: "2026-08-10T11:58:00.000Z",
        expires_at: "2026-08-10T12:03:00.000Z",
      },
    ],
  };
}

function eventDatabase(row: StoredEventRow | null) {
  const statements: string[] = [];
  const bindings: unknown[][] = [];
  const database = {
    prepare(sql: string) {
      statements.push(sql);
      const index = statements.length - 1;
      return {
        bind(...values: unknown[]) {
          bindings[index] = values;
          return { first: async () => row };
        },
      };
    },
  } as unknown as D1Database;
  return { database, statements, bindings };
}

function createRoute(input?: {
  device?: AuthorizedDevice | null;
  event?: StoredEventRow | null;
  readModels?: unknown;
}) {
  const event = eventDatabase(input && "event" in input ? (input.event ?? null) : eventRow);
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: event.database,
  }) as Env;
  const authorizeDevice = vi.fn(async () =>
    input && "device" in input ? (input.device ?? null) : operatorDevice,
  );
  const loadOperationsReadModels = vi.fn(async () => input?.readModels ?? emptyReadModels());
  const performanceValues = [100, 112.34];
  const dependencies = {
    authorizeDevice,
    loadOperationsReadModels,
    nowIso: () => NOW,
    nowMs: () => Date.parse(NOW),
    performanceNow: () => performanceValues.shift() ?? 112.34,
  } as unknown as OperationsRouteDependencies;
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: null };
  }>();
  app.use("*", async (context, next) => {
    context.set("sessionActor", null);
    await next();
  });
  registerOperationsRoutes(app as never, dependencies);
  return { app, env, event, authorizeDevice, loadOperationsReadModels };
}

function request(route: ReturnType<typeof createRoute>) {
  return route.app.request(
    `https://worker.test/api/control/${EVENT_ID}/operations`,
    undefined,
    route.env,
  );
}

describe("operations routes", () => {
  it.each([null, { ...operatorDevice, role: "DISPLAY" as const }])(
    "rejects an unauthorized operations reader",
    async (device) => {
      const route = createRoute({ device });
      const response = await request(route);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "SESSION_NOT_AUTHORIZED" },
      });
      expect(route.event.statements).toEqual([]);
      expect(route.loadOperationsReadModels).not.toHaveBeenCalled();
    },
  );

  it("returns the public event error before loading operations models", async () => {
    const route = createRoute({ event: null });
    const response = await request(route);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." },
    });
    expect(route.event.statements[0]).toContain("FROM operation_days WHERE id = ?1");
    expect(route.event.bindings).toEqual([[EVENT_ID]]);
    expect(route.loadOperationsReadModels).not.toHaveBeenCalled();
  });

  it("serves an empty canonical operations board with stable timing and defaults", async () => {
    const route = createRoute();
    const response = await request(route);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toBe("operations;dur=12.3");
    expect(body).toMatchObject({
      currentDeviceRole: "FLIGHT_LINE",
      event: { eventId: EVENT_ID, version: 7, emergencyMode: false },
      products: [],
      rotations: [],
      queueGroups: [],
      aircraft: [],
      assistClaims: [],
      plannedOperations: [],
      recurringOperationalRules: [],
      gates: [],
      resourceGroups: [],
      metrics: {
        openTickets: 0,
        soldTickets: 0,
        completedRotations: 0,
        activeRotations: 0,
      },
    });
    expect(route.authorizeDevice).toHaveBeenCalledWith(
      route.env,
      EVENT_ID,
      expect.any(Request),
      null,
    );
    expect(route.loadOperationsReadModels).toHaveBeenCalledWith(route.env.DB, EVENT_ID, NOW);
  });

  it("projects operational ownership, forecasts, plans and stable identifiers", async () => {
    const route = createRoute({
      readModels: representativeReadModels(),
    });
    const response = await request(route);
    const body = (await response.json()) as {
      products: Array<Record<string, unknown>>;
      aircraftProductTurnaroundOverrides: Array<Record<string, unknown>>;
      rotations: Array<Record<string, unknown>>;
      queueGroups: Array<Record<string, unknown>>;
      aircraft: Array<Record<string, unknown>>;
      assistClaims: Array<Record<string, unknown>>;
      plannedOperations: Array<Record<string, unknown>>;
      recurringOperationalRules: Array<Record<string, unknown>>;
      gates: Array<Record<string, unknown>>;
      resourceGroups: Array<Record<string, unknown>>;
      metrics: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(body.products[0]).toMatchObject({
      id: "product-a",
      referenceCapacity: 4,
      predictionQuality: "STABLE",
      effectiveTurnaroundProfile: {
        boarding: { valueMinutes: 7, sourceLevel: "PRODUCT", sourceId: "product-a" },
      },
    });
    expect(body.aircraftProductTurnaroundOverrides[0]).toMatchObject({
      aircraftId: "aircraft-a",
      productId: "product-a",
      effectiveTurnaroundProfile: {
        boarding: { valueMinutes: 6, sourceLevel: "AIRCRAFT_PRODUCT" },
      },
    });
    expect(body.rotations[0]).toMatchObject({
      communicationNumber: 17,
      queuePosition: 2,
      gateId: "gate-a",
      capacityReduced: true,
      predictedLowerMinutes: 10,
      predictedUpperMinutes: 20,
      timeline: {
        predictionQuality: "STABLE",
        predictionUpdatedAt: "2026-08-10T11:59:00.000Z",
        effectiveTurnaroundProfile: {
          boarding: { valueMinutes: 6, sourceLevel: "AIRCRAFT_PRODUCT" },
        },
      },
      dispatchPlan: {
        planId: "dispatch-plan-a",
        revision: 2,
        groupIds: ["ticket-group-a"],
      },
    });
    expect(body.queueGroups[0]).toMatchObject({
      ticketCount: 5,
      nextSegmentTicketCount: 2,
      segmentIndex: 2,
      precalledAt: "2026-08-10T11:55:00.000Z",
      dispatchReservation: "OWN",
      activeRecall: { id: "recall-a", sequence: 1 },
    });
    expect(body.aircraft[0]).toMatchObject({
      operationalState: "AVAILABLE",
      operationalStateChangedAt: "2026-08-10T11:50:00.000Z",
    });
    expect(body.assistClaims[0]).toMatchObject({
      aircraftId: "aircraft-a",
      claimedByCurrentOperator: true,
      ownerLoginCode: "FLIGHT-LINE-01",
    });
    expect(body.plannedOperations[0]).toMatchObject({ id: "plan-a", status: "DUE" });
    expect(body.plannedOperations[0]).not.toHaveProperty("reason");
    expect(body.recurringOperationalRules[0]).toMatchObject({
      id: "rule-a",
      triggerMetric: "COMPLETED_ROTATIONS",
    });
    expect(body.gates[0]).toMatchObject({
      id: "gate-a",
      displayFilter: { productIds: ["product-a"], rotationStatuses: ["DRAFT"] },
      assignedResourceGroupIds: ["group-a"],
    });
    expect(body.resourceGroups[0]).toMatchObject({
      id: "group-a",
      referenceCapacity: 4,
      activeAircraftIds: ["aircraft-a"],
    });
    expect(body.metrics).toMatchObject({
      openTickets: 2,
      informationalRevenueCents: 25_000,
      activeDevices: 2,
    });
  });

  it("does not register the legacy event URL", async () => {
    const route = createRoute();
    const response = await route.app.request(
      `https://worker.test/api/events/${EVENT_ID}/operations`,
      undefined,
      route.env,
    );

    expect(response.status).toBe(404);
    expect(route.authorizeDevice).not.toHaveBeenCalled();
  });

  it("hides forecast windows during emergency mode", async () => {
    const route = createRoute({
      event: { ...eventRow, emergency_mode: 1 },
      readModels: representativeReadModels(),
    });
    const response = await request(route);
    const body = (await response.json()) as {
      rotations: Array<{
        boardingWindowLowerAt: string | null;
        boardingWindowUpperAt: string | null;
        timeline: { predictionQuality: string };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.rotations[0]).toMatchObject({
      boardingWindowLowerAt: null,
      boardingWindowUpperAt: null,
      timeline: { predictionQuality: "UNCERTAIN" },
    });
  });

  it("keeps assigned capacity while transient aircraft state reduces forecast capacity", async () => {
    const readModels = representativeReadModels();
    const [aircraft] = readModels.aircraftRows.results;
    if (!aircraft) throw new Error("Representative aircraft fixture is missing");
    aircraft.operational_state = "PAUSED";
    const route = createRoute({ readModels });
    const response = await request(route);
    const body = (await response.json()) as {
      products: Array<{ referenceCapacity: number; predictionQuality: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.products[0]).toMatchObject({
      referenceCapacity: 4,
      predictionQuality: "STABLE",
    });
  });
});
