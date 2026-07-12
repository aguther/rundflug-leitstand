ALTER TABLE resource_group_memberships
  ADD COLUMN current_pilot_id TEXT REFERENCES pilots(id) ON DELETE RESTRICT;

CREATE INDEX idx_membership_current_pilot
  ON resource_group_memberships(operation_day_id, aircraft_id, current_pilot_id)
  WHERE active_until IS NULL AND current_pilot_id IS NOT NULL;
