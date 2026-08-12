import { commandEnvelopeSchema } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type RotationTransitionCommand,
  RotationTransitionCommandService,
} from "./rotation-transition-command-service";
import type { Env, StoredEventRow } from "./types";

interface TransitionScenario {
  rotation?: Record<string, unknown> | null;
  selectedGroups?: Array<Record<string, unknown>>;
  lease?: Record<string, unknown> | null;
  conflictingLeases?: Array<Record<string, unknown>>;
  turnaround?: Record<string, unknown> | null;
  skippedGroups?: Array<{ id: string }>;
  candidate?: Record<string, unknown> | null;
  pilot?: Record<string, unknown> | null;
  recurringRules?: Array<Record<string, unknown>>;
}

interface PreparedStatement {
  sql: string;
  parameters: unknown[];
  first: () => Promise<Record<string, unknown> | null>;
  all: () => Promise<{ results: Array<Record<string, unknown>> }>;
  run: () => Promise<{ success: true; results: []; meta: { changes: number } }>;
}

function defaultRotation(overrides: Record<string, unknown> = {}) {
  return {
    id: "rotation-1",
    status: "DRAFT",
    version: 3,
    aircraft_id: null,
    pilot_id: null,
    called_at: null,
    forecast_assumed_aircraft_id: null,
    dispatch_plan_revision: null,
    dispatch_batch_id: null,
    dispatch_group_ids_json: "[]",
    dispatch_operation_day_version: null,
    flight_group_product_id: "product-1",
    resource_group_status: "ACTIVE",
    ...overrides,
  };
}

function selectedGroup(overrides: Record<string, unknown> = {}) {
  return {
    ticket_group_id: "group-1",
    rotation_id: "rotation-1",
    resource_group_id: "resource-group-1",
    product_id: "product-1",
    queue_sequence: 10,
    ticket_count: 2,
    ...overrides,
  };
}

function turnaround(overrides: Record<string, unknown> = {}) {
  return {
    product_boarding: null,
    product_deboarding: null,
    product_buffer: null,
    aircraft_boarding: null,
    aircraft_deboarding: null,
    aircraft_buffer: null,
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "aircraft-1",
    passenger_seats: 4,
    operational_state: "AVAILABLE",
    current_pilot_id: "pilot-1",
    ...overrides,
  };
}

function activeLease(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440101",
    operation_day_id: "synthetic-event",
    aircraft_id: "aircraft-1",
    operator_account_id: "operator-1",
    device_id: "flight-line-device",
    acquire_command_id: "550e8400-e29b-41d4-a716-446655440099",
    dispatch_plan_revision: "plan-1",
    dispatch_batch_id: "batch-1",
    dispatch_order: 1,
    ticket_group_ids_json: '["group-1"]',
    occupied_seats: 2,
    available_seats: 2,
    decision_reasons_json: '["FIFO"]',
    operation_day_version: 17,
    member_rotation_ids_json: '["rotation-1"]',
    status: "ACTIVE",
    acquired_at: "2026-08-09T09:59:00.000Z",
    expires_at: "2099-08-09T10:05:00.000Z",
    version: 1,
    ...overrides,
  };
}

function createDatabase(scenario: TransitionScenario) {
  const prepared: PreparedStatement[] = [];
  const firstFor = (sql: string): Record<string, unknown> | null => {
    if (sql.includes("SELECT r.id AS rotation_id")) {
      return scenario.rotation === null ? null : { rotation_id: "rotation-1" };
    }
    if (sql.includes("SELECT r.id, r.status, r.version")) {
      return scenario.rotation === undefined ? defaultRotation() : scenario.rotation;
    }
    if (sql.includes("FROM dispatch_recommendation_leases") && sql.includes("WHERE id = ?1")) {
      return scenario.lease ?? null;
    }
    if (sql.includes("FROM products p")) {
      return scenario.turnaround === undefined ? turnaround() : scenario.turnaround;
    }
    if (sql.includes("SELECT a.id, a.passenger_seats")) {
      return scenario.candidate === undefined ? candidate() : scenario.candidate;
    }
    if (sql.includes("SELECT p.id FROM pilots p")) {
      return scenario.pilot === undefined ? { id: "pilot-1" } : scenario.pilot;
    }
    return null;
  };
  const allFor = (sql: string): Array<Record<string, unknown>> => {
    if (sql.includes("SELECT tg.id AS ticket_group_id")) {
      return scenario.selectedGroups ?? [selectedGroup()];
    }
    if (sql.includes("SELECT lease.id, lease.operation_day_id")) {
      return scenario.conflictingLeases ?? [];
    }
    if (sql.includes("SELECT tg.id") && sql.includes("tg.product_id <> ?3")) {
      return scenario.skippedGroups ?? [];
    }
    if (sql.includes("FROM recurring_operational_rules rule")) {
      return scenario.recurringRules ?? [];
    }
    return [];
  };
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => {
      const statement: PreparedStatement = {
        sql,
        parameters,
        first: async () => firstFor(sql),
        all: async () => ({ results: allFor(sql) }),
        run: async () => ({ success: true, results: [], meta: { changes: 1 } }),
      };
      prepared.push(statement);
      return statement;
    },
  }));
  const batch = vi.fn(async (statements: PreparedStatement[]) =>
    statements.map(() => ({ success: true, results: [], meta: { changes: 1 } })),
  );
  return {
    database: { prepare, batch } as unknown as D1Database,
    batch,
    prepared,
  };
}

function storedEvent(): StoredEventRow {
  return {
    id: "synthetic-event",
    name: "Synthetic event",
    event_date: "2026-08-09",
    time_zone: "Europe/Berlin",
    status: "ACTIVE",
    emergency_mode: 0,
    operational_interrupted: 0,
    version: 17,
    operational_note: "",
    planned_boarding_minutes: 8,
    planned_deboarding_minutes: 5,
    planned_buffer_minutes: 3,
    updated_at: "2026-08-09T10:00:00.000Z",
  };
}

function transitionCommand(
  type: RotationTransitionCommand["type"],
  payload: Record<string, unknown>,
): RotationTransitionCommand {
  return commandEnvelopeSchema.parse({
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "flight-line-device",
    expectedVersion: 17,
    issuedAt: "2026-08-09T10:01:00.000Z",
    type,
    payload,
  }) as RotationTransitionCommand;
}

function callNextPayload(overrides: Record<string, unknown> = {}) {
  return {
    ticketGroupIds: ["group-1"],
    aircraftId: "aircraft-1",
    pilotId: "pilot-1",
    ...overrides,
  };
}

function serviceHarness(scenario: TransitionScenario = {}) {
  const database = createDatabase(scenario);
  const broadcasts: unknown[] = [];
  const backgroundWork: Promise<unknown>[] = [];
  const loadOpenRecalls = vi.fn().mockResolvedValue([]);
  const recallClosureStatements = vi.fn(() => []);
  const loadEligibleDraftMembers = vi.fn().mockResolvedValue([
    { rotationId: "rotation-1", queueSequence: 10 },
    { rotationId: "waiting-rotation", queueSequence: 5 },
  ]);
  const service = new RotationTransitionCommandService(
    { DB: database.database } as unknown as Env,
    (result) => broadcasts.push(result),
    (work) => backgroundWork.push(work),
    loadOpenRecalls,
    recallClosureStatements,
    loadEligibleDraftMembers,
  );
  return {
    service,
    broadcasts,
    backgroundWork,
    loadOpenRecalls,
    recallClosureStatements,
    loadEligibleDraftMembers,
    ...database,
  };
}

async function expectCallNextGuard(
  scenario: TransitionScenario,
  payload: Record<string, unknown>,
  expectedCode: string,
  operatorAccountId: string | null = "operator-1",
) {
  const harness = serviceHarness(scenario);
  const response = await harness.service.handle(
    transitionCommand("CALL_NEXT", callNextPayload(payload)),
    storedEvent(),
    operatorAccountId,
  );

  expect(response.status).toBe(expectedCode === "DUPLICATE_TICKET_GROUP" ? 400 : 409);
  await expect(response.json()).resolves.toMatchObject({ error: { code: expectedCode } });
  expect(harness.batch).not.toHaveBeenCalled();
  expect(harness.broadcasts).toHaveLength(0);
}

describe("CALL_NEXT guards", () => {
  it("requires an active resource group", async () => {
    await expectCallNextGuard(
      { rotation: defaultRotation({ resource_group_status: "PAUSED" }) },
      {},
      "RESOURCE_GROUP_NOT_ACTIVE",
    );
  });

  it("rejects duplicate and unavailable ticket groups", async () => {
    await expectCallNextGuard(
      {},
      { ticketGroupIds: ["group-1", "group-1"] },
      "DUPLICATE_TICKET_GROUP",
    );
    await expectCallNextGuard({ selectedGroups: [] }, {}, "TICKET_GROUP_NOT_AVAILABLE");
  });

  it("keeps selected groups inside one resource group and product", async () => {
    const secondGroup = selectedGroup({
      ticket_group_id: "group-2",
      rotation_id: "rotation-2",
      queue_sequence: 11,
    });
    await expectCallNextGuard(
      {
        selectedGroups: [
          selectedGroup(),
          { ...secondGroup, resource_group_id: "resource-group-2" },
        ],
      },
      { ticketGroupIds: ["group-1", "group-2"] },
      "RESOURCE_GROUP_MISMATCH",
    );
    await expectCallNextGuard(
      {
        selectedGroups: [selectedGroup(), { ...secondGroup, product_id: "product-2" }],
      },
      { ticketGroupIds: ["group-1", "group-2"] },
      "PRODUCT_MISMATCH",
    );
  });

  it("validates dispatch lease ownership, freshness, and contents", async () => {
    const recommendation = { planRevision: "plan-1", batchId: "batch-1" };
    await expectCallNextGuard(
      {},
      { dispatchRecommendationLeaseId: "550e8400-e29b-41d4-a716-446655440101" },
      "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
      null,
    );
    await expectCallNextGuard(
      { lease: activeLease({ status: "CONSUMED" }) },
      {
        dispatchRecommendationLeaseId: "550e8400-e29b-41d4-a716-446655440101",
        dispatchRecommendation: recommendation,
      },
      "DISPATCH_RECOMMENDATION_LEASE_CONFLICT",
    );
    await expectCallNextGuard(
      { lease: activeLease({ expires_at: "2020-01-01T00:00:00.000Z" }) },
      {
        dispatchRecommendationLeaseId: "550e8400-e29b-41d4-a716-446655440101",
        dispatchRecommendation: recommendation,
      },
      "DISPATCH_RECOMMENDATION_LEASE_EXPIRED",
    );
    await expectCallNextGuard(
      { lease: activeLease({ occupied_seats: 3 }) },
      {
        dispatchRecommendationLeaseId: "550e8400-e29b-41d4-a716-446655440101",
        dispatchRecommendation: recommendation,
      },
      "DISPATCH_RECOMMENDATION_LEASE_MISMATCH",
    );
  });

  it("rejects stale unleased dispatch recommendations", async () => {
    await expectCallNextGuard(
      {
        rotation: defaultRotation({
          forecast_assumed_aircraft_id: "aircraft-1",
          dispatch_plan_revision: "plan-old",
          dispatch_batch_id: "batch-1",
          dispatch_group_ids_json: '["group-1"]',
          dispatch_operation_day_version: 17,
        }),
      },
      { dispatchRecommendation: { planRevision: "plan-1", batchId: "batch-1" } },
      "DISPATCH_PLAN_STALE",
    );
  });

  it("requires a reason before overriding another operator's active lease", async () => {
    await expectCallNextGuard(
      { conflictingLeases: [activeLease()] },
      {},
      "QUEUE_DEVIATION_REASON_REQUIRED",
    );
  });

  it("rejects flight-group product drift and missing turnaround configuration", async () => {
    await expectCallNextGuard(
      { rotation: defaultRotation({ flight_group_product_id: "product-2" }) },
      {},
      "PRODUCT_MISMATCH",
    );
    const harness = serviceHarness({ turnaround: null });
    const response = await harness.service.handle(
      transitionCommand("CALL_NEXT", callNextPayload()),
      storedEvent(),
      "operator-1",
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PRODUCT_NOT_FOUND" } });
  });

  it("requires a reason when an earlier group of another product is skipped", async () => {
    await expectCallNextGuard(
      { skippedGroups: [{ id: "earlier-group" }] },
      {},
      "QUEUE_DEVIATION_REASON_REQUIRED",
    );
  });

  it("validates aircraft availability, capacity, and pilot assignment", async () => {
    await expectCallNextGuard(
      { candidate: candidate({ operational_state: "IN_FLIGHT" }) },
      {},
      "AIRCRAFT_NOT_AVAILABLE",
    );
    await expectCallNextGuard(
      { selectedGroups: [selectedGroup({ ticket_count: 5 })] },
      {},
      "AIRCRAFT_CAPACITY_EXCEEDED",
    );
    await expectCallNextGuard(
      { candidate: candidate({ current_pilot_id: "pilot-2" }) },
      {},
      "AIRCRAFT_PILOT_ASSIGNMENT_MISMATCH",
    );
    await expectCallNextGuard({ pilot: null }, {}, "PILOT_NOT_AVAILABLE");
  });
});

describe("successful rotation transitions", () => {
  it("persists a confirmed CALL_NEXT with recall closure and overtake accounting", async () => {
    const harness = serviceHarness();
    harness.loadOpenRecalls.mockResolvedValue([
      {
        id: "recall-1",
        ticket_group_id: "group-1",
        operation_day_id: "synthetic-event",
      },
    ]);
    const response = await harness.service.handle(
      transitionCommand("CALL_NEXT", callNextPayload()),
      storedEvent(),
      "operator-1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      eventType: "FLIGHT_GROUP_CALLED",
      event: { version: 18 },
    });
    expect(harness.loadOpenRecalls).toHaveBeenCalledWith(
      "synthetic-event",
      ["group-1"],
      expect.any(String),
    );
    expect(harness.recallClosureStatements).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "BOARDING" }),
    );
    expect(harness.loadEligibleDraftMembers).toHaveBeenCalledWith(
      "synthetic-event",
      "resource-group-1",
    );
    expect(
      harness.prepared.some(({ sql }) => sql.includes("dispatch_confirmed_overtake_count")),
    ).toBe(true);
    expect(harness.batch).toHaveBeenCalledOnce();
    expect(harness.broadcasts).toHaveLength(1);
  });

  it.each([
    {
      type: "MARK_ON_BLOCK" as const,
      status: "IN_FLIGHT",
      payload: { rotationId: "rotation-1" },
      eventType: "MARK_ON_BLOCK",
    },
    {
      type: "COMPLETE_TURNAROUND" as const,
      status: "LANDED",
      payload: { rotationId: "rotation-1", nextAircraftState: "AVAILABLE" },
      eventType: "TURNAROUND_COMPLETED",
    },
    {
      type: "CANCEL_ROTATION" as const,
      status: "CALLED",
      payload: { rotationId: "rotation-1", reason: "Synthetic cancellation" },
      eventType: "ROTATION_CANCELED",
    },
  ])(
    "persists $type with its distinct event semantics",
    async ({ type, status, payload, eventType }) => {
      const harness = serviceHarness({
        rotation: defaultRotation({
          status,
          aircraft_id: "aircraft-1",
          pilot_id: "pilot-1",
          called_at: "2026-08-09T10:00:00.000Z",
        }),
      });

      const response = await harness.service.handle(
        transitionCommand(type, payload),
        storedEvent(),
        "operator-1",
      );
      await Promise.all(harness.backgroundWork);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ accepted: true, eventType });
      expect(harness.batch).toHaveBeenCalledOnce();
      expect(harness.broadcasts).toHaveLength(1);
    },
  );

  it("requires retained aircraft and pilot assignments for non-call transitions", async () => {
    const withoutAircraft = serviceHarness({
      rotation: defaultRotation({ status: "CALLED", aircraft_id: null, pilot_id: "pilot-1" }),
    });
    const aircraftResponse = await withoutAircraft.service.handle(
      transitionCommand("MARK_OFF_BLOCK", { rotationId: "rotation-1" }),
      storedEvent(),
      "operator-1",
    );
    await expect(aircraftResponse.json()).resolves.toMatchObject({
      error: { code: "AIRCRAFT_ASSIGNMENT_REQUIRED" },
    });

    const withoutPilot = serviceHarness({
      rotation: defaultRotation({ status: "CALLED", aircraft_id: "aircraft-1", pilot_id: null }),
    });
    const pilotResponse = await withoutPilot.service.handle(
      transitionCommand("MARK_OFF_BLOCK", { rotationId: "rotation-1" }),
      storedEvent(),
      "operator-1",
    );
    await expect(pilotResponse.json()).resolves.toMatchObject({
      error: { code: "PILOT_ASSIGNMENT_REQUIRED" },
    });
  });
});
