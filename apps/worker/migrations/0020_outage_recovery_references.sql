CREATE TABLE outage_recovery_references (
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  paper_reference TEXT NOT NULL,
  ticket_group_id TEXT NOT NULL REFERENCES ticket_groups(id) ON DELETE RESTRICT,
  rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE RESTRICT,
  current_state TEXT NOT NULL CHECK (current_state IN ('DRAFT', 'CALLED', 'IN_FLIGHT', 'LANDED', 'COMPLETED')),
  last_source_entry_id TEXT NOT NULL,
  created_by_batch_id TEXT NOT NULL REFERENCES outage_recovery_batches(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (operation_day_id, paper_reference),
  UNIQUE (operation_day_id, rotation_id)
) STRICT;

CREATE INDEX idx_outage_recovery_references_state
  ON outage_recovery_references(operation_day_id, current_state, paper_reference);
