import type { ForecastHistoryQuery } from "@rundflug/contracts";

export type ForecastHistoryStatement = {
  sql: string;
  bindings: Array<string | number>;
};

export function buildForecastHistoryStatement(
  eventId: string,
  query: ForecastHistoryQuery,
): ForecastHistoryStatement {
  const bindings: Array<string | number> = [eventId];
  const clauses = ["fs.operation_day_id = ?1"];
  const addFilter = (column: string, value: string | undefined, operator = "=") => {
    if (value === undefined) return;
    bindings.push(value);
    clauses.push(`${column} ${operator} ?${bindings.length}`);
  };

  addFilter("fs.rotation_id", query.rotationId);
  addFilter("r.aircraft_id", query.aircraftId);
  addFilter("r.pilot_id", query.pilotId);
  addFilter("fs.captured_at", query.since, ">=");
  addFilter("fs.captured_at", query.until, "<=");

  bindings.push(query.limit, query.offset);
  const limitIndex = bindings.length - 1;
  const offsetIndex = bindings.length;
  return {
    bindings,
    sql: `SELECT fs.id AS snapshot_id, fs.rotation_id, r.flight_group_id,
                 fg.communication_number,
                 COALESCE((
                   SELECT MIN(p.code) FROM rotation_tickets rt
                   JOIN tickets t ON t.id = rt.ticket_id
                   JOIN ticket_groups tg ON tg.id = t.ticket_group_id
                   JOIN products p ON p.id = tg.product_id
                  WHERE rt.rotation_id = r.id
                 ), 'FG') AS product_code,
                 r.aircraft_id, a.registration AS aircraft_registration,
                 r.pilot_id, pl.operational_code AS pilot_operational_code,
                 fs.operation_day_version, fs.captured_at, fs.trigger_event_type,
                 fs.quality, fs.lower_minutes, fs.upper_minutes, fs.data_basis_scope,
                 fs.sample_size, fs.data_age_minutes, fs.active_capacity,
                 fs.reference_duration_minutes,
                 fs.predicted_boarding_at, fs.predicted_departure_at,
                 fs.predicted_landing_at, fs.predicted_completion_at,
                 r.called_at, r.departed_at, r.landed_at, r.completed_at,
                 CASE WHEN r.called_at IS NULL OR fs.predicted_boarding_at IS NULL THEN NULL
                   ELSE ROUND((julianday(r.called_at) - julianday(fs.predicted_boarding_at)) * 1440.0, 1)
                 END AS boarding_deviation_minutes,
                 CASE WHEN r.departed_at IS NULL OR fs.predicted_departure_at IS NULL THEN NULL
                   ELSE ROUND((julianday(r.departed_at) - julianday(fs.predicted_departure_at)) * 1440.0, 1)
                 END AS departure_deviation_minutes,
                 CASE WHEN r.landed_at IS NULL OR fs.predicted_landing_at IS NULL THEN NULL
                   ELSE ROUND((julianday(r.landed_at) - julianday(fs.predicted_landing_at)) * 1440.0, 1)
                 END AS landing_deviation_minutes,
                 CASE WHEN r.completed_at IS NULL OR fs.predicted_completion_at IS NULL THEN NULL
                   ELSE ROUND((julianday(r.completed_at) - julianday(fs.predicted_completion_at)) * 1440.0, 1)
                 END AS completion_deviation_minutes,
                 COUNT(*) OVER() AS total_count
            FROM forecast_snapshots fs
            JOIN rotations r ON r.id = fs.rotation_id
            JOIN flight_groups fg ON fg.id = r.flight_group_id
            LEFT JOIN aircraft a ON a.id = r.aircraft_id
            LEFT JOIN pilots pl ON pl.id = r.pilot_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY fs.captured_at DESC, fs.id DESC
           LIMIT ?${limitIndex} OFFSET ?${offsetIndex}`,
  };
}
