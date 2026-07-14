PRAGMA foreign_keys = ON;

CREATE TABLE rotation_manifest_corrections (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  ticket_group_id TEXT NOT NULL REFERENCES ticket_groups(id) ON DELETE RESTRICT,
  source_rotation_ids_json TEXT NOT NULL CHECK (json_valid(source_rotation_ids_json)),
  target_rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  corrected_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  event_version INTEGER NOT NULL CHECK (event_version > 0)
) STRICT;

CREATE INDEX idx_manifest_corrections_event_time
  ON rotation_manifest_corrections(operation_day_id, corrected_at, id);

CREATE TRIGGER rotation_manifest_corrections_no_update
BEFORE UPDATE ON rotation_manifest_corrections
BEGIN
  SELECT RAISE(ABORT, 'rotation_manifest_corrections is append-only');
END;

CREATE TRIGGER rotation_manifest_corrections_no_delete
BEFORE DELETE ON rotation_manifest_corrections
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'rotation_manifest_corrections is append-only');
END;
