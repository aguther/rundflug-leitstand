ALTER TABLE aircraft ADD COLUMN operational_state_changed_at TEXT;

UPDATE aircraft
   SET operational_state_changed_at = COALESCE(
     (
       SELECT MAX(oe.occurred_at)
         FROM operational_events oe
        WHERE oe.event_type IN (
          'AIRCRAFT_OPERATIONAL_STATE_CHANGED',
          'FLIGHT_GROUP_CALLED',
          'MARK_OFF_BLOCK',
          'MARK_ON_BLOCK',
          'TURNAROUND_COMPLETED',
          'ROTATION_CANCELED',
          'ROTATION_ABORTED',
          'CALL_REVOKED',
          'OUTAGE_RECOVERY_APPLIED'
        )
          AND (
            (oe.aggregate_type = 'AIRCRAFT' AND oe.aggregate_id = aircraft.id)
            OR (
              oe.aggregate_type = 'ROTATION'
              AND EXISTS (
                SELECT 1
                  FROM rotations r
                 WHERE r.id = oe.aggregate_id AND r.aircraft_id = aircraft.id
              )
            )
          )
     ),
     (
       SELECT MAX(COALESCE(r.completed_at, r.landed_at, r.departed_at, r.called_at))
         FROM rotations r
        WHERE r.aircraft_id = aircraft.id
     ),
     updated_at
   );
