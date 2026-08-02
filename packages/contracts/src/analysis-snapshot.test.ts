import { describe, expect, it } from "vitest";
import { analysisClientContextSchema, analysisSnapshotSchema } from "./index";

function validSnapshot(): unknown {
  return {
    format: "rundflug-analysis-snapshot",
    formatVersion: 1,
    manifest: {
      exportId: "export-synthetic",
      capturedAt: "2026-08-02T10:00:00.000Z",
      applicationVersion: "1.12.0",
      requirementsVersion: "1.12.0",
      sourceRevision: "revision-synthetic",
      environment: "acceptance",
      privacyProfile: "SUPPORT_SAFE",
      eventId: "event-synthetic",
      eventVersion: 7,
      eventDate: "2026-08-02",
      timeZone: "Europe/Berlin",
      planningRunId: "run-synthetic",
      planningRunEventVersion: 7,
      dispatchPlanRevision: "dispatch-synthetic",
      schemaVersions: { snapshot: 1, planningContext: 1, planningRun: 1 },
    },
    currentState: { operationBoard: { event: { id: "event-synthetic", version: 7 } } },
    planning: {
      metadata: {
        mode: "ANCHOR",
        contextId: "context-synthetic",
        anchorRunId: "run-synthetic",
        replayDistance: 0,
      },
      run: {
        id: "run-synthetic",
        eventVersion: 7,
        calculationNow: "2026-08-02T10:00:00.000Z",
        capturedAt: "2026-08-02T10:00:00.100Z",
        trigger: "MANUAL_DIAGNOSIS",
        sourceRevision: "revision-synthetic",
        dispatchPlanRevision: "dispatch-synthetic",
        forecastDigest: "a".repeat(64),
        precallDigest: "b".repeat(64),
        durationMs: 12.5,
        captureDurationMs: 3.2,
      },
      replayChain: [
        {
          id: "run-synthetic",
          previousRunId: null,
          anchorRunId: "run-synthetic",
          contextId: "context-synthetic",
          eventVersion: 7,
          replayDistance: 0,
          calculationNow: "2026-08-02T10:00:00.000Z",
          capturedAt: "2026-08-02T10:00:00.100Z",
          trigger: "MANUAL_DIAGNOSIS",
          mode: "ANCHOR",
          sourceRevision: "revision-synthetic",
          dispatchPlanRevision: "dispatch-synthetic",
          forecastDigest: "a".repeat(64),
          precallDigest: "b".repeat(64),
          previousForecastStateChunkId: null,
          previousDispatchStateChunkId: null,
          dispatchResultChunkId: null,
          precallResultChunkId: null,
        },
      ],
      context: {
        id: "context-synthetic",
        eventVersion: 7,
        schemaVersion: 1,
        manifestHash: "c".repeat(64),
        manifest: [
          {
            kind: "EVENT_CONFIGURATION",
            partitionKey: "event:0",
            chunkId: "chunk-synthetic",
          },
        ],
      },
      chunks: [
        {
          id: "chunk-synthetic",
          kind: "EVENT_CONFIGURATION",
          schemaVersion: 1,
          hash: "d".repeat(64),
          byteSize: 2,
          payload: {},
        },
      ],
      forecastSnapshots: [],
    },
    client: null,
  };
}

describe("support-safe analysis contracts", () => {
  it("accepts a strict version-one snapshot", () => {
    expect(analysisSnapshotSchema.parse(validSnapshot())).toMatchObject({
      format: "rundflug-analysis-snapshot",
      formatVersion: 1,
      client: null,
    });
  });

  it("rejects unknown fields and future versions", () => {
    expect(
      analysisSnapshotSchema.safeParse({ ...(validSnapshot() as object), sessionToken: "canary" })
        .success,
    ).toBe(false);
    expect(
      analysisSnapshotSchema.safeParse({ ...(validSnapshot() as object), formatVersion: 2 })
        .success,
    ).toBe(false);
  });

  it("does not permit credential or free-form client additions", () => {
    const context = {
      capturedAt: "2026-08-02T10:00:00.000Z",
      route: "/flight-director",
      selectedAircraftId: null,
      selectedRotationId: null,
      selectedQueueGroupIds: [],
      assignmentDialogOpen: false,
      visibleRecommendation: null,
      connectionState: "CONNECTED",
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
      displayMode: "BROWSER",
      browserFamily: "EDGE",
      browserMajorVersion: 140,
      recentUiEvents: [],
    };
    expect(analysisClientContextSchema.safeParse(context).success).toBe(true);
    expect(
      analysisClientContextSchema.safeParse({ ...context, credential: "credential-canary" })
        .success,
    ).toBe(false);
  });
});
