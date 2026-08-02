-- Create a D1 Time Travel bookmark or portable backup before applying this additive migration.
-- Older Workers ignore the archive metadata. A complete rollback requires Time Travel or restoring
-- the backup and deleting objects below the R2 analysis/ prefix.

CREATE TABLE analysis_archives (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  operation_day_version INTEGER NOT NULL CHECK (operation_day_version >= 0),
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  privacy_profile TEXT NOT NULL CHECK (privacy_profile = 'SUPPORT_SAFE'),
  format_version INTEGER NOT NULL CHECK (format_version = 1),
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

CREATE INDEX idx_analysis_archives_event_status
  ON analysis_archives(operation_day_id, status, requested_at DESC);

CREATE INDEX idx_analysis_archives_cleanup
  ON analysis_archives(status, expires_at);

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

CREATE INDEX idx_analysis_archive_events_archive
  ON analysis_archive_events(archive_id, occurred_at, id);

CREATE TRIGGER analysis_archive_events_no_update
BEFORE UPDATE ON analysis_archive_events
BEGIN
  SELECT RAISE(ABORT, 'analysis_archive_events is append-only');
END;

CREATE TRIGGER analysis_archive_events_no_delete
BEFORE DELETE ON analysis_archive_events
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'analysis_archive_events is append-only');
END;
