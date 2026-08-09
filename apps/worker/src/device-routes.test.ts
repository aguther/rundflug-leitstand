import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizedDevice } from "./device-authorization";
import { loadDevices } from "./device-read-service";
import { type DeviceRouteDependencies, registerDeviceRoutes } from "./device-routes";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const OBSERVED_AT = Date.parse("2026-08-10T12:00:00.000Z");

const adminDevice: AuthorizedDevice = {
  id: "550e8400-e29b-41d4-a716-446655440370",
  role: "ADMIN",
  accountId: "550e8400-e29b-41d4-a716-446655440371",
  loginCode: "ADMIN-01",
};

const deviceProjection = {
  id: "device-a",
  label: "Synthetic device",
  role: "FLIGHT_LINE",
  active: true,
  online: true,
  pairedAt: "2026-08-10T08:00:00.000Z",
  lastSeenAt: "2026-08-10T11:59:00.000Z",
  revokedAt: null,
};

function createRouteApp(device: AuthorizedDevice | null = adminDevice) {
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: Object.create(null) as D1Database,
  }) as Env;
  const authorizeDevice = vi.fn(async () => device);
  const loadDevicesMock = vi.fn(async () => [deviceProjection]);
  const dependencies = {
    authorizeDevice,
    loadDevices: loadDevicesMock,
  } as unknown as DeviceRouteDependencies;
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  registerDeviceRoutes(app as never, dependencies);
  return { app, env, authorizeDevice, loadDevices: loadDevicesMock };
}

function request(route: ReturnType<typeof createRouteApp>) {
  return route.app.request(
    `https://worker.test/api/control/${EVENT_ID}/devices`,
    undefined,
    route.env,
  );
}

describe("device routes", () => {
  it.each([null, { ...adminDevice, role: "FLIGHT_DIRECTOR" as const }])(
    "rejects a non-admin device",
    async (device) => {
      const route = createRouteApp(device);
      const response = await request(route);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "SESSION_NOT_AUTHORIZED",
          message: "Sitzung für diese Ansicht nicht berechtigt.",
        },
      });
      expect(route.loadDevices).not.toHaveBeenCalled();
    },
  );

  it("returns the device projection for an administrator", async () => {
    const route = createRouteApp();
    const response = await request(route);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ devices: [deviceProjection] });
    expect(route.authorizeDevice).toHaveBeenCalledWith(route.env, EVENT_ID, expect.any(Request));
    expect(route.loadDevices).toHaveBeenCalledWith(route.env.DB, EVENT_ID);
  });
});

describe("device read service", () => {
  it("binds the event and preserves ordering and online-state semantics", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const prepare = vi.fn((value: string) => {
      sql = value;
      return {
        bind: (...values: unknown[]) => {
          bindings = values;
          return {
            all: async () => ({
              results: [
                {
                  id: "device-boundary",
                  label: "Boundary device",
                  role: "FLIGHT_LINE",
                  active: 1,
                  paired_at: "2026-08-10T08:00:00.000Z",
                  last_seen_at: "2026-08-10T11:58:00.000Z",
                  revoked_at: null,
                },
                {
                  id: "device-stale",
                  label: "Stale device",
                  role: "DISPLAY",
                  active: 1,
                  paired_at: "2026-08-10T07:00:00.000Z",
                  last_seen_at: "2026-08-10T11:57:59.999Z",
                  revoked_at: null,
                },
                {
                  id: "device-inactive",
                  label: "Inactive device",
                  role: "CASHIER",
                  active: 0,
                  paired_at: "2026-08-10T06:00:00.000Z",
                  last_seen_at: "2026-08-10T12:00:00.000Z",
                  revoked_at: "2026-08-10T11:00:00.000Z",
                },
              ],
            }),
          };
        },
      };
    });

    const result = await loadDevices({ prepare } as unknown as D1Database, EVENT_ID, OBSERVED_AT);

    expect(result).toEqual([
      {
        id: "device-boundary",
        label: "Boundary device",
        role: "FLIGHT_LINE",
        active: true,
        online: true,
        pairedAt: "2026-08-10T08:00:00.000Z",
        lastSeenAt: "2026-08-10T11:58:00.000Z",
        revokedAt: null,
      },
      {
        id: "device-stale",
        label: "Stale device",
        role: "DISPLAY",
        active: true,
        online: false,
        pairedAt: "2026-08-10T07:00:00.000Z",
        lastSeenAt: "2026-08-10T11:57:59.999Z",
        revokedAt: null,
      },
      {
        id: "device-inactive",
        label: "Inactive device",
        role: "CASHIER",
        active: false,
        online: false,
        pairedAt: "2026-08-10T06:00:00.000Z",
        lastSeenAt: "2026-08-10T12:00:00.000Z",
        revokedAt: "2026-08-10T11:00:00.000Z",
      },
    ]);
    expect(sql).toContain("FROM paired_devices WHERE operation_day_id = ?1");
    expect(sql).toContain("ORDER BY active DESC, paired_at DESC");
    expect(bindings).toEqual([EVENT_ID]);
  });
});
