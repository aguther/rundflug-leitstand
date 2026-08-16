-- Add verified cold-storage catalogues for bounded planning-history compaction.
--
-- Forward repair / recovery:
-- This migration deliberately has no in-place rollback because compacted D1 rows may already
-- exist only in verified R2 packages. On failure, stop the hourly compaction trigger, restore an
-- isolated D1 from the latest portable backup, apply the corrected forward migration, verify all
-- catalogue checksums and foreign keys, and only then switch the Worker binding. Never drop these
-- tables or restore the old analysis_archives CHECK constraint on a live database.

PRAGMA defer_foreign_keys = ON;

DROP TRIGGER analysis_archive_events_no_delete;
DROP TRIGGER analysis_archive_events_no_update;
DROP INDEX idx_analysis_archive_events_archive;
DROP INDEX idx_analysis_archives_cleanup;
DROP INDEX idx_analysis_archives_event_status;

ALTER TABLE analysis_archive_events RENAME TO analysis_archive_events_v1;
ALTER TABLE analysis_archives RENAME TO analysis_archives_v1;

CREATE TABLE analysis_archives (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  operation_day_version INTEGER NOT NULL CHECK (operation_day_version >= 0),
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  privacy_profile TEXT NOT NULL CHECK (privacy_profile = 'SUPPORT_SAFE'),
  format_version INTEGER NOT NULL CHECK (format_version IN (1, 2)),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'BUILDING', 'READY', 'FAILED', 'EXPIRED', 'DELETED'
  )),
  object_key TEXT,
  object_etag TEXT,
  object_size_bytes INTEGER CHECK (object_size_bytes IS NULL OR object_size_bytes >= 0),
  content_type TEXT,
  source_revision TEXT NOT NULL,
  application_version TEXT NOT NULL,
  requirements_version TEXT NOT NULL,
  entry_counts_json TEXT NOT NULL CHECK (json_valid(entry_counts_json)),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  failure_code TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE(operation_day_id, operation_day_version, format_version, privacy_profile)
) STRICT;

INSERT INTO analysis_archives SELECT * FROM analysis_archives_v1;

CREATE TABLE analysis_archive_events (
  id TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL REFERENCES analysis_archives(id) ON DELETE RESTRICT,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ARCHIVE_REQUESTED', 'ARCHIVE_BUILD_STARTED', 'ARCHIVE_READY',
    'ARCHIVE_FAILED', 'ARCHIVE_DOWNLOADED', 'ARCHIVE_EXPIRED', 'ARCHIVE_DELETED'
  )),
  occurred_at TEXT NOT NULL,
  actor_alias TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json))
) STRICT;

INSERT INTO analysis_archive_events SELECT * FROM analysis_archive_events_v1;
DROP TABLE analysis_archive_events_v1;
DROP TABLE analysis_archives_v1;

CREATE INDEX idx_analysis_archive_events_archive
  ON analysis_archive_events(archive_id, occurred_at, id);
CREATE INDEX idx_analysis_archives_cleanup
  ON analysis_archives(status, expires_at);
CREATE INDEX idx_analysis_archives_event_status
  ON analysis_archives(operation_day_id, status, requested_at DESC);

CREATE TRIGGER analysis_archive_events_no_delete
BEFORE DELETE ON analysis_archive_events
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'analysis_archive_events is append-only');
END;

CREATE TRIGGER analysis_archive_events_no_update
BEFORE UPDATE ON analysis_archive_events
BEGIN
  SELECT RAISE(ABORT, 'analysis_archive_events is append-only');
END;

CREATE TABLE planning_history_compactions (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  format_version INTEGER NOT NULL CHECK (format_version = 1),
  privacy_profile TEXT NOT NULL CHECK (privacy_profile = 'SUPPORT_SAFE'),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'BUILDING', 'VERIFIED', 'PRUNING', 'COMPLETED',
    'FAILED', 'EXPIRED', 'DELETED'
  )),
  segment_start_run_id TEXT NOT NULL,
  segment_start_captured_at TEXT NOT NULL,
  segment_end_run_id TEXT NOT NULL,
  segment_end_captured_at TEXT NOT NULL,
  continuation_run_id TEXT,
  continuation_context_id TEXT,
  continuation_previous_run_id TEXT,
  continuation_anchor_run_id TEXT,
  continuation_previous_context_id TEXT,
  terminal_segment INTEGER NOT NULL CHECK (terminal_segment IN (0, 1)),
  object_key TEXT NOT NULL UNIQUE,
  checksum_key TEXT NOT NULL UNIQUE,
  object_sha256 TEXT CHECK (object_sha256 IS NULL OR length(object_sha256) = 64),
  object_etag TEXT,
  object_size_bytes INTEGER CHECK (object_size_bytes IS NULL OR object_size_bytes >= 0),
  entry_counts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(entry_counts_json)),
  source_revision TEXT NOT NULL,
  application_version TEXT NOT NULL,
  requirements_version TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  workflow_dispatched_at TEXT,
  started_at TEXT,
  verified_at TEXT,
  pruning_started_at TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  failure_code TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE(operation_day_id, segment_end_run_id, format_version)
) STRICT;

CREATE TABLE planning_history_compaction_events (
  id TEXT PRIMARY KEY,
  compaction_id TEXT NOT NULL REFERENCES planning_history_compactions(id) ON DELETE RESTRICT,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'COMPACTION_REQUESTED', 'PACKAGE_BUILD_STARTED', 'PACKAGE_VERIFIED',
    'PRUNING_STARTED', 'COMPACTION_COMPLETED', 'COMPACTION_FAILED',
    'PACKAGE_EXPIRED', 'PACKAGE_DELETED'
  )),
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json))
) STRICT;

CREATE TABLE planning_history_maintenance_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  compaction_id TEXT REFERENCES planning_history_compactions(id) ON DELETE RESTRICT,
  operation_day_id TEXT REFERENCES operation_days(id) ON DELETE RESTRICT,
  boundary_run_id TEXT,
  boundary_context_id TEXT,
  activated_at TEXT,
  CHECK (
    (active = 0 AND compaction_id IS NULL AND operation_day_id IS NULL
      AND boundary_run_id IS NULL AND boundary_context_id IS NULL AND activated_at IS NULL)
    OR
    (active = 1 AND compaction_id IS NOT NULL AND operation_day_id IS NOT NULL
      AND activated_at IS NOT NULL)
  )
) STRICT;

INSERT INTO planning_history_maintenance_control (singleton, active) VALUES (1, 0);

CREATE INDEX idx_planning_history_compactions_candidate
  ON planning_history_compactions(status, requested_at, operation_day_id);
CREATE INDEX idx_planning_history_compactions_event_segment
  ON planning_history_compactions(operation_day_id, segment_end_captured_at, id);
CREATE INDEX idx_planning_history_compactions_retention
  ON planning_history_compactions(status, expires_at);
CREATE INDEX idx_planning_history_compaction_events_history
  ON planning_history_compaction_events(compaction_id, occurred_at, id);
CREATE TRIGGER planning_history_compaction_events_no_update
BEFORE UPDATE ON planning_history_compaction_events
BEGIN
  SELECT RAISE(ABORT, 'planning_history_compaction_events is append-only');
END;

CREATE TRIGGER planning_history_compaction_events_no_delete
BEFORE DELETE ON planning_history_compaction_events
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'planning_history_compaction_events is append-only');
END;

CREATE TRIGGER planning_history_compactions_no_delete
BEFORE DELETE ON planning_history_compactions
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'planning_history_compactions cannot be deleted outside reset');
END;

DROP TRIGGER forecast_snapshots_no_delete;
CREATE TRIGGER forecast_snapshots_no_delete
BEFORE DELETE ON forecast_snapshots
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
 AND NOT EXISTS (
   SELECT 1 FROM planning_history_maintenance_control control
    WHERE control.singleton = 1 AND control.active = 1
      AND control.operation_day_id = OLD.operation_day_id
 )
BEGIN
  SELECT RAISE(ABORT, 'forecast_snapshots is append-only');
END;

DROP TRIGGER planning_runs_no_delete;
CREATE TRIGGER planning_runs_no_delete
BEFORE DELETE ON planning_runs
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
 AND NOT EXISTS (
   SELECT 1 FROM planning_history_maintenance_control control
    WHERE control.singleton = 1 AND control.active = 1
      AND control.operation_day_id = OLD.operation_day_id
 )
BEGIN
  SELECT RAISE(ABORT, 'planning_runs is append-only');
END;

DROP TRIGGER planning_contexts_no_delete;
CREATE TRIGGER planning_contexts_no_delete
BEFORE DELETE ON planning_contexts
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
 AND NOT EXISTS (
   SELECT 1 FROM planning_history_maintenance_control control
    WHERE control.singleton = 1 AND control.active = 1
      AND control.operation_day_id = OLD.operation_day_id
 )
BEGIN
  SELECT RAISE(ABORT, 'planning_contexts is append-only');
END;

DROP TRIGGER planning_chunks_no_delete;
CREATE TRIGGER planning_chunks_no_delete
BEFORE DELETE ON planning_chunks
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
 AND NOT EXISTS (
   SELECT 1 FROM planning_history_maintenance_control control
    WHERE control.singleton = 1 AND control.active = 1
      AND control.operation_day_id = OLD.operation_day_id
 )
BEGIN
  SELECT RAISE(ABORT, 'planning_chunks is append-only');
END;

DROP TRIGGER planning_runs_restrict_update;
CREATE TRIGGER planning_runs_restrict_update
BEFORE UPDATE ON planning_runs
WHEN NOT (
  OLD.status = 'CAPTURING' AND NEW.status IN ('SUCCEEDED', 'FAILED') AND
  OLD.id = NEW.id AND OLD.operation_day_id = NEW.operation_day_id AND
  OLD.operation_day_version = NEW.operation_day_version AND OLD.context_id = NEW.context_id AND
  OLD.calculation_now = NEW.calculation_now AND OLD.capture_mode = NEW.capture_mode
)
AND NOT EXISTS (
  SELECT 1 FROM planning_history_maintenance_control control
   WHERE control.singleton = 1 AND control.active = 1
     AND control.operation_day_id = OLD.operation_day_id
     AND control.boundary_run_id = OLD.id
     AND NEW.id = OLD.id AND NEW.operation_day_id = OLD.operation_day_id
     AND (
       (NEW.previous_run_id IS NULL AND NEW.anchor_run_id IS NULL)
       OR EXISTS (
         SELECT 1 FROM planning_history_compactions compaction
          WHERE compaction.id = control.compaction_id
            AND compaction.continuation_previous_run_id IS NEW.previous_run_id
            AND compaction.continuation_anchor_run_id IS NEW.anchor_run_id
       )
     )
)
BEGIN
  SELECT RAISE(ABORT, 'planning_runs is append-only after capture');
END;

DROP TRIGGER planning_contexts_no_update;
CREATE TRIGGER planning_contexts_no_update
BEFORE UPDATE ON planning_contexts
WHEN NOT EXISTS (
  SELECT 1 FROM planning_history_maintenance_control control
   WHERE control.singleton = 1 AND control.active = 1
     AND control.operation_day_id = OLD.operation_day_id
     AND control.boundary_context_id = OLD.id
     AND NEW.id = OLD.id AND NEW.operation_day_id = OLD.operation_day_id
     AND (
       NEW.previous_context_id IS NULL
       OR EXISTS (
         SELECT 1 FROM planning_history_compactions compaction
          WHERE compaction.id = control.compaction_id
            AND compaction.continuation_previous_context_id IS NEW.previous_context_id
       )
     )
)
BEGIN
  SELECT RAISE(ABORT, 'planning_contexts is append-only');
END;
