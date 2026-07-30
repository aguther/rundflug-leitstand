import type { ResourceDayHistoryQuery } from "@rundflug/contracts";

export interface ResourceDayHistoryStatement {
  sql: string;
  bindings: Array<string | number>;
}

export interface PilotPauseEventRow {
  id: string;
  sequence: number;
  eventType: "PILOT_PAUSE_STARTED" | "PILOT_PAUSE_ENDED";
  occurredAt: string;
}

export interface PairedPilotPause {
  id: string;
  type: "PAUSE";
  startedAt: string;
  endedAt: string | null;
  active: boolean;
}

export function buildResourceDayRotationStatement(
  eventId: string,
  query: ResourceDayHistoryQuery,
  from: string,
  observedUntil: string,
): ResourceDayHistoryStatement {
  const scopeColumn = query.scopeType === "AIRCRAFT" ? "r.aircraft_id" : "r.pilot_id";
  return {
    bindings: [eventId, query.scopeId, from, observedUntil],
    sql: `SELECT r.id AS rotation_id, r.flight_group_id,
                 fg.communication_number,
                 rg.id AS resource_group_id, rg.name AS resource_group_name,
                 rg.short_code AS resource_group_short_code,
                 COALESCE(GROUP_CONCAT(DISTINCT p.name), rg.name) AS product_name,
                 COUNT(DISTINCT CASE
                   WHEN rt.released_at IS NULL AND t.status <> 'CANCELED' THEN rt.ticket_id
                 END) AS passenger_count,
                 COALESCE(r.usable_capacity, a.passenger_seats, 1) AS usable_capacity,
                 r.aircraft_id, a.registration AS aircraft_registration,
                 r.pilot_id, pl.operational_code AS pilot_operational_code,
                 r.called_at, r.departed_at, r.landed_at, r.completed_at
            FROM rotations r
            JOIN flight_groups fg ON fg.id = r.flight_group_id
            JOIN resource_groups rg ON rg.id = fg.resource_group_id
            LEFT JOIN aircraft a ON a.id = r.aircraft_id
            LEFT JOIN pilots pl ON pl.id = r.pilot_id
            LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id
            LEFT JOIN tickets t ON t.id = rt.ticket_id
            LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            LEFT JOIN products p ON p.id = tg.product_id
           WHERE r.operation_day_id = ?1
             AND ${scopeColumn} = ?2
             AND r.called_at IS NOT NULL
             AND r.called_at <= ?4
             AND COALESCE(r.completed_at, r.landed_at, r.departed_at, r.called_at) >= ?3
           GROUP BY r.id, r.flight_group_id, fg.communication_number,
                    rg.id, rg.name, rg.short_code, r.usable_capacity,
                    r.aircraft_id, a.registration, a.passenger_seats,
                    r.pilot_id, pl.operational_code,
                    r.called_at, r.departed_at, r.landed_at, r.completed_at
           ORDER BY r.called_at, r.id`,
  };
}

export function buildAircraftBlockStatement(
  eventId: string,
  aircraftId: string,
  from: string,
  observedUntil: string,
): ResourceDayHistoryStatement {
  return {
    bindings: [eventId, aircraftId, from, observedUntil],
    sql: `SELECT id, block_type, status, started_at, cleared_at
            FROM operational_blocks
           WHERE operation_day_id = ?1
             AND scope_type = 'AIRCRAFT'
             AND scope_id = ?2
             AND block_type IN ('REFUELING', 'PAUSE', 'INTERRUPTION')
             AND started_at <= ?4
             AND COALESCE(cleared_at, ?4) >= ?3
           ORDER BY started_at, id`,
  };
}

export function buildPilotPauseEventStatement(
  eventId: string,
  pilotId: string,
  observedUntil: string,
): ResourceDayHistoryStatement {
  return {
    bindings: [eventId, pilotId, observedUntil],
    sql: `SELECT id, sequence, event_type, occurred_at
            FROM operational_events
           WHERE operation_day_id = ?1
             AND aggregate_type = 'PILOT'
             AND aggregate_id = ?2
             AND event_type IN ('PILOT_PAUSE_STARTED', 'PILOT_PAUSE_ENDED')
             AND occurred_at <= ?3
           ORDER BY sequence, id`,
  };
}

export function pairPilotPauseEvents(
  events: readonly PilotPauseEventRow[],
  from: string,
  observedUntil: string,
): PairedPilotPause[] {
  const fromMs = Date.parse(from);
  const observedUntilMs = Date.parse(observedUntil);
  const pauses: PairedPilotPause[] = [];
  let openStart: PilotPauseEventRow | null = null;

  for (const event of [...events].sort(
    (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
  )) {
    const occurredAtMs = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredAtMs) || occurredAtMs > observedUntilMs) continue;
    if (event.eventType === "PILOT_PAUSE_STARTED") {
      if (openStart === null) openStart = event;
      continue;
    }
    if (openStart === null) continue;

    const startedAtMs = Date.parse(openStart.occurredAt);
    if (occurredAtMs >= fromMs && startedAtMs <= observedUntilMs) {
      pauses.push({
        id: `pilot-pause-${openStart.id}`,
        type: "PAUSE",
        startedAt: new Date(Math.max(startedAtMs, fromMs)).toISOString(),
        endedAt: new Date(Math.min(occurredAtMs, observedUntilMs)).toISOString(),
        active: false,
      });
    }
    openStart = null;
  }

  if (openStart !== null) {
    const startedAtMs = Date.parse(openStart.occurredAt);
    if (Number.isFinite(startedAtMs) && startedAtMs <= observedUntilMs) {
      pauses.push({
        id: `pilot-pause-${openStart.id}`,
        type: "PAUSE",
        startedAt: new Date(Math.max(startedAtMs, fromMs)).toISOString(),
        endedAt: null,
        active: true,
      });
    }
  }
  return pauses;
}
