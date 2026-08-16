import { describe, expect, it, vi } from "vitest";
import { applyDemoSeed, createD1TestDatabase } from "../test-support/migrated-database";
import {
  type AnalysisSnapshotCaptureInput,
  AnalysisSnapshotCaptureService,
} from "./analysis-snapshot-capture-service";
import type { Env } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

function createDatabase(firstRows: Array<Record<string, unknown> | null>): {
  db: D1Database;
  prepare: ReturnType<typeof vi.fn>;
  runs: PreparedQuery[];
} {
  const runs: PreparedQuery[] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...parameters: unknown[]) => ({
      first: async () => firstRows.shift() ?? null,
      run: async () => {
        runs.push({ sql, parameters });
        return { success: true, results: [], meta: {} };
      },
    }),
  }));
  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    runs,
  };
}

function captureInput(
  overrides: Partial<AnalysisSnapshotCaptureInput> = {},
): AnalysisSnapshotCaptureInput {
  return {
    eventId: "synthetic-event",
    requestId: "550e8400-e29b-41d4-a716-446655440001",
    expectedEventVersion: 38,
    deviceId: "synthetic-admin-device",
    actorRole: "ADMIN",
    deviceRole: "ADMIN",
    ...overrides,
  };
}

function createService(
  db: D1Database,
  recalculateForecastTimelines = vi.fn(),
): AnalysisSnapshotCaptureService {
  return new AnalysisSnapshotCaptureService(
    { DB: db } as unknown as Env,
    recalculateForecastTimelines,
  );
}

describe("analysis snapshot capture service", () => {
  it("persists and replays a manual capture receipt in migrated SQLite", async () => {
    const testDatabase = createD1TestDatabase();
    try {
      applyDemoSeed(testDatabase.database);
      const recalculate = vi.fn(async () => ({
        planningRunId: "550e8400-e29b-41d4-a716-446655440081",
        eventVersion: 0,
        dispatchPlanRevision: "dispatch-revision-0",
      }));
      const service = createService(testDatabase.d1, recalculate);
      const input = captureInput({
        eventId: "demo-2026",
        requestId: "550e8400-e29b-41d4-a716-446655440081",
        expectedEventVersion: 0,
        deviceId: "technical-scaffold",
      });

      await expect(service.capture(input)).resolves.toEqual({
        ok: true,
        planningRunId: input.requestId,
        eventVersion: 0,
        dispatchPlanRevision: "dispatch-revision-0",
      });
      await expect(service.capture(input)).resolves.toEqual({
        ok: true,
        planningRunId: input.requestId,
        eventVersion: 0,
        dispatchPlanRevision: "dispatch-revision-0",
      });

      expect(recalculate).toHaveBeenCalledOnce();
      const receipt = testDatabase.database
        .prepare(
          `SELECT operation_day_id, device_id, command_type, response_json
             FROM idempotency_receipts WHERE command_id = ?1`,
        )
        .get(input.requestId) as Record<string, unknown>;
      expect(receipt).toMatchObject({
        operation_day_id: "demo-2026",
        device_id: "technical-scaffold",
        command_type: "CAPTURE_ANALYSIS_SNAPSHOT",
      });
      expect(JSON.parse(String(receipt.response_json))).toMatchObject({
        expectedEventVersion: 0,
        planningRunId: input.requestId,
      });
    } finally {
      testDatabase.close();
    }
  });

  it("rejects unauthorized sessions before reading persistence", async () => {
    const { db, prepare } = createDatabase([]);
    const recalculate = vi.fn();
    const service = createService(db, recalculate);

    const result = await service.capture(
      captureInput({ actorRole: "CASHIER", deviceRole: "CASHIER" }),
    );

    expect(result).toEqual({ ok: false, code: "SESSION_NOT_AUTHORIZED" });
    expect(prepare).not.toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
  });

  it("replays a matching idempotency receipt without recalculation", async () => {
    const { db, runs } = createDatabase([
      {
        operation_day_id: "synthetic-event",
        device_id: "synthetic-admin-device",
        command_type: "CAPTURE_ANALYSIS_SNAPSHOT",
        response_json: JSON.stringify({
          expectedEventVersion: 38,
          planningRunId: "550e8400-e29b-41d4-a716-446655440001",
          eventVersion: 38,
          dispatchPlanRevision: "dispatch-revision-38",
        }),
      },
    ]);
    const recalculate = vi.fn();
    const service = createService(db, recalculate);

    const result = await service.capture(captureInput());

    expect(result).toEqual({
      ok: true,
      planningRunId: "550e8400-e29b-41d4-a716-446655440001",
      eventVersion: 38,
      dispatchPlanRevision: "dispatch-revision-38",
    });
    expect(recalculate).not.toHaveBeenCalled();
    expect(runs).toHaveLength(0);
  });

  it("rejects stale event versions before starting forecast capture", async () => {
    const { db, runs } = createDatabase([null, null, { version: 39 }]);
    const recalculate = vi.fn();
    const service = createService(db, recalculate);

    const result = await service.capture(captureInput());

    expect(result).toEqual({
      ok: false,
      code: "ANALYSIS_SNAPSHOT_STALE_VERSION",
      currentVersion: 39,
    });
    expect(recalculate).not.toHaveBeenCalled();
    expect(runs).toHaveLength(0);
  });

  it("captures the exact manual planning run and persists its receipt", async () => {
    const { db, runs } = createDatabase([null, null, { version: 38 }]);
    const recalculate = vi.fn(async () => ({
      planningRunId: "550e8400-e29b-41d4-a716-446655440001",
      eventVersion: 38,
      dispatchPlanRevision: "dispatch-revision-38",
    }));
    const service = createService(db, recalculate);

    const result = await service.capture(captureInput());

    expect(result).toEqual({
      ok: true,
      planningRunId: "550e8400-e29b-41d4-a716-446655440001",
      eventVersion: 38,
      dispatchPlanRevision: "dispatch-revision-38",
    });
    expect(recalculate).toHaveBeenCalledWith({
      eventId: "synthetic-event",
      triggerEventType: "MANUAL_DIAGNOSIS",
      planningRunId: "550e8400-e29b-41d4-a716-446655440001",
      expectedEventVersion: 38,
    });
    expect(runs).toHaveLength(1);
    const [receipt] = runs;
    expect(receipt?.sql).toContain("INSERT INTO idempotency_receipts");
    expect(receipt?.parameters).toContain("CAPTURE_ANALYSIS_SNAPSHOT");
    expect(String(receipt?.parameters.at(-1))).toContain('"expectedEventVersion":38');
  });

  it("recovers a completed planning run and recreates the missing receipt", async () => {
    const { db, runs } = createDatabase([
      null,
      {
        operation_day_id: "synthetic-event",
        operation_day_version: 38,
        trigger_event_type: "MANUAL_DIAGNOSIS",
        dispatch_plan_revision: "dispatch-revision-38",
        status: "SUCCEEDED",
      },
    ]);
    const recalculate = vi.fn();
    const service = createService(db, recalculate);

    const result = await service.capture(captureInput());

    expect(result).toEqual({
      ok: true,
      planningRunId: "550e8400-e29b-41d4-a716-446655440001",
      eventVersion: 38,
      dispatchPlanRevision: "dispatch-revision-38",
    });
    expect(recalculate).not.toHaveBeenCalled();
    expect(runs).toHaveLength(1);
  });
});
