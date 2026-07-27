-- Release 1.10.0: veranstaltungsbezogene, wiederkehrende Pausen- und Tankregeln.
-- Die Regeln erzeugen ausschließlich weiche Betriebsplaneinträge. Sie ändern niemals
-- selbst einen Flugzeug-, Piloten- oder Veranstaltungszustand.
--
-- Wiederherstellung: Vor der Migration D1 Time Travel beziehungsweise ein portables
-- R2-Backup anlegen. Für eine vollständige Rückkehr muss D1 aus dieser Sicherung
-- wiederhergestellt werden, weil SQLite additive Spalten nicht ohne Tabellenneuaufbau entfernt.
CREATE TABLE recurring_operational_rules (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('AIRCRAFT', 'PILOT')),
  scope_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('PAUSE', 'REFUELING')),
  trigger_metric TEXT NOT NULL
    CHECK (trigger_metric IN ('COMPLETED_ROTATIONS', 'OPERATING_MINUTES')),
  interval_value INTEGER NOT NULL CHECK (interval_value BETWEEN 1 AND 100000),
  progress_value INTEGER NOT NULL DEFAULT 0 CHECK (progress_value BETWEEN 0 AND 100000),
  minimum_duration_minutes INTEGER NOT NULL CHECK (minimum_duration_minutes BETWEEN 1 AND 1440),
  typical_duration_minutes INTEGER NOT NULL CHECK (typical_duration_minutes BETWEEN 1 AND 1440),
  maximum_duration_minutes INTEGER NOT NULL CHECK (maximum_duration_minutes BETWEEN 1 AND 1440),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  sequence_number INTEGER NOT NULL DEFAULT 0 CHECK (sequence_number >= 0),
  reason TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by_device_id TEXT NOT NULL,
  last_reset_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  CHECK (minimum_duration_minutes <= typical_duration_minutes),
  CHECK (typical_duration_minutes <= maximum_duration_minutes),
  CHECK (operation_kind <> 'REFUELING' OR scope_type = 'AIRCRAFT')
) STRICT;

CREATE UNIQUE INDEX idx_recurring_operational_rules_active_target_kind
  ON recurring_operational_rules(operation_day_id, scope_type, scope_id, operation_kind)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_recurring_operational_rules_event_status
  ON recurring_operational_rules(operation_day_id, status, scope_type, scope_id);

ALTER TABLE planned_operational_constraints
  ADD COLUMN recurring_rule_id TEXT
  REFERENCES recurring_operational_rules(id) ON DELETE RESTRICT;

ALTER TABLE planned_operational_constraints
  ADD COLUMN recurrence_sequence INTEGER
  CHECK (recurrence_sequence IS NULL OR recurrence_sequence > 0);

CREATE UNIQUE INDEX idx_planned_operational_constraints_recurring_sequence
  ON planned_operational_constraints(recurring_rule_id, recurrence_sequence)
  WHERE recurring_rule_id IS NOT NULL;
