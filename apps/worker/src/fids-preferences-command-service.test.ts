import { describe, expect, it, vi } from "vitest";
import { FidsPreferencesCommandService } from "./fids-preferences-command-service";
import type { Env } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
  first: () => Promise<unknown>;
  all: () => Promise<{ results: Array<Record<string, unknown>> }>;
}

function createDatabase(
  firstRows: unknown[] = [],
  allRows: Array<Array<Record<string, unknown>>> = [],
) {
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]): PreparedQuery => ({
      sql,
      parameters,
      first: async () => firstRows.shift() ?? null,
      all: async () => ({ results: allRows.shift() ?? [] }),
    }),
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) => statements);
  return { database: { prepare, batch } as unknown as D1Database, batch, prepare };
}

const updateUrl = new URL("https://worker.test/internal/events/event-a/fids/preferences");
const command = {
  commandId: "00e971df-23d5-4d28-9107-92b447416221",
  expectedVersion: 0,
  visibleRows: 8,
  layout: "SINGLE",
  theme: "DARK",
  viewMode: "FIXED_PAGE",
  priorityGroupCount: 3,
  rotationIntervalSeconds: 12,
  groupSharedFlights: false,
  contentFilter: { productIds: ["product-b", "product-a"], gateIds: ["gate-a"] },
} as const;

function updateRequest(
  body: unknown = command,
  overrides: Partial<Record<string, string | null>> = {},
): Request {
  const values: Record<string, string> = {
    "x-operator-account-id": "account-a",
    "x-operator-login-code": "FD-01",
    "x-operator-session-id": "session-a",
    "x-operator-device-id": "device-a",
    "x-operator-role": "ADMIN",
  };
  const headers = new Headers({ "content-type": "application/json" });
  for (const [name, defaultValue] of Object.entries(values)) {
    const value = overrides[name] === undefined ? defaultValue : overrides[name];
    if (value !== null) headers.set(name, value);
  }
  return new Request(updateUrl, { method: "PUT", headers, body: JSON.stringify(body) });
}

function service(database: D1Database): FidsPreferencesCommandService {
  return new FidsPreferencesCommandService({ DB: database } as unknown as Env);
}

describe("FIDS preferences command service", () => {
  it("rejects incomplete or unauthorized sessions before reading data", async () => {
    const missingSession = createDatabase();
    const missingResponse = await service(missingSession.database).handleUpdate(
      updateRequest(command, { "x-operator-session-id": null }),
      updateUrl,
    );
    expect(missingResponse.status).toBe(403);
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: { code: "SESSION_NOT_AUTHORIZED" },
    });
    expect(missingSession.prepare).not.toHaveBeenCalled();

    const cashier = createDatabase();
    const cashierResponse = await service(cashier.database).handleUpdate(
      updateRequest(command, { "x-operator-role": "CASHIER" }),
      updateUrl,
    );
    expect(cashierResponse.status).toBe(403);
    expect(cashier.prepare).not.toHaveBeenCalled();
  });

  it("rejects malformed preferences before idempotency or persistence", async () => {
    const input = createDatabase();

    const response = await service(input.database).handleUpdate(
      updateRequest({ ...command, visibleRows: 2 }),
      updateUrl,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_FIDS_PREFERENCES" },
    });
    expect(input.prepare).not.toHaveBeenCalled();
  });

  it("returns an idempotent replay and rejects a reused command for another device", async () => {
    const replayValue = { ...command, contentFilter: { productIds: [], gateIds: [] }, version: 1 };
    const replay = createDatabase([
      {
        operation_day_id: "event-a",
        device_id: "device-a",
        command_type: "UPDATE_FIDS_PREFERENCES",
        response_json: JSON.stringify(replayValue),
      },
    ]);
    const replayResponse = await service(replay.database).handleUpdate(updateRequest(), updateUrl);
    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toEqual(replayValue);
    expect(replay.batch).not.toHaveBeenCalled();

    const conflict = createDatabase([
      {
        operation_day_id: "event-a",
        device_id: "other-device",
        command_type: "UPDATE_FIDS_PREFERENCES",
        response_json: JSON.stringify(replayValue),
      },
    ]);
    const conflictResponse = await service(conflict.database).handleUpdate(
      updateRequest(),
      updateUrl,
    );
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("rejects missing events and unknown filter references", async () => {
    const missing = createDatabase([null, null]);
    const missingResponse = await service(missing.database).handleUpdate(
      updateRequest(),
      updateUrl,
    );
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: { code: "EVENT_NOT_FOUND" },
    });

    const unknownFilter = createDatabase(
      [null, { id: "event-a" }],
      [[{ id: "product-a" }], [{ id: "gate-a" }]],
    );
    const unknownResponse = await service(unknownFilter.database).handleUpdate(
      updateRequest(),
      updateUrl,
    );
    expect(unknownResponse.status).toBe(400);
    await expect(unknownResponse.json()).resolves.toMatchObject({
      error: { code: "FIDS_FILTER_OPTION_NOT_FOUND" },
    });
  });

  it("rejects stale updates after validating filter references", async () => {
    const input = createDatabase(
      [
        null,
        { id: "event-a" },
        {
          visible_rows: 8,
          layout: "SINGLE",
          theme: "SYSTEM",
          view_mode: "FIXED_PAGE",
          priority_group_count: 3,
          rotation_interval_seconds: 12,
          group_shared_flights: 0,
          content_filter_json: '{"productIds":[],"gateIds":[]}',
          version: 2,
        },
      ],
      [[{ id: "product-a" }, { id: "product-b" }], [{ id: "gate-a" }]],
    );

    const response = await service(input.database).handleUpdate(updateRequest(), updateUrl);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_VERSION", currentVersion: 2 },
    });
    expect(input.batch).not.toHaveBeenCalled();
  });

  it("persists normalized preferences, audit, receipt and outbox in one batch", async () => {
    const input = createDatabase(
      [null, { id: "event-a" }, null],
      [[{ id: "product-a" }, { id: "product-b" }], [{ id: "gate-a" }]],
    );

    const response = await service(input.database).handleUpdate(updateRequest(), updateUrl);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      contentFilter: { productIds: ["product-a", "product-b"], gateIds: ["gate-a"] },
      version: 1,
    });
    expect(input.batch).toHaveBeenCalledOnce();
    const statements = input.batch.mock.calls[0]?.[0] ?? [];
    const sql = statements.map(({ sql }) => sql).join("\n");
    expect(sql).toContain("INSERT INTO fids_preferences");
    expect(sql).toContain("INSERT INTO operational_events");
    expect(sql).toContain("INSERT INTO idempotency_receipts");
    expect(sql).toContain("INSERT INTO outbox");
  });
});
