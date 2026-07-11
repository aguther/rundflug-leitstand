ALTER TABLE rotations ADD COLUMN planned_boarding_at TEXT;
ALTER TABLE rotations ADD COLUMN planned_departure_at TEXT;
ALTER TABLE rotations ADD COLUMN planned_landing_at TEXT;
ALTER TABLE rotations ADD COLUMN planned_completion_at TEXT;
ALTER TABLE rotations ADD COLUMN predicted_boarding_at TEXT;
ALTER TABLE rotations ADD COLUMN predicted_departure_at TEXT;
ALTER TABLE rotations ADD COLUMN predicted_landing_at TEXT;
ALTER TABLE rotations ADD COLUMN predicted_completion_at TEXT;
ALTER TABLE rotations ADD COLUMN prediction_quality TEXT
  CHECK (prediction_quality IN ('STABLE', 'CHANGING', 'UNCERTAIN'));
ALTER TABLE rotations ADD COLUMN prediction_lower_minutes INTEGER
  CHECK (prediction_lower_minutes IS NULL OR prediction_lower_minutes >= 0);
ALTER TABLE rotations ADD COLUMN prediction_upper_minutes INTEGER
  CHECK (prediction_upper_minutes IS NULL OR prediction_upper_minutes >= 0);
ALTER TABLE rotations ADD COLUMN prediction_updated_at TEXT;

CREATE TABLE forecast_snapshots (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE RESTRICT,
  operation_day_version INTEGER NOT NULL CHECK (operation_day_version >= 0),
  captured_at TEXT NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('STABLE', 'CHANGING', 'UNCERTAIN')),
  lower_minutes INTEGER NOT NULL CHECK (lower_minutes >= 0),
  upper_minutes INTEGER NOT NULL CHECK (upper_minutes >= 0),
  predicted_boarding_at TEXT,
  predicted_departure_at TEXT,
  predicted_landing_at TEXT,
  predicted_completion_at TEXT
) STRICT;

CREATE INDEX idx_forecast_snapshots_event_rotation
  ON forecast_snapshots(operation_day_id, rotation_id, captured_at DESC);

CREATE TRIGGER forecast_snapshots_no_update
BEFORE UPDATE ON forecast_snapshots
BEGIN
  SELECT RAISE(ABORT, 'forecast_snapshots is append-only');
END;

CREATE TRIGGER forecast_snapshots_no_delete
BEFORE DELETE ON forecast_snapshots
BEGIN
  SELECT RAISE(ABORT, 'forecast_snapshots is append-only');
END;
