import type { MasterDataTemplate } from "@rundflug/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { loadAdminMasterDataTemplate } from "./admin-master-data-template-export";
import { registerAdminMasterDataTemplateRoutes } from "./admin-master-data-template-routes";
import type { SessionActor } from "./auth";
import type { AuthorizedDevice } from "./device-authorization";
import { API_BODY_LIMIT_BYTES } from "./request-body-boundaries";
import type { Env } from "./types";

const EVENT_ID = "synthetic-event";
const COMMAND_ID = "550e8400-e29b-41d4-a716-446655440080";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440081";
const NOW = new Date("2026-08-09T19:00:00.000Z");

function adminDevice(role: AuthorizedDevice["role"] = "ADMIN"): AuthorizedDevice {
  return {
    id: DEVICE_ID,
    role,
    accountId: "550e8400-e29b-41d4-a716-446655440082",
    loginCode: "ADMIN-01",
  };
}

function emptyTemplate(overrides?: Partial<MasterDataTemplate>): MasterDataTemplate {
  return {
    format: "rundflug-master-data-template",
    formatVersion: 2,
    exportedAt: NOW.toISOString(),
    source: { name: "Synthetic event", version: 3 },
    eventParameters: {
      noShowAfterMinutes: 15,
      maxTicketDeferrals: 2,
      notificationLeadMinutes: 20,
      automaticPrecallEnabled: true,
      precallLeadMinutes: 10,
      maximumGateWaitMinutes: 15,
      precallMinimumQuality: "STABLE",
      precallGateCooldownMinutes: 2,
      referenceWeightsKg: { child: 35, normal: 80, heavy: 110 },
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 3,
      plannedBufferMinutes: 2,
      departedVisibilitySeconds: 60,
    },
    gates: [],
    resourceGroups: [],
    aircraft: [],
    assignments: [],
    pilots: [],
    products: [],
    aircraftProductTurnaroundOverrides: [],
    ...overrides,
  };
}

function importBody(template: MasterDataTemplate = emptyTemplate()) {
  return { commandId: COMMAND_ID, expectedVersion: 3, template };
}

function jsonRequest(body: unknown, headers?: Record<string, string>) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

interface MockStatement {
  sql: string;
  bindings: unknown[];
  first: () => Promise<unknown>;
  all: () => Promise<{ results: unknown[] }>;
}

interface TargetRow {
  status: string;
  version: number;
  gates: number;
  resource_groups: number;
  memberships: number;
  pilots: number;
  products: number;
}

const eligibleTarget: TargetRow = {
  status: "PREPARATION",
  version: 3,
  gates: 0,
  resource_groups: 0,
  memberships: 0,
  pilots: 0,
  products: 0,
};

function storedImportResponse() {
  return {
    accepted: true,
    duplicate: false,
    eventId: EVENT_ID,
    version: 4,
    counts: { gates: 0, resourceGroups: 0, aircraft: 0, assignments: 0, pilots: 0, products: 0 },
  } as const;
}

function createApp(input?: {
  device?: AuthorizedDevice | null;
  exportTemplate?: MasterDataTemplate | null;
  priorReceipt?: { operation_day_id: string; device_id: string; response_json: string } | null;
  concurrentReceipt?: { response_json: string; device_id: string } | null;
  target?: TargetRow | null;
  existingAircraft?: Record<string, unknown> | null;
  updateChanges?: number;
}) {
  const prepared: MockStatement[] = [];
  const batched: MockStatement[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => {
      const statement: MockStatement = {
        sql,
        bindings,
        first: async () => {
          if (sql.includes("SELECT operation_day_id, device_id, response_json")) {
            return input && "priorReceipt" in input ? (input.priorReceipt ?? null) : null;
          }
          if (sql.includes("SELECT response_json, device_id")) {
            return input && "concurrentReceipt" in input ? (input.concurrentReceipt ?? null) : null;
          }
          if (sql.includes("SELECT od.status, od.version")) {
            return input && "target" in input ? (input.target ?? null) : eligibleTarget;
          }
          if (sql.includes("FROM aircraft WHERE registration")) {
            return input && "existingAircraft" in input ? (input.existingAircraft ?? null) : null;
          }
          return null;
        },
        all: async () => ({ results: [] }),
      };
      prepared.push(statement);
      return statement;
    },
  }));
  const batch = vi.fn(async (statements: MockStatement[]) => {
    batched.push(statements);
    return statements.map((_statement, index) => ({
      meta: { changes: index === statements.length - 1 ? (input?.updateChanges ?? 1) : 1 },
    }));
  });
  const database = Object.assign(Object.create(null), { prepare, batch }) as D1Database;
  const env = Object.assign(Object.create(null), { DB: database }) as Env;
  const device = input && "device" in input ? (input.device ?? null) : adminDevice();
  const authorizeDevice = vi.fn(async () => device);
  const exported =
    input && "exportTemplate" in input ? (input.exportTemplate ?? null) : emptyTemplate();
  const loadTemplate = vi.fn(
    async (_database: D1Database, _eventId: string, _exportedAt?: () => string) => exported,
  );
  let generatedId = 0;
  const randomUUID = vi.fn(
    () =>
      `550e8400-e29b-41d4-a716-${String(++generatedId).padStart(12, "0")}` as ReturnType<
        typeof crypto.randomUUID
      >,
  );
  const app = new Hono<{
    Bindings: Env;
    Variables: { sessionActor: SessionActor | null };
  }>();
  registerAdminMasterDataTemplateRoutes(app, {
    authorizeDevice,
    loadAdminMasterDataTemplate: loadTemplate,
    now: () => NOW,
    randomUUID,
  });
  return {
    app,
    env,
    prepare,
    batch,
    prepared,
    batched,
    authorizeDevice,
    loadTemplate,
    randomUUID,
  };
}

describe("admin master-data template routes", () => {
  it("requires an ADMIN device before export, validation or import access", async () => {
    const { app, env, prepare, batch, loadTemplate } = createApp({
      device: adminDevice("CASHIER"),
    });

    const responses = await Promise.all([
      app.request(`https://worker.test/api/admin/events/${EVENT_ID}/master-data-template`, {}, env),
      app.request(
        `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/validate`,
        jsonRequest({ template: emptyTemplate() }),
        env,
      ),
      app.request(
        `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/import`,
        jsonRequest(importBody()),
        env,
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(loadTemplate).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it("exports the portable template with the existing attachment contract", async () => {
    const template = emptyTemplate();
    const { app, env, loadTemplate } = createApp({ exportTemplate: template });

    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template`,
      {},
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="stammdaten-${EVENT_ID}.json"`,
    );
    await expect(response.json()).resolves.toEqual(template);
    expect(loadTemplate).toHaveBeenCalledWith(env.DB, EVENT_ID, expect.any(Function));
    expect(loadTemplate.mock.calls[0]?.[2]?.()).toBe(NOW.toISOString());
  });

  it("returns EVENT_NOT_FOUND when the export source event is missing", async () => {
    const { app, env } = createApp({ exportTemplate: null });

    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template`,
      {},
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVENT_NOT_FOUND" } });
  });

  it("rejects malformed and declared oversized template bodies", async () => {
    const { app, env, prepare } = createApp();

    const malformed = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/validate`,
      jsonRequest("{"),
      env,
    );
    const oversized = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/import`,
      jsonRequest({}, { "content-length": String(API_BODY_LIMIT_BYTES + 1) }),
      env,
    );

    expect([malformed.status, oversized.status]).toEqual([400, 400]);
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: "TEMPLATE_INVALID" } });
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "TEMPLATE_TOO_LARGE" },
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("reports existing aircraft conflicts and target eligibility during validation", async () => {
    const template = emptyTemplate({
      aircraft: [
        {
          key: "aircraft-1",
          registration: "D-EAAA",
          aircraftType: "C172",
          passengerSeats: 4,
          maximumPassengerPayloadKg: 320,
          refuelReminderThreshold: 5,
        },
      ],
    });
    const { app, env } = createApp({
      existingAircraft: {
        id: "existing-aircraft",
        registration: "D-EAAA",
        aircraft_type: "C172",
        passenger_seats: 3,
        maximum_passenger_payload_kg: 320,
        refuel_reminder_threshold: 5,
      },
    });

    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/validate`,
      jsonRequest({ template }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      valid: false,
      targetEligible: true,
      counts: { aircraft: 1 },
      errors: [{ path: "aircraft.0" }],
      warnings: [expect.stringContaining("1 bestehende Flugzeuge")],
    });
  });

  it("replays a matching import receipt and rejects a foreign command owner", async () => {
    const responseJson = JSON.stringify(storedImportResponse());
    const matching = createApp({
      priorReceipt: {
        operation_day_id: EVENT_ID,
        device_id: DEVICE_ID,
        response_json: responseJson,
      },
    });
    const foreign = createApp({
      priorReceipt: {
        operation_day_id: EVENT_ID,
        device_id: "different-device",
        response_json: responseJson,
      },
    });

    const replay = await matching.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/import`,
      jsonRequest(importBody()),
      matching.env,
    );
    const conflict = await foreign.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/import`,
      jsonRequest(importBody()),
      foreign.env,
    );

    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ accepted: true, duplicate: true });
    expect(matching.batch).not.toHaveBeenCalled();
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("rejects stale versions and non-empty target events before building the batch", async () => {
    const stale = createApp({ target: { ...eligibleTarget, version: 4 } });
    const occupied = createApp({ target: { ...eligibleTarget, products: 1 } });

    const staleResponse = await stale.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/import`,
      jsonRequest(importBody()),
      stale.env,
    );
    const occupiedResponse = await occupied.app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/import`,
      jsonRequest(importBody()),
      occupied.env,
    );

    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({ error: { code: "STALE_VERSION" } });
    expect(occupiedResponse.status).toBe(409);
    await expect(occupiedResponse.json()).resolves.toMatchObject({
      error: { code: "TEMPLATE_TARGET_NOT_EMPTY" },
    });
    expect(stale.batch).not.toHaveBeenCalled();
    expect(occupied.batch).not.toHaveBeenCalled();
  });

  it("commits receipt, audit, outbox and version update in one guarded batch", async () => {
    const { app, env, batch, batched } = createApp();

    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/import`,
      jsonRequest(importBody()),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(storedImportResponse());
    expect(batch).toHaveBeenCalledOnce();
    const statements = batched[0] ?? [];
    expect(statements).toHaveLength(4);
    expect(statements.map((statement) => statement.sql)).toEqual([
      expect.stringContaining("INSERT INTO idempotency_receipts"),
      expect.stringContaining("INSERT INTO operational_events"),
      expect.stringContaining("INSERT INTO outbox"),
      expect.stringContaining("UPDATE operation_days"),
    ]);
    expect(statements[0]?.sql).toContain("status = 'PREPARATION'");
    expect(statements[1]?.sql).toContain("MASTER_DATA_TEMPLATE_IMPORTED");
    expect(statements[2]?.sql).toContain("MASTER_DATA_TEMPLATE_IMPORTED");
    expect(statements[3]?.sql).toContain("version = ?2 AND status = 'PREPARATION'");
    expect(
      statements.slice(1).every((statement) => statement.sql.includes("idempotency_receipts")),
    ).toBe(true);
  });

  it("returns the concurrently stored receipt when the guarded update loses the race", async () => {
    const responseJson = JSON.stringify(storedImportResponse());
    const { app, env } = createApp({
      updateChanges: 0,
      concurrentReceipt: { device_id: DEVICE_ID, response_json: responseJson },
    });

    const response = await app.request(
      `https://worker.test/api/admin/events/${EVENT_ID}/master-data-template/import`,
      jsonRequest(importBody()),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: true, duplicate: true });
  });
});

describe("admin master-data template export projection", () => {
  it("returns null without querying child tables when the event is missing", async () => {
    const prepare = vi.fn((_sql: string) => ({
      bind: () => ({ first: async () => null }),
    }));
    const database = Object.assign(Object.create(null), { prepare }) as D1Database;

    await expect(
      loadAdminMasterDataTemplate(database, EVENT_ID, () => NOW.toISOString()),
    ).resolves.toBeNull();
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("builds a schema-valid empty projection from the event parameters", async () => {
    const event = {
      name: "Synthetic event",
      version: 3,
      no_show_after_minutes: 15,
      max_ticket_deferrals: 2,
      notification_lead_minutes: 20,
      automatic_precall_enabled: 1,
      precall_lead_minutes: 10,
      max_gate_wait_minutes: 15,
      precall_min_quality: "STABLE",
      precall_gate_cooldown_minutes: 2,
      child_reference_weight_kg: 35,
      normal_reference_weight_kg: 80,
      heavy_reference_weight_kg: 110,
      planned_boarding_minutes: 5,
      planned_deboarding_minutes: 3,
      planned_buffer_minutes: 2,
      departed_visibility_seconds: 60,
    };
    const childReads: string[] = [];
    const prepare = vi.fn((sql: string) => ({
      bind: () => ({
        first: async () => event,
        all: async () => {
          childReads.push(sql);
          return { results: [] };
        },
      }),
    }));
    const database = Object.assign(Object.create(null), { prepare }) as D1Database;

    const result = await loadAdminMasterDataTemplate(database, EVENT_ID, () => NOW.toISOString());

    expect(result).toEqual(emptyTemplate());
    expect(childReads).toHaveLength(6);
  });
});
