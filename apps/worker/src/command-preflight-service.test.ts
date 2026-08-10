import { commandEnvelopeSchema } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import { CommandPreflightService } from "./command-preflight-service";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
  run: ReturnType<typeof vi.fn>;
}

function createCommand() {
  return commandEnvelopeSchema.parse({
    commandId: "550e8400-e29b-41d4-a716-446655440001",
    eventId: "synthetic-event",
    deviceId: "synthetic-device",
    issuedAt: "2026-08-10T08:00:00.000Z",
    type: "SET_RESOURCE_GROUP_NOTICE",
    expectedVersion: 7,
    payload: { resourceGroupId: "synthetic-group", note: "Synthetic notice" },
  });
}

function storedCommandResult(): string {
  return JSON.stringify({
    accepted: true,
    duplicate: false,
    event: {
      eventId: "synthetic-event",
      name: "Synthetic event",
      eventDate: "2026-08-10",
      aerodrome: "EDSY",
      timeZone: "Europe/Berlin",
      status: "ACTIVE",
      archivedAt: null,
      templateSourceId: null,
      emergencyMode: false,
      operationalInterrupted: false,
      version: 7,
      operationalNote: "",
      saleOpensAt: null,
      operationsStartAt: null,
      operationsEndAt: null,
      noShowAfterMinutes: 10,
      maxTicketDeferrals: 3,
      notificationLeadMinutes: 10,
      automaticPrecallEnabled: true,
      precallLeadMinutes: 15,
      maximumGateWaitMinutes: 30,
      precallMinimumQuality: "STABLE",
      precallGateCooldownMinutes: 5,
      referenceWeightsKg: { child: 35, normal: 75, heavy: 95 },
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 5,
      plannedBufferMinutes: 2,
      departedVisibilitySeconds: 15,
      updatedAt: "2026-08-10T08:00:00.000Z",
    },
    eventType: "RESOURCE_GROUP_NOTICE_SET",
  });
}

function createDatabase(rows: Array<Record<string, unknown> | null>): {
  db: D1Database;
  batch: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
  prepared: PreparedQuery[];
} {
  const prepared: PreparedQuery[] = [];
  const run = vi.fn(async () => ({ success: true, meta: {} }));
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => {
      const statement = { sql, parameters, run };
      prepared.push(statement);
      return statement;
    },
  }));
  const batch = vi.fn(async (statements: PreparedQuery[]) =>
    statements.map((_, index) => ({
      success: true,
      results: rows[index] ? [rows[index]] : [],
      meta: {},
    })),
  );

  // The mock intentionally implements only the D1 methods exercised by this adapter.
  const db = { prepare, batch } as unknown as D1Database;
  return { db, batch, run, prepared };
}

describe("trusted command preflight", () => {
  it("uses one batch for all reads and one call for claim renewal", async () => {
    const command = createCommand();
    const { db, batch, run, prepared } = createDatabase([
      null,
      { id: "synthetic-event", version: 7 },
      { aircraft_id: "synthetic-aircraft", revision: 9 },
    ]);
    const service = new CommandPreflightService(db);
    const now = new Date("2026-08-10T08:00:00.000Z");

    const context = await service.loadTrusted({
      command,
      deviceRole: "FLIGHT_LINE",
      operatorAccountId: "synthetic-operator",
      now,
    });
    const claim = context.reads.activeOperatorClaim;
    expect(claim).not.toBeNull();
    if (!claim) throw new Error("Expected the synthetic active claim.");
    const renewal = await service.renewActiveClaim({
      command,
      operatorAccountId: "synthetic-operator",
      claim,
      now,
    });

    expect(batch).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(context.d1CallCount + renewal.d1CallCount).toBe(2);
    expect(batch.mock.calls.length + run.mock.calls.length).toBe(2);
    expect(context.reads.statementCount).toBe(3);
    expect(prepared[0]?.sql).toContain("FROM idempotency_receipts");
    expect(prepared[1]?.sql).toContain("FROM operation_days");
    expect(prepared[2]?.sql).toContain("FROM flight_line_assist_claims");
    expect(prepared[3]?.sql).toContain("UPDATE flight_line_assist_claims");
  });

  it("returns a stored duplicate from the shared read batch", async () => {
    const command = createCommand();
    const { db, batch, run } = createDatabase([
      { response_json: storedCommandResult() },
      { id: "synthetic-event", version: 7 },
    ]);
    const service = new CommandPreflightService(db);

    const context = await service.loadTrusted({
      command,
      deviceRole: "ADMIN",
      operatorAccountId: null,
      now: new Date("2026-08-10T08:00:00.000Z"),
    });

    expect(context.duplicateResult).toMatchObject({
      accepted: true,
      duplicate: false,
      eventType: "RESOURCE_GROUP_NOTICE_SET",
    });
    expect(batch).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });
});
