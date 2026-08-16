export const forecastDurationSamplesSql = `WITH eligible_samples AS (
  SELECT (julianday(r.completed_at) - julianday(r.called_at)) * 1440.0 AS minutes,
         r.completed_at, r.operation_day_id, p.code AS product_code, a.aircraft_type
    FROM rotations r
    JOIN flight_groups fg ON fg.id = r.flight_group_id
    JOIN rotation_tickets rt ON rt.rotation_id = r.id
    JOIN tickets t ON t.id = rt.ticket_id
    JOIN ticket_groups tg ON tg.id = t.ticket_group_id
    JOIN products p ON p.id = tg.product_id
    LEFT JOIN aircraft a ON a.id = r.aircraft_id
   WHERE r.status = 'COMPLETED' AND r.called_at IS NOT NULL AND r.completed_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM operational_events interruption
        WHERE interruption.operation_day_id = r.operation_day_id
          AND interruption.event_type IN ('EVENT_OPERATION_INTERRUPTED', 'EMERGENCY_MODE_TRIGGERED')
          AND interruption.occurred_at < r.completed_at
          AND NOT EXISTS (
            SELECT 1 FROM operational_events resumed
             WHERE resumed.operation_day_id = r.operation_day_id
               AND resumed.occurred_at > interruption.occurred_at
               AND resumed.occurred_at <= r.called_at
               AND ((interruption.event_type = 'EVENT_OPERATION_INTERRUPTED'
                     AND resumed.event_type = 'EVENT_OPERATION_RESUMED')
                 OR (interruption.event_type = 'EMERGENCY_MODE_TRIGGERED'
                     AND resumed.event_type = 'EMERGENCY_MODE_CLEARED'))
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM planned_operational_constraints slowdown
        WHERE slowdown.operation_day_id = r.operation_day_id
          AND slowdown.effect_mode = 'SLOWDOWN'
          AND slowdown.activated_at IS NOT NULL
          AND slowdown.activated_at < r.completed_at
          AND COALESCE(slowdown.cleared_at, '9999-12-31T23:59:59.999Z') > r.called_at
          AND (
            (slowdown.scope_type = 'EVENT' AND slowdown.scope_id = r.operation_day_id)
            OR (slowdown.scope_type = 'RESOURCE_GROUP' AND slowdown.scope_id = fg.resource_group_id)
            OR (slowdown.scope_type = 'AIRCRAFT' AND slowdown.scope_id = r.aircraft_id)
            OR (slowdown.scope_type = 'PILOT' AND slowdown.scope_id = r.pilot_id)
          )
     )
   GROUP BY r.id, p.code, a.aircraft_type
), historical_samples AS (
  SELECT eligible_samples.*,
         ROW_NUMBER() OVER (
           PARTITION BY product_code, COALESCE(aircraft_type, '') ORDER BY completed_at DESC
         ) AS aircraft_history_rank,
         ROW_NUMBER() OVER (
           PARTITION BY product_code ORDER BY completed_at DESC
         ) AS product_history_rank
    FROM eligible_samples
   WHERE operation_day_id <> ?1
)
SELECT minutes, completed_at, operation_day_id, product_code, aircraft_type
  FROM eligible_samples
 WHERE operation_day_id = ?1
UNION ALL
SELECT minutes, completed_at, operation_day_id, product_code, aircraft_type
  FROM historical_samples
 WHERE aircraft_history_rank <= 24 OR product_history_rank <= 24
ORDER BY completed_at DESC`;
