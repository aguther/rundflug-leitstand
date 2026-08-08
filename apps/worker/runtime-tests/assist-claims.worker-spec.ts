/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AssistClaimService } from "../src/assist-claim-service";

const eventId = "assist-runtime-event";
const aircraftId = "assist-runtime-aircraft";
const accountId = "assist-runtime-account";
const otherAccountId = "assist-runtime-other-account";

async function executeStatements(sql: string): Promise<void> {
  for (const statement of sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await env.DB.prepare(statement).run();
  }
}

function claimRequest(
  input: {
    accountId?: string;
    loginCode?: string;
    deviceId?: string;
    role?: string;
    method?: "PUT" | "DELETE";
    body?: unknown;
  } = {},
): { request: Request; url: URL } {
  const url = new URL(
    `https://coordinator.test/internal/events/${eventId}/assist-claims/${aircraftId}`,
  );
  const method = input.method ?? "PUT";
  return {
    url,
    request: new Request(url, {
      method,
      headers: {
        "content-type": "application/json",
        "x-operator-account-id": input.accountId ?? accountId,
        "x-operator-login-code": input.loginCode ?? "FLIGHT-LINE-01",
        "x-operator-device-id": input.deviceId ?? "assist-runtime-device",
        "x-operator-role": input.role ?? "FLIGHT_LINE",
      },
      ...(method === "PUT"
        ? { body: JSON.stringify(input.body ?? { action: "ACQUIRE_OR_RENEW" }) }
        : {}),
    }),
  };
}

async function handleClaim(
  input: Parameters<typeof claimRequest>[0] = {},
  broadcasts: Array<{ eventVersion: number; eventType: string }> = [],
): Promise<Response> {
  const service = new AssistClaimService(
    env,
    (pathname) => pathname.split("/").at(-3) ?? null,
    (eventVersion, eventType) => broadcasts.push({ eventVersion, eventType }),
  );
  const { request, url } = claimRequest(input);
  return service.handleRequest(request, url);
}

beforeEach(async () => {
  await executeStatements(`
    DROP TABLE IF EXISTS outbox;
    DROP TABLE IF EXISTS operational_events;
    DROP TABLE IF EXISTS flight_line_assist_claims;
    DROP TABLE IF EXISTS operator_accounts;
    DROP TABLE IF EXISTS resource_group_memberships;
    DROP TABLE IF EXISTS aircraft;
    DROP TABLE IF EXISTS operation_days;

    CREATE TABLE operation_days (id TEXT PRIMARY KEY, version INTEGER NOT NULL);
    CREATE TABLE aircraft (id TEXT PRIMARY KEY);
    CREATE TABLE resource_group_memberships (
      operation_day_id TEXT NOT NULL,
      aircraft_id TEXT NOT NULL,
      active_until TEXT
    );
    CREATE TABLE operator_accounts (id TEXT PRIMARY KEY, login_code TEXT NOT NULL);
    CREATE TABLE flight_line_assist_claims (
      operation_day_id TEXT NOT NULL,
      aircraft_id TEXT NOT NULL,
      operator_account_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revision INTEGER NOT NULL,
      PRIMARY KEY (operation_day_id, aircraft_id),
      UNIQUE (operation_day_id, operator_account_id)
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

    INSERT INTO operation_days (id, version) VALUES ('${eventId}', 12);
    INSERT INTO aircraft (id) VALUES ('${aircraftId}');
    INSERT INTO resource_group_memberships (operation_day_id, aircraft_id, active_until)
      VALUES ('${eventId}', '${aircraftId}', NULL);
    INSERT INTO operator_accounts (id, login_code) VALUES
      ('${accountId}', 'FLIGHT-LINE-01'),
      ('${otherAccountId}', 'FLIGHT-LINE-02');
  `);
});

describe("operator-owned flight-line assist claims", () => {
  it("preserves authorization and rejects invalid claim mutations", async () => {
    const forbidden = await handleClaim({ role: "CASHIER" });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: { code: "ROLE_NOT_AUTHORIZED" } });

    const invalid = await handleClaim({ body: { action: "TAKEOVER", expectedRevision: 0 } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_ASSIST_CLAIM" } });
  });

  it("acquires, renews, takes over, and releases with audit and outbox persistence", async () => {
    const broadcasts: Array<{ eventVersion: number; eventType: string }> = [];
    const acquired = await handleClaim({}, broadcasts);
    const acquiredBody = (await acquired.json()) as Record<string, unknown>;
    expect(acquired.status, JSON.stringify(acquiredBody)).toBe(200);
    expect(acquiredBody).toMatchObject({
      aircraftId,
      claimedByCurrentOperator: true,
      ownerLoginCode: "FLIGHT-LINE-01",
      revision: 1,
    });
    expect(acquiredBody).not.toHaveProperty("operatorAccountId");

    const renewed = await handleClaim({}, broadcasts);
    expect(renewed.status).toBe(200);
    expect(await renewed.json()).toMatchObject({ revision: 2 });

    const conflict = await handleClaim({
      accountId: otherAccountId,
      loginCode: "FLIGHT-LINE-02",
      deviceId: "assist-runtime-other-device",
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      claim: { claimedByCurrentOperator: false, ownerLoginCode: "FLIGHT-LINE-01", revision: 2 },
      error: { code: "AIRCRAFT_ASSIST_CLAIMED" },
    });

    const takenOver = await handleClaim(
      {
        accountId: otherAccountId,
        loginCode: "FLIGHT-LINE-02",
        deviceId: "assist-runtime-other-device",
        body: { action: "TAKEOVER", expectedRevision: 2 },
      },
      broadcasts,
    );
    expect(takenOver.status).toBe(200);
    expect(await takenOver.json()).toMatchObject({ ownerLoginCode: "FLIGHT-LINE-02", revision: 3 });

    const foreignRelease = await handleClaim({ method: "DELETE" });
    expect(foreignRelease.status).toBe(204);
    expect(
      await env.DB.prepare(
        "SELECT operator_account_id, revision FROM flight_line_assist_claims WHERE operation_day_id = ?1 AND aircraft_id = ?2",
      )
        .bind(eventId, aircraftId)
        .first(),
    ).toEqual({ operator_account_id: otherAccountId, revision: 3 });

    const released = await handleClaim(
      {
        accountId: otherAccountId,
        loginCode: "FLIGHT-LINE-02",
        deviceId: "assist-runtime-other-device",
        method: "DELETE",
      },
      broadcasts,
    );
    expect(released.status).toBe(204);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM flight_line_assist_claims").first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT event_type FROM operational_events ORDER BY occurred_at, event_type",
      ).all(),
    ).toMatchObject({
      results: [
        { event_type: "AIRCRAFT_ASSIST_CLAIM_ACQUIRED" },
        { event_type: "AIRCRAFT_ASSIST_CLAIM_TAKEN_OVER" },
        { event_type: "AIRCRAFT_ASSIST_CLAIM_RELEASED" },
      ],
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox").first()).toEqual({
      count: 3,
    });
    expect(broadcasts).toEqual([
      { eventVersion: 12, eventType: "AIRCRAFT_ASSIST_CLAIM_ACQUIRED" },
      { eventVersion: 12, eventType: "AIRCRAFT_ASSIST_CLAIM_TAKEN_OVER" },
      { eventVersion: 12, eventType: "AIRCRAFT_ASSIST_CLAIM_RELEASED" },
    ]);
  });
});
