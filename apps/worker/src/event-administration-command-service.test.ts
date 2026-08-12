import { describe, expect, it, vi } from "vitest";
import { EventAdministrationCommandService } from "./event-administration-command-service";
import type { Env, StoredEventRow } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
  first: () => Promise<unknown>;
}

function createDatabase(firstRows: unknown[] = []) {
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]): PreparedQuery => ({
      sql,
      parameters,
      first: async () => firstRows.shift() ?? null,
    }),
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) => statements);
  return { database: { prepare, batch } as unknown as D1Database, batch, prepare };
}

function event(status: StoredEventRow["status"] = "PREPARATION"): StoredEventRow {
  return {
    id: "event-a",
    name: "Synthetic event",
    event_date: "2026-08-12",
    time_zone: "Europe/Berlin",
    status,
    emergency_mode: 0,
    operational_interrupted: 0,
    operations_end_at: "2026-08-12T18:00:00.000Z",
    version: 7,
    operational_note: "",
    updated_at: "2026-08-12T08:00:00.000Z",
  };
}

function commandBase(type: string) {
  return {
    commandId: "00e971df-23d5-4d28-9107-92b447416231",
    eventId: "event-a",
    deviceId: "device-a",
    expectedVersion: 7,
    issuedAt: "2026-08-12T08:00:00.000Z",
    type,
  } as const;
}

function createService(database: D1Database) {
  const broadcast = vi.fn();
  const waitUntil = vi.fn();
  return {
    service: new EventAdministrationCommandService(
      { DB: database } as unknown as Env,
      broadcast,
      waitUntil,
      () => null,
    ),
    broadcast,
    waitUntil,
  };
}

describe("event administration command service", () => {
  it("rejects unchanged and forbidden lifecycle transitions without persistence", async () => {
    const input = createDatabase();
    const { service, broadcast } = createService(input.database);
    const unchanged = {
      ...commandBase("SET_EVENT_LIFECYCLE"),
      type: "SET_EVENT_LIFECYCLE" as const,
      payload: { status: "PREPARATION" as const, reason: "Synthetic reason", adminPin: "1234" },
    };
    const unchangedResponse = await service.handleLifecycle(unchanged, event());
    expect(unchangedResponse.status).toBe(409);
    await expect(unchangedResponse.json()).resolves.toMatchObject({
      error: { code: "EVENT_STATUS_UNCHANGED" },
    });

    const forbidden = {
      ...unchanged,
      payload: { ...unchanged.payload, status: "ARCHIVED" as const },
    };
    const forbiddenResponse = await service.handleLifecycle(forbidden, event());
    expect(forbiddenResponse.status).toBe(409);
    await expect(forbiddenResponse.json()).resolves.toMatchObject({
      error: { code: "EVENT_LIFECYCLE_TRANSITION_NOT_ALLOWED" },
    });
    expect(input.prepare).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("requires complete master data before activation", async () => {
    const input = createDatabase([
      { products: 1, resource_groups: 1, aircraft: 0, pilots: 1, gates: 1 },
    ]);
    const { service, broadcast } = createService(input.database);
    const command = {
      ...commandBase("SET_EVENT_LIFECYCLE"),
      type: "SET_EVENT_LIFECYCLE" as const,
      payload: { status: "ACTIVE" as const, reason: "Synthetic activation", adminPin: "1234" },
    };

    const response = await service.handleLifecycle(command, event());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVENT_NOT_READY" } });
    expect(input.batch).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("activates a ready event with version, audit, receipt and outbox", async () => {
    const input = createDatabase([
      { products: 1, resource_groups: 1, aircraft: 1, pilots: 1, gates: 1 },
    ]);
    const { service, broadcast } = createService(input.database);
    const command = {
      ...commandBase("SET_EVENT_LIFECYCLE"),
      type: "SET_EVENT_LIFECYCLE" as const,
      payload: { status: "ACTIVE" as const, reason: "Synthetic activation", adminPin: "1234" },
    };

    const response = await service.handleLifecycle(command, event());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "EVENT_ACTIVE",
      event: { status: "ACTIVE", version: 8 },
    });
    expect(input.batch).toHaveBeenCalledOnce();
    const sql = (input.batch.mock.calls[0]?.[0] ?? []).map(({ sql }) => sql).join("\n");
    expect(sql).toContain("UPDATE operation_days SET status");
    expect(sql).toContain("INSERT INTO operational_events");
    expect(sql).toContain("INSERT INTO idempotency_receipts");
    expect(sql).toContain("INSERT INTO outbox");
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("rejects closing while a rotation remains operationally open", async () => {
    const input = createDatabase([{ count: 1 }]);
    const { service } = createService(input.database);
    const command = {
      ...commandBase("SET_EVENT_LIFECYCLE"),
      type: "SET_EVENT_LIFECYCLE" as const,
      payload: { status: "CLOSED" as const, reason: "Synthetic closure", adminPin: "1234" },
    };

    const response = await service.handleLifecycle(command, event("ACTIVE"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EVENT_HAS_OPEN_ROTATIONS" },
    });
    expect(input.batch).not.toHaveBeenCalled();
  });

  it("validates time ranges and reference weight ordering before configuration", async () => {
    const input = createDatabase();
    const { service } = createService(input.database);
    const basePayload = {
      saleOpensAt: "2026-08-12T19:00:00.000Z",
      operationsStartAt: "2026-08-12T09:00:00.000Z",
      operationsEndAt: "2026-08-12T18:00:00.000Z",
      noShowAfterMinutes: 15,
      maxTicketDeferrals: 2,
      notificationLeadMinutes: 15,
      automaticPrecallEnabled: true,
      precallLeadMinutes: 15,
      maximumGateWaitMinutes: 20,
      precallMinimumQuality: "CHANGING" as const,
      precallGateCooldownMinutes: 2,
      childReferenceWeightKg: 40,
      normalReferenceWeightKg: 80,
      heavyReferenceWeightKg: 100,
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 5,
      plannedBufferMinutes: 3,
      departedVisibilitySeconds: 15,
      reason: "Synthetic configuration",
      adminPin: "1234",
    };
    const invalidTime = {
      ...commandBase("CONFIGURE_EVENT_PARAMETERS"),
      type: "CONFIGURE_EVENT_PARAMETERS" as const,
      payload: basePayload,
    };
    const timeResponse = await service.handleParameters(invalidTime, event());
    expect(timeResponse.status).toBe(409);
    await expect(timeResponse.json()).resolves.toMatchObject({
      error: { code: "EVENT_TIME_RANGE_INVALID" },
    });

    const invalidWeights = {
      ...invalidTime,
      payload: {
        ...basePayload,
        saleOpensAt: null,
        childReferenceWeightKg: 90,
        normalReferenceWeightKg: 80,
      },
    };
    const weightResponse = await service.handleParameters(invalidWeights, event());
    expect(weightResponse.status).toBe(409);
    await expect(weightResponse.json()).resolves.toMatchObject({
      error: { code: "REFERENCE_WEIGHTS_INVALID" },
    });
    expect(input.prepare).not.toHaveBeenCalled();
  });

  it("persists valid event parameters atomically", async () => {
    const input = createDatabase();
    const { service, broadcast } = createService(input.database);
    const command = {
      ...commandBase("CONFIGURE_EVENT_PARAMETERS"),
      type: "CONFIGURE_EVENT_PARAMETERS" as const,
      payload: {
        saleOpensAt: null,
        operationsStartAt: "2026-08-12T09:00:00.000Z",
        operationsEndAt: "2026-08-12T18:00:00.000Z",
        noShowAfterMinutes: 15,
        maxTicketDeferrals: 2,
        notificationLeadMinutes: 15,
        automaticPrecallEnabled: true,
        precallLeadMinutes: 15,
        maximumGateWaitMinutes: 20,
        precallMinimumQuality: "CHANGING" as const,
        precallGateCooldownMinutes: 2,
        childReferenceWeightKg: 40,
        normalReferenceWeightKg: 80,
        heavyReferenceWeightKg: 100,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 3,
        departedVisibilitySeconds: 15,
        reason: "Synthetic configuration",
        adminPin: "1234",
      },
    };

    const response = await service.handleParameters(command, event());

    expect(response.status).toBe(200);
    expect(input.batch).toHaveBeenCalledOnce();
    const sql = (input.batch.mock.calls[0]?.[0] ?? []).map(({ sql }) => sql).join("\n");
    expect(sql).toContain("UPDATE operation_days SET sale_opens_at");
    expect(sql).toContain("INSERT INTO operational_events");
    expect(sql).toContain("INSERT INTO idempotency_receipts");
    expect(sql).toContain("INSERT INTO outbox");
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("protects the final admin device and rejects duplicate pairing IDs", async () => {
    const lastAdmin = createDatabase([{ id: "admin-b", role: "ADMIN", active: 1 }, { count: 1 }]);
    const lastAdminService = createService(lastAdmin.database).service;
    const revoke = {
      ...commandBase("REVOKE_DEVICE"),
      type: "REVOKE_DEVICE" as const,
      payload: { pairedDeviceId: "admin-b", adminPin: "1234", reason: "Synthetic revoke" },
    };
    const revokeResponse = await lastAdminService.handleDevices(revoke, event());
    expect(revokeResponse.status).toBe(409);
    await expect(revokeResponse.json()).resolves.toMatchObject({
      error: { code: "LAST_ADMIN_DEVICE" },
    });

    const duplicate = createDatabase([{ id: "device-b" }]);
    const pair = {
      ...commandBase("PAIR_DEVICE"),
      type: "PAIR_DEVICE" as const,
      payload: {
        pairedDeviceId: "00e971df-23d5-4d28-9107-92b447416232",
        label: "Synthetic device",
        role: "CASHIER" as const,
        credentialHash: "a".repeat(64),
        adminPin: "1234",
      },
    };
    const pairResponse = await createService(duplicate.database).service.handleDevices(
      pair,
      event(),
    );
    expect(pairResponse.status).toBe(409);
    await expect(pairResponse.json()).resolves.toMatchObject({
      error: { code: "DEVICE_ID_EXISTS" },
    });
  });
});
