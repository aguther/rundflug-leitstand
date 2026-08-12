import type { OperationBoard } from "@rundflug/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  buildAnalysisSnapshot,
  currentDispatchPlanRevision,
  supportSafeOperationBoard,
} from "./analysis-snapshot";
import snapshotSource from "./analysis-snapshot.ts?raw";
import type { Env } from "./types";

const HASH = "a".repeat(64);
const CAPTURED_AT = "2026-08-11T09:05:00.000Z";

function operationBoard(rotations: OperationBoard["rotations"] = []): OperationBoard {
  return {
    aircraft: [],
    aircraftProductTurnaroundOverrides: [],
    assistClaims: [],
    currentDeviceRole: "ADMIN",
    event: {
      aerodrome: "EDSY",
      archivedAt: null,
      automaticPrecallEnabled: true,
      departedVisibilitySeconds: 15,
      emergencyMode: false,
      eventDate: "2026-08-11",
      eventId: "event-synthetic",
      maxTicketDeferrals: 3,
      maximumGateWaitMinutes: 30,
      name: "Synthetic airfield day",
      noShowAfterMinutes: 10,
      notificationLeadMinutes: 10,
      operationalInterrupted: false,
      operationalNote: "Support-private note",
      operationsEndAt: null,
      operationsStartAt: null,
      plannedBoardingMinutes: 5,
      plannedBufferMinutes: 2,
      plannedDeboardingMinutes: 5,
      precallGateCooldownMinutes: 5,
      precallLeadMinutes: 15,
      precallMinimumQuality: "STABLE",
      referenceWeightsKg: { child: 35, heavy: 95, normal: 75 },
      saleOpensAt: null,
      status: "ACTIVE",
      templateSourceId: null,
      timeZone: "Europe/Berlin",
      updatedAt: CAPTURED_AT,
      version: 7,
    },
    gates: [],
    metrics: {
      activeDevices: 0,
      activePushSubscriptions: 0,
      activeRotations: 0,
      averageBoardingMinutes: null,
      averageFlightMinutes: null,
      averageRotationMinutes: null,
      averageTurnaroundMinutes: null,
      averageWaitMinutes: null,
      completedRotations: 0,
      informationalRevenueCents: 0,
      openTickets: 0,
      soldTickets: 0,
    },
    pilots: [],
    plannedOperations: [],
    products: [],
    queueGroups: [],
    recurringOperationalRules: [],
    resourceGroups: [],
    rotations,
  };
}

function planningRun(overrides: Record<string, unknown> = {}) {
  return {
    anchor_run_id: "run-1",
    calculation_now: CAPTURED_AT,
    capture_duration_ms: null,
    capture_mode: "REFERENCE",
    captured_at: CAPTURED_AT,
    context_id: "context-1",
    dispatch_plan_revision: "dispatch-7",
    dispatch_result_chunk_id: null,
    duration_ms: 12,
    forecast_digest: HASH,
    id: "run-1",
    operation_day_version: 7,
    precall_digest: HASH,
    precall_result_chunk_id: null,
    previous_dispatch_state_chunk_id: null,
    previous_forecast_state_chunk_id: null,
    previous_run_id: null,
    replay_distance: 0,
    source_revision: "source-7",
    trigger_event_type: "MANUAL_DIAGNOSIS",
    ...overrides,
  };
}

function snapshotEnvironment(overrides: { contextManifest?: string; eventVersion?: number } = {}) {
  const defaultManifest = JSON.stringify([
    { chunkId: "chunk-1", kind: "EVENT_CONFIGURATION", partitionKey: "event" },
  ]);
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: (..._parameters: unknown[]) => statement,
      first: async () => {
        if (sql.includes("FROM operation_days")) {
          return {
            event_date: "2026-08-11",
            time_zone: "Europe/Berlin",
            version: overrides.eventVersion ?? 7,
          };
        }
        if (sql.includes("FROM planning_runs run")) return planningRun();
        if (sql.includes("FROM planning_runs\n")) return planningRun();
        if (sql.includes("FROM planning_contexts")) {
          return {
            id: "context-1",
            manifest_hash: HASH,
            manifest_json: overrides.contextManifest ?? defaultManifest,
            operation_day_version: 7,
            schema_version: 1,
          };
        }
        return null;
      },
      all: async () => ({
        results: sql.includes("FROM planning_chunks")
          ? [
              {
                byte_size: 17,
                chunk_kind: "EVENT_CONFIGURATION",
                id: "chunk-1",
                payload_hash: HASH,
                payload_json: '{"eventVersion":7}',
                schema_version: 1,
              },
            ]
          : [
              {
                captured_at: CAPTURED_AT,
                dispatch_plan_revision: "dispatch-7",
                id: "forecast-1",
                lower_minutes: 5,
                planning_run_id: "run-1",
                predicted_boarding_at: null,
                predicted_completion_at: null,
                predicted_departure_at: null,
                predicted_landing_at: null,
                quality: "STABLE",
                rotation_id: "rotation-1",
                upper_minutes: 15,
              },
            ],
      }),
    };
    return statement;
  });
  return {
    env: {
      APP_ENV: "development",
      DB: { prepare },
    } as unknown as Env,
    prepare,
  };
}

describe("support-safe analysis snapshot", () => {
  it("V1120-SEC-010 removes free text and credential canaries recursively", () => {
    const safe = supportSafeOperationBoard({
      event: {
        id: "event-synthetic",
        name: "free-text-canary",
        operationalNote: "note-canary",
        version: 3,
      },
      products: [
        {
          id: "product-synthetic",
          publicDescription: "description-canary",
          credentialHash: "credential-canary",
          capacityStatus: "AVAILABLE",
        },
      ],
      nested: {
        guestData: "guest-canary",
        pushEndpoint: "https://push.invalid/canary",
        secretValue: "secret-canary",
      },
    } as never);
    const serialized = JSON.stringify(safe);

    expect(serialized).toContain("event-synthetic");
    expect(serialized).toContain("capacityStatus");
    expect(serialized).not.toContain("canary");
    expect(serialized).not.toContain("pushEndpoint");
  });

  it("V1120-DIA-020 binds the export to the exact manual planning run", () => {
    expect(snapshotSource).toContain("run.id = ?1");
    expect(snapshotSource).toContain("input.planningRunId");
    expect(snapshotSource).not.toContain("ORDER BY run.calculation_now DESC");
  });

  it("exports a validated, support-safe snapshot for the exact planning run", async () => {
    const { env, prepare } = snapshotEnvironment();

    const snapshot = await buildAnalysisSnapshot({
      capturedAt: CAPTURED_AT,
      env,
      eventId: "event-synthetic",
      expectedEventVersion: 7,
      operationBoard: operationBoard(),
      planningRunId: "run-1",
    });

    expect(snapshot.manifest).toMatchObject({
      capturedAt: CAPTURED_AT,
      dispatchPlanRevision: "dispatch-7",
      eventId: "event-synthetic",
      eventVersion: 7,
      planningRunId: "run-1",
      privacyProfile: "SUPPORT_SAFE",
      sourceRevision: "source-7",
    });
    expect(snapshot.planning).toMatchObject({
      chunks: [{ id: "chunk-1", payload: { eventVersion: 7 } }],
      context: { id: "context-1", manifest: [{ chunkId: "chunk-1" }] },
      forecastSnapshots: [{ id: "forecast-1", planningRunId: "run-1" }],
      metadata: { anchorRunId: "run-1", contextId: "context-1", replayDistance: 0 },
      replayChain: [{ id: "run-1", previousRunId: null }],
      run: { captureDurationMs: 0, id: "run-1" },
    });
    expect(JSON.stringify(snapshot.currentState.operationBoard)).not.toContain(
      "Support-private note",
    );
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes("run.id = ?1"))).toBe(true);
  });

  it("rejects stale event state and malformed persisted context data", async () => {
    const stale = snapshotEnvironment({ eventVersion: 8 });
    await expect(
      buildAnalysisSnapshot({
        env: stale.env,
        eventId: "event-synthetic",
        expectedEventVersion: 7,
        operationBoard: operationBoard(),
        planningRunId: "run-1",
      }),
    ).rejects.toThrow("ANALYSIS_SNAPSHOT_CHANGED");

    const malformed = snapshotEnvironment({ contextManifest: "not-json" });
    await expect(
      buildAnalysisSnapshot({
        env: malformed.env,
        eventId: "event-synthetic",
        expectedEventVersion: 7,
        operationBoard: operationBoard(),
        planningRunId: "run-1",
      }),
    ).rejects.toThrow("ANALYSIS_SNAPSHOT_DATA_INCOMPLETE");
  });

  it("requires one consistent dispatch revision across all draft rotations", () => {
    const draftRotation = (id: string, revision: string) =>
      ({
        dispatchPlan: { revision },
        id,
        status: "DRAFT",
      }) as OperationBoard["rotations"][number];

    expect(
      currentDispatchPlanRevision(operationBoard([draftRotation("rotation-1", "dispatch-7")])),
    ).toBe("dispatch-7");
    expect(() =>
      currentDispatchPlanRevision(
        operationBoard([
          draftRotation("rotation-1", "dispatch-7"),
          draftRotation("rotation-2", "dispatch-8"),
        ]),
      ),
    ).toThrow("ANALYSIS_SNAPSHOT_DATA_INCOMPLETE");
  });
});
