import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { buildAdminEventFlow } from "./admin-event-flow";
import { registerAdminEventRoutes } from "./admin-event-routes";
import type { SessionActor } from "./auth";
import type { AuthorizedDevice } from "./device-authorization";
import type { Env } from "./types";

const EVENT_ID = "550e8400-e29b-41d4-a716-446655440040";
const NOW = new Date("2026-08-09T16:00:00.000Z");

function adminDevice(role: AuthorizedDevice["role"] = "ADMIN"): AuthorizedDevice {
  return {
    id: "550e8400-e29b-41d4-a716-446655440041",
    role,
    accountId: "550e8400-e29b-41d4-a716-446655440042",
    loginCode: "ADMIN-01",
  };
}

function createApp(input?: {
  device?: AuthorizedDevice | null;
  events?: Array<Record<string, string | number | null>>;
  event?: Record<string, string | null> | null;
  tickets?: Array<{ sold_at: string; completed_at: string | null }>;
}) {
  const statements: Array<{ sql: string; bindings: unknown[]; operation: string }> = [];
  const prepare = vi.fn((sql: string) => ({
    all: async () => {
      statements.push({ sql, bindings: [], operation: "all" });
      return { results: input?.events ?? [] };
    },
    bind: (...bindings: unknown[]) => ({
      first: async () => {
        statements.push({ sql, bindings, operation: "first" });
        return input && "event" in input ? (input.event ?? null) : null;
      },
      all: async () => {
        statements.push({ sql, bindings, operation: "all" });
        return { results: input?.tickets ?? [] };
      },
    }),
  }));
  const device = input && "device" in input ? (input.device ?? null) : adminDevice();
  const authorizeDevice = vi.fn(async () => device);
  const env = { DB: { prepare } } as unknown as Env;
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerAdminEventRoutes(app, {
    authorizeDevice,
    buildAdminEventFlow,
    now: () => NOW,
  });
  return { app, env, prepare, statements, authorizeDevice };
}

describe("admin event routes", () => {
  it("requires an ADMIN device before reading event data", async () => {
    const { app, env, prepare } = createApp({ device: adminDevice("CASHIER") });

    const responses = await Promise.all([
      app.request("https://worker.test/api/admin/events", {}, env),
      app.request(`https://worker.test/api/admin/events/${EVENT_ID}/flow`, {}, env),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("lists events in the public response shape", async () => {
    const { app, env, authorizeDevice, statements } = createApp({
      events: [
        {
          id: EVENT_ID,
          name: "Synthetic event",
          event_date: "2026-08-09",
          aerodrome: "EDXX",
          time_zone: "Europe/Berlin",
          status: "PREPARATION",
          archived_at: null,
          template_source_id: "synthetic-template",
          version: 3,
        },
      ],
    });

    const response = await app.request(
      "https://worker.test/api/admin/events",
      { headers: { "x-event-id": EVENT_ID } },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      events: [
        {
          eventId: EVENT_ID,
          name: "Synthetic event",
          eventDate: "2026-08-09",
          aerodrome: "EDXX",
          timeZone: "Europe/Berlin",
          status: "PREPARATION",
          archivedAt: null,
          templateSourceId: "synthetic-template",
          version: 3,
        },
      ],
    });
    expect(authorizeDevice).toHaveBeenCalledWith(env, EVENT_ID, expect.any(Request));
    expect(statements[0]?.sql).toContain("ORDER BY event_date DESC, name");
  });

  it("returns EVENT_NOT_FOUND without reading tickets", async () => {
    const { app, env, statements } = createApp({ event: null });

    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/flow`,
      {},
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVENT_NOT_FOUND" } });
    expect(statements).toHaveLength(1);
  });

  it("reads only valid tickets and the current completed assignment", async () => {
    const { app, env, statements } = createApp({
      event: {
        id: EVENT_ID,
        event_date: "2026-08-09",
        time_zone: "Europe/Berlin",
        sale_opens_at: "2026-08-09T08:00:00.000Z",
        operations_start_at: "2026-08-09T09:00:00.000Z",
        operations_end_at: "2026-08-09T18:00:00.000Z",
      },
      tickets: [
        {
          sold_at: "2026-08-09T08:15:00.000Z",
          completed_at: "2026-08-09T09:30:00.000Z",
        },
      ],
    });

    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/flow?bucketMinutes=invalid`,
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ eventId: EVENT_ID, bucketMinutes: 15 });
    const ticketRead = statements.find((statement) => statement.sql.includes("FROM tickets t"));
    expect(ticketRead).toMatchObject({ bindings: [EVENT_ID], operation: "all" });
    expect(ticketRead?.sql).toContain("t.status <> 'CANCELED'");
    expect(ticketRead?.sql).toContain("rt.released_at IS NULL");
    expect(ticketRead?.sql).toContain("r.status = 'COMPLETED'");
    expect(ticketRead?.sql).not.toContain("operational_events");
  });
});
