/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import type { UpdateFidsPreferences } from "@rundflug/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { FidsPreferencesCommandService } from "../src/fids-preferences-command-service";

const eventId = "fids-runtime-event";
const accountId = "550e8400-e29b-41d4-a716-446655440001";
const deviceId = "550e8400-e29b-41d4-a716-446655440002";
const commandId = "550e8400-e29b-41d4-a716-446655440003";
const productIds = ["550e8400-e29b-41d4-a716-446655440011", "550e8400-e29b-41d4-a716-446655440010"];
const gateIds = ["550e8400-e29b-41d4-a716-446655440021", "550e8400-e29b-41d4-a716-446655440020"];

const input: UpdateFidsPreferences = {
  commandId,
  expectedVersion: 0,
  visibleRows: 12,
  layout: "DOUBLE",
  theme: "DARK",
  viewMode: "FIXED_PAGE",
  priorityGroupCount: 4,
  rotationIntervalSeconds: 15,
  groupSharedFlights: true,
  contentFilter: { productIds, gateIds },
};

function updateRequest(
  body: unknown = input,
  headers: Record<string, string> = {},
): { request: Request; url: URL } {
  const url = new URL(`https://coordinator.test/internal/events/${eventId}/fids/preferences`);
  const request = new Request(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-operator-account-id": accountId,
      "x-operator-login-code": "DISPLAY-01",
      "x-operator-session-id": "synthetic-session",
      "x-operator-device-id": deviceId,
      "x-operator-role": "DISPLAY",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { request, url };
}

async function handleUpdate(
  body: unknown = input,
  headers: Record<string, string> = {},
): Promise<Response> {
  const service = new FidsPreferencesCommandService(env);
  const { request, url } = updateRequest(body, headers);
  return service.handleUpdate(request, url);
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

beforeEach(async () => {
  const setupSql = `
    DROP TABLE IF EXISTS outbox;
    DROP TABLE IF EXISTS operational_events;
    DROP TABLE IF EXISTS idempotency_receipts;
    DROP TABLE IF EXISTS fids_preferences;
    DROP TABLE IF EXISTS gates;
    DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS operation_days;

    CREATE TABLE operation_days (id TEXT PRIMARY KEY);
    CREATE TABLE products (id TEXT PRIMARY KEY, operation_day_id TEXT NOT NULL);
    CREATE TABLE gates (id TEXT PRIMARY KEY, operation_day_id TEXT NOT NULL);
    CREATE TABLE fids_preferences (
      operator_account_id TEXT NOT NULL,
      operation_day_id TEXT NOT NULL,
      visible_rows INTEGER NOT NULL,
      layout TEXT NOT NULL,
      theme TEXT NOT NULL,
      view_mode TEXT NOT NULL,
      priority_group_count INTEGER NOT NULL,
      rotation_interval_seconds INTEGER NOT NULL,
      group_shared_flights INTEGER NOT NULL,
      content_filter_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (operator_account_id, operation_day_id)
    );
    CREATE TABLE idempotency_receipts (
      command_id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      received_at TEXT NOT NULL,
      response_json TEXT NOT NULL
    );
    CREATE TABLE operational_events (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE outbox (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    INSERT INTO operation_days (id) VALUES ('fids-runtime-event');
    INSERT INTO products (id, operation_day_id) VALUES
      ('550e8400-e29b-41d4-a716-446655440010', 'fids-runtime-event'),
      ('550e8400-e29b-41d4-a716-446655440011', 'fids-runtime-event');
    INSERT INTO gates (id, operation_day_id) VALUES
      ('550e8400-e29b-41d4-a716-446655440020', 'fids-runtime-event'),
      ('550e8400-e29b-41d4-a716-446655440021', 'fids-runtime-event');
  `;
  for (const statement of setupSql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await env.DB.prepare(statement).run();
  }
});

describe("FIDS preference command behavior", () => {
  it("rejects unauthorized and malformed requests without persistence", async () => {
    const unauthorized = await handleUpdate(input, { "x-operator-role": "CASHIER" });
    expect(unauthorized.status).toBe(403);
    expect(await unauthorized.json()).toEqual({
      error: {
        code: "SESSION_NOT_AUTHORIZED",
        message: "Sitzung für diese Ansicht nicht berechtigt.",
      },
    });

    const malformed = await handleUpdate({ ...input, visibleRows: 3 });
    expect(malformed.status).toBe(400);
    expect(await count("fids_preferences")).toBe(0);
    expect(await count("operational_events")).toBe(0);
    expect(await count("idempotency_receipts")).toBe(0);
    expect(await count("outbox")).toBe(0);
  });

  it("persists normalized preferences, audit, receipt, and a minimal outbox message atomically", async () => {
    const response = await handleUpdate();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      visibleRows: 12,
      layout: "DOUBLE",
      theme: "DARK",
      viewMode: "FIXED_PAGE",
      priorityGroupCount: 4,
      rotationIntervalSeconds: 15,
      groupSharedFlights: true,
      contentFilter: {
        productIds: [...productIds].sort(),
        gateIds: [...gateIds].sort(),
      },
      version: 1,
    });

    const audit = await env.DB.prepare(
      "SELECT event_type, device_id, aggregate_id, aggregate_version, payload_json FROM operational_events",
    ).first<{
      event_type: string;
      device_id: string;
      aggregate_id: string;
      aggregate_version: number;
      payload_json: string;
    }>();
    expect(audit).not.toBeNull();
    expect(audit?.event_type).toBe("FIDS_PREFERENCES_CHANGED");
    expect(audit?.device_id).toBe(deviceId);
    expect(audit?.aggregate_id).toBe(accountId);
    expect(audit?.aggregate_version).toBe(1);
    const auditPayload = JSON.parse(audit?.payload_json ?? "{}") as Record<string, unknown>;
    expect(auditPayload).toMatchObject({
      operatorAccountId: accountId,
      productIds: [...productIds].sort(),
      gateIds: [...gateIds].sort(),
      groupSharedFlights: true,
    });
    expect(JSON.stringify(auditPayload)).not.toMatch(/login|session|pin|token/i);

    const outbox = await env.DB.prepare("SELECT topic, payload_json FROM outbox").first<{
      topic: string;
      payload_json: string;
    }>();
    expect(outbox).toEqual({
      topic: "FIDS_PREFERENCES_CHANGED",
      payload_json: '{"version":1}',
    });
    expect(await count("idempotency_receipts")).toBe(1);
  });

  it("replays identical commands and rejects reuse, stale writes, and foreign filters", async () => {
    expect((await handleUpdate()).status).toBe(200);

    const replay = await handleUpdate();
    expect(replay.status).toBe(200);
    expect((await replay.json()) as { version: number }).toMatchObject({ version: 1 });
    expect(await count("operational_events")).toBe(1);
    expect(await count("idempotency_receipts")).toBe(1);
    expect(await count("outbox")).toBe(1);

    const conflict = await handleUpdate(input, {
      "x-operator-device-id": "550e8400-e29b-41d4-a716-446655440099",
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });

    const stale = await handleUpdate({
      ...input,
      commandId: "550e8400-e29b-41d4-a716-446655440004",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: { code: "STALE_VERSION", currentVersion: 1 },
    });

    const foreignFilter = await handleUpdate({
      ...input,
      commandId: "550e8400-e29b-41d4-a716-446655440005",
      expectedVersion: 1,
      contentFilter: {
        productIds: ["550e8400-e29b-41d4-a716-446655440098"],
        gateIds: [],
      },
    });
    expect(foreignFilter.status).toBe(400);
    expect(await foreignFilter.json()).toMatchObject({
      error: { code: "FIDS_FILTER_OPTION_NOT_FOUND" },
    });
    expect(await count("operational_events")).toBe(1);
  });
});
