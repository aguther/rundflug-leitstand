ALTER TABLE flight_groups ADD COLUMN queue_position INTEGER CHECK (queue_position > 0);
ALTER TABLE rotations ADD COLUMN usable_capacity INTEGER CHECK (usable_capacity > 0);

UPDATE flight_groups
   SET queue_position = communication_number
 WHERE queue_position IS NULL;

CREATE INDEX idx_flight_groups_operational_queue
  ON flight_groups(operation_day_id, resource_group_id, status, queue_position);
