import type { ForecastCalculationResult, ForecastTimelinesInput } from "@rundflug/domain";
import { describe, expect, it } from "vitest";
import { createMigratedTestDatabase, type SqliteRow } from "../test-support/migrated-database";
import { BACKUP_TABLES } from "./backup";
import { sha256Hex } from "./crypto";
import { EVENT_DELETION_SQL } from "./event-deletion";
import { FACTORY_RESET_DELETE_TABLES } from "./factory-reset";
import {
  canonicalPlanningChunk,
  canonicalPlanningJson,
  completePlanningCapture,
  failPlanningCapture,
  PLANNING_CHUNK_ENTITY_LIMIT,
  PLANNING_MAX_REPLAY_DISTANCE,
  planningContextChunkValues,
  preparePlanningCapture,
} from "./planning-capture";
import type { Env } from "./types";

interface PreparedQuery {
  sql: string;
  parameters: unknown[];
}

interface PreviousRun {
  id: string;
  context_id: string;
  anchor_run_id: string | null;
  replay_distance: number;
  calculation_now: string;
  anchor_calculation_now: string | null;
  dispatch_plan_revision: string;
  forecast_digest: string;
  forecast_semantic_digest: string;
  precall_digest: string;
  source_revision: string;
}

function createPlanningDatabase(input: {
  previous?: PreviousRun | null;
  validPreviousContext?: boolean;
  existingContextId?: string | null;
  completionChanges?: number;
}) {
  const runs: PreparedQuery[] = [];
  const batches: PreparedQuery[][] = [];
  const prepare = (sql: string) => ({
    bind: (...parameters: unknown[]) => {
      const query = { sql, parameters };
      return {
        ...query,
        first: async () => {
          if (sql.includes("FROM planning_runs run")) return input.previous ?? null;
          if (sql.includes("WHERE id = ?1 AND operation_day_version")) {
            return input.validPreviousContext === false ? null : { id: parameters[0] };
          }
          if (sql.includes("WHERE operation_day_id = ?1 AND operation_day_version")) {
            return input.existingContextId ? { id: input.existingContextId } : null;
          }
          return null;
        },
        run: async () => {
          runs.push(query);
          return {
            success: true,
            results: [],
            meta: { changes: input.completionChanges ?? 1 },
          };
        },
      };
    },
  });
  const batch = async (statements: PreparedQuery[]) => {
    batches.push(statements);
    return statements.map(() => ({ success: true, results: [], meta: {} }));
  };
  return {
    env: {
      DB: { prepare, batch } as unknown as D1Database,
      SOURCE_REVISION: " revision-17 ",
    } as Env,
    runs,
    batches,
  };
}

function forecastInput(rotationCount = 1): ForecastTimelinesInput {
  return {
    event: {
      eventId: "event-synthetic",
      now: "2026-08-02T10:00:00.000Z",
      plannedOperationsStartAt: "2026-08-02T08:00:00.000Z",
      plannedOperationsEndAt: "2026-08-02T20:00:00.000Z",
      operationalInterrupted: false,
      emergencyMode: false,
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 4,
      plannedBufferMinutes: 2,
    },
    capacities: [
      {
        resourceGroupId: "resource-a",
        activeAircraft: 1,
        availabilityLanes: [
          {
            laneId: "aircraft-a:pilot-a",
            aircraftId: "aircraft-a",
            pilotId: "pilot-a",
            passengerSeats: 4,
            availableLowerAt: "2026-08-02T10:00:00.000Z",
            availableExpectedAt: "2026-08-02T10:00:00.000Z",
            availableUpperAt: "2026-08-02T10:00:00.000Z",
          },
        ],
      },
    ],
    durationSamples: [],
    rotations: Array.from({ length: rotationCount }, (_, index) => ({
      id: `rotation-${String(index).padStart(3, "0")}`,
      status: "DRAFT" as const,
      createdAt: "2026-08-02T09:00:00.000Z",
      calledAt: null,
      departedAt: null,
      landedAt: null,
      resourceGroupId: "resource-a",
      resourceGroupStatus: "ACTIVE" as const,
      queueSequence: index + 1,
      referenceDurationMinutes: 20,
      productCode: "RUNDÖ",
      aircraftType: null,
      predictedDepartureAt: null,
      predictedLandingAt: null,
      predictedCompletionAt: null,
    })),
  };
}

const calculationResult = {
  projections: [
    {
      rotationId: "rotation-000",
      forecastState: "PLANNED",
      predictionQuality: "STABLE",
      capacityStatus: "AVAILABLE",
      uncertaintyReasons: [],
      extendsBeyondOperationsEnd: false,
      overtimeMinutes: 0,
    },
  ],
  diagnostics: { dispatchPlan: { revision: "dispatch-revision-17" } },
} as unknown as ForecastCalculationResult;

async function matchingPrevious(overrides: Partial<PreviousRun> = {}): Promise<PreviousRun> {
  const forecastSemanticDigest = await sha256Hex(
    canonicalPlanningJson(
      calculationResult.projections.map((projection) => ({
        rotationId: projection.rotationId,
        forecastState: projection.forecastState,
        predictionQuality: projection.predictionQuality,
        capacityStatus: projection.capacityStatus,
        uncertaintyReasons: projection.uncertaintyReasons,
        extendsBeyondOperationsEnd: projection.extendsBeyondOperationsEnd,
        overtimeMinutes: projection.overtimeMinutes,
      })),
    ),
  );
  return {
    id: "previous-run",
    context_id: "context-17",
    anchor_run_id: "anchor-run",
    replay_distance: 2,
    calculation_now: "2026-08-12T07:59:00.000Z",
    anchor_calculation_now: "2026-08-12T07:58:00.000Z",
    dispatch_plan_revision: "dispatch-revision-17",
    forecast_digest: "full-forecast-digest",
    forecast_semantic_digest: forecastSemanticDigest,
    precall_digest: await sha256Hex("[]"),
    source_revision: "revision-17",
    ...overrides,
  };
}

async function prepareCapture(
  env: Env,
  overrides: Partial<Parameters<typeof preparePlanningCapture>[0]> = {},
) {
  return preparePlanningCapture({
    env,
    eventId: "event-synthetic",
    eventVersion: 17,
    calculationNow: "2026-08-12T08:00:00.000Z",
    capturedAt: "2026-08-12T08:00:01.000Z",
    triggerEventType: "AUTOMATIC_FORECAST_TICK",
    forecastInput: forecastInput(),
    calculationResult,
    precallInput: [],
    precallOutput: [],
    durationMs: 12,
    runId: "planning-run-17",
    ...overrides,
  });
}

describe("hybrid planning capture", () => {
  it("canonicalizes object keys while preserving array order and exact strings", async () => {
    const left = await canonicalPlanningChunk("EVENT_CONFIGURATION", {
      z: ["ä", "2026-08-02T10:00:00.000Z"],
      a: { second: 2, first: 1 },
    });
    const right = await canonicalPlanningChunk("EVENT_CONFIGURATION", {
      a: { first: 1, second: 2 },
      z: ["ä", "2026-08-02T10:00:00.000Z"],
    });
    const reordered = await canonicalPlanningChunk("EVENT_CONFIGURATION", {
      a: { first: 1, second: 2 },
      z: ["2026-08-02T10:00:00.000Z", "ä"],
    });

    expect(left).toEqual(right);
    expect(reordered.hash).not.toBe(left.hash);
    expect(left.json).toContain("ä");
    expect(left.byteSize).toBe(new TextEncoder().encode(left.json).byteLength);
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalPlanningJson({ duration: Number.POSITIVE_INFINITY })).toThrow(
      "is not finite",
    );
  });

  it("keeps calculation time outside chunks and partitions entity sets at fifty", () => {
    const chunks = planningContextChunkValues(forecastInput(121));
    const serialized = chunks.map((chunk) => canonicalPlanningJson(chunk.value)).join("\n");
    const rotationChunks = chunks.filter((chunk) => chunk.kind === "ROTATIONS_QUEUE");

    expect(serialized).not.toContain('"now"');
    expect(rotationChunks).toHaveLength(3);
    expect(
      rotationChunks.every(
        (chunk) => Array.isArray(chunk.value) && chunk.value.length <= PLANNING_CHUNK_ENTITY_LIMIT,
      ),
    ).toBe(true);
  });

  it("links snapshots and maintains append-only lifecycle coverage", () => {
    const database = createMigratedTestDatabase();
    const tableNames = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all()
      .map((row: SqliteRow) => String(row.name));
    const forecastColumns = database.prepare("PRAGMA table_info(forecast_snapshots)").all();

    expect(tableNames).toEqual(
      expect.arrayContaining(["planning_chunks", "planning_contexts", "planning_runs"]),
    );
    expect(forecastColumns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "planning_run_id" })]),
    );
    for (const table of ["planning_chunks", "planning_contexts", "planning_runs"]) {
      expect(BACKUP_TABLES).toContain(table);
      expect(
        EVENT_DELETION_SQL.some((statement) => statement.startsWith(`DELETE FROM ${table}`)),
      ).toBe(true);
      expect(FACTORY_RESET_DELETE_TABLES).toContain(table);
    }
    database.close();
  });

  it("persists an initial anchor with context and result chunks", async () => {
    const { env, runs, batches } = createPlanningDatabase({ previous: null });

    const capture = await prepareCapture(env);

    expect(capture).toMatchObject({
      runId: "planning-run-17",
      mode: "ANCHOR",
      anchorRunId: "planning-run-17",
      replayDistance: 0,
    });
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(4);
    expect(batches[1]).toHaveLength(4);
    const runInsert = runs.find(({ sql }) => sql.includes("INSERT INTO planning_runs"));
    expect(runInsert?.parameters[10]).toBe("ANCHOR");
    expect(runInsert?.parameters[11]).toBe("INITIAL_RUN");
    expect(runInsert?.parameters[14]).toBe("revision-17");
    expect(runInsert?.parameters.slice(19, 23).every((value) => typeof value === "string")).toBe(
      true,
    );
  });

  it("stores an unchanged automatic calculation as a bounded reference", async () => {
    const previous = await matchingPrevious();
    const { env, runs, batches } = createPlanningDatabase({
      previous,
      existingContextId: "context-17",
    });

    const capture = await prepareCapture(env);

    expect(capture).toMatchObject({
      mode: "REFERENCE",
      contextId: "context-17",
      anchorRunId: "anchor-run",
      replayDistance: 3,
    });
    expect(batches).toHaveLength(0);
    const runInsert = runs.find(({ sql }) => sql.includes("INSERT INTO planning_runs"));
    expect(runInsert?.parameters[10]).toBe("REFERENCE");
    expect(runInsert?.parameters[11]).toBeNull();
    expect(runInsert?.parameters.slice(19, 23)).toEqual([null, null, null, null]);
  });

  it("creates anchors for every material lineage change and replay boundary", async () => {
    const baseline = await matchingPrevious();
    const scenarios: Array<{
      expectedReason: string;
      previous?: PreviousRun;
      database?: { validPreviousContext?: boolean; existingContextId?: string | null };
      capture?: Partial<Parameters<typeof preparePlanningCapture>[0]>;
    }> = [
      {
        expectedReason: "TRIGGER:ROTATION_UPDATED",
        previous: baseline,
        capture: { triggerEventType: "ROTATION_UPDATED" },
      },
      {
        expectedReason: "CONTEXT_CHANGED",
        previous: baseline,
        database: { validPreviousContext: false },
      },
      {
        expectedReason: "SOURCE_REVISION_CHANGED",
        previous: { ...baseline, source_revision: "revision-16" },
      },
      {
        expectedReason: "DISPATCH_REVISION_CHANGED",
        previous: { ...baseline, dispatch_plan_revision: "dispatch-revision-16" },
      },
      {
        expectedReason: "PRECALL_DECISION_CHANGED",
        previous: { ...baseline, precall_digest: "old-precall-digest" },
      },
      {
        expectedReason: "FORECAST_SEMANTICS_CHANGED",
        previous: { ...baseline, forecast_semantic_digest: "old-semantic-digest" },
      },
      {
        expectedReason: "PERIODIC_ANCHOR",
        previous: {
          ...baseline,
          anchor_calculation_now: "2026-08-12T07:50:00.000Z",
        },
      },
      {
        expectedReason: "PERIODIC_ANCHOR",
        previous: {
          ...baseline,
          replay_distance: PLANNING_MAX_REPLAY_DISTANCE - 1,
        },
      },
    ];

    for (const scenario of scenarios) {
      const { env, runs } = createPlanningDatabase({
        ...(scenario.previous ? { previous: scenario.previous } : {}),
        existingContextId: scenario.database?.existingContextId ?? "context-17",
        ...(scenario.database?.validPreviousContext === undefined
          ? {}
          : { validPreviousContext: scenario.database.validPreviousContext }),
      });

      const capture = await prepareCapture(env, scenario.capture);
      const runInsert = runs.find(({ sql }) => sql.includes("INSERT INTO planning_runs"));

      expect(capture.mode).toBe("ANCHOR");
      expect(capture.replayDistance).toBe(0);
      expect(runInsert?.parameters[11]).toBe(scenario.expectedReason);
    }
  });

  it("completes a capture only when exactly one active run changes", async () => {
    const successful = createPlanningDatabase({ completionChanges: 1 });
    await expect(
      completePlanningCapture(successful.env, {
        runId: "planning-run-17",
        mode: "ANCHOR",
        contextId: "context-17",
        anchorRunId: "planning-run-17",
        replayDistance: 0,
        startedAtMs: performance.now(),
      }),
    ).resolves.toBeUndefined();

    const missing = createPlanningDatabase({ completionChanges: 0 });
    await expect(
      completePlanningCapture(missing.env, {
        runId: "planning-run-missing",
        mode: "ANCHOR",
        contextId: "context-17",
        anchorRunId: "planning-run-missing",
        replayDistance: 0,
        startedAtMs: performance.now(),
      }),
    ).rejects.toThrow("PLANNING_CAPTURE_COMPLETION_FAILED");
  });

  it("marks a capture failed with the supplied diagnostic code", async () => {
    const { env, runs } = createPlanningDatabase({});

    await failPlanningCapture(
      env,
      {
        runId: "planning-run-17",
        mode: "ANCHOR",
        contextId: "context-17",
        anchorRunId: "planning-run-17",
        replayDistance: 0,
        startedAtMs: performance.now(),
      },
      "FORECAST_WRITE_FAILED",
    );

    const failureUpdate = runs.find(({ sql }) => sql.includes("SET status = 'FAILED'"));
    expect(failureUpdate?.parameters[1]).toBe("FORECAST_WRITE_FAILED");
    expect(failureUpdate?.parameters[2]).toBe("planning-run-17");
  });
});
