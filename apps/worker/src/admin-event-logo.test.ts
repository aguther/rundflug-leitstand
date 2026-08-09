import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerAdminEventLogoRoutes } from "./admin-event-logo-routes";
import {
  type EventLogoMutationResult,
  type EventLogoRemoveResponse,
  type EventLogoSetResponse,
  removeAdminEventLogo,
  type SetAdminEventLogoInput,
  setAdminEventLogo,
} from "./admin-event-logo-service";
import type { SessionActor } from "./auth";
import type { AuthorizedDevice } from "./device-authorization";
import { parseEventLogoTheme, readEventLogoBytes, validateEventLogo } from "./event-logo";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440210";
const COMMAND_ID = "550e8400-e29b-41d4-a716-446655440211";
const NOW = new Date("2026-08-09T22:30:00.000Z");
const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');

interface MockStatement {
  sql: string;
  bindings: unknown[];
  bind: (...values: unknown[]) => MockStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<D1Result>;
}

interface EventLogoReceiptFixture {
  operation_day_id: string;
  device_id: string;
  command_type: string;
  response_json: string;
}

interface EventLogoRowFixture {
  version: number;
  logo_object_key: string | null;
  logo_media_type: string | null;
  logo_dark_object_key: string | null;
  logo_dark_media_type: string | null;
}

function resultWithChanges(changes: number): D1Result {
  return { meta: { changes } } as D1Result;
}

function createServiceEnvironment(input?: {
  receipts?: Array<EventLogoReceiptFixture | null>;
  event?: EventLogoRowFixture | null;
  batchChanges?: number;
  batchError?: Error;
  runChanges?: number;
  runError?: Error;
}) {
  const receipts = [...(input?.receipts ?? [null])];
  const event =
    input && "event" in input
      ? (input.event ?? null)
      : {
          version: 7,
          logo_object_key: "event-logos/synthetic-event/light-old.svg",
          logo_media_type: "image/svg+xml",
          logo_dark_object_key: "event-logos/synthetic-event/dark-old.png",
          logo_dark_media_type: "image/png",
        };
  const statements: MockStatement[] = [];
  const prepare = vi.fn((sql: string) => {
    const statement: MockStatement = {
      sql,
      bindings: [],
      bind(...values: unknown[]) {
        this.bindings = values;
        return this;
      },
      async first<T>() {
        if (sql.includes("FROM idempotency_receipts")) {
          return (receipts.shift() ?? null) as T | null;
        }
        if (sql.includes("FROM operation_days")) return event as T | null;
        return null;
      },
      async run() {
        if (input?.runError) throw input.runError;
        return resultWithChanges(input?.runChanges ?? 1);
      },
    };
    statements.push(statement);
    return statement as unknown as D1PreparedStatement;
  });
  const batchedStatements: MockStatement[][] = [];
  const batch = vi.fn(async (items: D1PreparedStatement[]) => {
    batchedStatements.push(items as unknown as MockStatement[]);
    if (input?.batchError) throw input.batchError;
    return [resultWithChanges(input?.batchChanges ?? 1)] as D1Result[];
  });
  const put = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: { prepare, batch },
    BACKUPS: { put, delete: remove },
  }) as Env;
  return { env, statements, batchedStatements, batch, put, remove };
}

function adminDevice(): AuthorizedDevice {
  return { id: DEVICE_ID, role: "ADMIN", accountId: null, loginCode: null };
}

function createRouteApp(input?: {
  device?: AuthorizedDevice | null;
  setResult?: EventLogoMutationResult<EventLogoSetResponse>;
  removeResult?: EventLogoMutationResult<EventLogoRemoveResponse>;
}) {
  const env = Object.assign(Object.create(null), {
    APP_ENV: "production",
    DATA_JURISDICTION: "eu",
    DB: Object.create(null),
    BACKUPS: Object.create(null),
  }) as Env;
  const authorizeDevice = vi.fn(async () =>
    input && "device" in input ? (input.device ?? null) : adminDevice(),
  );
  const setAdminLogo = vi.fn(
    async (
      _env: Env,
      logoInput: SetAdminEventLogoInput,
    ): Promise<EventLogoMutationResult<EventLogoSetResponse>> => {
      try {
        await logoInput.loadUpload();
      } catch {
        return {
          status: 400,
          body: {
            error: {
              code: "EVENT_LOGO_INVALID",
              message: "Logo muss ein sicheres PNG, JPEG, WebP oder SVG bis 1 MiB sein.",
            },
          },
        };
      }
      return (
        input?.setResult ?? {
          status: 200,
          body: {
            logoUrl: `/api/public/events/${EVENT_ID}/logo?theme=dark`,
            theme: "dark",
          },
        }
      );
    },
  );
  const removeAdminLogo = vi.fn(async () =>
    Promise.resolve(
      input?.removeResult ?? {
        status: 200 as const,
        body: { removed: true, theme: "light" as const },
      },
    ),
  );
  const readLogoBytes = vi.fn(readEventLogoBytes);
  const validateLogo = vi.fn(validateEventLogo);
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerAdminEventLogoRoutes(app, {
    authorizeDevice,
    parseEventLogoTheme,
    readEventLogoBytes: readLogoBytes,
    removeAdminEventLogo: removeAdminLogo,
    setAdminEventLogo: setAdminLogo,
    validateEventLogo: validateLogo,
  });
  return {
    app,
    env,
    authorizeDevice,
    readLogoBytes,
    validateLogo,
    setAdminLogo,
    removeAdminLogo,
  };
}

function commandHeaders(overrides?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "image/svg+xml",
    "x-command-id": COMMAND_ID,
    "x-expected-version": "7",
    ...overrides,
  };
}

async function loadSvgUpload() {
  return { bytes: SVG_BYTES, mediaType: "image/svg+xml" as const };
}

describe("admin event logo routes", () => {
  it("rejects unknown themes before authorization", async () => {
    const { app, env, authorizeDevice } = createRouteApp();
    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/logo?theme=contrast`,
      { method: "DELETE", headers: commandHeaders() },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EVENT_LOGO_THEME_INVALID" },
    });
    expect(authorizeDevice).not.toHaveBeenCalled();
  });

  it("requires an administrator and complete command headers", async () => {
    const unauthorized = createRouteApp({ device: null });
    const denied = await unauthorized.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/logo`,
      { method: "DELETE", headers: commandHeaders() },
      unauthorized.env,
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "ADMIN_REQUIRED" } });

    const invalid = createRouteApp();
    const rejected = await invalid.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/logo`,
      { method: "DELETE", headers: { "x-expected-version": "-1" } },
      invalid.env,
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: "INVALID_COMMAND" } });
    expect(invalid.removeAdminLogo).not.toHaveBeenCalled();
  });

  it("validates an upload and passes the selected theme to the service", async () => {
    const { app, env, readLogoBytes, validateLogo, setAdminLogo } = createRouteApp();
    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/logo?theme=dark`,
      { method: "PUT", headers: commandHeaders(), body: SVG_BYTES },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      logoUrl: `/api/public/events/${EVENT_ID}/logo?theme=dark`,
      theme: "dark",
    });
    expect(setAdminLogo).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        eventId: EVENT_ID,
        deviceId: DEVICE_ID,
        commandId: COMMAND_ID,
        expectedVersion: 7,
        theme: "dark",
        loadUpload: expect.any(Function),
      }),
    );
    expect(readLogoBytes).toHaveBeenCalledTimes(1);
    expect(validateLogo).toHaveBeenCalledWith(SVG_BYTES, "image/svg+xml");
  });

  it("maps unsafe uploads returned by the service", async () => {
    const { app, env, setAdminLogo } = createRouteApp();
    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/logo`,
      {
        method: "PUT",
        headers: commandHeaders(),
        body: new TextEncoder().encode("<svg onload='alert(1)'></svg>"),
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVENT_LOGO_INVALID" } });
    expect(setAdminLogo).toHaveBeenCalledTimes(1);
  });

  it("defaults deletion to the light theme and maps service conflicts", async () => {
    const conflict: EventLogoMutationResult<EventLogoRemoveResponse> = {
      status: 409,
      body: {
        error: {
          code: "STALE_VERSION",
          message: "Veranstaltung wurde zwischenzeitlich geändert.",
        },
      },
    };
    const { app, env, removeAdminLogo } = createRouteApp({ removeResult: conflict });
    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/logo`,
      { method: "DELETE", headers: commandHeaders() },
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(conflict.body);
    expect(removeAdminLogo).toHaveBeenCalledWith(env, {
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      commandId: COMMAND_ID,
      expectedVersion: 7,
      theme: "light",
    });
  });
});

describe("admin event logo service", () => {
  it("replays a matching legacy light receipt without another mutation", async () => {
    const stored: EventLogoSetResponse = {
      logoUrl: `/api/public/events/${EVENT_ID}/logo?theme=light`,
      theme: "light",
    };
    const { env, batch, put } = createServiceEnvironment({
      receipts: [
        {
          operation_day_id: EVENT_ID,
          device_id: DEVICE_ID,
          command_type: "SET_EVENT_LOGO",
          response_json: JSON.stringify(stored),
        },
      ],
    });
    const loadUpload = vi.fn(loadSvgUpload);

    const result = await setAdminEventLogo(env, {
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      commandId: COMMAND_ID,
      expectedVersion: 7,
      theme: "light",
      loadUpload,
    });

    expect(result).toEqual({ status: 200, body: stored });
    expect(batch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(loadUpload).not.toHaveBeenCalled();
  });

  it("rejects a receipt reused for another theme", async () => {
    const { env } = createServiceEnvironment({
      receipts: [
        {
          operation_day_id: EVENT_ID,
          device_id: DEVICE_ID,
          command_type: "SET_EVENT_LOGO",
          response_json: "{}",
        },
      ],
    });

    const result = await setAdminEventLogo(env, {
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      commandId: COMMAND_ID,
      expectedVersion: 7,
      theme: "dark",
      loadUpload: loadSvgUpload,
    });

    expect(result).toMatchObject({
      status: 409,
      body: { error: { code: "IDEMPOTENCY_CONFLICT" } },
    });
  });

  it("rejects an invalid upload before writing D1 or R2", async () => {
    const { env, batch, put } = createServiceEnvironment();
    const result = await setAdminEventLogo(env, {
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      commandId: COMMAND_ID,
      expectedVersion: 7,
      theme: "light",
      loadUpload: async () => {
        throw new Error("EVENT_LOGO_INVALID");
      },
    });

    expect(result).toMatchObject({
      status: 400,
      body: { error: { code: "EVENT_LOGO_INVALID" } },
    });
    expect(batch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects missing or stale events before reading the upload", async () => {
    const missingUpload = vi.fn(loadSvgUpload);
    const missing = createServiceEnvironment({ event: null });
    const missingResult = await setAdminEventLogo(missing.env, {
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      commandId: COMMAND_ID,
      expectedVersion: 7,
      theme: "light",
      loadUpload: missingUpload,
    });
    expect(missingResult).toMatchObject({
      status: 404,
      body: { error: { code: "EVENT_NOT_FOUND" } },
    });
    expect(missingUpload).not.toHaveBeenCalled();

    const staleUpload = vi.fn(loadSvgUpload);
    const stale = createServiceEnvironment({
      event: {
        version: 8,
        logo_object_key: null,
        logo_media_type: null,
        logo_dark_object_key: null,
        logo_dark_media_type: null,
      },
    });
    const staleResult = await setAdminEventLogo(stale.env, {
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      commandId: COMMAND_ID,
      expectedVersion: 7,
      theme: "light",
      loadUpload: staleUpload,
    });
    expect(staleResult).toMatchObject({
      status: 409,
      body: { error: { code: "STALE_VERSION" } },
    });
    expect(staleUpload).not.toHaveBeenCalled();
  });

  it("stores a dark logo with variant-aware audit, receipt and outbox", async () => {
    const { env, batchedStatements, put, remove } = createServiceEnvironment();
    const randomValues = ["new-object", "audit-event", "outbox-event"];
    const result = await setAdminEventLogo(
      env,
      {
        eventId: EVENT_ID,
        deviceId: DEVICE_ID,
        commandId: COMMAND_ID,
        expectedVersion: 7,
        theme: "dark",
        loadUpload: loadSvgUpload,
      },
      { now: () => NOW, randomUuid: () => randomValues.shift() ?? "unexpected" },
    );

    const objectKey = `event-logos/${EVENT_ID}/new-object.svg`;
    expect(result).toEqual({
      status: 200,
      body: {
        logoUrl: `/api/public/events/${EVENT_ID}/logo?theme=dark`,
        theme: "dark",
      },
    });
    expect(put).toHaveBeenCalledWith(objectKey, SVG_BYTES, {
      httpMetadata: { contentType: "image/svg+xml" },
      customMetadata: { eventId: EVENT_ID, theme: "dark" },
    });
    expect(batchedStatements).toHaveLength(1);
    const [update, audit, receipt, outbox] = batchedStatements[0] ?? [];
    expect(update?.sql).toContain("logo_dark_object_key");
    expect(update?.sql).toContain("logo_dark_media_type");
    expect(audit?.bindings).toContain(
      JSON.stringify({ theme: "dark", mediaType: "image/svg+xml" }),
    );
    expect(receipt?.bindings).toContain("SET_EVENT_LOGO_DARK");
    expect(outbox?.sql).toContain("EVENT_STATE_CHANGED");
    expect(remove).toHaveBeenCalledWith("event-logos/synthetic-event/dark-old.png");
  });

  it("deletes the uploaded object when the guarded update becomes stale", async () => {
    const { env, remove } = createServiceEnvironment({ batchChanges: 0 });
    const result = await setAdminEventLogo(
      env,
      {
        eventId: EVENT_ID,
        deviceId: DEVICE_ID,
        commandId: COMMAND_ID,
        expectedVersion: 7,
        theme: "light",
        loadUpload: loadSvgUpload,
      },
      { now: () => NOW, randomUuid: () => "new-object" },
    );

    expect(result).toMatchObject({ status: 409, body: { error: { code: "STALE_VERSION" } } });
    expect(remove).toHaveBeenCalledWith(`event-logos/${EVENT_ID}/new-object.svg`);
    expect(remove).not.toHaveBeenCalledWith("event-logos/synthetic-event/light-old.svg");
  });

  it("cleans a concurrent upload and replays the winning receipt", async () => {
    const stored: EventLogoSetResponse = {
      logoUrl: `/api/public/events/${EVENT_ID}/logo?theme=light`,
      theme: "light",
    };
    const { env, remove } = createServiceEnvironment({
      receipts: [
        null,
        {
          operation_day_id: EVENT_ID,
          device_id: DEVICE_ID,
          command_type: "SET_EVENT_LOGO_LIGHT",
          response_json: JSON.stringify(stored),
        },
      ],
      batchError: new Error("UNIQUE constraint failed"),
    });
    const result = await setAdminEventLogo(
      env,
      {
        eventId: EVENT_ID,
        deviceId: DEVICE_ID,
        commandId: COMMAND_ID,
        expectedVersion: 7,
        theme: "light",
        loadUpload: loadSvgUpload,
      },
      { now: () => NOW, randomUuid: () => "concurrent-object" },
    );

    expect(result).toEqual({ status: 200, body: stored });
    expect(remove).toHaveBeenCalledWith(`event-logos/${EVENT_ID}/concurrent-object.svg`);
    expect(remove).not.toHaveBeenCalledWith("event-logos/synthetic-event/light-old.svg");
  });

  it("records an idempotent no-op when the selected logo is already absent", async () => {
    const { env, statements, batch, remove } = createServiceEnvironment({
      event: {
        version: 7,
        logo_object_key: null,
        logo_media_type: null,
        logo_dark_object_key: "event-logos/synthetic-event/dark-old.png",
        logo_dark_media_type: "image/png",
      },
    });
    const result = await removeAdminEventLogo(
      env,
      {
        eventId: EVENT_ID,
        deviceId: DEVICE_ID,
        commandId: COMMAND_ID,
        expectedVersion: 7,
        theme: "light",
      },
      { now: () => NOW, randomUuid: () => "unused" },
    );

    expect(result).toEqual({ status: 200, body: { removed: false, theme: "light" } });
    const receipt = statements.find((statement) =>
      statement.sql.includes("INSERT INTO idempotency_receipts"),
    );
    expect(receipt?.sql).toContain("logo_object_key IS NULL");
    expect(receipt?.bindings).toContain("REMOVE_EVENT_LOGO_LIGHT");
    expect(batch).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes a dark logo atomically and deletes its object afterward", async () => {
    const { env, batchedStatements, remove } = createServiceEnvironment();
    const randomValues = ["audit-event", "outbox-event"];
    const result = await removeAdminEventLogo(
      env,
      {
        eventId: EVENT_ID,
        deviceId: DEVICE_ID,
        commandId: COMMAND_ID,
        expectedVersion: 7,
        theme: "dark",
      },
      { now: () => NOW, randomUuid: () => randomValues.shift() ?? "unexpected" },
    );

    expect(result).toEqual({ status: 200, body: { removed: true, theme: "dark" } });
    const [update, audit, receipt, outbox] = batchedStatements[0] ?? [];
    expect(update?.sql).toContain("logo_dark_object_key = NULL");
    expect(update?.sql).toContain("logo_dark_media_type = NULL");
    expect(audit?.bindings).toContain(JSON.stringify({ theme: "dark" }));
    expect(receipt?.bindings).toContain("REMOVE_EVENT_LOGO_DARK");
    expect(outbox?.sql).toContain("EVENT_STATE_CHANGED");
    expect(remove).toHaveBeenCalledWith("event-logos/synthetic-event/dark-old.png");
  });
});
