import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { createServer } from "vite";
import {
  archiveModel,
  canonicalJson,
  replayAnalysisPackage,
  verifyIntegrity,
} from "./replay_analysis_package.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const payload = { event: { eventId: "synthetic-event" }, tuning: null };
const payloadHash = sha256(canonicalJson(payload));
const chunkHashInput = `EVENT_CONFIGURATION:1:${payloadHash}`;
const chunkId = `planning-chunk-${sha256(chunkHashInput)}`;
const chunk = {
  id: chunkId,
  kind: "EVENT_CONFIGURATION",
  schemaVersion: 1,
  hash: payloadHash,
  byteSize: Buffer.byteLength(canonicalJson(payload)),
  payload,
};
const manifest = [{ kind: "EVENT_CONFIGURATION", partitionKey: "event:0", chunkId }];
const context = {
  id: "context-synthetic",
  eventVersion: 1,
  schemaVersion: 1,
  manifestHash: sha256(canonicalJson(manifest)),
  manifest,
};
const run = {
  id: "run-synthetic",
  previousRunId: null,
  anchorRunId: "run-synthetic",
  contextId: context.id,
  eventVersion: 1,
  replayDistance: 0,
  calculationNow: "2026-08-02T10:00:00.000Z",
  capturedAt: "2026-08-02T10:00:00.100Z",
  trigger: "MANUAL_DIAGNOSIS",
  mode: "ANCHOR",
  sourceRevision: "synthetic",
  dispatchPlanRevision: "synthetic",
  forecastDigest: "a".repeat(64),
  precallDigest: "b".repeat(64),
  previousForecastStateChunkId: null,
  previousDispatchStateChunkId: null,
  dispatchResultChunkId: null,
  precallResultChunkId: null,
  status: "SUCCEEDED",
};

const verified = verifyIntegrity({ chunks: [chunk], contexts: [context], runs: [run] });
assert.equal(verified.chunkById.size, 1);
assert.equal(verified.runById.size, 1);

const rawChunk = {
  id: chunk.id,
  chunk_kind: chunk.kind,
  schema_version: chunk.schemaVersion,
  payload_hash: chunk.hash,
  byte_size: chunk.byteSize,
  payload_json: JSON.stringify(chunk.payload),
};
const rawContext = {
  id: context.id,
  operation_day_version: context.eventVersion,
  schema_version: context.schemaVersion,
  manifest_hash: context.manifestHash,
  manifest_json: JSON.stringify(context.manifest),
};
const rawRun = {
  id: run.id,
  previous_run_id: run.previousRunId,
  anchor_run_id: run.anchorRunId,
  context_id: run.contextId,
  operation_day_version: run.eventVersion,
  replay_distance: run.replayDistance,
  calculation_now: run.calculationNow,
  captured_at: run.capturedAt,
  trigger_event_type: run.trigger,
  capture_mode: run.mode,
  source_revision: run.sourceRevision,
  dispatch_plan_revision: run.dispatchPlanRevision,
  forecast_digest: run.forecastDigest,
  precall_digest: run.precallDigest,
  previous_forecast_state_chunk_id: run.previousForecastStateChunkId,
  previous_dispatch_state_chunk_id: run.previousDispatchStateChunkId,
  dispatch_result_chunk_id: run.dispatchResultChunkId,
  precall_result_chunk_id: run.precallResultChunkId,
  status: run.status,
};
const coldFiles = {
  "planning/chunks.ndjson": `${JSON.stringify(rawChunk)}\n`,
  "planning/contexts.ndjson": `${JSON.stringify(rawContext)}\n`,
  "planning/runs.ndjson": `${JSON.stringify(rawRun)}\n`,
  "history/forecast-snapshots.ndjson": "",
};
const coldEntryDescriptors = Object.entries(coldFiles).map(([path, text]) => ({
  path,
  encoding: "ndjson",
  rowCount: text ? 1 : 0,
  byteCount: Buffer.byteLength(text),
  sha256: sha256(text),
}));
const coldContinuation = {
  terminal: true,
  continuationRunId: null,
  continuationContextId: null,
  previousRunId: null,
  anchorRunId: null,
  previousContextId: null,
};
const coldContinuationBytes = strToU8(JSON.stringify(coldContinuation));
const coldPackage = zipSync({
  ...Object.fromEntries(Object.entries(coldFiles).map(([path, text]) => [path, strToU8(text)])),
  "continuation.json": coldContinuationBytes,
  "manifest.json": strToU8(
    JSON.stringify({
      format: "rundflug-planning-history",
      formatVersion: 1,
      continuation: coldContinuation,
      continuationReceipt: {
        path: "continuation.json",
        encoding: "json",
        rowCount: 1,
        byteCount: coldContinuationBytes.byteLength,
        sha256: sha256(coldContinuationBytes),
      },
      entries: coldEntryDescriptors,
    }),
  ),
});
const outerEntries = new Map([
  [
    "manifest.json",
    strToU8(
      JSON.stringify({
        format: "rundflug-analysis-day-archive",
        formatVersion: 2,
        sourceRevision: "synthetic",
        applicationVersion: "1.12.0",
        planningHistory: {
          packages: [
            {
              path: "planning-history/cold.zip",
              compactionId: "cold",
              sha256: sha256(coldPackage),
              rowCounts: Object.fromEntries(
                coldEntryDescriptors.map((entry) => [entry.path, entry.rowCount]),
              ),
            },
          ],
        },
      }),
    ),
  ],
  ["README.md", strToU8("synthetic")],
  ["snapshot/event.json", strToU8('{"id":"synthetic-event"}')],
  ["planning/chunks.ndjson", new Uint8Array()],
  ["planning/contexts.ndjson", new Uint8Array()],
  ["planning/runs.ndjson", new Uint8Array()],
  ["history/forecast-snapshots.ndjson", new Uint8Array()],
  ["planning-history/cold.zip", coldPackage],
]);
const v2Archive = archiveModel(outerEntries);
const verifiedV2 = verifyIntegrity(v2Archive);
assert.equal(verifiedV2.runById.size, 1);
const legacyArchiveEntry = (path, bytes) => {
  if (path === "manifest.json") {
    return strToU8(
      JSON.stringify({
        format: "rundflug-analysis-day-archive",
        formatVersion: 1,
        sourceRevision: "synthetic",
        applicationVersion: "1.12.0",
      }),
    );
  }
  if (path === "planning/chunks.ndjson") return strToU8(`${JSON.stringify(rawChunk)}\n`);
  if (path === "planning/contexts.ndjson") return strToU8(`${JSON.stringify(rawContext)}\n`);
  if (path === "planning/runs.ndjson") return strToU8(`${JSON.stringify(rawRun)}\n`);
  return bytes;
};
const v1Archive = archiveModel(
  new Map(
    [...outerEntries]
      .filter(([path]) => path !== "planning-history/cold.zip")
      .map(([path, bytes]) => [path, legacyArchiveEntry(path, bytes)]),
  ),
);
assert.equal(verifyIntegrity(v1Archive).runById.size, 1);

assert.throws(
  () =>
    verifyIntegrity({
      chunks: [{ ...chunk, hash: "0".repeat(64) }],
      contexts: [context],
      runs: [run],
    }),
  (error) => error?.code === "ANALYSIS_CHUNK_HASH_MISMATCH",
);
assert.throws(
  () =>
    verifyIntegrity({
      chunks: [chunk],
      contexts: [context],
      runs: [{ ...run, replayDistance: 11 }],
    }),
  (error) => error?.code === "ANALYSIS_REPLAY_DISTANCE_INVALID",
);

const makeChunk = (kind, value) => {
  const json = canonicalJson(value);
  const hash = sha256(json);
  const identityHashInput = `${kind}:1:${hash}`;
  return {
    id: `planning-chunk-${sha256(identityHashInput)}`,
    kind,
    schemaVersion: 1,
    hash,
    byteSize: Buffer.byteLength(json),
    payload: value,
  };
};

const temporaryDirectory = mkdtempSync(join(tmpdir(), "rundflug-analysis-replay-"));
try {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  const domain = await vite.ssrLoadModule("/packages/domain/src/index.ts");
  const calculationNow = "2026-08-02T10:00:00.000Z";
  const rotation = {
    id: "rotation-replay",
    status: "DRAFT",
    createdAt: "2026-08-02T09:00:00.000Z",
    calledAt: null,
    departedAt: null,
    landedAt: null,
    resourceGroupId: "resource-replay",
    resourceGroupStatus: "ACTIVE",
    queueSequence: 1,
    referenceDurationMinutes: 20,
    productCode: "R",
    aircraftType: null,
    predictedDepartureAt: null,
    predictedLandingAt: null,
    predictedCompletionAt: null,
  };
  const forecastInput = {
    event: {
      eventId: "event-replay",
      now: calculationNow,
      plannedOperationsStartAt: "2026-08-02T08:00:00.000Z",
      plannedOperationsEndAt: "2026-08-02T20:00:00.000Z",
      operationalInterrupted: false,
      emergencyMode: false,
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 4,
      plannedBufferMinutes: 2,
    },
    rotations: [rotation],
    capacities: [],
    durationSamples: [],
  };
  const calculated = domain.calculateForecastTimelineResult(forecastInput);
  await vite.close();

  const eventConfiguration = makeChunk("EVENT_CONFIGURATION", {
    event: Object.fromEntries(Object.entries(forecastInput.event).filter(([key]) => key !== "now")),
    tuning: null,
    dispatchPlanningLimits: null,
  });
  const rotations = makeChunk("ROTATIONS_QUEUE", [rotation]);
  const operationalConstraints = makeChunk("OPERATIONAL_CONSTRAINTS", [
    {
      id: "rotation:rotation-replay",
      resourceGroupId: "resource-replay",
      constraints: [],
      turnaroundProfiles: [],
      confirmedTurnaroundProfile: null,
    },
  ]);
  const previousForecast = makeChunk("PREVIOUS_FORECAST_STATE", [
    {
      rotationId: "rotation-replay",
      predictedDepartureAt: null,
      predictedLandingAt: null,
      predictedCompletionAt: null,
    },
  ]);
  const previousDispatch = makeChunk("PREVIOUS_DISPATCH_STATE", null);
  const dispatchResult = makeChunk("DISPATCH_RESULT", calculated.diagnostics.dispatchPlan);
  const precallResult = makeChunk("PRECALL_RESULT", { input: [], output: [] });
  const chunks = [
    eventConfiguration,
    rotations,
    operationalConstraints,
    previousForecast,
    previousDispatch,
    dispatchResult,
    precallResult,
  ];
  const contextManifest = [
    { kind: "EVENT_CONFIGURATION", partitionKey: "event:0", chunkId: eventConfiguration.id },
    {
      kind: "OPERATIONAL_CONSTRAINTS",
      partitionKey: "resource-replay:0",
      chunkId: operationalConstraints.id,
    },
    { kind: "ROTATIONS_QUEUE", partitionKey: "resource-replay:0", chunkId: rotations.id },
  ].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.partitionKey.localeCompare(right.partitionKey),
  );
  const replayRun = {
    id: "run-replay",
    previousRunId: null,
    anchorRunId: "run-replay",
    contextId: "context-replay",
    eventVersion: 1,
    replayDistance: 0,
    calculationNow,
    capturedAt: "2026-08-02T10:00:00.100Z",
    trigger: "MANUAL_DIAGNOSIS",
    mode: "ANCHOR",
    sourceRevision: "synthetic",
    dispatchPlanRevision: calculated.diagnostics.dispatchPlan.revision,
    forecastDigest: sha256(canonicalJson(calculated.projections)),
    precallDigest: sha256(canonicalJson([])),
    previousForecastStateChunkId: previousForecast.id,
    previousDispatchStateChunkId: previousDispatch.id,
    dispatchResultChunkId: dispatchResult.id,
    precallResultChunkId: precallResult.id,
  };
  const snapshot = {
    format: "rundflug-analysis-snapshot",
    formatVersion: 1,
    manifest: { sourceRevision: "synthetic", applicationVersion: "1.12.0" },
    planning: {
      context: {
        id: "context-replay",
        eventVersion: 1,
        schemaVersion: 1,
        manifestHash: sha256(canonicalJson(contextManifest)),
        manifest: contextManifest,
      },
      replayChain: [replayRun],
      chunks,
      forecastSnapshots: calculated.projections.map((projection, index) => ({
        id: `snapshot-${index}`,
        planningRunId: replayRun.id,
        rotationId: projection.rotationId,
        plannedBoardingAt: projection.plannedBoardingAt,
        plannedDepartureAt: projection.plannedDepartureAt,
        plannedLandingAt: projection.plannedLandingAt,
        plannedCompletionAt: projection.plannedCompletionAt,
        predictedBoardingAt: projection.predictedBoardingAt,
        predictedDepartureAt: projection.predictedDepartureAt,
        predictedLandingAt: projection.predictedLandingAt,
        predictedCompletionAt: projection.predictedCompletionAt,
        forecastState: projection.forecastState,
        extendsBeyondOperationsEnd: projection.extendsBeyondOperationsEnd,
        overtimeMinutes: projection.overtimeMinutes,
        quality: projection.predictionQuality,
        lowerMinutes: projection.predictionLowerMinutes,
        upperMinutes: projection.predictionUpperMinutes,
        capacityStatus: projection.capacityStatus,
        uncertaintyReasons: projection.uncertaintyReasons,
        dispatchPlanRevision: projection.dispatchPlanRevision,
      })),
    },
  };
  const snapshotPath = join(temporaryDirectory, "snapshot.json");
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  const replay = await replayAnalysisPackage({
    input: snapshotPath,
    runId: null,
    all: true,
    allowVersionMismatch: true,
    output: null,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.targetsVerified, 1);

  const tamperedPath = join(temporaryDirectory, "tampered.json");
  snapshot.planning.chunks[0].payload.event.eventId = "tampered-event";
  writeFileSync(tamperedPath, JSON.stringify(snapshot));
  await assert.rejects(
    replayAnalysisPackage({
      input: tamperedPath,
      runId: null,
      all: true,
      allowVersionMismatch: true,
      output: null,
    }),
    (error) => error?.code === "ANALYSIS_CHUNK_HASH_MISMATCH",
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

process.stdout.write("Analysis replay integrity verification passed.\n");
