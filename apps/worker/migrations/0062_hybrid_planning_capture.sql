-- Create a D1 Time Travel bookmark or portable backup before applying this additive migration.
-- Older Workers ignore the new tables and nullable snapshot columns. A complete rollback requires
-- Time Travel or restoring that backup.

CREATE TABLE planning_chunks (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  chunk_kind TEXT NOT NULL CHECK (chunk_kind IN (
    'EVENT_CONFIGURATION',
    'ROTATIONS_QUEUE',
    'CAPACITIES',
    'DURATION_SAMPLES',
    'OPERATIONAL_CONSTRAINTS',
    'PREVIOUS_FORECAST_STATE',
    'PREVIOUS_DISPATCH_STATE',
    'DISPATCH_RESULT',
    'PRECALL_RESULT'
  )),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(operation_day_id, chunk_kind, schema_version, payload_hash)
) STRICT;

CREATE INDEX idx_planning_chunks_event_kind
  ON planning_chunks(operation_day_id, chunk_kind, created_at);

CREATE TABLE planning_contexts (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  operation_day_version INTEGER NOT NULL CHECK (operation_day_version >= 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  previous_context_id TEXT REFERENCES planning_contexts(id) ON DELETE RESTRICT,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64),
  anchor_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(operation_day_id, operation_day_version, schema_version)
) STRICT;

CREATE INDEX idx_planning_contexts_event_version
  ON planning_contexts(operation_day_id, operation_day_version DESC);

CREATE TABLE planning_runs (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  operation_day_version INTEGER NOT NULL CHECK (operation_day_version >= 0),
  context_id TEXT NOT NULL REFERENCES planning_contexts(id) ON DELETE RESTRICT,
  previous_run_id TEXT REFERENCES planning_runs(id) ON DELETE RESTRICT,
  anchor_run_id TEXT REFERENCES planning_runs(id) ON DELETE RESTRICT,
  replay_distance INTEGER NOT NULL CHECK (replay_distance BETWEEN 0 AND 10),
  calculation_now TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  trigger_event_type TEXT NOT NULL,
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('REFERENCE', 'CHANGE', 'ANCHOR')),
  anchor_reason TEXT,
  application_version TEXT NOT NULL,
  requirements_version TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  dispatch_plan_revision TEXT NOT NULL,
  forecast_digest TEXT NOT NULL CHECK (length(forecast_digest) = 64),
  forecast_semantic_digest TEXT NOT NULL CHECK (length(forecast_semantic_digest) = 64),
  precall_digest TEXT NOT NULL CHECK (length(precall_digest) = 64),
  previous_forecast_state_chunk_id TEXT REFERENCES planning_chunks(id) ON DELETE RESTRICT,
  previous_dispatch_state_chunk_id TEXT REFERENCES planning_chunks(id) ON DELETE RESTRICT,
  dispatch_result_chunk_id TEXT REFERENCES planning_chunks(id) ON DELETE RESTRICT,
  precall_result_chunk_id TEXT REFERENCES planning_chunks(id) ON DELETE RESTRICT,
  duration_ms REAL NOT NULL CHECK (duration_ms >= 0),
  capture_duration_ms REAL CHECK (capture_duration_ms IS NULL OR capture_duration_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('CAPTURING', 'SUCCEEDED', 'FAILED')),
  failure_code TEXT,
  CHECK (
    (status = 'FAILED' AND failure_code IS NOT NULL) OR
    (status <> 'FAILED' AND failure_code IS NULL)
  ),
  UNIQUE(operation_day_id, operation_day_version, calculation_now, trigger_event_type)
) STRICT;

CREATE INDEX idx_planning_runs_event_time
  ON planning_runs(operation_day_id, calculation_now DESC);

CREATE INDEX idx_planning_runs_dispatch_revision
  ON planning_runs(operation_day_id, dispatch_plan_revision);

CREATE INDEX idx_planning_runs_anchor
  ON planning_runs(operation_day_id, anchor_run_id, replay_distance);

ALTER TABLE forecast_snapshots ADD COLUMN planning_run_id TEXT
  REFERENCES planning_runs(id) ON DELETE RESTRICT;

CREATE INDEX idx_forecast_snapshots_planning_run
  ON forecast_snapshots(planning_run_id);

CREATE TRIGGER planning_chunks_no_update
BEFORE UPDATE ON planning_chunks
BEGIN
  SELECT RAISE(ABORT, 'planning_chunks is append-only');
END;

CREATE TRIGGER planning_contexts_no_update
BEFORE UPDATE ON planning_contexts
BEGIN
  SELECT RAISE(ABORT, 'planning_contexts is append-only');
END;

CREATE TRIGGER planning_runs_restrict_update
BEFORE UPDATE ON planning_runs
WHEN NOT (
  OLD.status = 'CAPTURING' AND NEW.status IN ('SUCCEEDED', 'FAILED') AND
  OLD.id = NEW.id AND OLD.operation_day_id = NEW.operation_day_id AND
  OLD.operation_day_version = NEW.operation_day_version AND OLD.context_id = NEW.context_id AND
  OLD.calculation_now = NEW.calculation_now AND OLD.capture_mode = NEW.capture_mode
)
BEGIN
  SELECT RAISE(ABORT, 'planning_runs is append-only after capture');
END;

CREATE TRIGGER planning_chunks_no_delete
BEFORE DELETE ON planning_chunks
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'planning_chunks is append-only');
END;

CREATE TRIGGER planning_contexts_no_delete
BEFORE DELETE ON planning_contexts
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'planning_contexts is append-only');
END;

CREATE TRIGGER planning_runs_no_delete
BEFORE DELETE ON planning_runs
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'planning_runs is append-only');
END;
