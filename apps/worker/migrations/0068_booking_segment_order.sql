-- Persist the technical split sequence so dispatch reads do not depend on display identifiers.
-- Create a D1 Time Travel bookmark or portable backup before applying this additive migration.
ALTER TABLE rotations ADD COLUMN booking_segment_order INTEGER NOT NULL DEFAULT 1
  CHECK (booking_segment_order >= 1);

UPDATE rotations
   SET booking_segment_order = COALESCE((
     SELECT CAST(sold_segment.key AS INTEGER) + 1
       FROM operational_events sold_event,
            json_each(sold_event.payload_json, '$.rotationIds') sold_segment
      WHERE sold_event.operation_day_id = rotations.operation_day_id
        AND sold_event.event_type = 'TICKET_GROUP_SOLD'
        AND sold_segment.value = rotations.id
      ORDER BY sold_event.occurred_at, sold_event.id
      LIMIT 1
   ), 1);
