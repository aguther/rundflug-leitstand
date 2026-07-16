ALTER TABLE operation_days ADD COLUMN automatic_precall_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (automatic_precall_enabled IN (0, 1));
ALTER TABLE operation_days ADD COLUMN precall_lead_minutes INTEGER NOT NULL DEFAULT 15
  CHECK (precall_lead_minutes BETWEEN 1 AND 240);
ALTER TABLE operation_days ADD COLUMN max_gate_wait_minutes INTEGER NOT NULL DEFAULT 20
  CHECK (max_gate_wait_minutes BETWEEN 1 AND 120);
ALTER TABLE operation_days ADD COLUMN precall_min_quality TEXT NOT NULL DEFAULT 'CHANGING'
  CHECK (precall_min_quality IN ('STABLE', 'CHANGING'));
ALTER TABLE operation_days ADD COLUMN precall_gate_cooldown_minutes INTEGER NOT NULL DEFAULT 2
  CHECK (precall_gate_cooldown_minutes BETWEEN 0 AND 60);

ALTER TABLE resource_groups ADD COLUMN automatic_precall_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (automatic_precall_enabled IN (0, 1));

ALTER TABLE flight_groups ADD COLUMN precalled_at TEXT;
ALTER TABLE flight_groups ADD COLUMN precall_trigger TEXT;

CREATE INDEX idx_flight_groups_precall
  ON flight_groups(operation_day_id, resource_group_id, precalled_at);
