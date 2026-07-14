ALTER TABLE forecast_snapshots ADD COLUMN trigger_event_type TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';
ALTER TABLE forecast_snapshots ADD COLUMN data_basis_scope TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN'
  CHECK (data_basis_scope IN (
    'AIRCRAFT_PRODUCT_HISTORY',
    'PRODUCT_HISTORY',
    'REFERENCE_ONLY',
    'LEGACY_UNKNOWN'
  ));
ALTER TABLE forecast_snapshots ADD COLUMN sample_size INTEGER NOT NULL DEFAULT 0
  CHECK (sample_size >= 0);
ALTER TABLE forecast_snapshots ADD COLUMN data_age_minutes REAL NOT NULL DEFAULT 0
  CHECK (data_age_minutes >= 0);
ALTER TABLE forecast_snapshots ADD COLUMN active_capacity INTEGER NOT NULL DEFAULT 0
  CHECK (active_capacity >= 0);
ALTER TABLE forecast_snapshots ADD COLUMN reference_duration_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (reference_duration_minutes >= 0);
