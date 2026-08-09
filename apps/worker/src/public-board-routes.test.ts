import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import type {
  FidsProjectionEvent,
  FidsProjectionRow,
  loadFidsProjectionFleet,
  loadFidsProjectionRows,
} from "./fids-board-projection";
import { registerPublicBoardRoutes } from "./public-board-routes";
import type { Env } from "./types";

const NOW = "2026-08-09T08:00:00.000Z";

function event(overrides?: Partial<FidsProjectionEvent>): FidsProjectionEvent {
  return {
    name: "Synthetischer Flugtag",
    time_zone: "Europe/Berlin",
    emergency_mode: 0,
    operational_interrupted: 0,
    operational_note: "Allgemeiner Hinweis",
    operations_end_at: "2026-08-09T18:00:00.000Z",
    planned_public_note: "Aktiver Planhinweis",
    departed_visibility_seconds: 900,
    updated_at: NOW,
    ...overrides,
  };
}

function row(overrides?: Partial<FidsProjectionRow>): FidsProjectionRow {
  return {
    row_id: "rotation-1:group-1",
    rotation_id: "rotation-1",
    product_id: "product-1",
    gate_id: "gate-1",
    product_name: "Panorama",
    product_code: "PAN20",
    gate_label: "Gate 1",
    communication_number: 8021,
    precalled_at: null,
    precall_decision_status: "PREPARE",
    queue_position: 2,
    dispatch_order: 1,
    status: "DRAFT",
    predicted_boarding_at: "2026-08-09T08:30:00.000Z",
    predicted_completion_at: "2026-08-09T08:50:00.000Z",
    prediction_quality: "STABLE",
    prediction_lower_minutes: 20,
    prediction_upper_minutes: 40,
    prediction_updated_at: NOW,
    dispatch_batch_id: "batch-1",
    dispatch_unplanned_reason: null,
    recall_id: null,
    recall_sequence: null,
    recall_started_at: null,
    recall_expires_at: null,
    aircraft_registration: "D-EAAA",
    departed_at: null,
    ticket_count: 3,
    part_number: 1,
    part_count: 1,
    passenger_count: 3,
    resource_group_status: "ACTIVE",
    resource_group_operational_note: "Ressourcenhinweis",
    planned_public_note: "Gruppenhinweis",
    sort_rank: 2,
    projection_index: 1,
    ...overrides,
  };
}

function createApp(input?: {
  event?: FidsProjectionEvent | null;
  rows?: FidsProjectionRow[];
  fleet?: Array<{ registration: string; operational_state: string; refuel_planned: number }>;
  gate?: { id: string; label: string; display_filter_json: string } | null;
}) {
  const gateBindings: unknown[][] = [];
  const prepare = vi.fn(() => ({
    bind: (...values: unknown[]) => {
      gateBindings.push(values);
      return { first: async () => input?.gate ?? null };
    },
  }));
  const env = { DB: { prepare }, APP_ENV: "development" } as unknown as Env;
  const loadEvent = vi.fn(async (_database: D1Database, _eventId: string) => input?.event ?? null);
  const loadRows = vi.fn(
    async (_database: D1Database, _projection: Parameters<typeof loadFidsProjectionRows>[1]) =>
      input?.rows ?? [],
  );
  const loadFleet = vi.fn(
    async (_database: D1Database, _eventId: string) => input?.fleet ?? [],
  ) as typeof loadFidsProjectionFleet;
  const liveFetch = vi.fn(async () =>
    Response.json({ live: true }, { headers: { "x-live-proxy": "synthetic" } }),
  );
  const idFromName = vi.fn(() => ({ syntheticId: true }));
  const get = vi.fn(() => ({ fetch: liveFetch }));
  const coordinatorNamespace = vi.fn(
    () => ({ idFromName, get }) as unknown as Env["EVENT_COORDINATOR"],
  );
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerPublicBoardRoutes(app, coordinatorNamespace, { loadEvent, loadRows, loadFleet });
  return {
    app,
    env,
    prepare,
    gateBindings,
    loadEvent,
    loadRows,
    loadFleet,
    coordinatorNamespace,
    idFromName,
    get,
    liveFetch,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("public event board and live routes", () => {
  it("returns an unknown event without loading board rows", async () => {
    const { app, env, loadRows, loadFleet } = createApp({ event: null });

    const response = await app.request(
      "https://worker.test/api/public/events/missing/board",
      {},
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVENT_NOT_FOUND" } });
    expect(loadRows).not.toHaveBeenCalled();
    expect(loadFleet).not.toHaveBeenCalled();
  });

  it("applies a gate filter, limits the anonymous projection, and strips protected identifiers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const displayFilter = { productIds: ["product-1"], rotationStatuses: ["DRAFT"] };
    const { app, env, gateBindings, loadRows } = createApp({
      event: event(),
      rows: [row()],
      fleet: [{ registration: "D-EAAA", operational_state: "AVAILABLE", refuel_planned: 1 }],
      gate: { id: "gate-1", label: "Gate 1", display_filter_json: JSON.stringify(displayFilter) },
    });

    const response = await app.request(
      "https://worker.test/api/public/events/event-1/board?gateId=gate-1",
      {},
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toMatch(/^public-board;dur=\d+\.\d$/);
    const payload = (await response.json()) as {
      groups: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    expect(payload).toMatchObject({
      eventName: "Synthetischer Flugtag",
      selectedGate: { id: "gate-1", label: "Gate 1", displayFilter },
      operationalNotice: "Aktiver Planhinweis",
      fleet: [{ registration: "D-EAAA", status: "AVAILABLE", refuelPlanned: true }],
      groups: [
        {
          productName: "Panorama",
          productCode: "PAN20",
          communicationNumber: 8021,
          status: "PREPARE",
          forecastState: "DISPATCH_WINDOW",
          predictionQuality: "STABLE",
        },
      ],
    });
    expect(payload.groups[0]).not.toHaveProperty("rowId");
    expect(payload.groups[0]).not.toHaveProperty("productId");
    expect(payload.groups[0]).not.toHaveProperty("gateId");
    expect(payload.groups[0]).not.toHaveProperty("bookingGroupLabels");
    expect(payload.groups[0]).not.toHaveProperty("sharedFlightKey");
    expect(payload).not.toHaveProperty("preferencesVersion");
    expect(gateBindings).toEqual([["gate-1", "event-1"]]);
    expect(loadRows).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        eventId: "event-1",
        filter: { productIds: ["product-1"], gateIds: ["gate-1"], rotationStatuses: ["DRAFT"] },
        band: "ALL",
        limit: 20,
        offset: 0,
      }),
    );
  });

  it("suppresses board and fleet projections during emergency mode", async () => {
    const { app, env, loadRows, loadFleet } = createApp({
      event: event({ emergency_mode: 1 }),
      rows: [row()],
      fleet: [{ registration: "D-EAAA", operational_state: "AVAILABLE", refuel_planned: 0 }],
    });

    const response = await app.request(
      "https://worker.test/api/public/events/event-1/board",
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      emergencyMode: true,
      groups: [],
      fleet: [],
    });
    expect(loadRows).not.toHaveBeenCalled();
    expect(loadFleet).not.toHaveBeenCalled();
  });

  it("forwards the public live request to the event coordinator unchanged", async () => {
    const { app, env, coordinatorNamespace, idFromName, get, liveFetch } = createApp();

    const response = await app.request(
      "https://worker.test/api/public/events/event-1/live?transport=poll",
      { headers: { "x-synthetic-client": "board-1" } },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ live: true });
    expect(response.headers.get("x-live-proxy")).toBe("synthetic");
    expect(coordinatorNamespace).toHaveBeenCalledWith(env);
    expect(idFromName).toHaveBeenCalledWith("event-1");
    expect(get).toHaveBeenCalledOnce();
    expect(liveFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://worker.test/api/public/events/event-1/live?transport=poll",
      }),
    );
  });
});
