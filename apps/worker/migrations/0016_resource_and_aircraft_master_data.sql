ALTER TABLE resource_groups ADD COLUMN reference_capacity INTEGER NOT NULL DEFAULT 1
  CHECK (reference_capacity > 0);
ALTER TABLE resource_groups ADD COLUMN planned_rotation_minutes INTEGER NOT NULL DEFAULT 30
  CHECK (planned_rotation_minutes BETWEEN 1 AND 600);
ALTER TABLE resource_groups ADD COLUMN compatible_aircraft_types_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(compatible_aircraft_types_json));

ALTER TABLE aircraft ADD COLUMN maximum_passenger_payload_kg REAL
  CHECK (maximum_passenger_payload_kg IS NULL OR maximum_passenger_payload_kg > 0);
ALTER TABLE resource_group_memberships ADD COLUMN change_reason TEXT NOT NULL DEFAULT 'Migration';
ALTER TABLE resource_group_memberships ADD COLUMN changed_by_device_id TEXT NOT NULL DEFAULT 'system-migration';

CREATE INDEX idx_memberships_history
  ON resource_group_memberships(operation_day_id, aircraft_id, active_from, active_until);
