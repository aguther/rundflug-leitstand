import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, StoredEventRow } from "./types";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class<Environment> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Environment;

    constructor(ctx: DurableObjectState, env: Environment) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { EventCoordinator } from "./event-coordinator";

interface StorageHarness {
  deleteAlarm: ReturnType<typeof vi.fn>;
  deleteAll: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getAlarm: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  setAlarm: ReturnType<typeof vi.fn>;
}

interface ContextHarness {
  context: DurableObjectState;
  storage: StorageHarness;
  waits: Promise<unknown>[];
}

function contextHarness(): ContextHarness {
  const waits: Promise<unknown>[] = [];
  const storage: StorageHarness = {
    deleteAlarm: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(undefined),
    getAlarm: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
    storage,
    waitUntil(work: Promise<unknown>) {
      waits.push(work);
    },
  } as unknown as DurableObjectState;
  return { context, storage, waits };
}

function databaseHarness(
  first: (sql: string, values: unknown[]) => unknown | Promise<unknown>,
): D1Database {
  return {
    prepare(sql: string) {
      const values: unknown[] = [];
      return {
        bind(...boundValues: unknown[]) {
          values.push(...boundValues);
          return this;
        },
        first() {
          return first(sql, values);
        },
      };
    },
  } as unknown as D1Database;
}

function coordinatorHarness(first: (sql: string, values: unknown[]) => unknown = () => null) {
  const context = contextHarness();
  const env = {
    APP_ENV: "development",
    DATA_JURISDICTION: "eu",
    DB: databaseHarness(first),
  } as unknown as Env;
  return { coordinator: new EventCoordinator(context.context, env), ...context };
}

function activeEvent(): StoredEventRow {
  return {
    id: "event-1",
    name: "Synthetic airfield day",
    event_date: "2026-07-24",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    version: 4,
    operational_note: "",
    updated_at: "2026-07-24T06:00:00.000Z",
  };
}

function noticeCommand(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "event-1",
    deviceId: "admin-device",
    issuedAt: "2026-07-24T05:00:00.000Z",
    type: "SET_RESOURCE_GROUP_NOTICE",
    expectedVersion: 4,
    payload: { resourceGroupId: "group-1", note: "Synthetic notice" },
    ...overrides,
  };
}

function storedCommandResult() {
  return {
    accepted: true,
    duplicate: false,
    event: {
      eventId: "event-1",
      name: "Synthetic airfield day",
      eventDate: "2026-07-24",
      aerodrome: "EDSY",
      timeZone: "Europe/Berlin",
      status: "ACTIVE",
      archivedAt: null,
      templateSourceId: null,
      emergencyMode: false,
      operationalInterrupted: false,
      version: 4,
      operationalNote: "",
      saleOpensAt: null,
      operationsStartAt: null,
      operationsEndAt: null,
      noShowAfterMinutes: 10,
      maxTicketDeferrals: 3,
      notificationLeadMinutes: 10,
      automaticPrecallEnabled: true,
      precallLeadMinutes: 15,
      maximumGateWaitMinutes: 30,
      precallMinimumQuality: "STABLE",
      precallGateCooldownMinutes: 5,
      referenceWeightsKg: { child: 35, normal: 75, heavy: 95 },
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 5,
      plannedBufferMinutes: 2,
      departedVisibilitySeconds: 15,
      updatedAt: "2026-07-24T05:00:00.000Z",
    },
    eventType: "RESOURCE_GROUP_NOTICE_SET",
  } as const;
}

function preflightReads(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyResponseJson: null,
    current: activeEvent(),
    aggregateVersion: null,
    plannedOperation: null,
    activeOperatorClaim: null,
    targetRotationAircraftId: null,
    batchCount: 1,
    statementCount: 2,
    durationMs: 1,
    ...overrides,
  };
}

function commandRequest(
  command: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://worker.test/events/${String(command.eventId)}/command`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(command),
  });
}

describe("EventCoordinator routing", () => {
  it("returns a JSON 404 for an unknown durable-object route", async () => {
    const { coordinator } = coordinatorHarness();

    const response = await coordinator.fetch(
      new Request("https://worker.test/events/event-1/nope"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Durable-Object-Route nicht gefunden." },
    });
  });

  it("clears alarms, storage, and realtime clients during a factory reset", async () => {
    const { coordinator, storage } = coordinatorHarness();
    const closeAllForReset = vi.fn();
    Object.assign(coordinator, { realtime: { closeAllForReset } });

    const response = await coordinator.fetch(
      new Request("https://worker.test/events/event-1/factory-reset", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reset: true });
    expect(closeAllForReset).toHaveBeenCalledOnce();
    expect(storage.deleteAlarm).toHaveBeenCalledOnce();
    expect(storage.deleteAll).toHaveBeenCalledOnce();
  });

  it("rejects malformed commands before reading operational state", async () => {
    const first = vi.fn();
    const { coordinator } = coordinatorHarness(first);

    const response = await coordinator.fetch(
      new Request("https://worker.test/events/event-1/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "NOT_A_COMMAND" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("server-timing")).toMatch(/^command-queue;dur=/);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_COMMAND", message: "Kommando ist formal ungültig." },
    });
    expect(first).not.toHaveBeenCalled();
  });

  it("rejects a command whose URL addresses another event", async () => {
    const first = vi.fn();
    const { coordinator } = coordinatorHarness(first);
    const command = {
      commandId: "c7686b45-39dd-4bb8-b4da-49308c6643cf",
      eventId: "event-2",
      deviceId: "flight-line-1",
      expectedVersion: 17,
      observedEventVersion: 17,
      issuedAt: "2026-07-24T05:00:00.000Z",
      type: "MARK_OFF_BLOCK",
      preconditions: [{ aggregateType: "ROTATION", aggregateId: "rotation-1", expectedVersion: 3 }],
      payload: { rotationId: "rotation-1" },
    };

    const response = await coordinator.fetch(
      new Request("https://worker.test/events/event-1/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "EVENT_MISMATCH",
        message: "Event-ID in URL und Kommando stimmen nicht überein.",
      },
    });
    expect(first).not.toHaveBeenCalled();
  });

  it("serializes FIDS preference changes through the command tail", async () => {
    const { coordinator } = coordinatorHarness();
    const handleUpdate = vi.fn().mockResolvedValue(new Response("updated", { status: 202 }));
    Object.assign(coordinator, { fidsPreferencesCommands: { handleUpdate } });
    const request = new Request("https://worker.test/events/event-1/fids/preferences", {
      method: "PUT",
    });

    const response = await coordinator.fetch(request);

    expect(response.status).toBe(202);
    expect(handleUpdate).toHaveBeenCalledWith(request, expect.any(URL));
  });

  it("delegates assist claims without passing them through the command queue", async () => {
    const { coordinator } = coordinatorHarness();
    const handleRequest = vi.fn().mockResolvedValue(new Response("claim", { status: 200 }));
    Object.assign(coordinator, { assistClaims: { handleRequest } });
    const request = new Request("https://worker.test/events/event-1/assist-claims/aircraft-1", {
      method: "DELETE",
    });

    const response = await coordinator.fetch(request);

    expect(await response.text()).toBe("claim");
    expect(handleRequest).toHaveBeenCalledWith(request, expect.any(URL));
  });

  it("returns a stable response when a dispatch lease adapter fails", async () => {
    const { coordinator } = coordinatorHarness();
    Object.assign(coordinator, {
      dispatchRecommendationLeases: {
        handleRequest: vi.fn().mockRejectedValue(new Error("synthetic lease failure")),
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await coordinator.fetch(
      new Request("https://worker.test/events/event-1/dispatch-recommendation-leases", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "DISPATCH_RECOMMENDATION_LEASE_FAILED",
        message: "Belegungsvorschlag konnte nicht reserviert werden.",
      },
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"code":"DISPATCH_RECOMMENDATION_LEASE_FAILED"'),
    );
  });
});

describe("EventCoordinator command authorization and preflight", () => {
  it("replays a stored idempotency receipt before device authentication", async () => {
    const stored = storedCommandResult();
    const { coordinator } = coordinatorHarness((sql) =>
      sql.includes("idempotency_receipts") ? { response_json: JSON.stringify(stored) } : null,
    );

    const response = await coordinator.fetch(commandRequest(noticeCommand()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
      eventType: "RESOURCE_GROUP_NOTICE_SET",
    });
  });

  it("rejects an unpaired device after an idempotency miss", async () => {
    const { coordinator } = coordinatorHarness(() => null);

    const response = await coordinator.fetch(commandRequest(noticeCommand()));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "DEVICE_NOT_PAIRED", message: "Sitzung ist nicht berechtigt." },
    });
  });

  it("replays a trusted preflight receipt without dispatching the command", async () => {
    const { coordinator } = coordinatorHarness();
    const loadTrusted = vi.fn().mockResolvedValue({
      duplicateResult: storedCommandResult(),
      reads: preflightReads(),
      d1CallCount: 1,
    });
    Object.assign(coordinator, { commandPreflight: { loadTrusted } });
    const command = noticeCommand();

    const response = await coordinator.fetch(
      commandRequest(command, {
        "x-operator-role": "ADMIN",
        "x-operator-device-id": String(command.deviceId),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: true, duplicate: true });
    expect(loadTrusted).toHaveBeenCalledOnce();
  });

  it("rejects commands outside the trusted operator role", async () => {
    const { coordinator } = coordinatorHarness();
    const command = noticeCommand();
    Object.assign(coordinator, {
      commandPreflight: {
        loadTrusted: vi.fn().mockResolvedValue({
          duplicateResult: null,
          reads: preflightReads(),
          d1CallCount: 1,
        }),
      },
    });

    const response = await coordinator.fetch(
      commandRequest(command, {
        "x-operator-role": "FIDS",
        "x-operator-device-id": String(command.deviceId),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });

  it("returns not found when preflight cannot load the addressed event", async () => {
    const { coordinator } = coordinatorHarness();
    const command = noticeCommand();
    Object.assign(coordinator, {
      commandPreflight: {
        loadTrusted: vi.fn().mockResolvedValue({
          duplicateResult: null,
          reads: preflightReads({ current: null }),
          d1CallCount: 1,
        }),
      },
    });

    const response = await coordinator.fetch(
      commandRequest(command, {
        "x-operator-role": "ADMIN",
        "x-operator-device-id": String(command.deviceId),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." },
    });
  });

  it("rejects a stale event version before invoking a command service", async () => {
    const { coordinator } = coordinatorHarness();
    const command = noticeCommand({ expectedVersion: 3 });
    const handle = vi.fn();
    const commandServices = Reflect.get(coordinator, "commandServices") as Record<string, unknown>;
    commandServices.operationalControlCommands = { handle };
    Object.assign(coordinator, {
      commandPreflight: {
        loadTrusted: vi.fn().mockResolvedValue({
          duplicateResult: null,
          reads: preflightReads(),
          d1CallCount: 1,
        }),
      },
    });

    const response = await coordinator.fetch(
      commandRequest(command, {
        "x-operator-role": "ADMIN",
        "x-operator-device-id": String(command.deviceId),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_VERSION", currentVersion: 4 },
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("dispatches a validated command and records preflight diagnostics", async () => {
    const { coordinator } = coordinatorHarness();
    const command = noticeCommand();
    const accepted = new Response(JSON.stringify(storedCommandResult()), {
      headers: { "content-type": "application/json" },
    });
    const handle = vi.fn().mockResolvedValue(accepted);
    const logSlowReads = vi.fn();
    const commandServices = Reflect.get(coordinator, "commandServices") as Record<string, unknown>;
    commandServices.operationalControlCommands = { handle };
    Object.assign(coordinator, {
      commandPreflight: {
        loadTrusted: vi.fn().mockResolvedValue({
          duplicateResult: null,
          reads: preflightReads(),
          d1CallCount: 1,
        }),
        logSlowReads,
      },
    });

    const response = await coordinator.fetch(
      commandRequest(command, {
        "x-operator-role": "ADMIN",
        "x-operator-device-id": String(command.deviceId),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: true });
    expect(handle).toHaveBeenCalledWith(expect.objectContaining(command), activeEvent());
    expect(logSlowReads).toHaveBeenCalledWith(
      "SET_RESOURCE_GROUP_NOTICE",
      expect.objectContaining({ current: activeEvent() }),
      1,
    );
  });

  it("contains unexpected preflight failures as internal command errors", async () => {
    const { coordinator } = coordinatorHarness();
    const command = noticeCommand();
    Object.assign(coordinator, {
      commandPreflight: {
        loadTrusted: vi.fn().mockRejectedValue(new Error("synthetic preflight failure")),
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await coordinator.fetch(
      commandRequest(command, {
        "x-operator-role": "ADMIN",
        "x-operator-device-id": String(command.deviceId),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "Kommando konnte nicht verarbeitet werden." },
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"code":"COMMAND_PROCESSING_FAILED"'),
    );
  });
});

describe("EventCoordinator alarms", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when no event has been registered for automatic work", async () => {
    const { coordinator, storage } = coordinatorHarness();

    await coordinator.alarm();

    expect(storage.setAlarm).not.toHaveBeenCalled();
  });

  it("expires recalls, recalculates active events, and keeps a pending alarm alive", async () => {
    const event = activeEvent();
    const first = vi.fn((sql: string) =>
      sql.includes("FROM operation_days WHERE id") ? event : { pending: 1 },
    );
    const { coordinator, storage } = coordinatorHarness(first);
    storage.get.mockResolvedValue("event-1");
    const expire = vi.fn().mockResolvedValue(undefined);
    const scheduleForecastRecalculation = vi.fn().mockResolvedValue(undefined);
    Object.assign(coordinator, {
      ticketGroupRecallPersistence: { expire },
      scheduleForecastRecalculation,
    });

    await coordinator.alarm();

    expect(expire).toHaveBeenCalledWith(event);
    expect(scheduleForecastRecalculation).toHaveBeenCalledWith(
      "event-1",
      "AUTOMATIC_FORECAST_TICK",
    );
    expect(storage.setAlarm).toHaveBeenCalledOnce();
    expect(storage.setAlarm.mock.calls[0]?.[0]).toBeGreaterThan(Date.now());
  });

  it("isolates tick failures and stops when no pending work remains", async () => {
    const failure = new Error("synthetic database failure");
    const first = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(null);
    const { coordinator, storage } = coordinatorHarness(first);
    storage.get.mockResolvedValue("event-1");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(coordinator.alarm()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"code":"AUTOMATIC_COORDINATOR_TICK_FAILED"'),
    );
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });
});

describe("EventCoordinator delegated work", () => {
  it("resolves a manual analysis capture through the serialized forecast queue", async () => {
    const { coordinator, waits } = coordinatorHarness();
    const capture = vi.fn().mockResolvedValue({ ok: true, snapshotId: "snapshot-1" });
    Object.assign(coordinator, { analysisSnapshotCapture: { capture } });
    const input = { eventId: "event-1", trigger: "MANUAL" } as never;

    const result = await coordinator.captureAnalysisSnapshot(input);

    expect(result).toEqual({ ok: true, snapshotId: "snapshot-1" });
    expect(capture).toHaveBeenCalledWith(input);
    expect(waits).toHaveLength(1);
    await expect(waits[0]).resolves.toBeUndefined();
  });

  it("turns analysis capture failures into a stable result", async () => {
    const { coordinator } = coordinatorHarness();
    Object.assign(coordinator, {
      analysisSnapshotCapture: {
        capture: vi.fn().mockRejectedValue(new Error("synthetic capture failure")),
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      coordinator.captureAnalysisSnapshot({ eventId: "event-1", trigger: "MANUAL" } as never),
    ).resolves.toEqual({ ok: false, code: "ANALYSIS_SNAPSHOT_CAPTURE_FAILED" });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"code":"ANALYSIS_SNAPSHOT_CAPTURE_FAILED"'),
    );
  });

  it("delegates websocket lifecycle events to the realtime boundary", async () => {
    const { coordinator } = coordinatorHarness();
    const realtime = {
      handleMessage: vi.fn(),
      handleClose: vi.fn(),
      handleError: vi.fn(),
    };
    Object.assign(coordinator, { realtime });
    const socket = {} as WebSocket;
    const message = new ArrayBuffer(4);

    await coordinator.webSocketMessage(socket, message);
    await coordinator.webSocketClose(socket, 1000, "done", true);
    await coordinator.webSocketError(socket);

    expect(realtime.handleMessage).toHaveBeenCalledWith(socket, message);
    expect(realtime.handleClose).toHaveBeenCalledOnce();
    expect(realtime.handleError).toHaveBeenCalledWith(socket);
  });
});
