-- Release 1.10.0: weiche Betriebsplanung für Pausen, Tanken, Flugshows und andere
-- absehbare Einschränkungen. Ein Plan ändert niemals selbst einen operativen Zustand.
-- Erst ein bestehendes, menschlich bestätigtes Zustandskommando verknüpft den Plan mit
-- einem tatsächlichen operational_block.
--
-- Wiederherstellung: Vor einem Rollback D1 Time Travel beziehungsweise ein portables
-- R2-Backup verwenden. Ältere Worker ignorieren operations_start_at und die neue Tabelle.
ALTER TABLE operation_days ADD COLUMN operations_start_at TEXT;

CREATE TABLE planned_operational_constraints (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('EVENT', 'RESOURCE_GROUP', 'AIRCRAFT', 'PILOT')),
  scope_id TEXT NOT NULL,
  constraint_kind TEXT NOT NULL
    CHECK (constraint_kind IN ('PAUSE', 'REFUELING', 'FLIGHT_SHOW', 'WEATHER', 'TECHNICAL', 'OTHER')),
  start_mode TEXT NOT NULL
    CHECK (start_mode IN ('TIME_WINDOW', 'AFTER_CURRENT_ROTATION')),
  earliest_start_at TEXT,
  latest_start_at TEXT,
  after_rotation_id TEXT REFERENCES rotations(id) ON DELETE RESTRICT,
  minimum_duration_minutes INTEGER NOT NULL CHECK (minimum_duration_minutes BETWEEN 1 AND 1440),
  typical_duration_minutes INTEGER NOT NULL CHECK (typical_duration_minutes BETWEEN 1 AND 1440),
  maximum_duration_minutes INTEGER NOT NULL CHECK (maximum_duration_minutes BETWEEN 1 AND 1440),
  status TEXT NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'ACTIVE', 'CLEARED', 'CANCELED')),
  reason TEXT NOT NULL,
  public_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by_device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT,
  cleared_at TEXT,
  canceled_at TEXT,
  CHECK (minimum_duration_minutes <= typical_duration_minutes),
  CHECK (typical_duration_minutes <= maximum_duration_minutes),
  CHECK (
    (start_mode = 'TIME_WINDOW'
      AND earliest_start_at IS NOT NULL
      AND latest_start_at IS NOT NULL
      AND after_rotation_id IS NULL)
    OR
    (start_mode = 'AFTER_CURRENT_ROTATION'
      AND earliest_start_at IS NULL
      AND latest_start_at IS NULL
      AND after_rotation_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_planned_operational_constraints_event_status
  ON planned_operational_constraints(operation_day_id, status, latest_start_at);
CREATE INDEX idx_planned_operational_constraints_scope
  ON planned_operational_constraints(operation_day_id, scope_type, scope_id, status);

ALTER TABLE operational_blocks ADD COLUMN planned_operation_id TEXT
  REFERENCES planned_operational_constraints(id) ON DELETE RESTRICT;
CREATE INDEX idx_operational_blocks_plan
  ON operational_blocks(planned_operation_id, status);
