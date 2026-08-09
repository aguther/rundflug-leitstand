import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizedDevice } from "./device-authorization";
import {
  type ReportExportRouteDependencies,
  registerReportExportRoutes,
} from "./report-export-routes";
import { generateTicketExportCsv, loadPerformanceProfile } from "./report-export-service";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";

const adminDevice: AuthorizedDevice = {
  id: "550e8400-e29b-41d4-a716-446655440360",
  role: "ADMIN",
  accountId: "550e8400-e29b-41d4-a716-446655440361",
  loginCode: "ADMIN-01",
};

const performanceProfile = {
  schemaVersion: 1 as const,
  exportedAt: "2026-08-10T08:00:00.000Z",
  context: {
    eventName: "Synthetic event",
    eventDate: "2026-08-10",
    aerodrome: "EDXX",
    timeZone: "Europe/Berlin",
  },
  planningDefaults: { boardingMinutes: 5, deboardingMinutes: 4, bufferMinutes: 3 },
  resourceGroups: [],
};

function createRouteApp(device: AuthorizedDevice | null = adminDevice) {
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: Object.create(null) as D1Database,
  }) as Env;
  const authorizeDevice = vi.fn(async () => device);
  const generateDailyReportCsv = vi.fn(async () => ({
    status: "READY" as const,
    body: "daily-csv",
  }));
  const generateDailyReportPdf = vi.fn(async () => ({
    status: "READY" as const,
    body: new TextEncoder().encode("%PDF-1.4 synthetic"),
  }));
  const generateTicketExportCsv = vi.fn(async () => "ticket-csv");
  const loadPerformanceProfile = vi.fn(async () => ({
    status: "READY" as const,
    body: performanceProfile,
  }));
  const dependencies = {
    authorizeDevice,
    generateDailyReportCsv,
    generateDailyReportPdf,
    generateTicketExportCsv,
    loadPerformanceProfile,
  } as unknown as ReportExportRouteDependencies;
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  registerReportExportRoutes(app as never, dependencies);
  return {
    app,
    env,
    authorizeDevice,
    generateDailyReportCsv,
    generateDailyReportPdf,
    generateTicketExportCsv,
    loadPerformanceProfile,
  };
}

function request(route: ReturnType<typeof createRouteApp>, path: string) {
  return route.app.request(
    `https://worker.test/api/control/${EVENT_ID}${path}`,
    undefined,
    route.env,
  );
}

describe("report export routes", () => {
  it.each(["ADMIN", "CASHIER"] as const)("allows daily CSV export for %s", async (role) => {
    const route = createRouteApp({ ...adminDevice, role });
    const response = await request(route, "/reports/daily.csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="tagesbericht-${EVENT_ID}.csv"`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("daily-csv");
  });

  it.each([null, { ...adminDevice, role: "FLIGHT_DIRECTOR" as const }])(
    "rejects daily CSV export for an unauthorized device",
    async (device) => {
      const route = createRouteApp(device);
      const response = await request(route, "/reports/daily.csv");
      expect(response.status).toBe(403);
      expect(route.generateDailyReportCsv).not.toHaveBeenCalled();
    },
  );

  it("preserves the daily CSV event-not-found response", async () => {
    const route = createRouteApp();
    route.generateDailyReportCsv.mockResolvedValueOnce({ status: "EVENT_NOT_FOUND" } as never);
    const response = await request(route, "/reports/daily.csv");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVENT_NOT_FOUND" } });
  });

  it.each(["ADMIN", "FLIGHT_DIRECTOR"] as const)(
    "allows performance profile export for %s",
    async (role) => {
      const route = createRouteApp({ ...adminDevice, role });
      const response = await request(route, "/exports/performance-profile.json");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="leistungsprofil-${EVENT_ID}.json"`,
      );
      await expect(response.json()).resolves.toEqual(performanceProfile);
    },
  );

  it.each(["CASHIER", "DISPLAY"] as const)(
    "rejects performance profile export for %s",
    async (role) => {
      const route = createRouteApp({ ...adminDevice, role });
      const response = await request(route, "/exports/performance-profile.json");
      expect(response.status).toBe(403);
      expect(route.loadPerformanceProfile).not.toHaveBeenCalled();
    },
  );

  it.each(["ADMIN", "CASHIER", "FLIGHT_DIRECTOR"] as const)(
    "allows ticket CSV export for %s",
    async (role) => {
      const route = createRouteApp({ ...adminDevice, role });
      const response = await request(route, "/exports/tickets.csv");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="rohdaten-tickets-${EVENT_ID}.csv"`,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.text()).resolves.toBe("ticket-csv");
    },
  );

  it("rejects ticket CSV export for display devices", async () => {
    const route = createRouteApp({ ...adminDevice, role: "DISPLAY" });
    const response = await request(route, "/exports/tickets.csv");
    expect(response.status).toBe(403);
    expect(route.generateTicketExportCsv).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "CASHIER", "FLIGHT_DIRECTOR"] as const)(
    "allows daily PDF export for %s",
    async (role) => {
      const route = createRouteApp({ ...adminDevice, role });
      const response = await request(route, "/reports/daily.pdf");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="tagesbericht-${EVENT_ID}.pdf"`,
      );
      await expect(response.text()).resolves.toBe("%PDF-1.4 synthetic");
    },
  );

  it("preserves the daily PDF event-not-found response", async () => {
    const route = createRouteApp();
    route.generateDailyReportPdf.mockResolvedValueOnce({ status: "EVENT_NOT_FOUND" } as never);
    const response = await request(route, "/reports/daily.pdf");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVENT_NOT_FOUND" } });
  });
});

describe("report export service", () => {
  it("projects a deterministic aggregate-only performance profile", async () => {
    const sqlStatements: string[] = [];
    const bindings: unknown[][] = [];
    const prepare = vi.fn((sql: string) => {
      sqlStatements.push(sql);
      return {
        bind: (...values: unknown[]) => {
          bindings.push(values);
          return {
            first: async () => ({
              name: "Synthetic event",
              event_date: "2026-08-10",
              aerodrome: "EDXX",
              time_zone: "Europe/Berlin",
              planned_boarding_minutes: 5,
              planned_deboarding_minutes: 4,
              planned_buffer_minutes: 3,
            }),
            all: async () => ({
              results: [
                {
                  resource_group_id: "group-a",
                  resource_group_name: "Synthetic group",
                  completed_rotations: 7,
                  average_boarding_minutes: 5.5,
                  average_flight_minutes: 18.2,
                  average_turnaround_minutes: 4.1,
                  aircraft_types: "Type B,Type A",
                  passenger_seat_counts: "6,4,invalid",
                },
              ],
            }),
          };
        },
      };
    });
    const result = await loadPerformanceProfile(
      { prepare } as unknown as D1Database,
      EVENT_ID,
      "2026-08-10T08:00:00.000Z",
    );
    expect(result).toEqual({
      status: "READY",
      body: {
        ...performanceProfile,
        resourceGroups: [
          {
            id: "group-a",
            name: "Synthetic group",
            completedRotations: 7,
            aircraftTypes: ["Type A", "Type B"],
            passengerSeatCounts: [4, 6],
            durationsMinutes: { boarding: 5.5, flight: 18.2, turnaround: 4.1 },
          },
        ],
      },
    });
    expect(sqlStatements[1]).toContain("average_turnaround_minutes");
    expect(sqlStatements[1]).toContain("GROUP_CONCAT(DISTINCT a.passenger_seats)");
    expect(bindings).toEqual([[EVENT_ID], [EVENT_ID]]);
  });

  it("does not read aggregates when the event is missing", async () => {
    const prepare = vi.fn(() => ({
      bind: () => ({ first: async () => null }),
    }));
    await expect(
      loadPerformanceProfile({ prepare } as unknown as D1Database, EVENT_ID),
    ).resolves.toEqual({ status: "EVENT_NOT_FOUND" });
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("exports the complete ticket projection with stable columns and CSV escaping", async () => {
    let sql = "";
    let binding: unknown[] = [];
    const prepare = vi.fn((value: string) => {
      sql = value;
      return {
        bind: (...values: unknown[]) => {
          binding = values;
          return {
            all: async () => ({
              results: [
                {
                  ticket_id: "ticket-a",
                  ticket_status: "COMPLETED",
                  weight_class: "NORMAL",
                  payment_method: "CASH",
                  payment_status: "PAID",
                  price_cents: 5000,
                  created_at: "2026-08-10T08:00:00.000Z",
                  ticket_group_id: "ticket-group-a",
                  queue_sequence: 42,
                  standby: 0,
                  product_id: "product-a",
                  product_name: "Synthetic; product",
                  resource_group_id: "group-a",
                  resource_group_name: "Synthetic group",
                  communication_number: 9,
                  rotation_id: "rotation-a",
                  rotation_status: "COMPLETED",
                  registration: "D-TEST",
                  pilot_code: "P-01",
                  called_at: "2026-08-10T09:00:00.000Z",
                  departed_at: "2026-08-10T09:10:00.000Z",
                  landed_at: "2026-08-10T09:30:00.000Z",
                  completed_at: "2026-08-10T09:40:00.000Z",
                },
              ],
            }),
          };
        },
      };
    });
    const csv = await generateTicketExportCsv({ prepare } as unknown as D1Database, EVENT_ID);
    expect(csv).toContain("ticket_id;ticket_status;weight_class");
    expect(csv).toContain('"Synthetic; product"');
    expect(csv).toContain("rotation-a;COMPLETED;D-TEST;P-01");
    expect(sql).toContain("rt.released_at IS NULL");
    expect(sql).not.toMatch(/public_code|token|guest_name|passenger_name/i);
    expect(binding).toEqual([EVENT_ID]);
  });
});
