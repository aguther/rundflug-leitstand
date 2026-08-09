import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizedDevice } from "./device-authorization";
import { type HistoryRouteDependencies, registerHistoryRoutes } from "./history-routes";
import {
  loadAuditHistory,
  loadForecastHistory,
  loadOperationalHistory,
  loadResourceDayHistory,
} from "./history-service";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440350";

const directorDevice: AuthorizedDevice = {
  id: DEVICE_ID,
  role: "FLIGHT_DIRECTOR",
  accountId: "550e8400-e29b-41d4-a716-446655440351",
  loginCode: "DIRECTOR-01",
};

const emptyOperationalHistory = { entries: [], total: 0, limit: 100, offset: 0 };
const emptyForecastHistory = { entries: [], total: 0, limit: 100, offset: 0 };
const resourceHistory = {
  scopeType: "PILOT" as const,
  scopeId: "pilot-a",
  from: "2026-08-09T06:00:00.000Z",
  until: "2026-08-09T18:00:00.000Z",
  observedUntil: "2026-08-09T12:00:00.000Z",
  rotations: [],
  blocks: [],
};

function createRouteApp(device: AuthorizedDevice | null = directorDevice) {
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: Object.create(null) as D1Database,
  }) as Env;
  const authorizeDevice = vi.fn(async () => device);
  const loadAuditHistoryMock = vi.fn(async () => ({ entries: [] }));
  const loadOperationalHistoryMock = vi.fn(async () => emptyOperationalHistory);
  const loadForecastHistoryMock = vi.fn(async () => emptyForecastHistory);
  const loadResourceDayHistoryMock = vi.fn(async () => ({
    status: "READY" as const,
    history: resourceHistory,
  }));
  const dependencies = {
    authorizeDevice,
    loadAuditHistory: loadAuditHistoryMock,
    loadOperationalHistory: loadOperationalHistoryMock,
    loadForecastHistory: loadForecastHistoryMock,
    loadResourceDayHistory: loadResourceDayHistoryMock,
  } as unknown as HistoryRouteDependencies;
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  registerHistoryRoutes(app as never, dependencies);
  return {
    app,
    env,
    authorizeDevice,
    loadAuditHistory: loadAuditHistoryMock,
    loadOperationalHistory: loadOperationalHistoryMock,
    loadForecastHistory: loadForecastHistoryMock,
    loadResourceDayHistory: loadResourceDayHistoryMock,
  };
}

function request(route: ReturnType<typeof createRouteApp>, path: string) {
  return route.app.request(
    `https://worker.test/api/control/${EVENT_ID}${path}`,
    undefined,
    route.env,
  );
}

function singleQueryDatabase(rows: Array<Record<string, unknown>>) {
  let sql = "";
  let bindings: unknown[] = [];
  const all = vi.fn(async () => ({ results: rows }));
  const bind = vi.fn((...values: unknown[]) => {
    bindings = values;
    return { all };
  });
  const prepare = vi.fn((value: string) => {
    sql = value;
    return { bind };
  });
  return {
    database: { prepare } as unknown as D1Database,
    sql: () => sql,
    bindings: () => bindings,
  };
}

describe("history routes", () => {
  it.each([null, { ...directorDevice, role: "DISPLAY" as const }])(
    "rejects every history surface for an unauthorized device",
    async (device) => {
      const route = createRouteApp(device);
      const paths = [
        "/history",
        "/history/operations",
        "/history/forecasts",
        "/history/resources?scopeType=PILOT&scopeId=pilot-a",
      ];
      for (const path of paths) {
        const response = await request(route, path);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          error: { code: "SESSION_NOT_AUTHORIZED" },
        });
      }
      expect(route.loadAuditHistory).not.toHaveBeenCalled();
      expect(route.loadOperationalHistory).not.toHaveBeenCalled();
      expect(route.loadForecastHistory).not.toHaveBeenCalled();
      expect(route.loadResourceDayHistory).not.toHaveBeenCalled();
    },
  );

  it.each(["ADMIN", "FLIGHT_DIRECTOR"] as const)("allows the history role %s", async (role) => {
    const route = createRouteApp({ ...directorDevice, role });
    const response = await request(route, "/history");
    expect(response.status).toBe(200);
    expect(route.loadAuditHistory).toHaveBeenCalledOnce();
  });

  it("forwards audit filters without interpreting them in the route", async () => {
    const route = createRouteApp();
    const response = await request(
      route,
      `/history?eventType=MARK_LANDED&aggregateType=ROTATION&aggregateId=rotation-a&deviceId=${DEVICE_ID}&since=2026-08-09T08%3A00%3A00.000Z&until=2026-08-09T12%3A00%3A00.000Z&limit=25`,
    );
    expect(response.status).toBe(200);
    expect(route.loadAuditHistory).toHaveBeenCalledWith(route.env.DB, EVENT_ID, {
      eventType: "MARK_LANDED",
      aggregateType: "ROTATION",
      aggregateId: "rotation-a",
      deviceId: DEVICE_ID,
      since: "2026-08-09T08:00:00.000Z",
      until: "2026-08-09T12:00:00.000Z",
      limit: "25",
    });
  });

  it("validates and normalizes operational history filters", async () => {
    const route = createRouteApp();
    const response = await request(
      route,
      "/history/operations?ticketId=ticket-a&communicationNumber=42&ticketStatus=COMPLETED&limit=25&offset=50",
    );
    expect(response.status).toBe(200);
    expect(route.loadOperationalHistory).toHaveBeenCalledWith(route.env.DB, EVENT_ID, {
      ticketId: "ticket-a",
      communicationNumber: 42,
      ticketStatus: "COMPLETED",
      limit: 25,
      offset: 50,
    });

    const invalid = await request(route, "/history/operations?ticketStatus=UNKNOWN");
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "HISTORY_FILTERS_INVALID" },
    });
  });

  it("validates forecast ranges before calling the service", async () => {
    const route = createRouteApp();
    const response = await request(
      route,
      "/history/forecasts?aircraftId=aircraft-a&limit=12&offset=4",
    );
    expect(response.status).toBe(200);
    expect(route.loadForecastHistory).toHaveBeenCalledWith(route.env.DB, EVENT_ID, {
      aircraftId: "aircraft-a",
      limit: 12,
      offset: 4,
    });

    const invalid = await request(
      route,
      "/history/forecasts?since=2026-08-09T12%3A00%3A00.000Z&until=2026-08-09T08%3A00%3A00.000Z",
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "FORECAST_FILTERS_INVALID" },
    });
  });

  it("maps resource validation and not-found results without exposing a partial response", async () => {
    const route = createRouteApp();
    const invalid = await request(route, "/history/resources?scopeType=PILOT");
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "RESOURCE_HISTORY_FILTERS_INVALID" },
    });

    route.loadResourceDayHistory.mockResolvedValueOnce({ status: "EVENT_NOT_FOUND" } as never);
    const missingEvent = await request(route, "/history/resources?scopeType=PILOT&scopeId=pilot-a");
    expect(missingEvent.status).toBe(404);
    await expect(missingEvent.json()).resolves.toMatchObject({
      error: { code: "EVENT_NOT_FOUND" },
    });

    route.loadResourceDayHistory.mockResolvedValueOnce({ status: "RESOURCE_NOT_FOUND" } as never);
    const missingResource = await request(
      route,
      "/history/resources?scopeType=AIRCRAFT&scopeId=aircraft-a",
    );
    expect(missingResource.status).toBe(404);
    await expect(missingResource.json()).resolves.toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND" },
    });
  });

  it("returns the complete resource history from the service", async () => {
    const route = createRouteApp();
    const response = await request(route, "/history/resources?scopeType=PILOT&scopeId=pilot-a");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(resourceHistory);
    expect(route.loadResourceDayHistory).toHaveBeenCalledWith(route.env.DB, EVENT_ID, {
      scopeType: "PILOT",
      scopeId: "pilot-a",
    });
  });
});

describe("history service", () => {
  it("binds trimmed audit filters, normalized dates and the bounded limit", async () => {
    const harness = singleQueryDatabase([
      {
        sequence: 9,
        event_type: "MARK_LANDED",
        occurred_at: "2026-08-09T10:00:00.000Z",
        device_id: DEVICE_ID,
        aggregate_type: "ROTATION",
        aggregate_id: "rotation-a",
        aggregate_version: 7,
        payload_json: '{"synthetic":true}',
      },
    ]);
    const result = await loadAuditHistory(harness.database, EVENT_ID, {
      eventType: " MARK_LANDED ",
      aggregateType: "ROTATION",
      aggregateId: "rotation-a",
      deviceId: DEVICE_ID,
      since: "2026-08-09T08:00:00+00:00",
      until: "invalid",
      limit: "5000",
    });
    expect(result.entries).toEqual([
      {
        sequence: 9,
        eventType: "MARK_LANDED",
        occurredAt: "2026-08-09T10:00:00.000Z",
        deviceId: DEVICE_ID,
        aggregateType: "ROTATION",
        aggregateId: "rotation-a",
        aggregateVersion: 7,
        payload: { synthetic: true },
      },
    ]);
    expect(harness.sql()).toContain("event_type = ?2");
    expect(harness.sql()).toContain("occurred_at >= ?6");
    expect(harness.sql()).not.toContain("occurred_at <=");
    expect(harness.bindings()).toEqual([
      EVENT_ID,
      "MARK_LANDED",
      "ROTATION",
      "rotation-a",
      DEVICE_ID,
      "2026-08-09T08:00:00.000Z",
      1000,
    ]);
  });

  it("projects operational assignments and stable communication labels", async () => {
    const harness = singleQueryDatabase([
      {
        ticket_id: "ticket-a",
        ticket_group_id: "ticket-group-a",
        ticket_status: "COMPLETED",
        sold_at: "2026-08-09T08:00:00.000Z",
        assigned_at: "2026-08-09T09:00:00.000Z",
        released_at: null,
        rotation_id: "rotation-a",
        rotation_status: "COMPLETED",
        flight_group_id: "flight-group-a",
        communication_number: 42,
        resource_group_short_code: "RG",
        product_id: "product-a",
        product_code: "PA",
        product_name: "Synthetic product",
        resource_group_id: "resource-group-a",
        resource_group_name: "Synthetic group",
        gate_id: "gate-a",
        gate_label: "Gate A",
        aircraft_id: "aircraft-a",
        aircraft_registration: "D-TEST",
        pilot_id: "pilot-a",
        pilot_operational_code: "P-01",
        called_at: "2026-08-09T09:10:00.000Z",
        departed_at: "2026-08-09T09:20:00.000Z",
        landed_at: "2026-08-09T09:40:00.000Z",
        completed_at: "2026-08-09T09:50:00.000Z",
        latest_at: "2026-08-09T09:50:00.000Z",
        total_count: 1,
      },
    ]);
    const result = await loadOperationalHistory(harness.database, EVENT_ID, {
      limit: 25,
      offset: 0,
    });
    expect(result).toMatchObject({
      total: 1,
      limit: 25,
      offset: 0,
      entries: [
        {
          ticketId: "ticket-a",
          assignmentActive: true,
          communicationLabel: "F-RG-042",
          pilotOperationalCode: "P-01",
        },
      ],
    });
    expect(harness.bindings()).toEqual([EVENT_ID, 25, 0]);
  });

  it("preserves forecast diagnostics and dispatch planning projections", async () => {
    const harness = singleQueryDatabase([
      {
        snapshot_id: "snapshot-a",
        rotation_id: "rotation-a",
        flight_group_id: "flight-group-a",
        communication_number: 42,
        resource_group_short_code: "RG",
        aircraft_id: "aircraft-a",
        aircraft_registration: "D-TEST",
        pilot_id: "pilot-a",
        pilot_operational_code: "P-01",
        operation_day_version: 7,
        captured_at: "2026-08-09T09:00:00.000Z",
        trigger_event_type: "MARK_LANDED",
        quality: "CHANGING",
        lower_minutes: 10,
        upper_minutes: 15,
        data_basis_scope: "PRODUCT_HISTORY",
        sample_size: 4,
        data_age_minutes: 2,
        active_capacity: 2,
        reference_duration_minutes: 30,
        product_id: "product-a",
        assumed_aircraft_id: "aircraft-a",
        boarding_minutes: 4,
        deboarding_minutes: 3,
        buffer_minutes: 2,
        boarding_source: "PRODUCT",
        deboarding_source: "PRODUCT",
        buffer_source: "EVENT",
        dispatch_plan_id: "plan-a",
        dispatch_plan_revision: "revision-a",
        dispatch_batch_id: "batch-a",
        dispatch_order: 1,
        dispatch_wave: 1,
        dispatch_lane_id: "lane-a",
        dispatch_group_ids_json: '["ticket-group-a"]',
        dispatch_occupied_seats: 3,
        dispatch_available_seats: 1,
        dispatch_commitment_level: "PREPARE",
        dispatch_decision_reasons_json: '["FAIRNESS"]',
        dispatch_confirmed_overtake_count: 1,
        dispatch_projected_overtake_count: 2,
        dispatch_unplanned_reason: null,
        predicted_boarding_at: "2026-08-09T09:10:00.000Z",
        predicted_departure_at: "2026-08-09T09:15:00.000Z",
        predicted_landing_at: "2026-08-09T09:35:00.000Z",
        predicted_completion_at: "2026-08-09T09:40:00.000Z",
        called_at: "2026-08-09T09:11:00.000Z",
        departed_at: null,
        landed_at: null,
        completed_at: null,
        boarding_deviation_minutes: 1,
        departure_deviation_minutes: null,
        landing_deviation_minutes: null,
        completion_deviation_minutes: null,
        total_count: 1,
      },
    ]);
    const result = await loadForecastHistory(harness.database, EVENT_ID, {
      limit: 20,
      offset: 0,
    });
    expect(result).toMatchObject({
      total: 1,
      entries: [
        {
          communicationLabel: "F-RG-042",
          quality: "CHANGING",
          dispatchPlan: {
            planId: "plan-a",
            groupIds: ["ticket-group-a"],
            commitmentLevel: "PREPARE",
            decisionReasons: ["FAIRNESS"],
            confirmedOvertakeCount: 1,
            projectedOvertakeCount: 2,
          },
          actual: { boardingAt: "2026-08-09T09:11:00.000Z" },
          deviationMinutes: { boarding: 1 },
        },
      ],
    });
  });

  it("returns a bounded anonymous aircraft-day projection", async () => {
    const preparedSql: string[] = [];
    const prepare = vi.fn((sql: string) => {
      preparedSql.push(sql);
      const first = async () => {
        if (sql.includes("FROM operation_days")) {
          return {
            event_date: "2026-08-09",
            time_zone: "Europe/Berlin",
            sale_opens_at: "2026-08-09T06:00:00.000Z",
            operations_start_at: "2026-08-09T08:00:00.000Z",
            operations_end_at: "2026-08-09T18:00:00.000Z",
          };
        }
        return { id: "aircraft-a" };
      };
      const all = async () => {
        if (sql.includes("FROM operational_blocks")) {
          return {
            results: [
              {
                id: "block-a",
                block_type: "REFUELING",
                status: "CLEARED",
                started_at: "2026-08-09T07:55:00.000Z",
                cleared_at: "2026-08-09T08:10:00.000Z",
              },
            ],
          };
        }
        return {
          results: [
            {
              rotation_id: "rotation-a",
              flight_group_id: "flight-group-a",
              communication_number: 42,
              resource_group_id: "resource-group-a",
              resource_group_name: "Synthetic group",
              resource_group_short_code: "RG",
              product_name: "Synthetic product",
              passenger_count: 3,
              usable_capacity: 4,
              aircraft_id: "aircraft-a",
              aircraft_registration: "D-TEST",
              pilot_id: "pilot-a",
              pilot_operational_code: "P-01",
              called_at: "2026-08-09T09:00:00.000Z",
              departed_at: "2026-08-09T09:10:00.000Z",
              landed_at: "2026-08-09T09:30:00.000Z",
              completed_at: "2026-08-09T09:40:00.000Z",
            },
          ],
        };
      };
      return { bind: () => ({ first, all }) };
    });
    const result = await loadResourceDayHistory(
      { prepare } as unknown as D1Database,
      EVENT_ID,
      { scopeType: "AIRCRAFT", scopeId: "aircraft-a" },
      "2026-08-09T12:00:00.000Z",
    );
    expect(result).toMatchObject({
      status: "READY",
      history: {
        scopeType: "AIRCRAFT",
        scopeId: "aircraft-a",
        observedUntil: "2026-08-09T12:00:00.000Z",
        rotations: [
          {
            communicationLabel: "F-RG-042",
            pilotOperationalCode: "P-01",
          },
        ],
        blocks: [
          {
            id: "block-a",
            type: "REFUELING",
            startedAt: "2026-08-09T07:55:00.000Z",
            endedAt: "2026-08-09T08:10:00.000Z",
            active: false,
          },
        ],
      },
    });
    expect(preparedSql.join("\n")).not.toMatch(/reason|note|public_code|token|payload_json/i);
    expect(JSON.stringify(result)).not.toMatch(/reason|note|publicCode|token|payload/i);
  });
});
