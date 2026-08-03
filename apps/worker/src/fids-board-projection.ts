export type FidsProjectionBand = "ALL" | "ACTIONABLE" | "RECENT_DEPARTURE" | "PREPARE" | "LOWER";

export interface FidsProjectionFilter {
  productIds: readonly string[];
  gateIds: readonly string[];
  rotationStatuses: readonly string[];
}

export interface FidsProjectionRow {
  row_id: string;
  rotation_id: string;
  product_id: string;
  gate_id: string | null;
  product_name: string;
  product_code: string;
  gate_label: string;
  communication_number: number;
  precalled_at: string | null;
  precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
  queue_position: number;
  dispatch_order: number | null;
  status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
  predicted_boarding_at: string | null;
  predicted_completion_at: string | null;
  prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
  prediction_lower_minutes: number | null;
  prediction_upper_minutes: number | null;
  prediction_updated_at: string | null;
  dispatch_batch_id: string | null;
  dispatch_unplanned_reason:
    | "NO_FORECAST_CAPACITY"
    | "WAITING_FOR_FITTING_LANE"
    | "WAITING_FOR_PRODUCT_FAIRNESS"
    | "NOT_IN_NEAR_DISPATCH_BATCH"
    | "COMMITMENT_LOCKED"
    | "ATTENDANCE_MISSING"
    | "ATTENDANCE_CLARIFICATION"
    | "UNKNOWN_RESOURCE_RETURN"
    | null;
  recall_id: string | null;
  recall_sequence: number | null;
  recall_started_at: string | null;
  recall_expires_at: string | null;
  aircraft_registration: string | null;
  departed_at: string | null;
  ticket_count: number;
  resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
  resource_group_operational_note: string;
  planned_public_note: string | null;
  sort_rank: number;
  projection_index: number;
}

const projectionCte = `WITH projected AS (
  SELECT r.id || ':' || COALESCE(tg.id, fg.id) AS row_id,
         r.id AS rotation_id,
         COALESCE(MIN(p.id), fg.product_id, 'product:' || fg.resource_group_id) AS product_id,
         MIN(g.id) AS gate_id,
         COALESCE(MIN(p.name), 'Rundflug') AS product_name,
         COALESCE(MIN(p.code), 'RF') AS product_code,
         COALESCE(MIN(g.label), 'Flight Line') AS gate_label,
         COALESCE(tg.communication_number, fg.communication_number) AS communication_number,
         fg.precalled_at, fg.precall_decision_status,
         COALESCE(fg.queue_position, fg.communication_number) AS queue_position,
         r.dispatch_order, r.status,
         r.predicted_boarding_at, r.predicted_completion_at, r.prediction_quality,
         r.prediction_lower_minutes, r.prediction_upper_minutes, r.prediction_updated_at,
         r.dispatch_batch_id, r.dispatch_unplanned_reason,
         recall.id AS recall_id, recall.sequence AS recall_sequence,
         recall.started_at AS recall_started_at, recall.expires_at AS recall_expires_at,
         MIN(a.registration) AS aircraft_registration,
         r.departed_at,
         COUNT(rt.ticket_id) AS ticket_count,
         rg.status AS resource_group_status,
         rg.operational_note AS resource_group_operational_note,
         (SELECT plan.public_note FROM planned_operational_constraints plan
           WHERE plan.operation_day_id = r.operation_day_id AND plan.status = 'ACTIVE'
             AND plan.scope_type = 'RESOURCE_GROUP' AND plan.scope_id = rg.id
             AND plan.public_note <> ''
           ORDER BY plan.activated_at DESC LIMIT 1) AS planned_public_note,
         CASE
           WHEN rg.status = 'ACTIVE' AND r.status = 'CALLED' THEN 0
           WHEN rg.status = 'ACTIVE' AND r.status = 'DRAFT'
             AND fg.precalled_at IS NOT NULL THEN 1
           WHEN rg.status = 'ACTIVE' AND r.status = 'DRAFT'
             AND fg.precall_decision_status = 'PREPARE' THEN 2
           WHEN r.status = 'DRAFT' THEN 3
           ELSE 4
         END AS sort_rank
    FROM rotations r
    JOIN flight_groups fg ON fg.id = r.flight_group_id
    JOIN resource_groups rg ON rg.id = fg.resource_group_id
    LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
    LEFT JOIN tickets t ON t.id = rt.ticket_id
    LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
    LEFT JOIN products p ON p.id = COALESCE(tg.product_id, fg.product_id)
    LEFT JOIN gates g ON g.id = COALESCE(r.gate_id, p.gate_id)
    LEFT JOIN aircraft a ON a.id = r.aircraft_id
    LEFT JOIN ticket_group_recalls recall
      ON recall.ticket_group_id = tg.id
     AND recall.ended_at IS NULL
     AND recall.expires_at > ?6
   WHERE r.operation_day_id = ?1 AND r.status <> 'CANCELED'
     AND (?2 = '[]' OR p.id IN (SELECT value FROM json_each(?2)))
     AND (?3 = '[]' OR g.id IN (SELECT value FROM json_each(?3)))
     AND (?4 = '[]' OR r.status IN (SELECT value FROM json_each(?4)))
     AND (r.status NOT IN ('IN_FLIGHT', 'LANDED', 'COMPLETED') OR r.departed_at > ?5)
   GROUP BY r.id, tg.id
), ranked AS (
  SELECT projected.*,
         CASE WHEN sort_rank IN (0, 1) THEN 1 ELSE 0 END AS actionable_band,
         CASE WHEN status IN ('IN_FLIGHT', 'LANDED', 'COMPLETED') THEN 1 ELSE 0 END
           AS recent_departure_band,
         ROW_NUMBER() OVER (
           ORDER BY sort_rank,
                    CASE WHEN status = 'DRAFT' THEN dispatch_order END,
                    CASE WHEN status = 'DRAFT' THEN predicted_boarding_at END,
                    CASE WHEN status = 'DRAFT' THEN queue_position END,
                    CASE WHEN status IN ('IN_FLIGHT', 'LANDED', 'COMPLETED')
                      THEN departed_at END DESC,
                    communication_number,
                    rotation_id
         ) - 1 AS projection_index
    FROM projected
), selected AS (
  SELECT * FROM ranked
   WHERE (?7 = 'ALL'
      OR (?7 = 'ACTIONABLE' AND actionable_band = 1)
      OR (?7 = 'RECENT_DEPARTURE' AND recent_departure_band = 1)
      OR (?7 = 'PREPARE' AND sort_rank = 2)
      OR (?7 = 'LOWER' AND actionable_band = 0 AND recent_departure_band = 0))
     AND (?8 = '[]' OR row_id NOT IN (SELECT value FROM json_each(?8)))
)`;

function projectionBindings(input: {
  eventId: string;
  filter: FidsProjectionFilter;
  departedVisibilityCutoff: string;
  now: string;
  band: FidsProjectionBand;
  excludedRowIds?: readonly string[];
}): readonly unknown[] {
  return [
    input.eventId,
    JSON.stringify(input.filter.productIds),
    JSON.stringify(input.filter.gateIds),
    JSON.stringify(input.filter.rotationStatuses),
    input.departedVisibilityCutoff,
    input.now,
    input.band,
    JSON.stringify(input.excludedRowIds ?? []),
  ];
}

export async function countFidsProjectionRows(
  db: D1Database,
  input: Parameters<typeof projectionBindings>[0],
): Promise<number> {
  const result = await db
    .prepare(`${projectionCte} SELECT COUNT(*) AS total_items FROM selected`)
    .bind(...projectionBindings(input))
    .first<{ total_items: number }>();
  return result?.total_items ?? 0;
}

export async function loadFidsProjectionRows(
  db: D1Database,
  input: Parameters<typeof projectionBindings>[0] & { limit: number; offset: number },
): Promise<FidsProjectionRow[]> {
  const result = await db
    .prepare(
      `${projectionCte}
       SELECT * FROM selected
        ORDER BY sort_rank,
                 CASE WHEN status = 'DRAFT' THEN dispatch_order END,
                 CASE WHEN status = 'DRAFT' THEN predicted_boarding_at END,
                 CASE WHEN status = 'DRAFT' THEN queue_position END,
                 CASE WHEN status IN ('IN_FLIGHT', 'LANDED', 'COMPLETED')
                   THEN departed_at END DESC,
                 communication_number,
                 rotation_id
        LIMIT ?9 OFFSET ?10`,
    )
    .bind(...projectionBindings(input), input.limit, input.offset)
    .all<FidsProjectionRow>();
  return result.results;
}

export async function loadAllFidsProjectionRows(
  db: D1Database,
  input: Parameters<typeof projectionBindings>[0],
): Promise<FidsProjectionRow[]> {
  const result = await db
    .prepare(
      `${projectionCte}
       SELECT * FROM selected
        ORDER BY sort_rank,
                 CASE WHEN status = 'DRAFT' THEN dispatch_order END,
                 CASE WHEN status = 'DRAFT' THEN predicted_boarding_at END,
                 CASE WHEN status = 'DRAFT' THEN queue_position END,
                 CASE WHEN status IN ('IN_FLIGHT', 'LANDED', 'COMPLETED')
                   THEN departed_at END DESC,
                 communication_number,
                 rotation_id`,
    )
    .bind(...projectionBindings(input))
    .all<FidsProjectionRow>();
  return result.results;
}

export interface FidsProjectionEvent {
  name: string;
  time_zone: string;
  emergency_mode: number;
  operational_interrupted: number;
  operational_note: string;
  operations_end_at: string | null;
  planned_public_note: string | null;
  departed_visibility_seconds: number;
  updated_at: string;
}

export async function loadFidsProjectionEvent(
  db: D1Database,
  eventId: string,
): Promise<FidsProjectionEvent | null> {
  return db
    .prepare(
      `SELECT od.name, od.time_zone, od.emergency_mode, od.operational_interrupted,
              od.operational_note, od.operations_end_at, od.departed_visibility_seconds,
              od.updated_at,
              (SELECT plan.public_note FROM planned_operational_constraints plan
                WHERE plan.operation_day_id = od.id AND plan.status = 'ACTIVE'
                  AND plan.scope_type = 'EVENT' AND plan.scope_id = od.id
                  AND plan.public_note <> ''
                ORDER BY plan.activated_at DESC LIMIT 1) AS planned_public_note
         FROM operation_days od WHERE od.id = ?1`,
    )
    .bind(eventId)
    .first<FidsProjectionEvent>();
}

export async function loadFidsProjectionFleet(db: D1Database, eventId: string) {
  const result = await db
    .prepare(
      `SELECT a.registration, a.operational_state, a.refuel_planned
         FROM aircraft a
         JOIN resource_group_memberships m ON m.aircraft_id = a.id
        WHERE m.operation_day_id = ?1 AND m.active_until IS NULL
        GROUP BY a.id, a.registration, a.operational_state, a.refuel_planned
        ORDER BY a.registration`,
    )
    .bind(eventId)
    .all<{ registration: string; operational_state: string; refuel_planned: number }>();
  return result.results;
}
