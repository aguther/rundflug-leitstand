-- Wiederherstellung: Vor Anwendung einen D1-Time-Travel-Punkt beziehungsweise eine portable
-- Sicherung anlegen. Die zusätzlichen Prognose- und Freeze-Spalten werden bei einer
-- Wiederherstellung auf den Stand vor 0058 zurückgesetzt.
ALTER TABLE rotations ADD COLUMN forecast_assumed_aircraft_id TEXT
  REFERENCES aircraft(id) ON DELETE SET NULL;
ALTER TABLE rotations ADD COLUMN turnaround_product_id TEXT
  REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE rotations ADD COLUMN turnaround_aircraft_id TEXT
  REFERENCES aircraft(id) ON DELETE SET NULL;
ALTER TABLE rotations ADD COLUMN turnaround_boarding_minutes INTEGER
  CHECK (turnaround_boarding_minutes IS NULL OR turnaround_boarding_minutes BETWEEN 0 AND 120);
ALTER TABLE rotations ADD COLUMN turnaround_deboarding_minutes INTEGER
  CHECK (turnaround_deboarding_minutes IS NULL OR turnaround_deboarding_minutes BETWEEN 0 AND 120);
ALTER TABLE rotations ADD COLUMN turnaround_buffer_minutes INTEGER
  CHECK (turnaround_buffer_minutes IS NULL OR turnaround_buffer_minutes BETWEEN 0 AND 120);
ALTER TABLE rotations ADD COLUMN turnaround_boarding_source TEXT;
ALTER TABLE rotations ADD COLUMN turnaround_deboarding_source TEXT;
ALTER TABLE rotations ADD COLUMN turnaround_buffer_source TEXT;

ALTER TABLE forecast_snapshots ADD COLUMN product_id TEXT
  REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE forecast_snapshots ADD COLUMN assumed_aircraft_id TEXT
  REFERENCES aircraft(id) ON DELETE SET NULL;
ALTER TABLE forecast_snapshots ADD COLUMN boarding_minutes INTEGER
  CHECK (boarding_minutes IS NULL OR boarding_minutes BETWEEN 0 AND 120);
ALTER TABLE forecast_snapshots ADD COLUMN deboarding_minutes INTEGER
  CHECK (deboarding_minutes IS NULL OR deboarding_minutes BETWEEN 0 AND 120);
ALTER TABLE forecast_snapshots ADD COLUMN buffer_minutes INTEGER
  CHECK (buffer_minutes IS NULL OR buffer_minutes BETWEEN 0 AND 120);
ALTER TABLE forecast_snapshots ADD COLUMN boarding_source TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';
ALTER TABLE forecast_snapshots ADD COLUMN deboarding_source TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';
ALTER TABLE forecast_snapshots ADD COLUMN buffer_source TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';
