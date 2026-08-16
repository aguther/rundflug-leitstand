import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";

const PACKAGE_TABLES = [
  ["planning/chunks.ndjson", "planning_chunks"],
  ["planning/contexts.ndjson", "planning_contexts"],
  ["planning/runs.ndjson", "planning_runs"],
  ["history/forecast-snapshots.ndjson", "forecast_snapshots"],
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes, path) {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch (error) {
    throw new Error(`PLANNING_HISTORY_RESTORE_JSON_INVALID:${path}`, { cause: error });
  }
}

function parseNdjson(bytes, path) {
  return strFromU8(bytes)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`PLANNING_HISTORY_RESTORE_NDJSON_INVALID:${path}:${index + 1}`, {
          cause: error,
        });
      }
    });
}

export function inspectPlanningHistoryPackage(bytes) {
  const entries = unzipSync(bytes);
  const manifestBytes = entries["manifest.json"];
  const continuationBytes = entries["continuation.json"];
  if (!manifestBytes || !continuationBytes) {
    throw new Error("PLANNING_HISTORY_RESTORE_REQUIRED_ENTRY_MISSING");
  }
  const manifest = parseJson(manifestBytes, "manifest.json");
  if (manifest.format !== "rundflug-planning-history" || manifest.formatVersion !== 1) {
    throw new Error("PLANNING_HISTORY_RESTORE_FORMAT_UNSUPPORTED");
  }
  const files = new Map();
  for (const descriptor of manifest.entries ?? []) {
    const entry = entries[descriptor.path];
    if (!entry || sha256(entry) !== descriptor.sha256) {
      throw new Error(`PLANNING_HISTORY_RESTORE_HASH_MISMATCH:${descriptor.path}`);
    }
    const rows = parseNdjson(entry, descriptor.path);
    if (rows.length !== descriptor.rowCount || entry.byteLength !== descriptor.byteCount) {
      throw new Error(`PLANNING_HISTORY_RESTORE_COUNT_MISMATCH:${descriptor.path}`);
    }
    files.set(descriptor.path, rows);
  }
  for (const [path] of PACKAGE_TABLES) {
    if (!files.has(path))
      throw new Error(`PLANNING_HISTORY_RESTORE_REQUIRED_ENTRY_MISSING:${path}`);
  }
  if (
    manifest.continuationReceipt?.path !== "continuation.json" ||
    manifest.continuationReceipt.rowCount !== 1 ||
    continuationBytes.byteLength !== manifest.continuationReceipt.byteCount ||
    sha256(continuationBytes) !== manifest.continuationReceipt.sha256
  ) {
    throw new Error("PLANNING_HISTORY_RESTORE_CONTINUATION_HASH_MISMATCH");
  }
  const continuation = parseJson(continuationBytes, "continuation.json");
  if (JSON.stringify(continuation) !== JSON.stringify(manifest.continuation)) {
    throw new Error("PLANNING_HISTORY_RESTORE_CONTINUATION_MISMATCH");
  }
  return { manifest, continuation, files, archiveSha256: sha256(bytes) };
}

function insertRows(database, table, rows) {
  for (const row of rows) {
    const columns = Object.keys(row);
    if (columns.length === 0 || columns.some((column) => !/^[a-z][a-z0-9_]*$/.test(column))) {
      throw new Error(`PLANNING_HISTORY_RESTORE_COLUMN_INVALID:${table}`);
    }
    const placeholders = columns.map((_, index) => `?${index + 1}`).join(", ");
    const statement = database.prepare(
      `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
    );
    statement.run(...columns.map((column) => row[column]));
  }
}

function reconstructBoundary(database, inspected) {
  const { continuation, manifest } = inspected;
  if (continuation.terminal) return;
  const compactionId = manifest.segment.compactionId;
  const eventId = manifest.event.id;
  const compaction = database
    .prepare(
      `SELECT id FROM planning_history_compactions
        WHERE id = ?1 AND operation_day_id = ?2 AND status IN ('COMPLETED', 'EXPIRED')`,
    )
    .get(compactionId, eventId);
  if (!compaction) throw new Error(`PLANNING_HISTORY_RESTORE_CATALOG_MISSING:${compactionId}`);
  database
    .prepare(
      `UPDATE planning_history_maintenance_control
          SET active = 1, compaction_id = ?1, operation_day_id = ?2,
              boundary_run_id = ?3, boundary_context_id = ?4, activated_at = ?5
        WHERE singleton = 1 AND active = 0`,
    )
    .run(
      compactionId,
      eventId,
      continuation.continuationRunId,
      continuation.continuationContextId,
      new Date().toISOString(),
    );
  database
    .prepare(
      `UPDATE planning_runs SET previous_run_id = ?1, anchor_run_id = ?2
        WHERE id = ?3 AND operation_day_id = ?4`,
    )
    .run(
      continuation.previousRunId,
      continuation.anchorRunId,
      continuation.continuationRunId,
      eventId,
    );
  database
    .prepare(
      `UPDATE planning_contexts SET previous_context_id = ?1
        WHERE id = ?2 AND operation_day_id = ?3`,
    )
    .run(continuation.previousContextId, continuation.continuationContextId, eventId);
  database
    .prepare(
      `UPDATE planning_history_maintenance_control
          SET active = 0, compaction_id = NULL, operation_day_id = NULL,
              boundary_run_id = NULL, boundary_context_id = NULL, activated_at = NULL
        WHERE singleton = 1 AND active = 1`,
    )
    .run();
}

export function restorePlanningHistoryPackages(database, packages) {
  const inspected = packages
    .map((bytes) => inspectPlanningHistoryPackage(bytes))
    .sort((left, right) =>
      left.manifest.segment.startCapturedAt.localeCompare(right.manifest.segment.startCapturedAt),
    );
  const seenCompactions = new Set();
  database.exec("BEGIN");
  try {
    for (const item of inspected) {
      if (seenCompactions.has(item.manifest.segment.compactionId)) {
        throw new Error("PLANNING_HISTORY_RESTORE_DUPLICATE_COMPACTION");
      }
      seenCompactions.add(item.manifest.segment.compactionId);
      for (const [path, table] of PACKAGE_TABLES) {
        insertRows(database, table, item.files.get(path));
      }
    }
    for (const item of inspected) reconstructBoundary(database, item);
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      throw new Error("PLANNING_HISTORY_RESTORE_FOREIGN_KEY_FAILED");
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return {
    packageCount: inspected.length,
    compactionIds: inspected.map((item) => item.manifest.segment.compactionId),
    archiveSha256: inspected.map((item) => item.archiveSha256),
  };
}
