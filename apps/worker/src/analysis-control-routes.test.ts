import type { AnalysisArchive, AnalysisSnapshot } from "@rundflug/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  type AnalysisControlRouteDependencies,
  registerAnalysisControlRoutes,
} from "./analysis-control-routes";
import type { SessionActor } from "./auth";
import type { AuthorizedDevice } from "./device-authorization";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440330";
const ARCHIVE_ID = "synthetic-archive";

const adminActor: SessionActor = {
  accountId: "550e8400-e29b-41d4-a716-446655440331",
  loginCode: "ADMIN-01",
  role: "ADMIN",
  sessionId: "550e8400-e29b-41d4-a716-446655440332",
  deviceId: "550e8400-e29b-41d4-a716-446655440333",
};

const adminDevice: AuthorizedDevice = {
  id: adminActor.deviceId,
  role: "ADMIN",
  accountId: adminActor.accountId,
  loginCode: adminActor.loginCode,
};

const archive: AnalysisArchive = {
  id: ARCHIVE_ID,
  eventId: EVENT_ID,
  eventVersion: 7,
  privacyProfile: "SUPPORT_SAFE",
  formatVersion: 1,
  status: "READY",
  requestedAt: "2026-08-09T10:00:00.000Z",
  startedAt: "2026-08-09T10:00:01.000Z",
  completedAt: "2026-08-09T10:00:02.000Z",
  expiresAt: "2026-09-08T10:00:00.000Z",
  sizeBytes: 3,
  failureCode: null,
};

const snapshot = {
  manifest: {
    capturedAt: "2026-08-09T10:11:12.000Z",
    eventDate: "2026-08-09",
  },
  supportSafe: true,
} as unknown as AnalysisSnapshot;

function createRouteApp(input?: {
  actor?: SessionActor | null;
  device?: AuthorizedDevice | null;
  versions?: Array<number | null>;
  capture?: Record<string, unknown>;
  operationVersion?: number;
  operationStatus?: number;
}) {
  const versions = [...(input?.versions ?? [7, 7, 7])];
  const first = vi.fn(async () => {
    const version = versions.shift();
    return version === null || version === undefined ? null : { version };
  });
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: { prepare } as unknown as D1Database,
  }) as Env;
  const actor = input && "actor" in input ? (input.actor ?? null) : adminActor;
  const device = input && "device" in input ? (input.device ?? null) : adminDevice;
  const authorizeDevice = vi.fn(async () => device);
  const captureAnalysisSnapshot = vi.fn(async () =>
    input?.capture
      ? input.capture
      : {
          ok: true,
          planningRunId: "550e8400-e29b-41d4-a716-446655440334",
        },
  );
  const namespace = {
    getByName: vi.fn(() => ({ captureAnalysisSnapshot })),
  };
  const buildAnalysisSnapshot = vi.fn(async () => snapshot);
  const analysisSnapshotSchema = { parse: vi.fn((value: AnalysisSnapshot) => value) };
  const operationBoardSchema = {
    safeParse: vi.fn(() => ({
      success: true,
      data: { event: { version: input?.operationVersion ?? 7 } },
    })),
  };
  const analysisActorAlias = vi.fn(async () => "analysis-actor-synthetic");
  const listAnalysisArchives = vi.fn(async () => [archive]);
  const requestAnalysisArchive = vi.fn(async () => ({ archive, created: true }));
  const buildAnalysisArchive = vi.fn(async () => true);
  const analysisArchiveDownload = vi.fn(async () => null);
  const deleteAnalysisArchive = vi.fn(async () => archive);
  const dependencies = {
    analysisActorAlias,
    analysisArchiveDownload,
    analysisSnapshotSchema,
    authorizeDevice,
    buildAnalysisArchive,
    buildAnalysisSnapshot,
    deleteAnalysisArchive,
    listAnalysisArchives,
    operationBoardSchema,
    requestAnalysisArchive,
  } as unknown as AnalysisControlRouteDependencies;
  const waitUntil = vi.fn();
  const executionContext = {
    waitUntil,
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
  const operationRequests: Request[] = [];
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  app.use("*", async (context, next) => {
    context.set("sessionActor", actor);
    await next();
  });
  app.get("/api/control/:eventId/operations", (context) => {
    operationRequests.push(context.req.raw);
    return context.json(
      { event: { version: input?.operationVersion ?? 7 } },
      (input?.operationStatus ?? 200) as 200,
    );
  });
  registerAnalysisControlRoutes(app, () => namespace as never, dependencies);

  return {
    app,
    env,
    executionContext,
    first,
    authorizeDevice,
    captureAnalysisSnapshot,
    namespace,
    buildAnalysisSnapshot,
    analysisSnapshotSchema,
    operationBoardSchema,
    analysisActorAlias,
    listAnalysisArchives,
    requestAnalysisArchive,
    buildAnalysisArchive,
    analysisArchiveDownload,
    deleteAnalysisArchive,
    waitUntil,
    operationRequests,
  };
}

function requestSnapshot(route: ReturnType<typeof createRouteApp>, body: unknown = {}) {
  return route.app.request(
    `https://worker.test/api/control/${EVENT_ID}/analysis/snapshot.json?ignored=true`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=synthetic" },
      body: JSON.stringify(body),
    },
    route.env,
    route.executionContext,
  );
}

function archiveRequest(
  route: ReturnType<typeof createRouteApp>,
  path: string,
  init?: RequestInit,
) {
  return route.app.request(
    `https://worker.test/api/control/${EVENT_ID}/analysis/day-archives${path}`,
    init,
    route.env,
    route.executionContext,
  );
}

describe("analysis control routes", () => {
  it.each([
    { actor: null, device: adminDevice },
    { actor: { ...adminActor, role: "FLIGHT_LINE" as const }, device: adminDevice },
    { actor: adminActor, device: { ...adminDevice, role: "FLIGHT_LINE" as const } },
  ])("rejects snapshot access without matching diagnostic roles", async ({ actor, device }) => {
    const route = createRouteApp({ actor, device });
    const response = await requestSnapshot(route, {
      requestId: REQUEST_ID,
      expectedEventVersion: 7,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SESSION_NOT_AUTHORIZED" },
    });
    expect(route.first).not.toHaveBeenCalled();
    expect(route.captureAnalysisSnapshot).not.toHaveBeenCalled();
  });

  it("validates the snapshot request before reading the event", async () => {
    const route = createRouteApp();
    const response = await requestSnapshot(route, { requestId: "not-a-uuid" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ANALYSIS_SNAPSHOT_INVALID_REQUEST" },
    });
    expect(route.first).not.toHaveBeenCalled();
  });

  it.each([
    { versions: [null], status: 404, code: "EVENT_NOT_FOUND" },
    { versions: [8], status: 412, code: "ANALYSIS_SNAPSHOT_STALE_VERSION" },
  ])("preserves the initial event version guard", async ({ versions, status, code }) => {
    const route = createRouteApp({ versions });
    const response = await requestSnapshot(route, {
      requestId: REQUEST_ID,
      expectedEventVersion: 7,
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(route.captureAnalysisSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["SESSION_NOT_AUTHORIZED", 403],
    ["ANALYSIS_SNAPSHOT_STALE_VERSION", 412],
    ["ANALYSIS_SNAPSHOT_CAPTURE_FAILED", 500],
    ["ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT", 409],
  ] as const)("maps coordinator capture error %s to %s", async (code, status) => {
    const route = createRouteApp({ capture: { ok: false, code, currentVersion: 8 } });
    const response = await requestSnapshot(route, {
      requestId: REQUEST_ID,
      expectedEventVersion: 7,
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code, currentVersion: 8 },
    });
  });

  it("exports the snapshot only against one stable version", async () => {
    const route = createRouteApp({
      actor: { ...adminActor, role: "FLIGHT_DIRECTOR" },
      device: { ...adminDevice, role: "FLIGHT_DIRECTOR" },
    });
    const response = await requestSnapshot(route, {
      requestId: REQUEST_ID,
      expectedEventVersion: 7,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="rundflug-analyse-momentaufnahme-2026-08-09-10-11-12.json"',
    );
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(route.captureAnalysisSnapshot).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      requestId: REQUEST_ID,
      expectedEventVersion: 7,
      deviceId: adminDevice.id,
      actorRole: "FLIGHT_DIRECTOR",
      deviceRole: "FLIGHT_DIRECTOR",
    });
    expect(route.operationRequests).toHaveLength(1);
    expect(route.operationRequests[0]?.url).toBe(
      `https://worker.test/api/control/${EVENT_ID}/operations`,
    );
    expect(route.operationRequests[0]?.headers.get("cookie")).toBe("session=synthetic");
    expect(route.buildAnalysisSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        env: route.env,
        eventId: EVENT_ID,
        expectedEventVersion: 7,
      }),
    );
    expect(route.first).toHaveBeenCalledTimes(3);
  });

  it("rejects a version change before or after snapshot construction", async () => {
    const before = createRouteApp({ versions: [7, 8] });
    const beforeResponse = await requestSnapshot(before, {
      requestId: REQUEST_ID,
      expectedEventVersion: 7,
    });
    expect(beforeResponse.status).toBe(409);
    await expect(beforeResponse.json()).resolves.toMatchObject({
      error: { code: "ANALYSIS_SNAPSHOT_CHANGED", currentVersion: 8 },
    });
    expect(before.buildAnalysisSnapshot).not.toHaveBeenCalled();

    const after = createRouteApp({ versions: [7, 7, 8] });
    const afterResponse = await requestSnapshot(after, {
      requestId: REQUEST_ID,
      expectedEventVersion: 7,
    });
    expect(afterResponse.status).toBe(409);
    expect(after.buildAnalysisSnapshot).toHaveBeenCalledOnce();
  });

  it.each([
    ["GET", ""],
    ["POST", ""],
    ["POST", `/${ARCHIVE_ID}/download`],
    ["DELETE", `/${ARCHIVE_ID}`],
  ])("requires matching admin access for %s %s", async (method, path) => {
    const route = createRouteApp({ actor: { ...adminActor, role: "FLIGHT_DIRECTOR" } });
    const requestInit: RequestInit = {
      method,
      headers: { "content-type": "application/json" },
    };
    if (method === "POST" && path === "") requestInit.body = "{}";
    const response = await archiveRequest(route, path, requestInit);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
  });

  it("lists archives and schedules only newly created archives", async () => {
    const listed = createRouteApp();
    const listResponse = await archiveRequest(listed, "");
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({ archives: [archive] });
    expect(listed.listAnalysisArchives).toHaveBeenCalledWith(listed.env, EVENT_ID);

    const created = createRouteApp();
    const createResponse = await archiveRequest(created, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: REQUEST_ID, expectedEventVersion: 7 }),
    });
    expect(createResponse.status).toBe(202);
    expect(created.waitUntil).toHaveBeenCalledOnce();
    expect(created.buildAnalysisArchive).toHaveBeenCalledWith(created.env, ARCHIVE_ID);

    const replay = createRouteApp();
    replay.requestAnalysisArchive.mockResolvedValueOnce({ archive, created: false });
    const replayResponse = await archiveRequest(replay, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: REQUEST_ID, expectedEventVersion: 7 }),
    });
    expect(replayResponse.status).toBe(200);
    expect(replay.waitUntil).not.toHaveBeenCalled();
  });

  it("validates archive creation before calling the archive service", async () => {
    const route = createRouteApp();
    const response = await archiveRequest(route, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "not-a-uuid", expectedEventVersion: 7 }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ANALYSIS_ARCHIVE_REQUEST_INVALID" },
    });
    expect(route.requestAnalysisArchive).not.toHaveBeenCalled();
  });

  it.each([
    ["EVENT_NOT_FOUND", 404],
    ["ANALYSIS_ARCHIVE_IDEMPOTENCY_CONFLICT", 409],
    ["ANALYSIS_ARCHIVE_STALE_VERSION", 409],
    ["ANALYSIS_ARCHIVE_EVENT_OPEN", 409],
  ] as const)("maps archive request error %s to %s", async (code, status) => {
    const route = createRouteApp();
    route.requestAnalysisArchive.mockRejectedValueOnce(new Error(code));
    const response = await archiveRequest(route, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: REQUEST_ID, expectedEventVersion: 7 }),
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("returns a support-safe archive download with fixed response headers", async () => {
    const route = createRouteApp();
    route.analysisArchiveDownload.mockResolvedValueOnce({
      archive,
      object: { body: new Response("zip").body, size: 3 },
    } as never);
    const response = await archiveRequest(route, `/${ARCHIVE_ID}/download`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="rundflug-tagesanalyse-${EVENT_ID}-v7.zip"`,
    );
    await expect(response.text()).resolves.toBe("zip");
    expect(route.analysisArchiveDownload).toHaveBeenCalledWith({
      env: route.env,
      eventId: EVENT_ID,
      archiveId: ARCHIVE_ID,
      actorAlias: "analysis-actor-synthetic",
    });
  });

  it("preserves not-ready, not-found and building archive responses", async () => {
    const notReady = createRouteApp();
    const notReadyResponse = await archiveRequest(notReady, `/${ARCHIVE_ID}/download`, {
      method: "POST",
    });
    expect(notReadyResponse.status).toBe(404);
    await expect(notReadyResponse.json()).resolves.toMatchObject({
      error: { code: "ANALYSIS_ARCHIVE_NOT_READY" },
    });

    const notFound = createRouteApp();
    notFound.deleteAnalysisArchive.mockResolvedValueOnce(null as never);
    const notFoundResponse = await archiveRequest(notFound, `/${ARCHIVE_ID}`, {
      method: "DELETE",
    });
    expect(notFoundResponse.status).toBe(404);

    const building = createRouteApp();
    building.deleteAnalysisArchive.mockRejectedValueOnce(new Error("ANALYSIS_ARCHIVE_BUILDING"));
    const buildingResponse = await archiveRequest(building, `/${ARCHIVE_ID}`, {
      method: "DELETE",
    });
    expect(buildingResponse.status).toBe(409);
    await expect(buildingResponse.json()).resolves.toMatchObject({
      error: { code: "ANALYSIS_ARCHIVE_BUILDING" },
    });
  });
});
