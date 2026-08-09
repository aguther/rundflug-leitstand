import type { FidsBoardResponse, FidsPreferences } from "@rundflug/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import type { FidsProjectionEvent } from "./fids-board-projection";
import { buildProtectedFidsBoard, type FidsBoardServiceDependencies } from "./fids-board-service";
import { registerFidsControlRoutes } from "./fids-control-routes";
import { loadFidsFilterOptions } from "./fids-filter-options-service";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440310";

const displayActor: SessionActor = {
  accountId: ACCOUNT_ID,
  loginCode: "DISPLAY-01",
  role: "DISPLAY",
  sessionId: "550e8400-e29b-41d4-a716-446655440311",
  deviceId: "550e8400-e29b-41d4-a716-446655440312",
};

const fixedPreferences: FidsPreferences = {
  visibleRows: 8,
  layout: "SINGLE",
  theme: "SYSTEM",
  viewMode: "FIXED_PAGE",
  priorityGroupCount: 3,
  rotationIntervalSeconds: 12,
  groupSharedFlights: true,
  contentFilter: { productIds: ["product-a"], gateIds: ["gate-a"] },
  version: 4,
};

const fixedPage: FidsBoardResponse["page"] = {
  requestedPage: 2,
  pageSize: 8,
  totalItems: 1,
  totalPages: 1,
  groups: [],
};

const boardResponse: FidsBoardResponse = {
  eventName: "Synthetic event",
  timeZone: "Europe/Berlin",
  emergencyMode: false,
  operationalInterrupted: false,
  operationalNotice: "",
  departedVisibilitySeconds: 15,
  updatedAt: "2026-08-09T22:00:00.000Z",
  preferencesVersion: 4,
  viewMode: "FIXED_PAGE",
  filterSummary: fixedPreferences.contentFilter,
  priority: null,
  page: fixedPage,
  fleet: [],
};

function eventDatabase(eventExists = true): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn(async () => (eventExists ? { id: EVENT_ID } : null)) })),
    })),
  } as unknown as D1Database;
}

function routeEnvironment(eventExists = true): Env {
  return Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: eventDatabase(eventExists),
  }) as Env;
}

function createRouteApp(input?: {
  actor?: SessionActor | null;
  eventExists?: boolean;
  board?: FidsBoardResponse | null;
}) {
  const env = routeEnvironment(input?.eventExists ?? true);
  const authorizeSession = vi.fn(async () =>
    input && "actor" in input ? (input.actor ?? null) : displayActor,
  );
  const loadPreferences = vi.fn(async () => fixedPreferences);
  const loadFilterOptions = vi.fn(async () => ({ gates: [], products: [] }));
  const buildBoard = vi.fn(async () =>
    input && "board" in input ? (input.board ?? null) : boardResponse,
  );
  const performanceValues = [100, 112.34];
  const performanceNow = vi.fn(() => performanceValues.shift() ?? 112.34);
  let forwardedRequest: Request | null = null;
  const stub = {
    fetch: vi.fn(async (request: Request) => {
      forwardedRequest = request;
      return Response.json({ updated: true }, { status: 202, headers: { "x-upstream": "yes" } });
    }),
  };
  const namespace = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => stub),
  };
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerFidsControlRoutes(app, () => namespace as never, {
    authorizeSession,
    buildProtectedFidsBoard: buildBoard,
    loadFidsFilterOptions: loadFilterOptions,
    loadFidsPreferences: loadPreferences,
    mayAccessFids: (role) => role === "DISPLAY" || role === "ADMIN",
    performanceNow,
  });
  return {
    app,
    env,
    authorizeSession,
    loadPreferences,
    loadFilterOptions,
    buildBoard,
    namespace,
    stub,
    forwardedRequest: () => forwardedRequest,
  };
}

describe("protected FIDS control routes", () => {
  it("rejects missing and non-FIDS sessions", async () => {
    for (const actor of [null, { ...displayActor, role: "FLIGHT_LINE" as const }]) {
      const { app, env } = createRouteApp({ actor });
      const response = await app.request(
        `https://worker.test/api/control/${EVENT_ID}/fids/preferences`,
        undefined,
        env,
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "SESSION_NOT_AUTHORIZED" },
      });
    }
  });

  it("loads account-owned preferences only for an existing event", async () => {
    const available = createRouteApp();
    const response = await available.app.request(
      `https://worker.test/api/control/${EVENT_ID}/fids/preferences`,
      undefined,
      available.env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fixedPreferences);
    expect(available.loadPreferences).toHaveBeenCalledWith(available.env.DB, ACCOUNT_ID, EVENT_ID);

    const missing = createRouteApp({ eventExists: false });
    const missingResponse = await missing.app.request(
      `https://worker.test/api/control/${EVENT_ID}/fids/preferences`,
      undefined,
      missing.env,
    );
    expect(missingResponse.status).toBe(404);
    expect(missing.loadPreferences).not.toHaveBeenCalled();
  });

  it("forwards preference updates with trusted operator headers", async () => {
    const route = createRouteApp();
    const body = JSON.stringify({ visibleRows: 12 });
    const response = await route.app.request(
      `https://worker.test/api/control/${EVENT_ID}/fids/preferences?ignored=true`,
      { method: "PUT", headers: { "content-type": "application/json" }, body },
      route.env,
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("x-upstream")).toBe("yes");
    const forwarded = route.forwardedRequest();
    expect(forwarded?.url).toBe(
      `https://worker.test/internal/events/${EVENT_ID}/fids/preferences?ignored=true`,
    );
    expect(forwarded?.method).toBe("PUT");
    expect(forwarded?.headers.get("x-operator-account-id")).toBe(ACCOUNT_ID);
    expect(forwarded?.headers.get("x-operator-session-id")).toBe(displayActor.sessionId);
    expect(forwarded?.headers.get("x-operator-role")).toBe("DISPLAY");
    await expect(forwarded?.text()).resolves.toBe(body);
  });

  it("loads filter options after validating the event", async () => {
    const route = createRouteApp();
    const response = await route.app.request(
      `https://worker.test/api/control/${EVENT_ID}/fids/filter-options`,
      undefined,
      route.env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ gates: [], products: [] });
    expect(route.loadFilterOptions).toHaveBeenCalledWith(route.env.DB, EVENT_ID);
  });

  it("passes paging to the board service and exposes server timing", async () => {
    const route = createRouteApp();
    const response = await route.app.request(
      `https://worker.test/api/control/${EVENT_ID}/fids/board?page=2&lowerPage=3`,
      undefined,
      route.env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toBe("fids-board;dur=12.3");
    await expect(response.json()).resolves.toEqual(boardResponse);
    expect(route.buildBoard).toHaveBeenCalledWith(route.env.DB, {
      eventId: EVENT_ID,
      accountId: ACCOUNT_ID,
      page: "2",
      lowerPage: "3",
    });
  });
});

describe("FIDS filter options service", () => {
  it("maps gates and products without changing their query order", async () => {
    const statements: string[] = [];
    const bindings: unknown[][] = [];
    const database = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind(...values: unknown[]) {
            bindings.push(values);
            return {
              all: async () =>
                sql.includes("FROM gates")
                  ? { results: [{ id: "gate-a", label: "Gate A", active: 1 }] }
                  : {
                      results: [
                        {
                          id: "product-a",
                          code: "PA",
                          name: "Product A",
                          gate_id: "gate-a",
                          active: 0,
                        },
                      ],
                    },
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(loadFidsFilterOptions(database, EVENT_ID)).resolves.toEqual({
      gates: [{ id: "gate-a", label: "Gate A", active: true }],
      products: [
        { id: "product-a", code: "PA", name: "Product A", gateId: "gate-a", active: false },
      ],
    });
    expect(statements[0]).toContain("FROM gates");
    expect(statements[1]).toContain("FROM products p");
    expect(bindings).toEqual([[EVENT_ID], [EVENT_ID]]);
  });
});

function boardDependencies(input?: {
  event?: FidsProjectionEvent | null;
  preferences?: FidsPreferences;
}): {
  dependencies: FidsBoardServiceDependencies;
  loadFleet: ReturnType<typeof vi.fn>;
  loadRows: ReturnType<typeof vi.fn>;
  mapRow: ReturnType<typeof vi.fn>;
  orderRows: ReturnType<typeof vi.fn>;
  groupRows: ReturnType<typeof vi.fn>;
  paginateRows: ReturnType<typeof vi.fn>;
  partitionRows: ReturnType<typeof vi.fn>;
} {
  const event: FidsProjectionEvent | null =
    input && "event" in input
      ? (input.event ?? null)
      : {
          name: "Synthetic event",
          time_zone: "Europe/Berlin",
          emergency_mode: 0,
          operational_interrupted: 0,
          operational_note: "Operational note",
          operations_end_at: null,
          planned_public_note: "Planned note",
          departed_visibility_seconds: 15,
          updated_at: "2026-08-09T22:00:00.000Z",
        };
  const preferences = input?.preferences ?? fixedPreferences;
  const loadEvent = vi.fn(async () => event);
  const loadPreferences = vi.fn(async () => preferences);
  const loadFleet = vi.fn(async () => [
    { registration: "D-EAAA", operational_state: "AVAILABLE", refuel_planned: 1 },
  ]);
  const loadRows = vi.fn(async () => [{ synthetic: true }]);
  const mapRow = vi.fn(() => ({ mapped: true }));
  const orderRows = vi.fn((rows: unknown[]) => rows);
  const groupRows = vi.fn((rows: unknown[]) => rows);
  const paginateRows = vi.fn(() => fixedPage);
  const partitionRows = vi.fn(() => ({
    priority: {
      configuredCapacity: 3,
      effectiveCapacity: 1,
      totalItems: 1,
      overflowCount: 0,
      groups: [],
    },
    page: { ...fixedPage, requestedPage: 3, pageSize: 5 },
  }));
  const dependencies = {
    groupSharedFidsFlights: groupRows,
    loadAllFidsProjectionRows: loadRows,
    loadFidsPreferences: loadPreferences,
    loadFidsProjectionEvent: loadEvent,
    loadFidsProjectionFleet: loadFleet,
    mapFidsProjectionRow: mapRow,
    now: () => new Date("2026-08-09T22:00:15.000Z"),
    orderFidsRows: orderRows,
    paginateFidsRows: paginateRows,
    parseFidsPage: (value: string | undefined) => Number(value ?? 0),
    partitionFidsRows: partitionRows,
  } as unknown as FidsBoardServiceDependencies;
  return {
    dependencies,
    loadFleet,
    loadRows,
    mapRow,
    orderRows,
    groupRows,
    paginateRows,
    partitionRows,
  };
}

describe("protected FIDS board service", () => {
  it("loads, maps, groups and paginates the complete filtered projection", async () => {
    const harness = boardDependencies();
    const database = Object.create(null) as D1Database;
    const result = await buildProtectedFidsBoard(
      database,
      { eventId: EVENT_ID, accountId: ACCOUNT_ID, page: "2", lowerPage: undefined },
      harness.dependencies,
    );

    expect(result).toMatchObject({
      eventName: "Synthetic event",
      operationalNotice: "Planned note",
      viewMode: "FIXED_PAGE",
      page: fixedPage,
      fleet: [{ registration: "D-EAAA", status: "AVAILABLE", refuelPlanned: true }],
    });
    expect(harness.loadRows).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        eventId: EVENT_ID,
        band: "ALL",
        filter: {
          productIds: ["product-a"],
          gateIds: ["gate-a"],
          rotationStatuses: [],
        },
        departedVisibilityCutoff: "2026-08-09T22:00:00.000Z",
      }),
    );
    expect(harness.mapRow).toHaveBeenCalledTimes(1);
    expect(harness.orderRows).toHaveBeenCalledTimes(1);
    expect(harness.groupRows).toHaveBeenCalledWith([{ mapped: true }], true);
    expect(harness.paginateRows).toHaveBeenCalledWith([{ mapped: true }], 2, 8);
    expect(harness.partitionRows).not.toHaveBeenCalled();
  });

  it("partitions split mode rows with the configured priority capacity", async () => {
    const harness = boardDependencies({
      preferences: { ...fixedPreferences, viewMode: "SPLIT", priorityGroupCount: 3 },
    });
    const result = await buildProtectedFidsBoard(
      Object.create(null) as D1Database,
      { eventId: EVENT_ID, accountId: ACCOUNT_ID, page: undefined, lowerPage: "3" },
      harness.dependencies,
    );

    expect(harness.partitionRows).toHaveBeenCalledWith({
      rows: [{ mapped: true }],
      visibleRows: 8,
      priorityGroupCount: 3,
      lowerPage: 3,
    });
    expect(result?.priority).toMatchObject({ configuredCapacity: 3, totalItems: 1 });
    expect(harness.paginateRows).not.toHaveBeenCalled();
  });

  it("suppresses operational data during emergency mode", async () => {
    const harness = boardDependencies({
      event: {
        name: "Synthetic event",
        time_zone: "Europe/Berlin",
        emergency_mode: 1,
        operational_interrupted: 1,
        operational_note: "Hidden",
        operations_end_at: null,
        planned_public_note: null,
        departed_visibility_seconds: 15,
        updated_at: "2026-08-09T22:00:00.000Z",
      },
      preferences: { ...fixedPreferences, viewMode: "SPLIT" },
    });
    const result = await buildProtectedFidsBoard(
      Object.create(null) as D1Database,
      { eventId: EVENT_ID, accountId: ACCOUNT_ID, page: undefined, lowerPage: "1" },
      harness.dependencies,
    );

    expect(harness.loadFleet).not.toHaveBeenCalled();
    expect(harness.loadRows).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      emergencyMode: true,
      fleet: [],
      priority: { configuredCapacity: 3, totalItems: 0, groups: [] },
      page: { requestedPage: 1, totalItems: 0, groups: [] },
    });
  });
});
