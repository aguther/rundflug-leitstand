import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionActor } from "./auth";
import { registerPublicPushRoutes } from "./public-push-routes";
import type { Env } from "./types";

const NOW = "2026-08-09T08:00:00.000Z";
const VALID_CODE = "ABCD2345EFGH";
const OLD_ENDPOINT = "https://fcm.googleapis.com/fcm/send/old";
const NEW_ENDPOINT = "https://fcm.googleapis.com/fcm/send/new";
const SUBSCRIPTION_BODY = {
  consent: true,
  endpoint: NEW_ENDPOINT,
  keys: { p256dh: "synthetic-p256dh", auth: "synthetic-auth" },
};

function createApp(input?: {
  vapid?: boolean;
  renewalChanges?: number;
  ticket?: Record<string, unknown> | null;
  group?: Record<string, unknown> | null;
  rotations?: Array<{ rotation_id: string }>;
  queuedByRotation?: Record<string, number>;
}) {
  const statements: Array<{ sql: string; bindings: unknown[]; operation: string }> = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => ({
      first: async () => {
        statements.push({ sql, bindings, operation: "first" });
        if (sql.includes("FROM ticket_groups tg")) return input?.group ?? null;
        if (sql.includes("FROM tickets t")) return input?.ticket ?? null;
        return null;
      },
      all: async () => {
        statements.push({ sql, bindings, operation: "all" });
        return { results: input?.rotations ?? [] };
      },
      run: async () => {
        statements.push({ sql, bindings, operation: "run" });
        return { success: true, meta: { changes: 1 } };
      },
    }),
  }));
  const batch = vi.fn(async () => [
    { success: true, meta: { changes: 1 } },
    { success: true, meta: { changes: input?.renewalChanges ?? 1 } },
  ]);
  const unknownTicketResponse = vi.fn(async () =>
    Response.json({ error: { code: "TICKET_NOT_FOUND" } }, { status: 404 }),
  );
  const queuePreparationNotifications = vi.fn(
    async (_env: Env, _eventId: string, rotationId?: string) =>
      (rotationId ? input?.queuedByRotation?.[rotationId] : 0) ?? 0,
  );
  const env = {
    DB: { prepare, batch },
    PUSH_RETENTION_DAYS: "7",
    ...(input?.vapid
      ? {
          VAPID_PUBLIC_KEY: "synthetic-public",
          VAPID_PRIVATE_KEY: "synthetic-private",
          VAPID_SUBJECT: "mailto:operator@example.invalid",
        }
      : {}),
  } as unknown as Env;
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerPublicPushRoutes(app, unknownTicketResponse, queuePreparationNotifications);
  return {
    app,
    env,
    prepare,
    batch,
    statements,
    unknownTicketResponse,
    queuePreparationNotifications,
  };
}

function jsonRequest(method: string, body: unknown) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("public push routes", () => {
  it("reports unavailable and configured VAPID states without querying D1", async () => {
    const unavailable = createApp();
    const configured = createApp({ vapid: true });

    const [unavailableResponse, configuredResponse] = await Promise.all([
      unavailable.app.request("https://worker.test/api/public/push/config", {}, unavailable.env),
      configured.app.request("https://worker.test/api/public/push/config", {}, configured.env),
    ]);

    expect(unavailableResponse.status).toBe(503);
    await expect(unavailableResponse.json()).resolves.toMatchObject({
      error: { code: "PUSH_NOT_CONFIGURED" },
    });
    expect(configuredResponse.status).toBe(200);
    await expect(configuredResponse.json()).resolves.toEqual({
      publicKey: "synthetic-public",
      retentionDays: 7,
    });
    expect(unavailable.prepare).not.toHaveBeenCalled();
    expect(configured.prepare).not.toHaveBeenCalled();
  });

  it("rejects an invalid subscription refresh without writing to D1", async () => {
    const { app, env, batch } = createApp();

    const response = await app.request(
      "https://worker.test/api/public/push/subscriptions/refresh",
      jsonRequest("POST", {
        previousEndpoint: "https://example.invalid/old",
        endpoint: NEW_ENDPOINT,
        keys: SUBSCRIPTION_BODY.keys,
      }),
      env,
    );

    expect(response.status).toBe(400);
    expect(batch).not.toHaveBeenCalled();
  });

  it.each([
    [1, 200, null],
    [0, 404, "PUSH_SUBSCRIPTION_NOT_FOUND"],
  ] as const)(
    "refreshes a valid subscription when D1 reports %i updated rows",
    async (renewalChanges, expectedStatus, errorCode) => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const { app, env, batch } = createApp({ renewalChanges });

      const response = await app.request(
        "https://worker.test/api/public/push/subscriptions/refresh",
        jsonRequest("POST", {
          previousEndpoint: OLD_ENDPOINT,
          endpoint: NEW_ENDPOINT,
          keys: SUBSCRIPTION_BODY.keys,
        }),
        env,
      );

      expect(response.status).toBe(expectedStatus);
      const payload = (await response.json()) as Record<string, unknown>;
      if (errorCode) expect(payload).toMatchObject({ error: { code: errorCode } });
      else expect(payload).toEqual({ active: true, updatedAt: NOW });
      expect(batch).toHaveBeenCalledOnce();
    },
  );

  it("rejects invalid ticket codes and invalid consent before reading D1", async () => {
    const { app, env, prepare, unknownTicketResponse } = createApp();

    const [invalidCode, invalidConsent] = await Promise.all([
      app.request(
        "https://worker.test/api/public/tickets/invalid/push-subscriptions",
        jsonRequest("POST", SUBSCRIPTION_BODY),
        env,
      ),
      app.request(
        `https://worker.test/api/public/tickets/${VALID_CODE}/push-subscriptions`,
        jsonRequest("POST", { ...SUBSCRIPTION_BODY, consent: false }),
        env,
      ),
    ]);

    expect(invalidCode.status).toBe(404);
    expect(invalidConsent.status).toBe(400);
    expect(unknownTicketResponse).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("uses the protected unknown response when a valid ticket code has no active target", async () => {
    const { app, env, statements, unknownTicketResponse } = createApp({ ticket: null });

    const response = await app.request(
      `https://worker.test/api/public/tickets/${VALID_CODE}/push-subscriptions`,
      jsonRequest("POST", SUBSCRIPTION_BODY),
      env,
    );

    expect(response.status).toBe(404);
    expect(unknownTicketResponse).toHaveBeenCalledOnce();
    expect(statements).toHaveLength(1);
    expect(statements[0]?.bindings[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    [null, "PUSH_RETENTION_UNCONFIGURED"],
    ["2026-08-01T18:00:00.000Z", "PUSH_RETENTION_EXPIRED"],
  ] as const)("rejects ticket storage with retention state %s", async (operationsEndAt, code) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements } = createApp({
      ticket: {
        id: "ticket-1",
        ticket_group_id: "group-1",
        operation_day_id: "event-1",
        operations_end_at: operationsEndAt,
        rotation_id: "rotation-1",
      },
    });

    const response = await app.request(
      `https://worker.test/api/public/tickets/${VALID_CODE}/push-subscriptions`,
      jsonRequest("POST", SUBSCRIPTION_BODY),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(statements).toHaveLength(1);
  });

  it("stores a ticket subscription and immediately checks preparation eligibility", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements, queuePreparationNotifications } = createApp({
      ticket: {
        id: "ticket-1",
        ticket_group_id: "group-1",
        operation_day_id: "event-1",
        operations_end_at: "2026-08-09T18:00:00.000Z",
        rotation_id: "rotation-1",
      },
      queuedByRotation: { "rotation-1": 1 },
    });

    const response = await app.request(
      `https://worker.test/api/public/tickets/${VALID_CODE}/push-subscriptions`,
      jsonRequest("POST", SUBSCRIPTION_BODY),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      active: true,
      consentedAt: NOW,
      deleteAfter: "2026-08-16T18:00:00.000Z",
      preparationQueued: true,
    });
    expect(statements).toHaveLength(2);
    expect(statements[1]?.sql).toContain("'TICKET'");
    expect(statements[1]?.bindings.slice(1, 4)).toEqual(["event-1", "ticket-1", "group-1"]);
    expect(queuePreparationNotifications).toHaveBeenCalledWith(env, "event-1", "rotation-1");
  });

  it("stores one group target and checks every active rotation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { app, env, statements, queuePreparationNotifications } = createApp({
      group: {
        id: "group-1",
        operation_day_id: "event-1",
        operations_end_at: "2026-08-09T18:00:00.000Z",
        representative_ticket_id: "ticket-1",
      },
      rotations: [{ rotation_id: "rotation-1" }, { rotation_id: "rotation-2" }],
      queuedByRotation: { "rotation-2": 1 },
    });

    const response = await app.request(
      `https://worker.test/api/public/groups/${VALID_CODE}/push-subscriptions`,
      jsonRequest("POST", SUBSCRIPTION_BODY),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ preparationQueued: true });
    expect(statements).toHaveLength(3);
    expect(statements[1]?.sql).toContain("'GROUP'");
    expect(queuePreparationNotifications).toHaveBeenNthCalledWith(1, env, "event-1", "rotation-1");
    expect(queuePreparationNotifications).toHaveBeenNthCalledWith(2, env, "event-1", "rotation-2");
  });

  it.each(["tickets", "groups"] as const)("deletes a matching %s subscription", async (kind) => {
    const { app, env, statements } = createApp();

    const response = await app.request(
      `https://worker.test/api/public/${kind}/${VALID_CODE}/push-subscriptions`,
      jsonRequest("DELETE", { endpoint: NEW_ENDPOINT }),
      env,
    );

    expect(response.status).toBe(204);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toContain(
      kind === "tickets" ? "target_kind = 'TICKET'" : "target_kind = 'GROUP'",
    );
    expect(statements[0]?.bindings[0]).toBe(NEW_ENDPOINT);
    expect(statements[0]?.bindings[1]).toMatch(/^[a-f0-9]{64}$/);
  });
});
