import type { OperationalHistoryQuery } from "@rundflug/contracts";

const latestOccurrenceExpression = `COALESCE(
  rt.released_at,
  r.completed_at,
  r.landed_at,
  r.departed_at,
  r.called_at,
  rt.assigned_at,
  tg.sold_at
)`;

export interface OperationalHistoryStatement {
  sql: string;
  bindings: Array<string | number>;
}

export function buildOperationalHistoryStatement(
  eventId: string,
  query: OperationalHistoryQuery,
): OperationalHistoryStatement {
  const conditions = ["tg.operation_day_id = ?1"];
  const bindings: Array<string | number> = [eventId];
  const addFilter = (column: string, value: string | number | undefined) => {
    if (value === undefined || value === "") return;
    bindings.push(value);
    conditions.push(`${column} = ?${bindings.length}`);
  };

  addFilter("t.id", query.ticketId);
  addFilter("tg.id", query.ticketGroupId);
  addFilter("r.id", query.rotationId);
  addFilter("fg.id", query.flightGroupId);
  addFilter("r.aircraft_id", query.aircraftId);
  addFilter("r.pilot_id", query.pilotId);
  addFilter("p.id", query.productId);
  addFilter("rg.id", query.resourceGroupId);
  addFilter("COALESCE(r.gate_id, p.gate_id)", query.gateId);
  addFilter("fg.communication_number", query.communicationNumber);
  addFilter("t.status", query.ticketStatus);
  addFilter("r.status", query.rotationStatus);
  if (query.since) {
    bindings.push(query.since);
    conditions.push(`${latestOccurrenceExpression} >= ?${bindings.length}`);
  }
  if (query.until) {
    bindings.push(query.until);
    conditions.push(`${latestOccurrenceExpression} <= ?${bindings.length}`);
  }

  bindings.push(query.limit, query.offset);
  const limitBinding = bindings.length - 1;
  const offsetBinding = bindings.length;
  return {
    sql: `SELECT
            t.id AS ticket_id,
            tg.id AS ticket_group_id,
            t.status AS ticket_status,
            tg.sold_at,
            rt.assigned_at,
            rt.released_at,
            r.id AS rotation_id,
            r.status AS rotation_status,
            fg.id AS flight_group_id,
            fg.communication_number,
            flight_rg.short_code AS resource_group_short_code,
            p.id AS product_id,
            p.code AS product_code,
            p.name AS product_name,
            rg.id AS resource_group_id,
            rg.name AS resource_group_name,
            COALESCE(r.gate_id, p.gate_id) AS gate_id,
            g.label AS gate_label,
            r.aircraft_id,
            a.registration AS aircraft_registration,
            r.pilot_id,
            pl.operational_code AS pilot_operational_code,
            r.called_at,
            r.departed_at,
            r.landed_at,
            r.completed_at,
            ${latestOccurrenceExpression} AS latest_at,
            COUNT(*) OVER() AS total_count
       FROM tickets t
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
       JOIN resource_groups rg ON rg.id = p.resource_group_id
       LEFT JOIN rotation_tickets rt ON rt.ticket_id = t.id
       LEFT JOIN rotations r ON r.id = rt.rotation_id
       LEFT JOIN flight_groups fg ON fg.id = r.flight_group_id
       LEFT JOIN resource_groups flight_rg ON flight_rg.id = fg.resource_group_id
       LEFT JOIN gates g ON g.id = COALESCE(r.gate_id, p.gate_id)
       LEFT JOIN aircraft a ON a.id = r.aircraft_id
       LEFT JOIN pilots pl ON pl.id = r.pilot_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY latest_at DESC, fg.communication_number, t.id
      LIMIT ?${limitBinding} OFFSET ?${offsetBinding}`,
    bindings,
  };
}
