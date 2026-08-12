const PAGE_SIZE = 250;
const encoder = new TextEncoder();

export interface AnalysisExportProjection {
  path: string;
  countKey: string;
  countSql: string;
  pageSql: string;
}

export const analysisExportProjections: readonly AnalysisExportProjection[] = [
  {
    path: "planning/chunks.ndjson",
    countKey: "planningChunks",
    countSql: "SELECT COUNT(*) AS count FROM planning_chunks WHERE operation_day_id = ?1",
    pageSql: `SELECT id, chunk_kind, schema_version, payload_hash, payload_json, byte_size, created_at
                FROM planning_chunks WHERE operation_day_id = ?1 ORDER BY created_at, id`,
  },
  {
    path: "planning/contexts.ndjson",
    countKey: "planningContexts",
    countSql: "SELECT COUNT(*) AS count FROM planning_contexts WHERE operation_day_id = ?1",
    pageSql: `SELECT id, operation_day_version, schema_version, previous_context_id,
                     manifest_json, manifest_hash, anchor_reason, created_at
                FROM planning_contexts WHERE operation_day_id = ?1 ORDER BY created_at, id`,
  },
  {
    path: "planning/runs.ndjson",
    countKey: "planningRuns",
    countSql: "SELECT COUNT(*) AS count FROM planning_runs WHERE operation_day_id = ?1",
    pageSql: `SELECT id, operation_day_version, context_id, previous_run_id, anchor_run_id,
                     replay_distance, calculation_now, captured_at, trigger_event_type, capture_mode,
                     anchor_reason, application_version, requirements_version, source_revision,
                     dispatch_plan_revision, forecast_digest, forecast_semantic_digest, precall_digest,
                     previous_forecast_state_chunk_id, previous_dispatch_state_chunk_id,
                     dispatch_result_chunk_id, precall_result_chunk_id,
                     duration_ms, capture_duration_ms, status, failure_code
                FROM planning_runs WHERE operation_day_id = ?1 ORDER BY captured_at, id`,
  },
  {
    path: "history/forecast-snapshots.ndjson",
    countKey: "forecastSnapshots",
    countSql: "SELECT COUNT(*) AS count FROM forecast_snapshots WHERE operation_day_id = ?1",
    pageSql: `SELECT id, planning_run_id, rotation_id, operation_day_version, captured_at,
                     trigger_event_type, quality, lower_minutes, upper_minutes, data_basis_scope,
                     sample_size, data_age_minutes, active_capacity, reference_duration_minutes,
                     product_id, assumed_aircraft_id, predicted_boarding_at,
                     predicted_departure_at, predicted_landing_at, predicted_completion_at,
                     boarding_minutes, deboarding_minutes, buffer_minutes,
                     boarding_source, deboarding_source, buffer_source,
                     dispatch_plan_id, dispatch_plan_revision, dispatch_batch_id,
                     dispatch_order, dispatch_wave, dispatch_lane_id, dispatch_group_ids_json,
                     dispatch_occupied_seats, dispatch_available_seats,
                     dispatch_commitment_level, dispatch_decision_reasons_json,
                     dispatch_confirmed_overtake_count, dispatch_projected_overtake_count,
                     dispatch_unplanned_reason
                FROM forecast_snapshots WHERE operation_day_id = ?1 ORDER BY captured_at, id`,
  },
  {
    path: "history/operational-events.ndjson",
    countKey: "operationalEvents",
    countSql: "SELECT COUNT(*) AS count FROM operational_events WHERE operation_day_id = ?1",
    pageSql: `SELECT sequence, id, event_type, occurred_at, aggregate_type, aggregate_id,
                     aggregate_version, 1 AS redacted_unknown_payload
                FROM operational_events WHERE operation_day_id = ?1 ORDER BY sequence`,
  },
  {
    path: "history/analysis-archive-events.ndjson",
    countKey: "analysisArchiveEvents",
    countSql: "SELECT COUNT(*) AS count FROM analysis_archive_events WHERE operation_day_id = ?1",
    pageSql: `SELECT id, archive_id, event_type, occurred_at, actor_alias, details_json
                FROM analysis_archive_events WHERE operation_day_id = ?1 ORDER BY occurred_at, id`,
  },
  {
    path: "state/products.ndjson",
    countKey: "products",
    countSql: "SELECT COUNT(*) AS count FROM products WHERE operation_day_id = ?1",
    pageSql: `SELECT id, resource_group_id, code, sale_enabled, sort_order, gate_id,
                     reference_capacity, reference_duration_minutes, sale_closes_at,
                     promised_flight_minutes, planned_boarding_minutes_override,
                     planned_deboarding_minutes_override, planned_buffer_minutes_override,
                     created_at, updated_at
                FROM products WHERE operation_day_id = ?1 ORDER BY sort_order, id`,
  },
  {
    path: "state/gates.ndjson",
    countKey: "gates",
    countSql: "SELECT COUNT(*) AS count FROM gates WHERE operation_day_id = ?1",
    pageSql: `SELECT id, gate_type, active, sort_order, travel_lead_minutes, created_at, updated_at
                FROM gates WHERE operation_day_id = ?1 ORDER BY sort_order, id`,
  },
  {
    path: "state/resource-groups.ndjson",
    countKey: "resourceGroups",
    countSql: "SELECT COUNT(*) AS count FROM resource_groups WHERE operation_day_id = ?1",
    pageSql: `SELECT id, short_code, status, version, gate_id, reference_capacity,
                     automatic_precall_enabled, created_at, updated_at
                FROM resource_groups WHERE operation_day_id = ?1 ORDER BY id`,
  },
  {
    path: "state/aircraft.ndjson",
    countKey: "aircraft",
    countSql: `SELECT COUNT(DISTINCT aircraft_id) AS count FROM resource_group_memberships
                WHERE operation_day_id = ?1`,
    pageSql: `SELECT DISTINCT aircraft.id, aircraft.aircraft_type, aircraft.passenger_seats,
                     aircraft.operational_state, aircraft.refuel_planned,
                     aircraft.rotations_since_refuel, aircraft.refuel_reminder_threshold,
                     aircraft.operational_interrupted, aircraft.version
                FROM aircraft JOIN resource_group_memberships membership
                  ON membership.aircraft_id = aircraft.id
               WHERE membership.operation_day_id = ?1 ORDER BY aircraft.id`,
  },
  {
    path: "state/pilots.ndjson",
    countKey: "pilots",
    countSql: "SELECT COUNT(*) AS count FROM pilots WHERE operation_day_id = ?1",
    pageSql: `SELECT id, operational_code, active, paused, pause_expected_review_at,
                     created_at, updated_at
                FROM pilots WHERE operation_day_id = ?1 ORDER BY id`,
  },
  {
    path: "state/memberships.ndjson",
    countKey: "memberships",
    countSql:
      "SELECT COUNT(*) AS count FROM resource_group_memberships WHERE operation_day_id = ?1",
    pageSql: `SELECT id, resource_group_id, aircraft_id, active_from, active_until, created_at
                FROM resource_group_memberships WHERE operation_day_id = ?1 ORDER BY active_from, id`,
  },
  {
    path: "state/ticket-groups.ndjson",
    countKey: "ticketGroups",
    countSql: "SELECT COUNT(*) AS count FROM ticket_groups WHERE operation_day_id = ?1",
    pageSql: `SELECT ticket_group.id, ticket_group.product_id, ticket_group.communication_number,
                     ticket_group.queue_sequence,
                     (SELECT COUNT(*) FROM tickets WHERE ticket_group_id = ticket_group.id) AS group_size,
                     ticket_group.standby, ticket_group.status, ticket_group.sold_at,
                     ticket_group.deferral_count, ticket_group.recalled_at,
                     ticket_group.recall_count, ticket_group.version
                FROM ticket_groups ticket_group WHERE ticket_group.operation_day_id = ?1
               ORDER BY ticket_group.queue_sequence, ticket_group.id`,
  },
  {
    path: "state/tickets.ndjson",
    countKey: "tickets",
    countSql: `SELECT COUNT(*) AS count FROM tickets ticket JOIN ticket_groups ticket_group
                ON ticket_group.id = ticket.ticket_group_id WHERE ticket_group.operation_day_id = ?1`,
    pageSql: `SELECT ticket.id, ticket.ticket_group_id, ticket.status, ticket.attendance_status,
                     ticket.created_at
                FROM tickets ticket JOIN ticket_groups ticket_group
                  ON ticket_group.id = ticket.ticket_group_id
               WHERE ticket_group.operation_day_id = ?1 ORDER BY ticket.created_at, ticket.id`,
  },
  {
    path: "state/flight-groups.ndjson",
    countKey: "flightGroups",
    countSql: "SELECT COUNT(*) AS count FROM flight_groups WHERE operation_day_id = ?1",
    pageSql: `SELECT id, resource_group_id, communication_number, status, version,
                     created_at, updated_at
                FROM flight_groups WHERE operation_day_id = ?1 ORDER BY communication_number, id`,
  },
  {
    path: "state/rotations.ndjson",
    countKey: "rotations",
    countSql: "SELECT COUNT(*) AS count FROM rotations WHERE operation_day_id = ?1",
    pageSql: `SELECT id, flight_group_id, aircraft_id, pilot_id, status, called_at,
                     departed_at, landed_at, completed_at, usable_capacity,
                     dispatch_plan_id, dispatch_plan_revision, dispatch_batch_id,
                     dispatch_order, dispatch_wave, dispatch_lane_id, dispatch_commitment_level,
                     dispatch_confirmed_overtake_count, dispatch_projected_overtake_count,
                     dispatch_unplanned_reason,
                     version, created_at, updated_at
                FROM rotations WHERE operation_day_id = ?1 ORDER BY created_at, id`,
  },
  {
    path: "state/rotation-tickets.ndjson",
    countKey: "rotationTickets",
    countSql: `SELECT COUNT(*) AS count FROM rotation_tickets assignment JOIN rotations rotation
                ON rotation.id = assignment.rotation_id WHERE rotation.operation_day_id = ?1`,
    pageSql: `SELECT assignment.rotation_id, assignment.ticket_id,
                     assignment.assigned_at, assignment.released_at
                FROM rotation_tickets assignment JOIN rotations rotation
                  ON rotation.id = assignment.rotation_id
               WHERE rotation.operation_day_id = ?1
               ORDER BY assignment.assigned_at, assignment.rotation_id, assignment.ticket_id`,
  },
  {
    path: "state/planned-operations.ndjson",
    countKey: "plannedOperations",
    countSql:
      "SELECT COUNT(*) AS count FROM planned_operational_constraints WHERE operation_day_id = ?1",
    pageSql: `SELECT id, scope_type, scope_id, constraint_kind, start_mode, earliest_start_at,
                     latest_start_at, after_rotation_id, minimum_duration_minutes,
                     typical_duration_minutes, maximum_duration_minutes, status, version,
                     activated_at, cleared_at, canceled_at, recurring_rule_id, recurrence_sequence
                FROM planned_operational_constraints WHERE operation_day_id = ?1 ORDER BY created_at, id`,
  },
  {
    path: "state/recurring-rules.ndjson",
    countKey: "recurringRules",
    countSql:
      "SELECT COUNT(*) AS count FROM recurring_operational_rules WHERE operation_day_id = ?1",
    pageSql: `SELECT id, scope_type, scope_id, operation_kind, trigger_metric, interval_value,
                     progress_value, minimum_duration_minutes, typical_duration_minutes,
                     maximum_duration_minutes, status, sequence_number, version, last_reset_at,
                     disabled_at
                FROM recurring_operational_rules WHERE operation_day_id = ?1 ORDER BY id`,
  },
  {
    path: "state/operational-blocks.ndjson",
    countKey: "operationalBlocks",
    countSql: "SELECT COUNT(*) AS count FROM operational_blocks WHERE operation_day_id = ?1",
    pageSql: `SELECT id, scope_type, scope_id, block_type, status, started_at,
                     expected_review_at, cleared_at, planned_operation_id
                FROM operational_blocks WHERE operation_day_id = ?1 ORDER BY started_at, id`,
  },
] as const;

export async function* pagedNdjson(input: {
  db: D1Database;
  eventId: string;
  sql: string;
  pageSize?: number;
}): AsyncGenerator<Uint8Array> {
  const pageSize = input.pageSize ?? PAGE_SIZE;
  let offset = 0;
  for (;;) {
    const page = await input.db
      .prepare(`${input.sql} LIMIT ?2 OFFSET ?3`)
      .bind(input.eventId, pageSize, offset)
      .all<Record<string, unknown>>();
    for (const row of page.results) yield encoder.encode(`${JSON.stringify(row)}\n`);
    if (page.results.length < pageSize) return;
    offset += page.results.length;
  }
}

export async function loadArchiveEntryCounts(
  db: D1Database,
  eventId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const projection of analysisExportProjections) {
    const row = await db.prepare(projection.countSql).bind(eventId).first<{ count: number }>();
    counts[projection.countKey] = row?.count ?? 0;
  }
  return counts;
}

type JsonValue = boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue };

function csvCell(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function* pagedCsv(input: {
  db: D1Database;
  eventId: string;
  sql: string;
  columns: readonly string[];
}): AsyncGenerator<Uint8Array> {
  yield encoder.encode(`${input.columns.join(",")}\r\n`);
  for await (const line of pagedNdjson({ db: input.db, eventId: input.eventId, sql: input.sql })) {
    const row = JSON.parse(new TextDecoder().decode(line)) as Record<string, JsonValue>;
    yield encoder.encode(`${input.columns.map((column) => csvCell(row[column])).join(",")}\r\n`);
  }
}

export const analysisCsvReports = [
  {
    path: "reports/queue.csv",
    columns: [
      "communication_number",
      "product_id",
      "group_size",
      "queue_sequence",
      "sold_at",
      "status",
      "deferral_count",
    ],
    sql: `SELECT ticket_group.communication_number, ticket_group.product_id,
                 (SELECT COUNT(*) FROM tickets WHERE ticket_group_id = ticket_group.id) AS group_size,
                 ticket_group.queue_sequence, ticket_group.sold_at, ticket_group.status,
                 ticket_group.deferral_count
            FROM ticket_groups ticket_group WHERE ticket_group.operation_day_id = ?1
           ORDER BY ticket_group.queue_sequence, ticket_group.id`,
  },
  {
    path: "reports/forecast-windows.csv",
    columns: [
      "planning_run_id",
      "rotation_id",
      "captured_at",
      "quality",
      "predicted_boarding_at",
      "predicted_departure_at",
      "predicted_landing_at",
      "predicted_completion_at",
    ],
    sql: `SELECT planning_run_id, rotation_id, captured_at, quality, predicted_boarding_at,
                 predicted_departure_at, predicted_landing_at, predicted_completion_at
            FROM forecast_snapshots WHERE operation_day_id = ?1 ORDER BY captured_at, id`,
  },
  {
    path: "reports/resource-timeline.csv",
    columns: [
      "scope_type",
      "scope_id",
      "block_type",
      "status",
      "started_at",
      "expected_review_at",
      "cleared_at",
    ],
    sql: `SELECT scope_type, scope_id, block_type, status, started_at,
                 expected_review_at, cleared_at
            FROM operational_blocks WHERE operation_day_id = ?1 ORDER BY started_at, id`,
  },
] as const;

export const analysisExportPageSize = PAGE_SIZE;
