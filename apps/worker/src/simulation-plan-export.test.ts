import type { MasterDataTemplate, SimulationPlanExport } from "@rundflug/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import type { AuthorizedDevice } from "./device-authorization";
import {
  loadMasterDataExportProjection,
  type MasterDataExportProjection,
} from "./master-data-export";
import { registerSimulationPlanExportRoutes } from "./simulation-plan-export-routes";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440090";
const NOW = new Date("2026-08-09T19:30:00.000Z");

interface MockStatement {
  sql: string;
  bindings: unknown[];
  first: () => Promise<unknown>;
  all: () => Promise<{ results: unknown[] }>;
}

function authorizedDevice(role: AuthorizedDevice["role"] = "ADMIN"): AuthorizedDevice {
  return {
    id: DEVICE_ID,
    role,
    accountId: "550e8400-e29b-41d4-a716-446655440091",
    loginCode: "ADMIN-01",
  };
}

function portableTemplate(): MasterDataTemplate {
  return {
    format: "rundflug-master-data-template",
    formatVersion: 2,
    exportedAt: NOW.toISOString(),
    source: { name: "Synthetic event", version: 4 },
    eventParameters: {
      noShowAfterMinutes: 15,
      maxTicketDeferrals: 2,
      notificationLeadMinutes: 20,
      automaticPrecallEnabled: true,
      precallLeadMinutes: 10,
      maximumGateWaitMinutes: 15,
      precallMinimumQuality: "STABLE",
      precallGateCooldownMinutes: 2,
      referenceWeightsKg: { child: 35, normal: 80, heavy: 110 },
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 3,
      plannedBufferMinutes: 2,
      departedVisibilitySeconds: 60,
    },
    gates: [
      {
        key: "gate-1",
        label: "Synthetic gate",
        gateType: "FLIGHT_LINE",
        active: true,
        sortOrder: 1,
        travelLeadMinutes: 4,
        displayFilter: { productKeys: ["product-1"], rotationStatuses: [] },
      },
    ],
    resourceGroups: [
      {
        key: "resource-group-1",
        name: "Synthetic group",
        shortCode: "SYN",
        gateKey: "gate-1",
        referenceCapacity: 3,
        compatibleAircraftTypes: ["C172"],
        automaticPrecallEnabled: true,
      },
    ],
    aircraft: [
      {
        key: "aircraft-1",
        registration: "D-TEST",
        aircraftType: "C172",
        passengerSeats: 3,
        maximumPassengerPayloadKg: 240,
        refuelReminderThreshold: 5,
      },
    ],
    assignments: [{ aircraftKey: "aircraft-1", resourceGroupKey: "resource-group-1" }],
    pilots: [{ key: "pilot-1", operationalCode: "P-01", operationalNote: "", active: true }],
    products: [
      {
        key: "product-1",
        resourceGroupKey: "resource-group-1",
        gateKey: "gate-1",
        name: "Synthetic flight",
        code: "SYN-20",
        publicDescription: "",
        priceCents: 5000,
        referenceCapacity: 3,
        referenceDurationMinutes: 20,
        promisedFlightMinutes: 15,
        plannedBoardingMinutesOverride: null,
        plannedDeboardingMinutesOverride: null,
        plannedBufferMinutesOverride: null,
        childCompanionRequired: false,
        weightClasses: ["NOT_CAPTURED"],
        sortOrder: 1,
        capacityWarningThreshold: 12,
        capacityCriticalThreshold: 4,
      },
    ],
    aircraftProductTurnaroundOverrides: [
      {
        aircraftKey: "aircraft-1",
        productKey: "product-1",
        plannedBoardingMinutesOverride: 6,
        plannedDeboardingMinutesOverride: 4,
        plannedBufferMinutesOverride: 3,
      },
    ],
  };
}

function projection(scheduleComplete = true): MasterDataExportProjection {
  return {
    template: portableTemplate(),
    schedule: scheduleComplete
      ? {
          timeZone: "Europe/Berlin",
          salesStartAt: "2026-08-09T07:00:00.000Z",
          salesEndAt: "2026-08-09T15:00:00.000Z",
          operationsStartAt: "2026-08-09T08:00:00.000Z",
          operationsEndAt: "2026-08-09T16:00:00.000Z",
        }
      : null,
    keys: {
      resourceGroups: new Map([["resource-group-db", "resource-group-1"]]),
      aircraft: new Map([["aircraft-db", "aircraft-1"]]),
      pilots: new Map([["pilot-db", "pilot-1"]]),
    },
  };
}

function createRouteApp(input?: {
  device?: AuthorizedDevice | null;
  exportProjection?: MasterDataExportProjection | null;
  plans?: Record<string, unknown>[];
  recurringRules?: Record<string, unknown>[];
}) {
  const prepared: MockStatement[] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => {
      const statement: MockStatement = {
        sql,
        bindings,
        first: async () => null,
        all: async () => ({
          results: sql.includes("FROM planned_operational_constraints")
            ? (input?.plans ?? [])
            : (input?.recurringRules ?? []),
        }),
      };
      prepared.push(statement);
      return statement;
    },
  }));
  const database = Object.assign(Object.create(null), { prepare }) as D1Database;
  const env = Object.assign(Object.create(null), { DB: database }) as Env;
  const device = input && "device" in input ? (input.device ?? null) : authorizedDevice();
  const exported =
    input && "exportProjection" in input ? (input.exportProjection ?? null) : projection();
  const authorizeDevice = vi.fn(async () => device);
  const loadProjection = vi.fn(async () => exported);
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerSimulationPlanExportRoutes(app, {
    authorizeDevice,
    loadMasterDataExportProjection: loadProjection,
    now: () => NOW,
  });
  return { app, env, prepare, prepared, authorizeDevice, loadProjection };
}

describe("simulation plan export route", () => {
  it("rejects missing and unauthorized devices before reading export data", async () => {
    for (const device of [null, authorizedDevice("CASHIER")]) {
      const { app, env, prepare, loadProjection } = createRouteApp({ device });

      const response = await app.request(
        `https://worker.test/api/control/${EVENT_ID}/exports/simulation-plan.json`,
        {},
        env,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "SESSION_NOT_AUTHORIZED" },
      });
      expect(loadProjection).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
    }
  });

  it("returns the existing event and schedule errors", async () => {
    const missing = createRouteApp({ exportProjection: null });
    const incomplete = createRouteApp({ exportProjection: projection(false) });

    const [missingResponse, incompleteResponse] = await Promise.all([
      missing.app.request(
        `https://worker.test/api/control/${EVENT_ID}/exports/simulation-plan.json`,
        {},
        missing.env,
      ),
      incomplete.app.request(
        `https://worker.test/api/control/${EVENT_ID}/exports/simulation-plan.json`,
        {},
        incomplete.env,
      ),
    ]);

    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: { code: "EVENT_NOT_FOUND" },
    });
    expect(incompleteResponse.status).toBe(409);
    await expect(incompleteResponse.json()).resolves.toMatchObject({
      error: { code: "SIMULATION_SCHEDULE_INCOMPLETE" },
    });
  });

  it("exports portable V3 plans and rules without operative rotation ids", async () => {
    const { app, env, prepared, loadProjection } = createRouteApp({
      device: authorizedDevice("FLIGHT_DIRECTOR"),
      plans: [
        {
          id: "plan-db-1",
          scope_type: "EVENT",
          scope_id: EVENT_ID,
          constraint_kind: "FLIGHT_SHOW",
          effect_mode: "BLOCKING",
          duration_multiplier_percent: null,
          start_mode: "TIME_WINDOW",
          earliest_start_at: "2026-08-09T11:00:00.000Z",
          latest_start_at: "2026-08-09T11:10:00.000Z",
          after_rotation_id: null,
          minimum_duration_minutes: 20,
          typical_duration_minutes: 25,
          maximum_duration_minutes: 30,
          public_note: "Synthetic interruption",
        },
        {
          id: "plan-db-2",
          scope_type: "AIRCRAFT",
          scope_id: "aircraft-db",
          constraint_kind: "REFUELING",
          effect_mode: "BLOCKING",
          duration_multiplier_percent: null,
          start_mode: "AFTER_CURRENT_ROTATION",
          earliest_start_at: null,
          latest_start_at: null,
          after_rotation_id: "operative-rotation-id",
          minimum_duration_minutes: 8,
          typical_duration_minutes: 12,
          maximum_duration_minutes: 18,
          public_note: "",
        },
      ],
      recurringRules: [
        {
          id: "rule-db-1",
          scope_type: "PILOT",
          scope_id: "pilot-db",
          operation_kind: "PAUSE",
          trigger_metric: "OPERATING_MINUTES",
          interval_value: 90,
          progress_value: 20,
          minimum_duration_minutes: 10,
          typical_duration_minutes: 15,
          maximum_duration_minutes: 20,
        },
      ],
    });

    const response = await app.request(
      `https://worker.test/api/control/${EVENT_ID}/exports/simulation-plan.json`,
      {},
      env,
    );
    const body = (await response.json()) as SimulationPlanExport;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="simulationsplan-${EVENT_ID}.json"`,
    );
    expect(body).toMatchObject({
      format: "rundflug-simulation-plan",
      formatVersion: 3,
      exportedAt: NOW.toISOString(),
      masterData: { formatVersion: 2 },
      plannedOperations: [
        { key: "plan-1", scopeKey: "event", afterCurrentRotation: false },
        { key: "plan-2", scopeKey: "aircraft-1", afterCurrentRotation: true },
      ],
      recurringRules: [{ key: "rule-1", scopeKey: "pilot-1" }],
    });
    expect(body.plannedOperations[1]).not.toHaveProperty("afterRotationId");
    expect(loadProjection).toHaveBeenCalledWith(env.DB, EVENT_ID, NOW.toISOString());
    expect(prepared).toHaveLength(2);
    expect(prepared.every((statement) => statement.bindings[0] === EVENT_ID)).toBe(true);
    expect(prepared[0]?.sql).toContain("status = 'PLANNED'");
    expect(prepared[0]?.sql).toContain("recurring_rule_id IS NULL");
    expect(prepared[1]?.sql).toContain("status = 'ACTIVE'");
    expect(prepared.map((statement) => statement.sql).join("\n")).not.toMatch(
      /\b(INSERT|UPDATE|DELETE)\b/,
    );
  });
});

const eventRow = {
  name: "Synthetic event",
  version: 4,
  time_zone: "Europe/Berlin",
  sale_opens_at: "2026-08-09T07:00:00.000Z",
  operations_start_at: "2026-08-09T08:00:00.000Z",
  operations_end_at: "2026-08-09T16:00:00.000Z",
  no_show_after_minutes: 15,
  max_ticket_deferrals: 2,
  notification_lead_minutes: 20,
  automatic_precall_enabled: 1,
  precall_lead_minutes: 10,
  max_gate_wait_minutes: 15,
  precall_min_quality: "STABLE",
  precall_gate_cooldown_minutes: 2,
  child_reference_weight_kg: 35,
  normal_reference_weight_kg: 80,
  heavy_reference_weight_kg: 110,
  planned_boarding_minutes: 5,
  planned_deboarding_minutes: 3,
  planned_buffer_minutes: 2,
  departed_visibility_seconds: 60,
};

function createProjectionDatabase(event: Record<string, unknown> | null = eventRow) {
  const prepared: MockStatement[] = [];
  const rowsFor = (sql: string): unknown[] => {
    if (sql.includes("FROM gates")) {
      return [
        {
          id: "gate-db",
          label: "Synthetic gate",
          gate_type: "FLIGHT_LINE",
          active: 1,
          sort_order: 1,
          travel_lead_minutes: 4,
          display_filter_json: JSON.stringify({
            productIds: ["product-db"],
            rotationStatuses: [],
          }),
        },
      ];
    }
    if (sql.includes("FROM resource_groups")) {
      return [
        {
          id: "resource-group-db",
          name: "Synthetic group",
          short_code: "SYN",
          gate_id: "gate-db",
          reference_capacity: 3,
          compatible_aircraft_types_json: JSON.stringify(["C172"]),
          automatic_precall_enabled: 1,
        },
      ];
    }
    if (sql.includes("FROM products")) {
      return [
        {
          id: "product-db",
          resource_group_id: "resource-group-db",
          gate_id: "gate-db",
          name: "Synthetic flight",
          code: "SYN-20",
          public_description: "",
          price_cents: 5000,
          reference_capacity: 3,
          reference_duration_minutes: 20,
          promised_flight_minutes: 15,
          planned_boarding_minutes_override: null,
          planned_deboarding_minutes_override: null,
          planned_buffer_minutes_override: null,
          child_companion_required: 0,
          weight_classes_json: JSON.stringify(["NOT_CAPTURED"]),
          sort_order: 1,
          capacity_warning_threshold: 12,
          capacity_critical_threshold: 4,
        },
      ];
    }
    if (sql.includes("FROM pilots")) {
      return [{ id: "pilot-db", operational_code: "P-01", active: 1 }];
    }
    if (sql.includes("FROM resource_group_memberships")) {
      return [
        {
          aircraft_id: "aircraft-db",
          resource_group_id: "resource-group-db",
          registration: "D-TEST",
          aircraft_type: "C172",
          passenger_seats: 3,
          maximum_passenger_payload_kg: 240,
          refuel_reminder_threshold: 5,
        },
      ];
    }
    if (sql.includes("FROM aircraft_product_turnaround_overrides")) {
      return [
        {
          aircraft_id: "aircraft-db",
          product_id: "product-db",
          planned_boarding_minutes_override: 6,
          planned_deboarding_minutes_override: 4,
          planned_buffer_minutes_override: 3,
        },
      ];
    }
    return [];
  };
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => {
      const statement: MockStatement = {
        sql,
        bindings,
        first: async () => event,
        all: async () => ({ results: rowsFor(sql) }),
      };
      prepared.push(statement);
      return statement;
    },
  }));
  const database = Object.assign(Object.create(null), { prepare }) as D1Database;
  return { database, prepared };
}

describe("master data export projection", () => {
  it("stops after the event lookup when the event is missing", async () => {
    const { database, prepared } = createProjectionDatabase(null);

    await expect(
      loadMasterDataExportProjection(database, EVENT_ID, NOW.toISOString()),
    ).resolves.toBeNull();

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.sql).toContain("FROM operation_days");
  });

  it("builds portable master data using only event-scoped read queries", async () => {
    const { database, prepared } = createProjectionDatabase();

    const exported = await loadMasterDataExportProjection(database, EVENT_ID, NOW.toISOString());

    expect(exported).not.toBeNull();
    expect(exported?.template).toMatchObject({
      formatVersion: 2,
      exportedAt: NOW.toISOString(),
      gates: [{ key: "gate-1", travelLeadMinutes: 4 }],
      products: [
        {
          key: "product-1",
          plannedBoardingMinutesOverride: null,
          plannedDeboardingMinutesOverride: null,
          plannedBufferMinutesOverride: null,
        },
      ],
      aircraftProductTurnaroundOverrides: [
        {
          aircraftKey: "aircraft-1",
          productKey: "product-1",
          plannedBoardingMinutesOverride: 6,
          plannedDeboardingMinutesOverride: 4,
          plannedBufferMinutesOverride: 3,
        },
      ],
    });
    expect(exported?.template.resourceGroups[0]).not.toHaveProperty("plannedRotationMinutes");
    expect(exported?.schedule).toEqual({
      timeZone: "Europe/Berlin",
      salesStartAt: "2026-08-09T07:00:00.000Z",
      salesEndAt: "2026-08-09T16:00:00.000Z",
      operationsStartAt: "2026-08-09T08:00:00.000Z",
      operationsEndAt: "2026-08-09T16:00:00.000Z",
    });
    expect(prepared).toHaveLength(7);
    expect(prepared.every((statement) => statement.bindings[0] === EVENT_ID)).toBe(true);
    const sql = prepared.map((statement) => statement.sql).join("\n");
    expect(sql).not.toMatch(
      /\b(ticket_groups|tickets|rotations|event_ledger|audit|operator_accounts)\b/,
    );
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(sql).not.toContain("planned_rotation_minutes");
  });
});
