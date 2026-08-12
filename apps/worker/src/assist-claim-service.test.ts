import { describe, expect, it, vi } from "vitest";
import { AssistClaimService } from "./assist-claim-service";
import type { Env } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

function createDatabase(firstResults: Array<Record<string, unknown> | null>) {
  const batches: PreparedQuery[][] = [];
  const runs: PreparedQuery[] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => ({
      sql,
      parameters,
      first: async () => firstResults.shift() ?? null,
      run: async () => {
        runs.push({ sql, parameters });
        return { success: true, results: [], meta: {} };
      },
    }),
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) => {
    batches.push(statements);
    return statements.map(() => ({ success: true, results: [], meta: {} }));
  });
  return { db: { prepare, batch } as unknown as D1Database, batches, runs };
}

function request(
  input: { method?: string; role?: string; body?: unknown; omitHeader?: string } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-operator-account-id": "account-one",
    "x-operator-login-code": "FL-01",
    "x-operator-device-id": "device-one",
    "x-operator-role": input.role ?? "FLIGHT_LINE",
  });
  if (input.omitHeader) headers.delete(input.omitHeader);
  return new Request("https://example.test/api/events/event-one/assist-claims/aircraft-one", {
    method: input.method ?? "POST",
    headers,
    ...(input.method === "DELETE" ? {} : { body: JSON.stringify(input.body ?? {}) }),
  });
}

function createService(db: D1Database) {
  const broadcast = vi.fn();
  return {
    service: new AssistClaimService({ DB: db } as unknown as Env, () => "event-one", broadcast),
    broadcast,
  };
}

function activeClaim(overrides: Record<string, unknown> = {}) {
  return {
    operator_account_id: "account-one",
    claimed_at: "2026-08-08T08:00:00.000Z",
    expires_at: "2099-08-08T09:00:00.000Z",
    revision: 3,
    login_code: "FL-01",
    ...overrides,
  };
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

describe("assist claim service", () => {
  it("requires a complete authorized operator context", async () => {
    const { db } = createDatabase([]);
    const { service } = createService(db);

    await expectError(
      await service.handleRequest(
        request({ omitHeader: "x-operator-device-id" }),
        new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
      ),
      401,
      "SESSION_NOT_AUTHORIZED",
    );
    await expectError(
      await service.handleRequest(
        request({ role: "CASHIER" }),
        new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
      ),
      403,
      "ROLE_NOT_AUTHORIZED",
    );
  });

  it("rejects an unknown aircraft", async () => {
    const { db, batches } = createDatabase([null]);
    const { service } = createService(db);

    const response = await service.handleRequest(
      request({ body: { action: "ACQUIRE_OR_RENEW" } }),
      new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
    );

    await expectError(response, 404, "AIRCRAFT_NOT_FOUND");
    expect(batches).toHaveLength(0);
  });

  it("silently ignores release attempts by a different operator", async () => {
    const { db, batches } = createDatabase([
      { id: "aircraft-one", event_version: 7 },
      activeClaim({ operator_account_id: "account-two", login_code: "FL-02" }),
    ]);
    const { service, broadcast } = createService(db);

    const response = await service.handleRequest(
      request({ method: "DELETE" }),
      new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
    );

    expect(response.status).toBe(204);
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("releases its own active claim atomically", async () => {
    const { db, batches } = createDatabase([
      { id: "aircraft-one", event_version: 7 },
      activeClaim(),
    ]);
    const { service, broadcast } = createService(db);

    const response = await service.handleRequest(
      request({ method: "DELETE" }),
      new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
    );

    expect(response.status).toBe(204);
    expect(batches[0]).toHaveLength(3);
    expect(batches[0]?.[0]?.sql).toContain("DELETE FROM flight_line_assist_claims");
    expect(broadcast).toHaveBeenCalledWith(7, "AIRCRAFT_ASSIST_CLAIM_RELEASED");
  });

  it("rejects malformed acquisition data", async () => {
    const { db, batches } = createDatabase([{ id: "aircraft-one", event_version: 7 }, null]);
    const { service } = createService(db);

    const response = await service.handleRequest(
      request({ body: { action: "UNKNOWN" } }),
      new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
    );

    await expectError(response, 400, "INVALID_ASSIST_CLAIM");
    expect(batches).toHaveLength(0);
  });

  it("renews the current operator claim without creating another audit event", async () => {
    const { db, batches, runs } = createDatabase([
      { id: "aircraft-one", event_version: 7 },
      activeClaim(),
    ]);
    const { service, broadcast } = createService(db);

    const response = await service.handleRequest(
      request({ body: { action: "ACQUIRE_OR_RENEW" } }),
      new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
    );

    await expect(response.json()).resolves.toMatchObject({
      aircraftId: "aircraft-one",
      claimedByCurrentOperator: true,
      revision: 4,
    });
    expect(runs[0]?.sql).toContain("UPDATE flight_line_assist_claims");
    expect(batches).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: "ACQUIRE_OR_RENEW" }, "AIRCRAFT_ASSIST_CLAIMED"],
    [{ action: "TAKEOVER", expectedRevision: 2 }, "AIRCRAFT_ASSIST_CLAIM_CHANGED"],
  ] as const)("reports a deterministic conflict for an occupied aircraft", async (body, code) => {
    const { db, batches } = createDatabase([
      { id: "aircraft-one", event_version: 7 },
      activeClaim({ operator_account_id: "account-two", login_code: "FL-02" }),
    ]);
    const { service } = createService(db);

    const response = await service.handleRequest(
      request({ body }),
      new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
    );

    await expectError(response, 409, code);
    expect(batches).toHaveLength(0);
  });

  it("takes over an occupied claim only with its expected revision", async () => {
    const { db, batches } = createDatabase([
      { id: "aircraft-one", event_version: 7 },
      activeClaim({ operator_account_id: "account-two", login_code: "FL-02" }),
    ]);
    const { service, broadcast } = createService(db);

    const response = await service.handleRequest(
      request({ body: { action: "TAKEOVER", expectedRevision: 3 } }),
      new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
    );

    await expect(response.json()).resolves.toMatchObject({
      claimedByCurrentOperator: true,
      ownerLoginCode: "FL-01",
      revision: 4,
    });
    expect(batches[0]).toHaveLength(3);
    expect(broadcast).toHaveBeenCalledWith(7, "AIRCRAFT_ASSIST_CLAIM_TAKEN_OVER");
  });

  it("acquires an expired claim with an incremented revision", async () => {
    const { db, batches } = createDatabase([
      { id: "aircraft-one", event_version: 7 },
      activeClaim({
        operator_account_id: "account-two",
        login_code: "FL-02",
        expires_at: "2020-08-08T09:00:00.000Z",
      }),
    ]);
    const { service, broadcast } = createService(db);

    const response = await service.handleRequest(
      request({ body: { action: "ACQUIRE_OR_RENEW" } }),
      new URL("https://example.test/api/events/event-one/assist-claims/aircraft-one"),
    );

    await expect(response.json()).resolves.toMatchObject({
      claimedByCurrentOperator: true,
      ownerLoginCode: "FL-01",
      revision: 4,
    });
    expect(batches[0]).toHaveLength(4);
    expect(batches[0]?.[1]?.sql).toContain("INSERT INTO flight_line_assist_claims");
    expect(broadcast).toHaveBeenCalledWith(7, "AIRCRAFT_ASSIST_CLAIM_ACQUIRED");
  });
});
