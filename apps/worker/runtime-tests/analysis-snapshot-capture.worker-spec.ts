/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env, runInDurableObject } from "cloudflare:test";
import type { OperationBoard } from "@rundflug/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { buildAnalysisSnapshot } from "../src/analysis-snapshot";
import type { AnalysisSnapshotCaptureInput, EventCoordinator } from "../src/event-coordinator";

interface TestForecastRequest {
  eventId: string;
  triggerEventType: string;
  planningRunId?: string;
  expectedEventVersion?: number;
}

function stubForecastRecalculation(
  instance: EventCoordinator,
  implementation: (request: TestForecastRequest) => Promise<{
    planningRunId: string;
    eventVersion: number;
    dispatchPlanRevision: string;
  }>,
): void {
  const service = Reflect.get(instance, "forecastTimelineService");
  if (!service || typeof service !== "object") {
    throw new Error("Forecast timeline service unavailable.");
  }
  Reflect.set(service, "recalculateForecastTimelines", implementation);
}

const eventId = "analysis-runtime-event";
const deviceId = "analysis-runtime-device";

function captureInput(requestId: string, expectedEventVersion = 38): AnalysisSnapshotCaptureInput {
  return {
    eventId,
    requestId,
    expectedEventVersion,
    deviceId,
    actorRole: "ADMIN",
    deviceRole: "ADMIN",
  };
}

async function receiptCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM idempotency_receipts").first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

beforeEach(async () => {
  const setupSql = `
    DROP TABLE IF EXISTS idempotency_receipts;
    DROP TABLE IF EXISTS forecast_snapshots;
    DROP TABLE IF EXISTS planning_contexts;
    DROP TABLE IF EXISTS planning_runs;
    DROP TABLE IF EXISTS operation_days;

    CREATE TABLE operation_days (
      id TEXT PRIMARY KEY,
      event_date TEXT NOT NULL DEFAULT '2026-08-04',
      time_zone TEXT NOT NULL DEFAULT 'Europe/Berlin',
      version INTEGER NOT NULL
    );
    CREATE TABLE planning_runs (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      operation_day_version INTEGER NOT NULL,
      context_id TEXT NOT NULL DEFAULT 'context-38',
      previous_run_id TEXT,
      anchor_run_id TEXT NOT NULL DEFAULT '',
      replay_distance INTEGER NOT NULL DEFAULT 0,
      calculation_now TEXT NOT NULL DEFAULT '2026-08-04T08:26:25.000Z',
      captured_at TEXT NOT NULL DEFAULT '2026-08-04T08:26:25.100Z',
      trigger_event_type TEXT NOT NULL,
      capture_mode TEXT NOT NULL DEFAULT 'ANCHOR',
      source_revision TEXT NOT NULL DEFAULT 'revision-synthetic',
      dispatch_plan_revision TEXT NOT NULL,
      forecast_digest TEXT NOT NULL DEFAULT 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      precall_digest TEXT NOT NULL DEFAULT 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      duration_ms REAL NOT NULL DEFAULT 1,
      capture_duration_ms REAL,
      previous_forecast_state_chunk_id TEXT,
      previous_dispatch_state_chunk_id TEXT,
      dispatch_result_chunk_id TEXT,
      precall_result_chunk_id TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE planning_contexts (
      id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      operation_day_version INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      manifest_json TEXT NOT NULL,
      manifest_hash TEXT NOT NULL
    );
    CREATE TABLE forecast_snapshots (
      id TEXT PRIMARY KEY,
      planning_run_id TEXT NOT NULL,
      rotation_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      quality TEXT NOT NULL,
      lower_minutes INTEGER NOT NULL,
      upper_minutes INTEGER NOT NULL,
      predicted_boarding_at TEXT,
      predicted_departure_at TEXT,
      predicted_landing_at TEXT,
      predicted_completion_at TEXT,
      dispatch_plan_revision TEXT
    );
    CREATE TABLE idempotency_receipts (
      command_id TEXT PRIMARY KEY,
      operation_day_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      received_at TEXT NOT NULL,
      response_json TEXT NOT NULL
    );
    INSERT INTO operation_days (id, version) VALUES ('analysis-runtime-event', 38);
  `;
  for (const statement of setupSql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await env.DB.prepare(statement).run();
  }
});

describe("V1120-DIA-010 analysis snapshot capture coordination", () => {
  it("replays an idempotent manual request without recalculating", async () => {
    const stub = env.EVENT_COORDINATOR.getByName(`${eventId}-idempotency`);
    const calls: string[] = [];

    const outcome = await runInDurableObject(stub, async (instance: EventCoordinator) => {
      stubForecastRecalculation(instance, async (request: TestForecastRequest) => {
        calls.push(request.planningRunId ?? request.triggerEventType);
        return {
          planningRunId: request.planningRunId ?? "automatic-run",
          eventVersion: request.expectedEventVersion ?? 38,
          dispatchPlanRevision: "dispatch-revision-38",
        };
      });
      const input = captureInput("02f33a3b-1f58-4c63-a0d1-3ca0031d2de7");
      const results = await Promise.all([
        instance.captureAnalysisSnapshot(input),
        instance.captureAnalysisSnapshot(input),
      ]);
      const conflict = await instance.captureAnalysisSnapshot({
        ...input,
        expectedEventVersion: 39,
      });
      return { results, conflict };
    });

    expect(outcome.results).toEqual([
      {
        ok: true,
        planningRunId: "02f33a3b-1f58-4c63-a0d1-3ca0031d2de7",
        eventVersion: 38,
        dispatchPlanRevision: "dispatch-revision-38",
      },
      {
        ok: true,
        planningRunId: "02f33a3b-1f58-4c63-a0d1-3ca0031d2de7",
        eventVersion: 38,
        dispatchPlanRevision: "dispatch-revision-38",
      },
    ]);
    expect(outcome.conflict).toEqual({
      ok: false,
      code: "ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT",
    });
    expect(calls).toEqual(["02f33a3b-1f58-4c63-a0d1-3ca0031d2de7"]);
    expect(await receiptCount()).toBe(1);
  });

  it("preserves manual FIFO requests while coalescing automatic work", async () => {
    const stub = env.EVENT_COORDINATOR.getByName(`${eventId}-queue`);
    const calls: string[] = [];

    const results = await runInDurableObject(stub, async (instance: EventCoordinator) => {
      stubForecastRecalculation(instance, async (request: TestForecastRequest) => {
        calls.push(request.planningRunId ?? request.triggerEventType);
        return {
          planningRunId: request.planningRunId ?? `run-${request.triggerEventType}`,
          eventVersion: request.expectedEventVersion ?? 38,
          dispatchPlanRevision: "dispatch-revision-38",
        };
      });
      const schedule = Reflect.get(instance, "scheduleForecastRecalculation");
      if (typeof schedule !== "function") throw new Error("Forecast scheduler unavailable.");
      const firstAutomatic = Promise.resolve(
        Reflect.apply(schedule, instance, [eventId, "AUTOMATIC_ONE"]),
      );
      const secondAutomatic = Promise.resolve(
        Reflect.apply(schedule, instance, [eventId, "AUTOMATIC_TWO"]),
      );
      const firstManual = instance.captureAnalysisSnapshot(
        captureInput("e2276a2f-6f43-4af1-b62b-12770264f1f4"),
      );
      const secondManual = instance.captureAnalysisSnapshot(
        captureInput("30bf4cdf-e88c-4da0-bc2f-d33fbd694844"),
      );
      const manualResults = await Promise.all([firstManual, secondManual]);
      await Promise.all([firstAutomatic, secondAutomatic]);
      return manualResults;
    });

    expect(results.every((result) => result.ok)).toBe(true);
    expect(calls).toEqual([
      "e2276a2f-6f43-4af1-b62b-12770264f1f4",
      "30bf4cdf-e88c-4da0-bc2f-d33fbd694844",
      "AUTOMATIC_TWO",
    ]);
    expect(await receiptCount()).toBe(2);
  });

  it("rejects stale versions and reports persistence failures", async () => {
    const stub = env.EVENT_COORDINATOR.getByName(`${eventId}-failures`);
    const results = await runInDurableObject(stub, async (instance: EventCoordinator) => {
      stubForecastRecalculation(instance, async () => {
        throw new Error("synthetic persistence failure");
      });
      const stale = await instance.captureAnalysisSnapshot(
        captureInput("3ee6c3db-71e6-4ca2-9f13-76a187a16408", 37),
      );
      const failed = await instance.captureAnalysisSnapshot(
        captureInput("33003d8e-3f99-48e6-a97f-bd835e0d92c0"),
      );
      return { stale, failed };
    });

    expect(results.stale).toEqual({
      ok: false,
      code: "ANALYSIS_SNAPSHOT_STALE_VERSION",
      currentVersion: 38,
    });
    expect(results.failed).toEqual({
      ok: false,
      code: "ANALYSIS_SNAPSHOT_CAPTURE_FAILED",
    });
    expect(await receiptCount()).toBe(0);
  });
});

describe("V1120-DIA-020 exact planning-run export", () => {
  it("exports the requested manual run when a newer automatic run exists", async () => {
    await env.DB.prepare(
      `INSERT INTO planning_contexts
        (id, operation_day_id, operation_day_version, schema_version, manifest_json, manifest_hash)
       VALUES (?1, ?2, 38, 1, '[]', ?3)`,
    )
      .bind("context-38", eventId, "c".repeat(64))
      .run();
    await env.DB.prepare(
      `INSERT INTO planning_runs
        (id, operation_day_id, operation_day_version, context_id, previous_run_id, anchor_run_id,
         replay_distance, calculation_now, captured_at, trigger_event_type, capture_mode,
         source_revision, dispatch_plan_revision, forecast_digest, precall_digest, duration_ms,
         capture_duration_ms, status)
       VALUES (?1, ?2, 38, 'context-38', NULL, ?1, 0, ?3, ?3, 'MANUAL_DIAGNOSIS',
               'ANCHOR', 'revision-manual', 'dispatch-manual', ?4, ?5, 2, 1, 'SUCCEEDED')`,
    )
      .bind("manual-run-38", eventId, "2026-08-04T08:26:25.100Z", "a".repeat(64), "b".repeat(64))
      .run();
    await env.DB.prepare(
      `INSERT INTO planning_runs
        (id, operation_day_id, operation_day_version, context_id, previous_run_id, anchor_run_id,
         replay_distance, calculation_now, captured_at, trigger_event_type, capture_mode,
         source_revision, dispatch_plan_revision, forecast_digest, precall_digest, duration_ms,
         capture_duration_ms, status)
       VALUES ('automatic-run-38', ?1, 38, 'context-38', 'manual-run-38', 'manual-run-38',
               1, '2026-08-04T08:26:26.000Z', '2026-08-04T08:26:26.100Z',
               'AUTOMATIC_FORECAST_TICK', 'REFERENCE', 'revision-automatic',
               'dispatch-automatic', ?2, ?3, 2, 1, 'SUCCEEDED')`,
    )
      .bind(eventId, "d".repeat(64), "e".repeat(64))
      .run();

    const snapshot = await buildAnalysisSnapshot({
      env,
      eventId,
      expectedEventVersion: 38,
      planningRunId: "manual-run-38",
      operationBoard: { rotations: [] } as OperationBoard,
      capturedAt: "2026-08-04T08:26:27.000Z",
    });

    expect(snapshot.manifest.planningRunId).toBe("manual-run-38");
    expect(snapshot.manifest.sourceRevision).toBe("revision-manual");
    expect(snapshot.planning.run.trigger).toBe("MANUAL_DIAGNOSIS");
    expect(snapshot.planning.replayChain.map((run) => run.id)).toEqual(["manual-run-38"]);

    await env.DB.prepare(
      `INSERT INTO forecast_snapshots
        (id, planning_run_id, rotation_id, captured_at, quality, lower_minutes, upper_minutes,
         dispatch_plan_revision)
       VALUES ('forecast-wrong-revision', 'manual-run-38', 'rotation-synthetic',
               '2026-08-04T08:26:25.100Z', 'STABLE', 2, 4, 'dispatch-automatic')`,
    ).run();
    await expect(
      buildAnalysisSnapshot({
        env,
        eventId,
        expectedEventVersion: 38,
        planningRunId: "manual-run-38",
        operationBoard: { rotations: [] } as OperationBoard,
        capturedAt: "2026-08-04T08:26:27.000Z",
      }),
    ).rejects.toThrow("ANALYSIS_SNAPSHOT_DATA_INCOMPLETE");
  });
});
