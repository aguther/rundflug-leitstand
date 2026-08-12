import type { CommandEnvelope } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import type { PlannedOperationRow } from "./command-preflight-types";
import {
  validateCommandVersion,
  validatePlannedOperationLink,
} from "./event-coordinator-preflight-policy";
import type { StoredEventRow } from "./types";

interface ErrorBody {
  error: {
    code: string;
    currentVersion?: number;
    conflict?: {
      aggregateType: string;
      aggregateId: string;
      currentAggregateVersion: number;
    };
  };
}

const current = { version: 7 } as StoredEventRow;

function command(
  type: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): CommandEnvelope {
  return {
    commandId: "command-1",
    eventId: "event-1",
    deviceId: "device-1",
    expectedVersion: 7,
    issuedAt: "2026-08-12T08:00:00.000Z",
    type,
    payload,
    ...overrides,
  } as unknown as CommandEnvelope;
}

async function errorBody(response: Response | null): Promise<ErrorBody> {
  expect(response).not.toBeNull();
  expect(response?.headers.get("content-type")).toBe("application/json; charset=utf-8");
  return (await response?.json()) as ErrorBody;
}

describe("event coordinator command version policy", () => {
  it("accepts cashier reordering based on any observed version up to the server version", () => {
    expect(
      validateCommandVersion(
        command(
          "REORDER_CASHIER_PRODUCTS",
          { orderedProductIds: ["product-1"] },
          { expectedVersion: 3 },
        ),
        current,
        null,
      ),
    ).toBeNull();
  });

  it("rejects a cashier version from the future", async () => {
    const response = validateCommandVersion(
      command(
        "REORDER_CASHIER_PRODUCTS",
        { orderedProductIds: ["product-1"] },
        { expectedVersion: 3, observedEventVersion: 8 },
      ),
      current,
      null,
    );

    expect(response?.status).toBe(409);
    expect(await errorBody(response)).toMatchObject({
      error: { code: "FUTURE_VERSION", currentVersion: 7 },
    });
  });

  it("accepts an exact event version when no aggregate precondition is present", () => {
    expect(
      validateCommandVersion(
        command("SET_OPERATIONAL_NOTE", { note: "synthetic note" }),
        current,
        null,
      ),
    ).toBeNull();
  });

  it("rejects a stale event version when no aggregate precondition is present", async () => {
    const response = validateCommandVersion(
      command("SET_OPERATIONAL_NOTE", { note: "synthetic note" }, { expectedVersion: 6 }),
      current,
      null,
    );

    expect(response?.status).toBe(409);
    expect(await errorBody(response)).toMatchObject({
      error: { code: "STALE_VERSION", currentVersion: 7 },
    });
  });

  it("rejects a precondition that does not identify the command target", async () => {
    const response = validateCommandVersion(
      command(
        "MARK_ON_BLOCK",
        { rotationId: "rotation-1", actualAt: "2026-08-12T08:00:00.000Z" },
        {
          preconditions: [
            { aggregateType: "ROTATION", aggregateId: "rotation-2", expectedVersion: 3 },
          ],
        },
      ),
      current,
      3,
    );

    expect(response?.status).toBe(400);
    expect(await errorBody(response)).toMatchObject({ error: { code: "INVALID_PRECONDITION" } });
  });

  it("rejects an observed event version from the future for aggregate commands", async () => {
    const response = validateCommandVersion(
      command(
        "MARK_ON_BLOCK",
        { rotationId: "rotation-1", actualAt: "2026-08-12T08:00:00.000Z" },
        {
          observedEventVersion: 8,
          preconditions: [
            { aggregateType: "ROTATION", aggregateId: "rotation-1", expectedVersion: 3 },
          ],
        },
      ),
      current,
      3,
    );

    expect(response?.status).toBe(409);
    expect(await errorBody(response)).toMatchObject({
      error: { code: "FUTURE_VERSION", currentVersion: 7 },
    });
  });

  it("distinguishes a missing aggregate from a stale aggregate", async () => {
    const aggregateCommand = command(
      "MARK_ON_BLOCK",
      { rotationId: "rotation-1", actualAt: "2026-08-12T08:00:00.000Z" },
      {
        expectedVersion: 5,
        preconditions: [
          { aggregateType: "ROTATION", aggregateId: "rotation-1", expectedVersion: 3 },
        ],
      },
    );

    const missing = validateCommandVersion(aggregateCommand, current, null);
    expect(missing?.status).toBe(404);
    expect(await errorBody(missing)).toMatchObject({ error: { code: "AGGREGATE_NOT_FOUND" } });

    const stale = validateCommandVersion(aggregateCommand, current, 4);
    expect(stale?.status).toBe(409);
    expect(await errorBody(stale)).toMatchObject({
      error: {
        code: "STALE_AGGREGATE_VERSION",
        currentVersion: 7,
        conflict: {
          aggregateType: "ROTATION",
          aggregateId: "rotation-1",
          currentAggregateVersion: 4,
        },
      },
    });
  });

  it("accepts a matching aggregate version independently of a stale event observation", () => {
    const aggregateCommand = command(
      "MARK_ON_BLOCK",
      { rotationId: "rotation-1", actualAt: "2026-08-12T08:00:00.000Z" },
      {
        expectedVersion: 5,
        preconditions: [
          { aggregateType: "ROTATION", aggregateId: "rotation-1", expectedVersion: 3 },
        ],
      },
    );

    expect(validateCommandVersion(aggregateCommand, current, 3)).toBeNull();
  });
});

describe("event coordinator planned-operation policy", () => {
  const matchingPlan: PlannedOperationRow = {
    scope_type: "EVENT",
    scope_id: "event-1",
    status: "PLANNED",
    effect_mode: "BLOCKING",
  };

  it("does not require a plan for ordinary commands", () => {
    expect(
      validatePlannedOperationLink(
        command("SET_OPERATIONAL_NOTE", { note: "synthetic note" }),
        null,
      ),
    ).toBeNull();
  });

  it("rejects planned-operation links on unsupported command types", async () => {
    const response = validatePlannedOperationLink(
      command("SET_OPERATIONAL_NOTE", {
        note: "synthetic note",
        plannedOperationId: "plan-1",
      }),
      null,
    );

    expect(response?.status).toBe(409);
    expect(await errorBody(response)).toMatchObject({
      error: { code: "PLANNED_OPERATION_LINK_NOT_SUPPORTED" },
    });
  });

  it("rejects a missing linked plan", async () => {
    const response = validatePlannedOperationLink(
      command("SET_EVENT_INTERRUPTION", {
        interrupted: true,
        plannedOperationId: "plan-1",
      }),
      null,
    );

    expect(response?.status).toBe(404);
    expect(await errorBody(response)).toMatchObject({
      error: { code: "PLANNED_OPERATION_NOT_FOUND" },
    });
  });

  it.each([
    [
      "effect mode",
      { ...matchingPlan, effect_mode: "SLOWDOWN" as const },
      "PLANNED_OPERATION_EFFECT_MISMATCH",
    ],
    ["scope", { ...matchingPlan, scope_id: "event-2" }, "PLANNED_OPERATION_SCOPE_MISMATCH"],
    [
      "activation status",
      { ...matchingPlan, status: "ACTIVE" as const },
      "PLANNED_OPERATION_STATUS_MISMATCH",
    ],
  ])("rejects a mismatching %s", async (_label, plan, expectedCode) => {
    const response = validatePlannedOperationLink(
      command("SET_EVENT_INTERRUPTION", {
        interrupted: true,
        plannedOperationId: "plan-1",
      }),
      plan,
    );

    expect(response?.status).toBe(409);
    expect(await errorBody(response)).toMatchObject({ error: { code: expectedCode } });
  });

  it("accepts activation from PLANNED and clearing from ACTIVE", () => {
    const activate = command("SET_EVENT_INTERRUPTION", {
      interrupted: true,
      plannedOperationId: "plan-1",
    });
    const clear = command("SET_EVENT_INTERRUPTION", {
      interrupted: false,
      plannedOperationId: "plan-1",
    });

    expect(validatePlannedOperationLink(activate, matchingPlan)).toBeNull();
    expect(validatePlannedOperationLink(clear, { ...matchingPlan, status: "ACTIVE" })).toBeNull();
  });
});
