import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zipSync } from "fflate";
import {
  inspectPlanningHistoryPackage,
  restorePlanningHistoryPackages,
} from "./lib/planning-history-restore.mjs";

const root = resolve(import.meta.dirname, "..");
const migrations = resolve(root, "apps", "worker", "migrations");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    database.exec(readFileSync(resolve(migrations, file), "utf8"));
  }
  return database;
}

function contextRow(id, version, previousContextId, capturedAt) {
  return {
    id,
    operation_day_id: "event-one",
    operation_day_version: version,
    schema_version: 1,
    previous_context_id: previousContextId,
    manifest_json: "[]",
    manifest_hash: String(version).repeat(64),
    anchor_reason: "TEST",
    created_at: capturedAt,
  };
}

function runRow(id, version, contextId, previousRunId, anchorRunId, mode, capturedAt) {
  return {
    id,
    operation_day_id: "event-one",
    operation_day_version: version,
    context_id: contextId,
    previous_run_id: previousRunId,
    anchor_run_id: anchorRunId,
    replay_distance: mode === "ANCHOR" ? 0 : 1,
    calculation_now: capturedAt,
    captured_at: capturedAt,
    trigger_event_type: "TEST",
    capture_mode: mode,
    anchor_reason: mode === "ANCHOR" ? "TEST" : null,
    application_version: "1.12.0",
    requirements_version: "1.12.0",
    source_revision: "test",
    dispatch_plan_revision: "dispatch",
    forecast_digest: "f".repeat(64),
    forecast_semantic_digest: "f".repeat(64),
    precall_digest: "f".repeat(64),
    previous_forecast_state_chunk_id: null,
    previous_dispatch_state_chunk_id: null,
    dispatch_result_chunk_id: null,
    precall_result_chunk_id: null,
    duration_ms: 1,
    capture_duration_ms: 1,
    status: "SUCCEEDED",
    failure_code: null,
  };
}

function ndjson(rows) {
  return strToU8(rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

function planningPackage() {
  const files = {
    "planning/runs.ndjson": ndjson([
      runRow("run-0", 1, "context-0", null, "run-0", "ANCHOR", "2026-08-14T10:00:00.000Z"),
      runRow("run-1", 2, "context-1", "run-0", "run-0", "REFERENCE", "2026-08-15T10:00:00.000Z"),
    ]),
    "planning/contexts.ndjson": ndjson([
      contextRow("context-0", 1, null, "2026-08-14T10:00:00.000Z"),
      contextRow("context-1", 2, "context-0", "2026-08-15T10:00:00.000Z"),
    ]),
    "planning/chunks.ndjson": ndjson([]),
    "history/forecast-snapshots.ndjson": ndjson([]),
  };
  const continuation = {
    terminal: false,
    continuationRunId: "run-2",
    continuationContextId: "context-2",
    previousRunId: "run-1",
    anchorRunId: "run-2",
    previousContextId: "context-1",
  };
  const continuationBytes = strToU8(`${JSON.stringify(continuation, null, 2)}\n`);
  const manifest = {
    format: "rundflug-planning-history",
    formatVersion: 1,
    createdAt: "2026-08-16T12:00:00.000Z",
    privacyProfile: "SUPPORT_SAFE",
    applicationVersion: "1.12.0",
    requirementsVersion: "1.12.0",
    sourceRevision: "test",
    event: { id: "event-one", date: "2026-08-15" },
    segment: {
      compactionId: "compaction-one",
      startRunId: "run-0",
      startCapturedAt: "2026-08-14T10:00:00.000Z",
      endRunId: "run-1",
      endCapturedAt: "2026-08-15T10:00:00.000Z",
      terminal: false,
    },
    continuation,
    continuationReceipt: {
      path: "continuation.json",
      encoding: "json",
      rowCount: 1,
      byteCount: continuationBytes.byteLength,
      sha256: sha256(continuationBytes),
    },
    entries: Object.entries(files).map(([path, bytes]) => ({
      path,
      encoding: "ndjson",
      rowCount: new TextDecoder().decode(bytes).split(/\r?\n/).filter(Boolean).length,
      byteCount: bytes.byteLength,
      sha256: sha256(bytes),
    })),
  };
  return zipSync({
    ...files,
    "continuation.json": continuationBytes,
    "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  });
}

const database = migratedDatabase();
try {
  database.exec(`
    INSERT INTO operation_days
      (id, name, event_date, status, version, created_at, updated_at)
    VALUES ('event-one', 'Synthetic event', '2026-08-15', 'ARCHIVED', 4,
            '2026-08-14T09:00:00.000Z', '2026-08-16T11:00:00.000Z');
  `);
  const context2 = contextRow("context-2", 3, null, "2026-08-15T11:00:00.000Z");
  const context3 = contextRow("context-3", 4, "context-2", "2026-08-16T10:00:00.000Z");
  for (const row of [context2, context3]) {
    database
      .prepare(
        `INSERT INTO planning_contexts
          (id, operation_day_id, operation_day_version, schema_version, previous_context_id,
           manifest_json, manifest_hash, anchor_reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .run(...Object.values(row));
  }
  const hotRuns = [
    runRow("run-2", 3, "context-2", null, null, "ANCHOR", "2026-08-15T11:00:00.000Z"),
    runRow("run-3", 4, "context-3", "run-2", "run-2", "REFERENCE", "2026-08-16T10:00:00.000Z"),
  ];
  for (const row of hotRuns) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `?${index + 1}`).join(",");
    database
      .prepare(`INSERT INTO planning_runs (${columns.join(",")}) VALUES (${placeholders})`)
      .run(...Object.values(row));
  }
  database
    .prepare(
      `INSERT INTO planning_history_compactions
        (id, operation_day_id, format_version, privacy_profile, status,
         segment_start_run_id, segment_start_captured_at, segment_end_run_id,
         segment_end_captured_at, continuation_run_id, continuation_context_id,
         continuation_previous_run_id, continuation_anchor_run_id,
         continuation_previous_context_id, terminal_segment, object_key, checksum_key,
         object_sha256, object_etag, object_size_bytes, entry_counts_json, source_revision,
         application_version, requirements_version, requested_at, expires_at)
       VALUES ('compaction-one', 'event-one', 1, 'SUPPORT_SAFE', 'COMPLETED',
               'run-0', '2026-08-14T10:00:00.000Z', 'run-1', '2026-08-15T10:00:00.000Z',
               'run-2', 'context-2', 'run-1', 'run-2', 'context-1', 0,
               'planning-history/event-one/package.zip',
               'planning-history/event-one/package.zip.sha256', ?1, 'etag', ?2, '{}',
               'test', '1.12.0', '1.12.0', '2026-08-16T12:00:00.000Z',
               '2031-08-16T12:00:00.000Z')`,
    )
    .run("a".repeat(64), 1);

  const bytes = planningPackage();
  const inspected = inspectPlanningHistoryPackage(bytes);
  if (inspected.manifest.segment.compactionId !== "compaction-one") {
    throw new Error("Planning history package inspection failed.");
  }
  const result = restorePlanningHistoryPackages(database, [bytes]);
  const restoredRun = database
    .prepare("SELECT previous_run_id, anchor_run_id FROM planning_runs WHERE id = 'run-2'")
    .get();
  const restoredContext = database
    .prepare("SELECT previous_context_id FROM planning_contexts WHERE id = 'context-2'")
    .get();
  const runCount = database.prepare("SELECT COUNT(*) AS count FROM planning_runs").get().count;
  if (
    result.packageCount !== 1 ||
    runCount !== 4 ||
    restoredRun.previous_run_id !== "run-1" ||
    restoredRun.anchor_run_id !== "run-2" ||
    restoredContext.previous_context_id !== "context-1" ||
    database.prepare("PRAGMA foreign_key_check").all().length !== 0
  ) {
    throw new Error("Planning history restore roundtrip failed.");
  }
  const corrupted = bytes.slice();
  corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
  try {
    inspectPlanningHistoryPackage(corrupted);
    throw new Error("Corrupted planning history package was accepted.");
  } catch (error) {
    if (error.message === "Corrupted planning history package was accepted.") throw error;
  }
  process.stdout.write("OK: planning history restore verified in isolated SQLite\n");
} finally {
  database.close();
}
