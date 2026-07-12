CREATE TABLE outage_recovery_batches (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  created_by_device_id TEXT NOT NULL REFERENCES paired_devices(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  simulated_against_version INTEGER NOT NULL CHECK (simulated_against_version >= 0),
  status TEXT NOT NULL CHECK (status IN ('STAGED', 'CONFLICTED', 'APPROVED', 'APPLYING', 'APPLIED', 'REJECTED')),
  simulation_json TEXT NOT NULL CHECK (json_valid(simulation_json)),
  approved_by_device_id TEXT REFERENCES paired_devices(id) ON DELETE RESTRICT,
  approved_at TEXT,
  applied_at TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
) STRICT;

CREATE TABLE outage_recovery_entries (
  id TEXT PRIMARY KEY,
  source_entry_id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES outage_recovery_batches(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('PAPER_SALE', 'ROTATION_CALLED', 'ROTATION_IN_FLIGHT', 'ROTATION_LANDED', 'ROTATION_COMPLETED')),
  original_occurred_at TEXT NOT NULL,
  paper_sequence INTEGER NOT NULL CHECK (paper_sequence > 0),
  paper_reference TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED', 'CONFLICT', 'APPLIED')),
  conflict_json TEXT CHECK (conflict_json IS NULL OR json_valid(conflict_json)),
  applied_event_sequence INTEGER REFERENCES operational_events(sequence) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_outage_recovery_batches_event
  ON outage_recovery_batches(operation_day_id, status, created_at);
CREATE INDEX idx_outage_recovery_entries_batch
  ON outage_recovery_entries(batch_id, original_occurred_at, paper_sequence);

ALTER TABLE operational_events ADD COLUMN recorded_after_outage INTEGER NOT NULL DEFAULT 0
  CHECK (recorded_after_outage IN (0, 1));
ALTER TABLE operational_events ADD COLUMN original_occurred_at TEXT;
ALTER TABLE operational_events ADD COLUMN recovery_batch_id TEXT;
ALTER TABLE operational_events ADD COLUMN paper_reference TEXT;
