#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, Unzip, UnzipInflate } from "fflate";
import { createServer } from "vite";
import { compareTechnicalStrings } from "./lib/technical-order.mjs";
import { GIT_EXECUTABLE } from "./lib/tool-executables.mjs";

class ReplayError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReplayError";
    this.code = code;
    this.details = details;
  }
}

function parseArguments(argv) {
  const options = {
    input: null,
    runId: null,
    all: false,
    allowVersionMismatch: false,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--run-id") options.runId = argv[++index] ?? null;
    else if (value === "--all") options.all = true;
    else if (value === "--allow-version-mismatch") options.allowVersionMismatch = true;
    else if (value === "--output") options.output = argv[++index] ?? null;
    else if (!value.startsWith("-") && options.input === null) options.input = value;
    else
      throw new ReplayError("ANALYSIS_REPLAY_ARGUMENT_INVALID", `Unbekanntes Argument: ${value}`);
  }
  if (!options.input) {
    throw new ReplayError(
      "ANALYSIS_REPLAY_INPUT_REQUIRED",
      "Verwendung: npm run analysis:replay -- <snapshot.json|archive.zip> [--run-id <id>|--all]",
    );
  }
  if (options.all && options.runId) {
    throw new ReplayError(
      "ANALYSIS_REPLAY_ARGUMENT_INVALID",
      "--all und --run-id schließen sich aus.",
    );
  }
  return options;
}

function canonicalValue(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ReplayError("ANALYSIS_NONFINITE_VALUE", path);
    return value;
  }
  if (Array.isArray(value))
    return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`));
  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort(compareTechnicalStrings)) {
      if (value[key] !== undefined) output[key] = canonicalValue(value[key], `${path}.${key}`);
    }
    return output;
  }
  throw new ReplayError("ANALYSIS_VALUE_INVALID", path);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function firstDifference(expected, actual, path = "$") {
  if (Object.is(expected, actual)) return null;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort(
      compareTechnicalStrings,
    );
    for (const key of keys) {
      const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return { path, expected, actual };
}

async function unzipEntries(filePath) {
  return new Promise((resolveEntries, reject) => {
    const entries = new Map();
    let pendingFiles = 0;
    let inputEnded = false;
    let settled = false;
    const completeIfReady = () => {
      if (!settled && inputEnded && pendingFiles === 0) {
        settled = true;
        resolveEntries(entries);
      }
    };
    const unzip = new Unzip((file) => {
      pendingFiles += 1;
      const chunks = [];
      let byteLength = 0;
      file.ondata = (error, data, final) => {
        if (error && !settled) {
          settled = true;
          reject(new ReplayError("ANALYSIS_ZIP_CORRUPT", error.message));
          return;
        }
        if (data.byteLength > 0) {
          chunks.push(data.slice());
          byteLength += data.byteLength;
        }
        if (final) {
          const bytes = new Uint8Array(byteLength);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          entries.set(file.name, bytes);
          pendingFiles -= 1;
          completeIfReady();
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    const input = createReadStream(filePath);
    input.on("data", (data) => unzip.push(new Uint8Array(data), false));
    input.on("error", (error) =>
      reject(new ReplayError("ANALYSIS_INPUT_READ_FAILED", error.message)),
    );
    input.on("end", () => {
      try {
        unzip.push(new Uint8Array(), true);
        inputEnded = true;
        completeIfReady();
      } catch (error) {
        reject(new ReplayError("ANALYSIS_ZIP_CORRUPT", error.message));
      }
    });
  });
}

function entryText(entries, path, required = true) {
  const bytes = entries.get(path);
  if (!bytes) {
    if (!required) return null;
    throw new ReplayError("ANALYSIS_ENTRY_MISSING", `Pflichteintrag fehlt: ${path}`, { path });
  }
  return strFromU8(bytes);
}

function parseJson(text, code, path) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ReplayError(code, `Ungültiges JSON in ${path}: ${error.message}`, { path });
  }
}

function parseNdjson(entries, path) {
  const text = entryText(entries, path);
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => parseJson(line, "ANALYSIS_NDJSON_INVALID", `${path}:${index + 1}`));
}

function normalizeArchiveRun(row) {
  return {
    id: row.id,
    previousRunId: row.previous_run_id,
    anchorRunId: row.anchor_run_id,
    contextId: row.context_id,
    eventVersion: row.operation_day_version,
    replayDistance: row.replay_distance,
    calculationNow: row.calculation_now,
    capturedAt: row.captured_at,
    trigger: row.trigger_event_type,
    mode: row.capture_mode,
    sourceRevision: row.source_revision,
    dispatchPlanRevision: row.dispatch_plan_revision,
    forecastDigest: row.forecast_digest,
    precallDigest: row.precall_digest,
    previousForecastStateChunkId: row.previous_forecast_state_chunk_id,
    previousDispatchStateChunkId: row.previous_dispatch_state_chunk_id,
    dispatchResultChunkId: row.dispatch_result_chunk_id,
    precallResultChunkId: row.precall_result_chunk_id,
    status: row.status,
  };
}

function archiveModel(entries) {
  const allowedRoots = new Set([
    "manifest.json",
    "README.md",
    "snapshot",
    "planning",
    "history",
    "state",
    "reports",
  ]);
  for (const path of entries.keys()) {
    const root = path.includes("/") ? path.slice(0, path.indexOf("/")) : path;
    if (!allowedRoots.has(root)) {
      throw new ReplayError("ANALYSIS_ENTRY_UNKNOWN", `Unbekannter Root-Eintrag: ${path}`, {
        path,
      });
    }
  }
  const manifest = parseJson(
    entryText(entries, "manifest.json"),
    "ANALYSIS_MANIFEST_INVALID",
    "manifest.json",
  );
  if (manifest.format !== "rundflug-analysis-day-archive" || manifest.formatVersion !== 1) {
    throw new ReplayError(
      "ANALYSIS_FORMAT_UNSUPPORTED",
      "Tagesarchivformat wird nicht unterstützt.",
    );
  }
  for (const required of [
    "README.md",
    "snapshot/event.json",
    "planning/chunks.ndjson",
    "planning/contexts.ndjson",
    "planning/runs.ndjson",
    "history/forecast-snapshots.ndjson",
  ]) {
    entryText(entries, required);
  }
  const chunks = parseNdjson(entries, "planning/chunks.ndjson").map((row) => ({
    id: row.id,
    kind: row.chunk_kind,
    schemaVersion: row.schema_version,
    hash: row.payload_hash,
    byteSize: row.byte_size,
    payload: parseJson(row.payload_json, "ANALYSIS_CHUNK_JSON_INVALID", row.id),
  }));
  const contexts = parseNdjson(entries, "planning/contexts.ndjson").map((row) => ({
    id: row.id,
    eventVersion: row.operation_day_version,
    schemaVersion: row.schema_version,
    manifestHash: row.manifest_hash,
    manifest: parseJson(row.manifest_json, "ANALYSIS_CONTEXT_MANIFEST_INVALID", row.id),
  }));
  return {
    kind: "archive",
    manifest,
    sourceRevision: manifest.sourceRevision,
    applicationVersion: manifest.applicationVersion,
    chunks,
    contexts,
    runs: parseNdjson(entries, "planning/runs.ndjson").map(normalizeArchiveRun),
    snapshots: parseNdjson(entries, "history/forecast-snapshots.ndjson"),
  };
}

function snapshotModel(snapshot) {
  if (snapshot.format !== "rundflug-analysis-snapshot" || snapshot.formatVersion !== 1) {
    throw new ReplayError(
      "ANALYSIS_FORMAT_UNSUPPORTED",
      "Momentaufnahmeformat wird nicht unterstützt.",
    );
  }
  if (!snapshot.planning?.replayChain || !Array.isArray(snapshot.planning.replayChain)) {
    throw new ReplayError(
      "ANALYSIS_REPLAY_CHAIN_MISSING",
      "Die Momentaufnahme enthält keine Replay-Kette.",
    );
  }
  return {
    kind: "snapshot",
    manifest: snapshot.manifest,
    sourceRevision: snapshot.manifest.sourceRevision,
    applicationVersion: snapshot.manifest.applicationVersion,
    chunks: snapshot.planning.chunks,
    contexts: [snapshot.planning.context],
    runs: snapshot.planning.replayChain.map((run) => ({ ...run, status: "SUCCEEDED" })),
    snapshots: snapshot.planning.forecastSnapshots,
  };
}

async function loadModel(inputPath) {
  const absolutePath = resolve(inputPath);
  if (absolutePath.toLowerCase().endsWith(".zip"))
    return archiveModel(await unzipEntries(absolutePath));
  return snapshotModel(
    parseJson(readFileSync(absolutePath, "utf8"), "ANALYSIS_SNAPSHOT_INVALID", absolutePath),
  );
}

function verifyVersions(model, allowMismatch) {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const git = spawnSync(GIT_EXECUTABLE, ["rev-parse", "HEAD"], { encoding: "utf8" });
  const localSourceRevision =
    process.env.SOURCE_REVISION || (git.status === 0 ? git.stdout.trim() : "unknown");
  const differences = [];
  if (model.applicationVersion !== packageJson.version) {
    differences.push({
      field: "applicationVersion",
      expected: model.applicationVersion,
      actual: packageJson.version,
    });
  }
  if (model.sourceRevision !== localSourceRevision) {
    differences.push({
      field: "sourceRevision",
      expected: model.sourceRevision,
      actual: localSourceRevision,
    });
  }
  if (differences.length > 0 && !allowMismatch) {
    throw new ReplayError(
      "ANALYSIS_SOURCE_VERSION_MISMATCH",
      "Export und ausgecheckter Quellstand stimmen nicht überein. Historischen Commit auschecken oder --allow-version-mismatch verwenden.",
      { differences },
    );
  }
  return differences;
}

function verifyIntegrity(model) {
  const chunkById = new Map();
  for (const chunk of model.chunks) {
    if (chunkById.has(chunk.id)) throw new ReplayError("ANALYSIS_CHUNK_DUPLICATE", chunk.id);
    const json = canonicalJson(chunk.payload);
    const hash = sha256(json);
    const identity = `planning-chunk-${sha256(`${chunk.kind}:${chunk.schemaVersion}:${hash}`)}`;
    if (hash !== chunk.hash) {
      throw new ReplayError("ANALYSIS_CHUNK_HASH_MISMATCH", `Chunk-Hash weicht ab: ${chunk.id}`, {
        chunkId: chunk.id,
      });
    }
    if (identity !== chunk.id) {
      throw new ReplayError("ANALYSIS_CHUNK_ID_MISMATCH", `Chunk-ID weicht ab: ${chunk.id}`, {
        chunkId: chunk.id,
      });
    }
    if (Buffer.byteLength(json, "utf8") !== chunk.byteSize) {
      throw new ReplayError("ANALYSIS_CHUNK_SIZE_MISMATCH", `Chunk-Größe weicht ab: ${chunk.id}`, {
        chunkId: chunk.id,
      });
    }
    chunkById.set(chunk.id, chunk);
  }
  const contextById = new Map();
  for (const context of model.contexts) {
    if (!Array.isArray(context.manifest))
      throw new ReplayError("ANALYSIS_CONTEXT_MANIFEST_INVALID", context.id);
    if (sha256(canonicalJson(context.manifest)) !== context.manifestHash) {
      throw new ReplayError(
        "ANALYSIS_CONTEXT_HASH_MISMATCH",
        `Kontext-Hash weicht ab: ${context.id}`,
        { contextId: context.id },
      );
    }
    for (const entry of context.manifest) {
      const chunk = chunkById.get(entry.chunkId);
      if (!chunk || chunk.kind !== entry.kind) {
        throw new ReplayError(
          "ANALYSIS_CONTEXT_CHUNK_MISSING",
          `Kontext referenziert ungültigen Chunk: ${entry.chunkId}`,
          { contextId: context.id, chunkId: entry.chunkId },
        );
      }
    }
    contextById.set(context.id, context);
  }
  const runById = new Map(
    model.runs.filter((run) => run.status === "SUCCEEDED").map((run) => [run.id, run]),
  );
  for (const run of runById.values()) {
    if (run.replayDistance < 0 || run.replayDistance > 10)
      throw new ReplayError("ANALYSIS_REPLAY_DISTANCE_INVALID", run.id);
    if (!contextById.has(run.contextId))
      throw new ReplayError("ANALYSIS_RUN_CONTEXT_MISSING", run.id);
    for (const chunkId of [
      run.previousForecastStateChunkId,
      run.previousDispatchStateChunkId,
      run.dispatchResultChunkId,
      run.precallResultChunkId,
    ]) {
      if (chunkId && !chunkById.has(chunkId))
        throw new ReplayError("ANALYSIS_RUN_CHUNK_MISSING", `${run.id}: ${chunkId}`);
    }
    let cursor = run;
    let distance = 0;
    const seen = new Set();
    while (cursor.id !== run.anchorRunId) {
      if (seen.has(cursor.id) || distance >= 10 || !cursor.previousRunId) {
        throw new ReplayError("ANALYSIS_REPLAY_CHAIN_INVALID", run.id);
      }
      seen.add(cursor.id);
      cursor = runById.get(cursor.previousRunId);
      if (!cursor) throw new ReplayError("ANALYSIS_REPLAY_CHAIN_MISSING", run.id);
      distance += 1;
    }
    if (distance !== run.replayDistance || cursor.mode !== "ANCHOR") {
      throw new ReplayError("ANALYSIS_REPLAY_CHAIN_INVALID", run.id, {
        expectedDistance: run.replayDistance,
        actualDistance: distance,
      });
    }
  }
  return { chunkById, contextById, runById };
}

function clone(value) {
  return structuredClone(value);
}

function reconstructInput(context, chunkById, calculationNow, forecastState, dispatchState) {
  const chunks = context.manifest.map((entry) => chunkById.get(entry.chunkId));
  const eventChunk = chunks.find((chunk) => chunk.kind === "EVENT_CONFIGURATION");
  if (!eventChunk) throw new ReplayError("ANALYSIS_EVENT_CONTEXT_MISSING", context.id);
  const configuration = clone(eventChunk.payload);
  const rotations = chunks
    .filter((chunk) => chunk.kind === "ROTATIONS_QUEUE")
    .flatMap((chunk) => clone(chunk.payload));
  const capacities = chunks
    .filter((chunk) => chunk.kind === "CAPACITIES")
    .flatMap((chunk) => clone(chunk.payload));
  const durationSamples = chunks
    .filter((chunk) => chunk.kind === "DURATION_SAMPLES")
    .flatMap((chunk) => clone(chunk.payload));
  const operational = chunks
    .filter((chunk) => chunk.kind === "OPERATIONAL_CONSTRAINTS")
    .flatMap((chunk) => clone(chunk.payload));
  for (const entry of operational) {
    if (String(entry.id).startsWith("rotation:")) {
      const rotation = rotations.find((candidate) => candidate.id === String(entry.id).slice(9));
      if (rotation) {
        rotation.constraints = entry.constraints;
        rotation.turnaroundProfiles = entry.turnaroundProfiles;
        rotation.confirmedTurnaroundProfile = entry.confirmedTurnaroundProfile;
      }
    } else if (String(entry.id).startsWith("capacity:")) {
      const capacity = capacities.find(
        (candidate) => candidate.resourceGroupId === entry.resourceGroupId,
      );
      if (capacity) {
        capacity.sharedConstraints = entry.sharedConstraints;
        for (const laneState of entry.lanes ?? []) {
          const lane = capacity.availabilityLanes?.find(
            (candidate) => candidate.laneId === laneState.laneId,
          );
          if (lane) {
            lane.constraints = laneState.constraints;
            lane.recurringConstraints = laneState.recurringConstraints;
          }
        }
      }
    }
  }
  const stateByRotation = new Map((forecastState ?? []).map((entry) => [entry.rotationId, entry]));
  for (const rotation of rotations) {
    const prior = stateByRotation.get(rotation.id);
    if (prior) {
      rotation.predictedDepartureAt = prior.predictedDepartureAt;
      rotation.predictedLandingAt = prior.predictedLandingAt;
      rotation.predictedCompletionAt = prior.predictedCompletionAt;
    }
  }
  return {
    event: { ...configuration.event, now: calculationNow },
    rotations,
    capacities,
    durationSamples,
    ...(configuration.tuning === null ? {} : { tuning: configuration.tuning }),
    previousDispatchPlan: dispatchState,
    ...(configuration.dispatchPlanningLimits === null
      ? {}
      : { dispatchPlanningLimits: configuration.dispatchPlanningLimits }),
  };
}

function lineageFor(run, runById) {
  const lineage = [];
  let cursor = run;
  for (;;) {
    lineage.unshift(cursor);
    if (cursor.id === run.anchorRunId) return lineage;
    cursor = runById.get(cursor.previousRunId);
    if (!cursor) throw new ReplayError("ANALYSIS_REPLAY_CHAIN_MISSING", run.id);
  }
}

function snapshotRunId(snapshot) {
  return snapshot.planningRunId ?? snapshot.planning_run_id;
}

function storedProjection(snapshot) {
  const value = (camel, snake) => snapshot[camel] ?? snapshot[snake] ?? null;
  return {
    rotationId: value("rotationId", "rotation_id"),
    predictedBoardingAt: value("predictedBoardingAt", "predicted_boarding_at"),
    predictedDepartureAt: value("predictedDepartureAt", "predicted_departure_at"),
    predictedLandingAt: value("predictedLandingAt", "predicted_landing_at"),
    predictedCompletionAt: value("predictedCompletionAt", "predicted_completion_at"),
    predictionQuality: value("quality", "quality"),
    predictionLowerMinutes: value("lowerMinutes", "lower_minutes"),
    predictionUpperMinutes: value("upperMinutes", "upper_minutes"),
    dispatchPlanRevision: value("dispatchPlanRevision", "dispatch_plan_revision"),
  };
}

function comparableProjection(projection) {
  const keys = [
    "rotationId",
    "predictedBoardingAt",
    "predictedDepartureAt",
    "predictedLandingAt",
    "predictedCompletionAt",
    "predictionQuality",
    "predictionLowerMinutes",
    "predictionUpperMinutes",
    "dispatchPlanRevision",
  ];
  return Object.fromEntries(keys.map((key) => [key, projection[key] ?? null]));
}

async function replayTarget(input) {
  const lineage = lineageFor(input.target, input.runById);
  let priorForecastState = null;
  let priorDispatchState = null;
  const results = [];
  for (const run of lineage) {
    const context = input.contextById.get(run.contextId);
    if (!context) throw new ReplayError("ANALYSIS_RUN_CONTEXT_MISSING", run.id);
    if (run.previousForecastStateChunkId)
      priorForecastState = input.chunkById.get(run.previousForecastStateChunkId).payload;
    if (run.previousDispatchStateChunkId)
      priorDispatchState = input.chunkById.get(run.previousDispatchStateChunkId).payload;
    const forecastInput = reconstructInput(
      context,
      input.chunkById,
      run.calculationNow,
      priorForecastState,
      priorDispatchState,
    );
    const calculated = input.domain.calculateForecastTimelineResult(forecastInput);
    const digest = sha256(canonicalJson(calculated.projections));
    const storedSnapshots = input.snapshots.filter(
      (snapshot) => snapshotRunId(snapshot) === run.id,
    );
    const expected = storedSnapshots
      .map(storedProjection)
      .sort((left, right) => left.rotationId.localeCompare(right.rotationId));
    const actual = calculated.projections
      .map(comparableProjection)
      .sort((left, right) => left.rotationId.localeCompare(right.rotationId));
    const projectionDifference = firstDifference(expected, actual);
    if (digest !== run.forecastDigest || projectionDifference) {
      throw new ReplayError(
        "ANALYSIS_FORECAST_REPLAY_MISMATCH",
        `Forecast weicht in Lauf ${run.id} ab.`,
        {
          runId: run.id,
          calculationNow: run.calculationNow,
          triggerEventType: run.trigger,
          operationDayVersion: run.eventVersion,
          digestExpected: run.forecastDigest,
          digestActual: digest,
          firstDifference: projectionDifference,
        },
      );
    }
    if (calculated.diagnostics.dispatchPlan.revision !== run.dispatchPlanRevision) {
      throw new ReplayError(
        "ANALYSIS_DISPATCH_REVISION_MISMATCH",
        `Dispatch-Revision weicht in Lauf ${run.id} ab.`,
        {
          runId: run.id,
          expected: run.dispatchPlanRevision,
          actual: calculated.diagnostics.dispatchPlan.revision,
        },
      );
    }
    if (run.dispatchResultChunkId) {
      const expectedDispatch = input.chunkById.get(run.dispatchResultChunkId).payload;
      const difference = firstDifference(expectedDispatch, calculated.diagnostics.dispatchPlan);
      if (difference) {
        throw new ReplayError(
          "ANALYSIS_DISPATCH_REPLAY_MISMATCH",
          `Dispatch weicht in Lauf ${run.id} ab.`,
          { runId: run.id, firstDifference: difference },
        );
      }
    }
    if (run.precallResultChunkId) {
      const precall = input.chunkById.get(run.precallResultChunkId).payload;
      const actualPrecall = input.domain.selectAutomaticPrecalls(precall.input);
      const difference = firstDifference(precall.output, actualPrecall);
      const digest = sha256(canonicalJson(actualPrecall));
      if (difference || digest !== run.precallDigest) {
        throw new ReplayError(
          "ANALYSIS_PRECALL_REPLAY_MISMATCH",
          `Voraufruf weicht in Lauf ${run.id} ab.`,
          { runId: run.id, firstDifference: difference },
        );
      }
    }
    priorForecastState = calculated.projections.map((projection) => ({
      rotationId: projection.rotationId,
      predictedDepartureAt: projection.predictedDepartureAt,
      predictedLandingAt: projection.predictedLandingAt,
      predictedCompletionAt: projection.predictedCompletionAt,
    }));
    priorDispatchState = calculated.diagnostics.dispatchPlan;
    results.push({
      runId: run.id,
      mode: run.mode,
      replayDistance: run.replayDistance,
      verified: true,
    });
  }
  return { targetRunId: input.target.id, lineage: results };
}

export async function replayAnalysisPackage(options) {
  const model = await loadModel(options.input);
  const versionDifferences = verifyVersions(model, options.allowVersionMismatch);
  const integrity = verifyIntegrity(model);
  const successfulRuns = [...integrity.runById.values()].sort(
    (left, right) =>
      left.calculationNow.localeCompare(right.calculationNow) || left.id.localeCompare(right.id),
  );
  let targets;
  if (options.runId) {
    const selected = integrity.runById.get(options.runId);
    if (!selected) throw new ReplayError("ANALYSIS_RUN_NOT_FOUND", options.runId);
    targets = [selected];
  } else if (options.all) targets = successfulRuns;
  else targets = successfulRuns.length > 0 ? [successfulRuns.at(-1)] : [];
  if (targets.length === 0)
    throw new ReplayError("ANALYSIS_RUN_NOT_FOUND", "Kein erfolgreicher Planungslauf im Export.");

  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  try {
    const domain = await vite.ssrLoadModule("/packages/domain/src/index.ts");
    const replayed = [];
    for (const target of targets) {
      replayed.push(
        await replayTarget({ ...integrity, target, snapshots: model.snapshots, domain }),
      );
    }
    return {
      ok: true,
      format: model.kind,
      sourceRevision: model.sourceRevision,
      versionMismatchAllowed: options.allowVersionMismatch && versionDifferences.length > 0,
      versionDifferences,
      chunksVerified: model.chunks.length,
      contextsVerified: model.contexts.length,
      targetsVerified: replayed.length,
      replayed,
    };
  } finally {
    await vite.close();
  }
}

async function main() {
  let report;
  let exitCode = 0;
  try {
    const options = parseArguments(process.argv.slice(2));
    report = await replayAnalysisPackage(options);
    if (options.output)
      writeFileSync(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    exitCode = 2;
    report = {
      ok: false,
      error: {
        code: error instanceof ReplayError ? error.code : "ANALYSIS_REPLAY_FAILED",
        message: error instanceof Error ? error.message : "Replay fehlgeschlagen.",
        details: error instanceof ReplayError ? error.details : {},
      },
    };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCode;
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  await main();
}

export { canonicalJson, firstDifference, parseArguments, verifyIntegrity };
