import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "vite";
import { compareTechnicalStrings } from "./lib/technical-order.mjs";

const MAX_ADDITIONAL_BYTES = 50 * 1024 * 1024;
const MAX_CAPTURE_P95_MS = 50;
const MAX_RELATIVE_CPU = 0.1;
const RUNS = 1440;
const ROTATIONS = 300;
const ANCHOR_INTERVAL = 10;

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareTechnicalStrings)
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
};
const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const percentile95 = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
};
const timestamp = (tick) =>
  new Date(Date.parse("2026-08-02T08:00:00.000Z") + tick * 30_000).toISOString();

const workDirectory = mkdtempSync(join(tmpdir(), "rundflug-analysis-scale-"));
const databasePath = join(workDirectory, "scale.sqlite");
const database = new DatabaseSync(databasePath);
try {
  const migrationDirectory = new URL("../apps/worker/migrations/", import.meta.url);
  for (const migrationName of readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .toSorted(compareTechnicalStrings)) {
    database.exec(readFileSync(new URL(migrationName, migrationDirectory), "utf8"));
  }
  database.exec(`
    INSERT INTO operation_days
      (id, name, event_date, status, version, created_at, updated_at)
    VALUES ('scale-event', 'Synthetic scale event', '2026-08-02', 'ACTIVE', 1,
            '2026-08-02T08:00:00.000Z', '2026-08-02T08:00:00.000Z');
  `);
  // Model the unchanged 30-second snapshot history separately from the additional run link.
  // Foreign keys are disabled only in this isolated size fixture so 432,000 historical rows do
  // not require duplicating the unrelated operational master-data graph.
  database.exec("PRAGMA foreign_keys = OFF; DROP INDEX idx_forecast_snapshots_planning_run; BEGIN");
  const insertSnapshot = database.prepare(
    `INSERT INTO forecast_snapshots
      (id, operation_day_id, rotation_id, operation_day_version, captured_at, quality,
       lower_minutes, upper_minutes, predicted_boarding_at, predicted_departure_at,
       predicted_landing_at, predicted_completion_at)
     VALUES (?, 'scale-event', ?, 1, ?, 'STABLE', 10, 30, ?, ?, ?, ?)`,
  );
  for (let tick = 0; tick < RUNS; tick += 1) {
    const capturedAt = timestamp(tick);
    for (let rotation = 0; rotation < ROTATIONS; rotation += 1) {
      const suffix = String(rotation + 1).padStart(3, "0");
      insertSnapshot.run(
        `snapshot-${String(tick).padStart(4, "0")}-${suffix}`,
        `rotation-${suffix}`,
        capturedAt,
        capturedAt,
        capturedAt,
        capturedAt,
        capturedAt,
      );
    }
  }
  database.exec("COMMIT");
  const pageSize = database.prepare("PRAGMA page_size").get().page_size;
  const baselinePages = database.prepare("PRAGMA page_count").get().page_count;

  const insertChunk = database.prepare(
    `INSERT OR IGNORE INTO planning_chunks
      (id, operation_day_id, chunk_kind, schema_version, payload_hash, payload_json,
       byte_size, created_at)
     VALUES (?, 'scale-event', ?, 1, ?, ?, ?, ?)`,
  );
  const persistChunk = (kind, payload, createdAt) => {
    const json = canonicalJson(payload);
    const hash = sha256(json);
    const id = `planning-chunk-${sha256(`${kind}:1:${hash}`)}`;
    insertChunk.run(id, kind, hash, json, Buffer.byteLength(json), createdAt);
    return id;
  };

  const rotationInputs = Array.from({ length: ROTATIONS }, (_, index) => ({
    id: `rotation-${String(index + 1).padStart(3, "0")}`,
    status: "DRAFT",
    createdAt: "2026-08-02T08:00:00.000Z",
    calledAt: null,
    departedAt: null,
    landedAt: null,
    resourceGroupId: "resource-1",
    resourceGroupStatus: "ACTIVE",
    queueSequence: index + 1,
    referenceDurationMinutes: 20,
    productCode: "ROUND",
    aircraftType: null,
    predictedDepartureAt: null,
    predictedLandingAt: null,
    predictedCompletionAt: null,
  }));
  const contextEntries = [];
  contextEntries.push({
    kind: "EVENT_CONFIGURATION",
    partitionKey: "event:0",
    chunkId: persistChunk(
      "EVENT_CONFIGURATION",
      {
        event: {
          eventId: "scale-event",
          plannedOperationsStartAt: "2026-08-02T08:00:00.000Z",
          plannedOperationsEndAt: "2026-08-02T20:00:00.000Z",
          operationalInterrupted: false,
          emergencyMode: false,
          plannedBoardingMinutes: 5,
          plannedDeboardingMinutes: 4,
          plannedBufferMinutes: 2,
        },
        tuning: null,
        dispatchPlanningLimits: null,
      },
      timestamp(0),
    ),
  });
  for (let offset = 0; offset < ROTATIONS; offset += 50) {
    contextEntries.push({
      kind: "ROTATIONS_QUEUE",
      partitionKey: `resource-1:${offset / 50}`,
      chunkId: persistChunk(
        "ROTATIONS_QUEUE",
        rotationInputs.slice(offset, offset + 50),
        timestamp(0),
      ),
    });
    contextEntries.push({
      kind: "OPERATIONAL_CONSTRAINTS",
      partitionKey: `resource-1:${offset / 50}`,
      chunkId: persistChunk(
        "OPERATIONAL_CONSTRAINTS",
        rotationInputs.slice(offset, offset + 50).map((rotation) => ({
          id: `rotation:${rotation.id}`,
          resourceGroupId: "resource-1",
          constraints: [],
          turnaroundProfiles: [],
          confirmedTurnaroundProfile: null,
        })),
        timestamp(0),
      ),
    });
  }
  contextEntries.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.partitionKey.localeCompare(right.partitionKey),
  );
  const manifestJson = canonicalJson(contextEntries);
  const manifestHash = sha256(manifestJson);
  const contextId = `planning-context-${sha256(`scale-event:1:1:${manifestHash}`)}`;
  database
    .prepare(
      `INSERT INTO planning_contexts
        (id, operation_day_id, operation_day_version, schema_version, previous_context_id,
         manifest_json, manifest_hash, anchor_reason, created_at)
       VALUES (?, 'scale-event', 1, 1, NULL, ?, ?, 'INITIAL_RUN', ?)`,
    )
    .run(contextId, manifestJson, manifestHash, timestamp(0));

  const insertRun = database.prepare(
    `INSERT INTO planning_runs
      (id, operation_day_id, operation_day_version, context_id, previous_run_id, anchor_run_id,
       replay_distance, calculation_now, captured_at, trigger_event_type, capture_mode,
       anchor_reason, application_version, requirements_version, source_revision,
       dispatch_plan_revision, forecast_digest, forecast_semantic_digest, precall_digest,
       previous_forecast_state_chunk_id, previous_dispatch_state_chunk_id,
       dispatch_result_chunk_id, precall_result_chunk_id, duration_ms, capture_duration_ms,
       status, failure_code)
     VALUES (?, 'scale-event', 1, ?, ?, ?, ?, ?, ?, 'AUTOMATIC_FORECAST_TICK', ?, ?,
             '1.12.0', '1.12.0', 'synthetic', ?, ?, ?, ?, ?, ?, ?, ?, 20, ?, 'SUCCEEDED', NULL)`,
  );
  const captureDurations = [];
  let previousRunId = null;
  let anchorRunId = null;
  let replayDistance = 0;
  database.exec("BEGIN");
  for (let tick = 0; tick < RUNS; tick += 1) {
    let startedAt;
    const calculationNow = timestamp(tick);
    const anchor = tick % ANCHOR_INTERVAL === 0;
    const runId = `run-${String(tick).padStart(4, "0")}`;
    let previousForecastChunkId = null;
    let previousDispatchChunkId = null;
    let dispatchResultChunkId = null;
    let precallResultChunkId = null;
    if (anchor) {
      anchorRunId = runId;
      replayDistance = 0;
      const previousForecast = rotationInputs.map((rotation, index) => ({
        rotationId: rotation.id,
        predictedDepartureAt: new Date(
          Date.parse(calculationNow) + (index + 1) * 60_000,
        ).toISOString(),
        predictedLandingAt: new Date(
          Date.parse(calculationNow) + (index + 21) * 60_000,
        ).toISOString(),
        predictedCompletionAt: new Date(
          Date.parse(calculationNow) + (index + 27) * 60_000,
        ).toISOString(),
      }));
      const groups = rotationInputs.map((rotation, index) => ({
        groupId: rotation.id,
        selected: index < 75,
        dispatchOrder: index + 1,
        projectedOvertakeCount: index % 3,
        reason: index < 75 ? "SELECTED" : "NOT_IN_NEAR_DISPATCH_BATCH",
      }));
      const dispatch = {
        planId: `dispatch-${tick}`,
        revision: sha256(calculationNow),
        calculatedAt: calculationNow,
        limits: { maximumNearBatches: 3, maximumProjectedOvertakes: 2 },
        batches: Array.from({ length: 75 }, (_, index) => ({
          id: `batch-${tick}-${index}`,
          wave: Math.floor(index / 3) + 1,
          laneId: `aircraft-${(index % 3) + 1}`,
          groupIds: [rotationInputs[index * 4]?.id].filter(Boolean),
          occupiedSeats: 4,
          availableSeats: 0,
        })),
        groupDecisions: groups,
        unplannedGroups: groups.slice(75).map((entry) => ({
          groupId: entry.groupId,
          reason: "NOT_IN_NEAR_DISPATCH_BATCH",
        })),
      };
      const precallInput = rotationInputs.map((rotation, index) => ({
        id: rotation.id,
        resourceGroupId: "resource-1",
        enabled: true,
        eventActive: true,
        operationsAvailable: true,
        resourceGroupActive: true,
        resourceGroupEnabled: true,
        alreadyPrecalled: false,
        forecastCapacityStatus: "AVAILABLE",
        predictionQuality: "STABLE",
        predictedBoardingMinutes: index + 1,
        adaptiveLeadMinutes: 12,
        dispatchOrder: index + 1,
      }));
      const precallOutput = precallInput.map((entry) => ({
        id: entry.id,
        resourceGroupId: entry.resourceGroupId,
        eligible: entry.predictedBoardingMinutes <= 12,
        status: entry.predictedBoardingMinutes <= 12 ? "GO_TO_GATE" : "WAITING",
        reason: entry.predictedBoardingMinutes <= 12 ? "ELIGIBLE" : "TOO_EARLY",
      }));
      // Forecast, dispatch and precall objects already exist when capture begins in production.
      // Measure canonicalization, hashing and persistence, not construction of the synthetic input.
      startedAt = performance.now();
      previousForecastChunkId = persistChunk(
        "PREVIOUS_FORECAST_STATE",
        previousForecast,
        calculationNow,
      );
      previousDispatchChunkId = persistChunk(
        "PREVIOUS_DISPATCH_STATE",
        { revision: `previous-${tick}` },
        calculationNow,
      );
      dispatchResultChunkId = persistChunk("DISPATCH_RESULT", dispatch, calculationNow);
      precallResultChunkId = persistChunk(
        "PRECALL_RESULT",
        { input: precallInput, output: precallOutput },
        calculationNow,
      );
    } else {
      startedAt = performance.now();
      replayDistance += 1;
    }
    const forecastDigest = sha256(`${calculationNow}:forecast`);
    const semanticDigest = sha256(`${Math.floor(tick / ANCHOR_INTERVAL)}:semantic`);
    const precallDigest = sha256(`${Math.floor(tick / ANCHOR_INTERVAL)}:precall`);
    insertRun.run(
      runId,
      contextId,
      previousRunId,
      anchorRunId,
      replayDistance,
      calculationNow,
      calculationNow,
      anchor ? "ANCHOR" : "REFERENCE",
      anchor ? (tick === 0 ? "INITIAL_RUN" : "PERIODIC_ANCHOR") : null,
      sha256(`${calculationNow}:dispatch`),
      forecastDigest,
      semanticDigest,
      precallDigest,
      previousForecastChunkId,
      previousDispatchChunkId,
      dispatchResultChunkId,
      precallResultChunkId,
      performance.now() - startedAt,
    );
    captureDurations.push(performance.now() - startedAt);
    previousRunId = runId;
  }
  database.exec("COMMIT");
  database.exec(
    `DROP TRIGGER forecast_snapshots_no_update;
     UPDATE forecast_snapshots
        SET planning_run_id = 'run-' || substr(id, 10, 4);
     CREATE INDEX idx_forecast_snapshots_planning_run
       ON forecast_snapshots(planning_run_id);`,
  );

  const finalPages = database.prepare("PRAGMA page_count").get().page_count;
  const additionalBytes = (finalPages - baselinePages) * pageSize;

  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  const domain = await vite.ssrLoadModule("/packages/domain/src/index.ts");
  const forecastDurations = [];
  for (let sample = 0; sample < 40; sample += 1) {
    const now = timestamp(sample);
    const input = {
      event: {
        eventId: "scale-event",
        now,
        plannedOperationsStartAt: timestamp(0),
        plannedOperationsEndAt: "2026-08-02T20:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 4,
        plannedBufferMinutes: 2,
      },
      rotations: rotationInputs,
      capacities: [],
      durationSamples: [],
    };
    const startedAt = performance.now();
    domain.calculateForecastTimelineResult(input);
    forecastDurations.push(performance.now() - startedAt);
  }
  await vite.close();

  const captureP95Ms = percentile95(captureDurations);
  const projectedForecastCpuMs =
    (forecastDurations.reduce((sum, value) => sum + value, 0) / forecastDurations.length) * RUNS;
  const captureCpuMs = captureDurations.reduce((sum, value) => sum + value, 0);
  const relativeCpu = captureCpuMs / projectedForecastCpuMs;
  const result = {
    ok:
      additionalBytes <= MAX_ADDITIONAL_BYTES &&
      captureP95Ms <= MAX_CAPTURE_P95_MS &&
      relativeCpu <= MAX_RELATIVE_CPU,
    scenario: { hours: 12, runs: RUNS, rotations: ROTATIONS, anchorIntervalRuns: ANCHOR_INTERVAL },
    measurements: {
      additionalD1Bytes: additionalBytes,
      additionalD1Megabytes: Number((additionalBytes / 1024 / 1024).toFixed(2)),
      captureP95Ms: Number(captureP95Ms.toFixed(3)),
      relativeCpu: Number(relativeCpu.toFixed(4)),
      forecastPathP95Ms: Number(percentile95(forecastDurations).toFixed(3)),
      maximumReplayDistance: ANCHOR_INTERVAL - 1,
    },
    budgets: {
      maximumAdditionalD1Bytes: MAX_ADDITIONAL_BYTES,
      maximumCaptureP95Ms: MAX_CAPTURE_P95_MS,
      maximumRelativeCpu: MAX_RELATIVE_CPU,
      maximumForecastPathMs: 2000,
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok || percentile95(forecastDurations) > 2000) {
    throw new Error("V1120-PER-010 analysis capture budget exceeded.");
  }
} finally {
  database.close();
  rmSync(workDirectory, { recursive: true, force: true });
}
