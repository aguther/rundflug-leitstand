import { withBookingGroupPartProjection } from "./booking-group-part-projection";
import { d1Read, runD1ReadsInBatch } from "./d1-read-scheduler";
import {
  EMPTY_GATE_DISPLAY_FILTER_JSON,
  withGateDisplayFilterFallback,
} from "./gate-display-filter-storage";

export async function loadOperationsReadModels(
  database: D1Database,
  eventId: string,
  projectionReadAt: string,
) {
  const [
    products,
    aircraftProductTurnaroundOverrideRows,
    rotations,
    queueGroupRows,
    dispatchLeaseRows,
    durationRows,
    aircraftRows,
    fleetRows,
    pilotRows,
    gatesRows,
    resourceGroupRows,
    plannedOperationRows,
    recurringRuleRows,
    metricsRow,
  ] = await withGateDisplayFilterFallback((gateDisplayFilterMode) => {
    const displayFilterProjection =
      gateDisplayFilterMode === "current"
        ? "g.display_filter_json"
        : `'${EMPTY_GATE_DISPLAY_FILTER_JSON}' AS display_filter_json`;
    return runD1ReadsInBatch(database, [
      d1Read(
        database
          .prepare(
            `SELECT p.id, p.code, p.name, p.public_description, p.resource_group_id, rg.name AS resource_group_name,
              rg.status AS resource_group_status, rg.operational_note AS resource_group_operational_note,
              p.price_cents, p.sale_enabled, p.reference_capacity, p.reference_duration_minutes,
              p.promised_flight_minutes,
              p.planned_boarding_minutes_override, p.planned_deboarding_minutes_override,
              p.planned_buffer_minutes_override,
              p.sale_closes_at, p.capacity_warning_threshold, p.capacity_critical_threshold,
              p.child_companion_required, p.weight_classes_json, p.sort_order, p.gate_id,
              g.label AS gate_label,
              COUNT(CASE WHEN t.status = 'QUEUED' THEN 1 END) AS queued_tickets,
              (SELECT COUNT(*) FROM tickets shared_t
                JOIN ticket_groups shared_tg ON shared_tg.id = shared_t.ticket_group_id
                JOIN products shared_p ON shared_p.id = shared_tg.product_id
               WHERE shared_p.resource_group_id = p.resource_group_id
                 AND shared_t.status = 'QUEUED') AS resource_group_open_tickets
         FROM products p
         JOIN resource_groups rg ON rg.id = p.resource_group_id
         JOIN gates g ON g.id = p.gate_id
         LEFT JOIN ticket_groups tg ON tg.product_id = p.id
         LEFT JOIN tickets t ON t.ticket_group_id = tg.id
        WHERE p.operation_day_id = ?1
        GROUP BY p.id
        ORDER BY p.sort_order, p.name, p.id`,
          )
          .bind(eventId),
      ).all<{
        id: string;
        code: string;
        name: string;
        public_description: string;
        resource_group_id: string;
        resource_group_name: string;
        resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
        resource_group_operational_note: string;
        price_cents: number;
        gate_id: string;
        gate_label: string;
        child_companion_required: number;
        weight_classes_json: string;
        sort_order: number;
        sale_enabled: number;
        reference_capacity: number;
        reference_duration_minutes: number;
        promised_flight_minutes: number;
        planned_boarding_minutes_override: number | null;
        planned_deboarding_minutes_override: number | null;
        planned_buffer_minutes_override: number | null;
        queued_tickets: number;
        resource_group_open_tickets: number;
        sale_closes_at: string | null;
        capacity_warning_threshold: number;
        capacity_critical_threshold: number;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT aircraft_id, product_id, planned_boarding_minutes_override,
                planned_deboarding_minutes_override, planned_buffer_minutes_override, version
           FROM aircraft_product_turnaround_overrides
          WHERE operation_day_id = ?1
          ORDER BY product_id, aircraft_id`,
          )
          .bind(eventId),
      ).all<{
        aircraft_id: string;
        product_id: string;
        planned_boarding_minutes_override: number | null;
        planned_deboarding_minutes_override: number | null;
        planned_buffer_minutes_override: number | null;
        version: number;
      }>(),
      d1Read(
        database
          .prepare(
            withBookingGroupPartProjection(
              `SELECT r.id, r.version, r.flight_group_id, fg.resource_group_id,
              rotation_rg.short_code AS resource_group_short_code, fg.communication_number,
              COALESCE(fg.queue_position, fg.communication_number) AS queue_position,
              r.status, r.aircraft_id, r.usable_capacity, fg.precalled_at,
              fg.precall_decision_status, fg.precall_decision_reason,
              fg.precall_dispatch_reason,
              fg.precall_decision_at, fg.precall_predicted_boarding_at,
              fg.precall_adaptive_lead_minutes, fg.precall_gate_id,
              fg.precall_adaptive_base_lead_minutes,
              fg.precall_gate_travel_lead_minutes, fg.precall_effective_lead_minutes,
              fg.precall_boarding_window_lower_at, fg.precall_boarding_window_upper_at,
              COALESCE(r.gate_id, MIN(p.gate_id), '') AS gate_id,
              COALESCE(MAX(rotation_gate.label), MIN(product_gate.label), '') AS gate_label,
              r.operational_note,
              r.called_at, r.departed_at, r.landed_at, r.completed_at,
              r.planned_boarding_at, r.planned_departure_at, r.planned_landing_at,
              r.planned_completion_at, r.predicted_boarding_at, r.predicted_departure_at,
              r.predicted_landing_at, r.predicted_completion_at, r.prediction_quality,
              r.prediction_lower_minutes, r.prediction_upper_minutes, r.prediction_updated_at,
              r.forecast_assumed_aircraft_id, r.turnaround_boarding_minutes,
              r.dispatch_plan_id, r.dispatch_plan_revision, r.dispatch_batch_id,
              (SELECT snapshot.operation_day_version
                 FROM forecast_snapshots snapshot
                WHERE snapshot.rotation_id = r.id
                  AND snapshot.dispatch_plan_revision = r.dispatch_plan_revision
                ORDER BY snapshot.captured_at DESC, snapshot.id DESC
                LIMIT 1) AS dispatch_operation_day_version,
              r.dispatch_order, r.dispatch_wave, r.dispatch_lane_id,
              r.dispatch_group_ids_json, r.dispatch_occupied_seats,
              r.dispatch_available_seats, r.dispatch_commitment_level,
              r.dispatch_decision_reasons_json, r.dispatch_confirmed_overtake_count,
              r.dispatch_projected_overtake_count,
              r.dispatch_unplanned_reason,
              r.turnaround_deboarding_minutes, r.turnaround_buffer_minutes,
              r.turnaround_boarding_source, r.turnaround_deboarding_source,
              r.turnaround_buffer_source,
              a.registration AS aircraft_registration,
              r.pilot_id, assigned_pilot.operational_code AS pilot_operational_code,
              (SELECT available_pilot.id FROM pilots available_pilot
                WHERE available_pilot.operation_day_id = r.operation_day_id
                  AND available_pilot.active = 1 AND available_pilot.paused = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM rotations pilot_rotation
                     WHERE pilot_rotation.operation_day_id = r.operation_day_id
                       AND pilot_rotation.pilot_id = available_pilot.id
                       AND pilot_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                  )
                ORDER BY available_pilot.operational_code LIMIT 1) AS suggested_pilot_id,
              (SELECT available_pilot.operational_code FROM pilots available_pilot
                WHERE available_pilot.operation_day_id = r.operation_day_id
                  AND available_pilot.active = 1 AND available_pilot.paused = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM rotations pilot_rotation
                     WHERE pilot_rotation.operation_day_id = r.operation_day_id
                       AND pilot_rotation.pilot_id = available_pilot.id
                       AND pilot_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                  )
                ORDER BY available_pilot.operational_code LIMIT 1) AS suggested_pilot_operational_code,
              (SELECT candidate.id FROM resource_group_memberships membership
                JOIN aircraft candidate ON candidate.id = membership.aircraft_id
               WHERE membership.operation_day_id = r.operation_day_id
                 AND membership.resource_group_id = fg.resource_group_id
                 AND membership.active_until IS NULL
                 AND candidate.operational_state IN ('AVAILABLE', 'BOARDING', 'IN_FLIGHT', 'LANDED', 'TURNAROUND')
                 AND candidate.operational_interrupted = 0
                 AND candidate.passenger_seats >= (
                   SELECT COUNT(*) FROM rotation_tickets capacity_rt
                    WHERE capacity_rt.rotation_id = r.id AND capacity_rt.released_at IS NULL
                 )
               ORDER BY
                 CASE WHEN candidate.operational_state = 'AVAILABLE' THEN 0 ELSE 1 END,
                 COALESCE((
                   SELECT candidate_rotation.predicted_completion_at
                     FROM rotations candidate_rotation
                    WHERE candidate_rotation.operation_day_id = membership.operation_day_id
                      AND candidate_rotation.aircraft_id = candidate.id
                      AND candidate_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                    ORDER BY candidate_rotation.predicted_completion_at DESC
                    LIMIT 1
                 ), '9999-12-31T23:59:59.999Z'),
                 candidate.passenger_seats,
                 candidate.registration
               LIMIT 1) AS suggested_aircraft_id,
              (SELECT candidate.registration FROM resource_group_memberships membership
                JOIN aircraft candidate ON candidate.id = membership.aircraft_id
               WHERE membership.operation_day_id = r.operation_day_id
                 AND membership.resource_group_id = fg.resource_group_id
                 AND membership.active_until IS NULL
                 AND candidate.operational_state IN ('AVAILABLE', 'BOARDING', 'IN_FLIGHT', 'LANDED', 'TURNAROUND')
                 AND candidate.operational_interrupted = 0
                 AND candidate.passenger_seats >= (
                   SELECT COUNT(*) FROM rotation_tickets capacity_rt
                    WHERE capacity_rt.rotation_id = r.id AND capacity_rt.released_at IS NULL
                 )
               ORDER BY
                 CASE WHEN candidate.operational_state = 'AVAILABLE' THEN 0 ELSE 1 END,
                 COALESCE((
                   SELECT candidate_rotation.predicted_completion_at
                     FROM rotations candidate_rotation
                    WHERE candidate_rotation.operation_day_id = membership.operation_day_id
                      AND candidate_rotation.aircraft_id = candidate.id
                      AND candidate_rotation.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                    ORDER BY candidate_rotation.predicted_completion_at DESC
                    LIMIT 1
                 ), '9999-12-31T23:59:59.999Z'),
                 candidate.passenger_seats,
                 candidate.registration
               LIMIT 1) AS suggested_aircraft_registration,
              MIN(tg.id) AS ticket_group_id, MIN(tg.deferral_count) AS deferral_count,
              COUNT(rt.ticket_id) AS ticket_count,
              CASE
                WHEN COUNT(rt.ticket_id) = 0
                  OR SUM(CASE WHEN t.weight_class = 'NOT_CAPTURED' THEN 1 ELSE 0 END) > 0
                THEN NULL
                ELSE SUM(CASE t.weight_class
                  WHEN 'CHILD' THEN od.child_reference_weight_kg
                  WHEN 'NORMAL' THEN od.normal_reference_weight_kg
                  WHEN 'HEAVY' THEN od.heavy_reference_weight_kg
                  WHEN 'INDIVIDUAL' THEN t.individual_weight_kg
                  ELSE NULL
                END)
              END AS estimated_passenger_payload_kg,
              COALESCE(MIN(p.code), 'RUND') AS product_code,
              COALESCE(MIN(p.name), 'Rundflug') AS product_name,
              COALESCE(MIN(p.reference_duration_minutes), 20) AS reference_duration_minutes,
              COALESCE(a.passenger_seats, MIN(p.reference_capacity), rotation_rg.reference_capacity)
                AS baseline_capacity,
              (SELECT json_group_array(json_object(
                'id', attendance_ticket.id,
                'status', attendance_ticket.status,
                'attendanceStatus', attendance_ticket.attendance_status
              ))
                FROM rotation_tickets attendance_rt
                JOIN tickets attendance_ticket ON attendance_ticket.id = attendance_rt.ticket_id
               WHERE attendance_rt.rotation_id = r.id AND attendance_rt.released_at IS NULL) AS tickets_json
              ,(SELECT json_group_array(json_object(
                  'id', grouped_tickets.ticket_group_id,
                  'communicationNumber', grouped_tickets.communication_number,
                  'soldAt', grouped_tickets.sold_at,
                  'ticketCount', grouped_tickets.ticket_count,
                  'presentCount', grouped_tickets.present_count,
                  'partNumber', grouped_tickets.part_number,
                  'partCount', grouped_tickets.part_count
                ))
                  FROM (
                    SELECT grouped_ticket.ticket_group_id,
                           grouped_group.communication_number,
                           grouped_group.sold_at,
                           grouped_part.part_number,
                           grouped_part.part_count,
                           COUNT(*) AS ticket_count,
                           SUM(CASE WHEN grouped_ticket.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END)
                             AS present_count
                      FROM rotation_tickets grouped_rt
                      JOIN tickets grouped_ticket ON grouped_ticket.id = grouped_rt.ticket_id
                      JOIN ticket_groups grouped_group ON grouped_group.id = grouped_ticket.ticket_group_id
                      JOIN booking_group_parts grouped_part
                        ON grouped_part.ticket_group_id = grouped_ticket.ticket_group_id
                       AND grouped_part.rotation_id = grouped_rt.rotation_id
                     WHERE grouped_rt.rotation_id = r.id AND grouped_rt.released_at IS NULL
                     GROUP BY grouped_ticket.ticket_group_id, grouped_group.communication_number,
                              grouped_group.sold_at, grouped_part.part_number,
                              grouped_part.part_count
                  ) grouped_tickets) AS booking_groups_json
         FROM rotations r
         JOIN operation_days od ON od.id = r.operation_day_id
         JOIN flight_groups fg ON fg.id = r.flight_group_id
         JOIN resource_groups rotation_rg ON rotation_rg.id = fg.resource_group_id
         LEFT JOIN aircraft a ON a.id = r.aircraft_id
         LEFT JOIN pilots assigned_pilot ON assigned_pilot.id = r.pilot_id
         LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
         LEFT JOIN tickets t ON t.id = rt.ticket_id
         LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         LEFT JOIN products p ON p.id = tg.product_id
         LEFT JOIN gates rotation_gate ON rotation_gate.id = r.gate_id
         LEFT JOIN gates product_gate ON product_gate.id = p.gate_id
        WHERE r.operation_day_id = ?1 AND r.status <> 'CANCELED'
        GROUP BY r.id
        ORDER BY CASE WHEN r.status = 'DRAFT' THEN 1 ELSE 0 END,
                 COALESCE(fg.queue_position, fg.communication_number), fg.communication_number`,
            ),
          )
          .bind(eventId),
      ).all<{
        id: string;
        version: number;
        flight_group_id: string;
        resource_group_id: string;
        resource_group_short_code: string;
        communication_number: number;
        queue_position: number;
        status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
        precalled_at: string | null;
        precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
        precall_decision_reason:
          | "ELIGIBLE"
          | "DISABLED"
          | "OPERATIONS_BLOCKED"
          | "NOT_QUEUE_FRONT"
          | "ALREADY_PRECALLED"
          | "NO_FORECAST_CAPACITY"
          | "NO_FITTING_AIRCRAFT"
          | "TOO_EARLY"
          | null;
        precall_dispatch_reason:
          | "NOT_IN_NEAR_DISPATCH_BATCH"
          | "GATE_CAPACITY_COVERED"
          | "WAITING_FOR_PRODUCT_FAIRNESS"
          | "WAITING_FOR_FITTING_LANE"
          | "COMMITMENT_LOCKED"
          | "DISPATCH_PLAN_STALE"
          | null;
        precall_decision_at: string | null;
        precall_predicted_boarding_at: string | null;
        precall_adaptive_lead_minutes: number | null;
        precall_gate_id: string | null;
        precall_adaptive_base_lead_minutes: number | null;
        precall_gate_travel_lead_minutes: number | null;
        precall_effective_lead_minutes: number | null;
        precall_boarding_window_lower_at: string | null;
        precall_boarding_window_upper_at: string | null;
        gate_id: string;
        gate_label: string;
        operational_note: string;
        aircraft_id: string | null;
        aircraft_registration: string | null;
        pilot_id: string | null;
        pilot_operational_code: string | null;
        suggested_pilot_id: string | null;
        suggested_pilot_operational_code: string | null;
        suggested_aircraft_id: string | null;
        suggested_aircraft_registration: string | null;
        ticket_group_id: string;
        deferral_count: number;
        ticket_count: number;
        baseline_capacity: number;
        usable_capacity: number | null;
        estimated_passenger_payload_kg: number | null;
        product_code: string;
        product_name: string;
        reference_duration_minutes: number;
        called_at: string | null;
        departed_at: string | null;
        landed_at: string | null;
        completed_at: string | null;
        planned_boarding_at: string | null;
        planned_departure_at: string | null;
        planned_landing_at: string | null;
        planned_completion_at: string | null;
        predicted_boarding_at: string | null;
        predicted_departure_at: string | null;
        predicted_landing_at: string | null;
        predicted_completion_at: string | null;
        prediction_quality: "STABLE" | "CHANGING" | "UNCERTAIN" | null;
        prediction_lower_minutes: number | null;
        prediction_upper_minutes: number | null;
        prediction_updated_at: string | null;
        forecast_assumed_aircraft_id: string | null;
        dispatch_plan_id: string | null;
        dispatch_plan_revision: string | null;
        dispatch_batch_id: string | null;
        dispatch_operation_day_version: number | null;
        dispatch_order: number | null;
        dispatch_wave: number | null;
        dispatch_lane_id: string | null;
        dispatch_group_ids_json: string;
        dispatch_occupied_seats: number | null;
        dispatch_available_seats: number | null;
        dispatch_commitment_level: "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE" | null;
        dispatch_decision_reasons_json: string;
        dispatch_confirmed_overtake_count: number;
        dispatch_projected_overtake_count: number;
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
        turnaround_boarding_minutes: number | null;
        turnaround_deboarding_minutes: number | null;
        turnaround_buffer_minutes: number | null;
        turnaround_boarding_source: string | null;
        turnaround_deboarding_source: string | null;
        turnaround_buffer_source: string | null;
        tickets_json: string;
        booking_groups_json: string;
      }>(),
      d1Read(
        database
          .prepare(
            `WITH segment_stats AS (
           SELECT segment_ticket.ticket_group_id, segment_rotation.id AS rotation_id,
                  segment_rotation.status,
                  COALESCE(segment_group.queue_position, segment_group.communication_number)
                    AS segment_order,
                  segment_group.communication_number,
                  segment_group.precalled_at,
                  COUNT(*) AS ticket_count,
                  SUM(CASE WHEN segment_ticket.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END)
                    AS present_count
             FROM rotation_tickets segment_assignment
             JOIN tickets segment_ticket ON segment_ticket.id = segment_assignment.ticket_id
             JOIN rotations segment_rotation ON segment_rotation.id = segment_assignment.rotation_id
             JOIN flight_groups segment_group ON segment_group.id = segment_rotation.flight_group_id
            WHERE segment_assignment.released_at IS NULL
              AND segment_rotation.operation_day_id = ?1
              AND segment_rotation.status <> 'CANCELED'
            GROUP BY segment_ticket.ticket_group_id, segment_rotation.id, segment_rotation.status,
                     segment_group.queue_position, segment_group.communication_number,
                     segment_group.precalled_at
         ), ranked_segments AS (
           SELECT segment_stats.*,
                  ROW_NUMBER() OVER (
                    PARTITION BY ticket_group_id
                    ORDER BY segment_order, communication_number, rotation_id
                  ) AS segment_index,
                  COUNT(*) OVER (PARTITION BY ticket_group_id) AS segment_count
             FROM segment_stats
         ), next_draft_segments AS (
           SELECT ranked_drafts.*
             FROM (
               SELECT ranked_segments.*,
                      ROW_NUMBER() OVER (
                        PARTITION BY ticket_group_id ORDER BY segment_index
                      ) AS draft_rank
                 FROM ranked_segments
                WHERE status = 'DRAFT'
             ) ranked_drafts
            WHERE ranked_drafts.draft_rank = 1
         )
         SELECT tg.id, tg.communication_number, tg.queue_sequence, tg.status,
                active_recall.id AS recall_id,
                active_recall.sequence AS recall_sequence,
                active_recall.started_at AS recall_started_at,
                active_recall.expires_at AS recall_expires_at,
                COALESCE((
                  SELECT MAX(recall_count.sequence)
                    FROM ticket_group_recalls recall_count
                   WHERE recall_count.ticket_group_id = tg.id
                ), 0) AS recall_count,
                p.id AS product_id, p.code AS product_code,
                p.name AS product_name, p.resource_group_id, p.gate_id,
                g.label AS gate_label,
                COUNT(t.id) AS ticket_count,
                SUM(CASE WHEN t.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS present_count,
                next_segment.ticket_count AS next_segment_ticket_count,
                next_segment.present_count AS next_segment_present_count,
                next_segment.segment_index,
                next_segment.segment_count,
                next_segment.precalled_at
           FROM ticket_groups tg
           JOIN products p ON p.id = tg.product_id
           JOIN gates g ON g.id = p.gate_id
           JOIN tickets t ON t.ticket_group_id = tg.id
           JOIN next_draft_segments next_segment ON next_segment.ticket_group_id = tg.id
           LEFT JOIN ticket_group_recalls active_recall
             ON active_recall.ticket_group_id = tg.id
            AND active_recall.ended_at IS NULL
            AND active_recall.expires_at > ?2
          WHERE tg.operation_day_id = ?1 AND tg.status IN ('QUEUED', 'PRESENT', 'MISSING')
          GROUP BY tg.id, p.id, next_segment.ticket_count, next_segment.present_count,
                   next_segment.segment_index, next_segment.segment_count,
                   next_segment.precalled_at,
                   active_recall.id, active_recall.sequence, active_recall.started_at,
                   active_recall.expires_at
          ORDER BY tg.queue_sequence`,
          )
          .bind(eventId, projectionReadAt),
      ).all<{
        id: string;
        communication_number: number;
        queue_sequence: number;
        status: string;
        recall_count: number;
        recall_id: string | null;
        recall_sequence: number | null;
        recall_started_at: string | null;
        recall_expires_at: string | null;
        product_id: string;
        product_code: string;
        product_name: string;
        resource_group_id: string;
        gate_id: string;
        gate_label: string;
        ticket_count: number;
        present_count: number;
        next_segment_ticket_count: number;
        next_segment_present_count: number;
        segment_index: number;
        segment_count: number;
        precalled_at: string | null;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT reserved_group.value AS ticket_group_id, lease.operator_account_id, lease.device_id
           FROM dispatch_recommendation_leases lease
           JOIN json_each(lease.ticket_group_ids_json) reserved_group
          WHERE lease.operation_day_id = ?1 AND lease.status = 'ACTIVE'
            AND lease.expires_at > ?2
          ORDER BY lease.acquired_at, lease.id`,
          )
          .bind(eventId, projectionReadAt),
      ).all<{
        ticket_group_id: string;
        operator_account_id: string;
        device_id: string;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT (julianday(landed_at) - julianday(departed_at)) * 1440.0 AS duration_minutes
         FROM rotations
        WHERE operation_day_id = ?1 AND departed_at IS NOT NULL AND landed_at IS NOT NULL
        ORDER BY landed_at DESC LIMIT 12`,
          )
          .bind(eventId),
      ).all<{ duration_minutes: number }>(),
      d1Read(
        database
          .prepare(
            `SELECT m.resource_group_id, a.passenger_seats, a.refuel_planned,
                a.operational_state, a.operational_interrupted
           FROM aircraft a
         JOIN resource_group_memberships m ON m.aircraft_id = a.id
        WHERE m.operation_day_id = ?1 AND m.active_until IS NULL`,
          )
          .bind(eventId),
      ).all<{
        resource_group_id: string;
        passenger_seats: number;
        refuel_planned: number;
        operational_state: string;
        operational_interrupted: number;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT a.id, a.version, a.registration, a.aircraft_type, a.passenger_seats,
              a.maximum_passenger_payload_kg, a.operational_state,
              COALESCE(a.operational_state_changed_at, a.updated_at) AS operational_state_changed_at,
              a.refuel_planned, a.rotations_since_refuel, a.refuel_reminder_threshold,
              a.operational_interrupted,
              m.resource_group_id, rg.name AS resource_group_name,
              rg.short_code AS resource_group_short_code,
              m.current_pilot_id, current_pilot.operational_code AS current_pilot_operational_code,
              (SELECT b.expected_review_at FROM operational_blocks b
                WHERE b.operation_day_id = m.operation_day_id AND b.scope_type = 'AIRCRAFT'
                  AND b.scope_id = a.id AND b.status = 'ACTIVE'
                ORDER BY b.started_at DESC LIMIT 1) AS expected_review_at
         FROM aircraft a
         LEFT JOIN resource_group_memberships m ON m.aircraft_id = a.id
          AND m.operation_day_id = ?1 AND m.active_until IS NULL
         LEFT JOIN resource_groups rg ON rg.id = m.resource_group_id
         LEFT JOIN pilots current_pilot ON current_pilot.id = m.current_pilot_id
        ORDER BY a.registration`,
          )
          .bind(eventId),
      ).all<{
        id: string;
        version: number;
        registration: string;
        aircraft_type: string;
        passenger_seats: number;
        maximum_passenger_payload_kg: number | null;
        operational_state: string;
        operational_state_changed_at: string;
        refuel_planned: number;
        rotations_since_refuel: number;
        refuel_reminder_threshold: number;
        operational_interrupted: number;
        resource_group_id: string | null;
        resource_group_name: string | null;
        resource_group_short_code: string | null;
        current_pilot_id: string | null;
        current_pilot_operational_code: string | null;
        expected_review_at: string | null;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT p.id, p.operational_code, p.operational_note, p.active, p.paused,
              p.pause_expected_review_at,
              (SELECT r.id FROM rotations r WHERE r.operation_day_id = p.operation_day_id
                AND r.pilot_id = p.id AND r.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                ORDER BY r.updated_at DESC LIMIT 1) AS current_rotation_id,
              (SELECT fg.communication_number FROM rotations r
                JOIN flight_groups fg ON fg.id = r.flight_group_id
                WHERE r.operation_day_id = p.operation_day_id AND r.pilot_id = p.id
                  AND r.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                ORDER BY r.updated_at DESC LIMIT 1) AS current_communication_number
         FROM pilots p WHERE p.operation_day_id = ?1 ORDER BY p.operational_code`,
          )
          .bind(eventId),
      ).all<{
        id: string;
        operational_code: string;
        operational_note: string;
        active: number;
        paused: number;
        pause_expected_review_at: string | null;
        current_rotation_id: string | null;
        current_communication_number: number | null;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT g.id, g.label, g.gate_type, g.active, g.sort_order,
                g.travel_lead_minutes, ${displayFilterProjection},
                COALESCE((SELECT json_group_array(rg.id) FROM resource_groups rg
                  WHERE rg.operation_day_id = g.operation_day_id AND rg.gate_id = g.id), '[]')
                  AS assigned_resource_group_ids_json
             FROM gates g WHERE g.operation_day_id = ?1 ORDER BY g.sort_order, g.label`,
          )
          .bind(eventId),
      ).all<{
        id: string;
        label: string;
        gate_type: "FLIGHT_LINE" | "BOARDING" | "DISPLAY_ONLY";
        active: number;
        sort_order: number;
        travel_lead_minutes: number;
        display_filter_json: string;
        assigned_resource_group_ids_json: string;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT rg.id, rg.version, rg.name, rg.short_code, rg.status, rg.operational_note,
              rg.gate_id, g.label AS gate_label,
              rg.reference_capacity,
              rg.compatible_aircraft_types_json, rg.automatic_precall_enabled,
              COALESCE((SELECT json_group_array(m.aircraft_id)
                FROM resource_group_memberships m
               WHERE m.operation_day_id = rg.operation_day_id
                 AND m.resource_group_id = rg.id AND m.active_until IS NULL), '[]') AS aircraft_ids_json
         FROM resource_groups rg JOIN gates g ON g.id = rg.gate_id
        WHERE rg.operation_day_id = ?1 ORDER BY rg.name`,
          )
          .bind(eventId),
      ).all<{
        id: string;
        version: number;
        name: string;
        short_code: string;
        status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
        operational_note: string;
        gate_id: string;
        gate_label: string;
        reference_capacity: number;
        compatible_aircraft_types_json: string;
        automatic_precall_enabled: number;
        aircraft_ids_json: string;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT plan.id, plan.version, plan.scope_type, plan.scope_id,
                plan.constraint_kind, plan.effect_mode, plan.duration_multiplier_percent,
                plan.start_mode, plan.earliest_start_at,
                plan.latest_start_at, plan.after_rotation_id,
                plan.minimum_duration_minutes, plan.typical_duration_minutes,
                plan.maximum_duration_minutes, plan.status, plan.public_note,
                plan.created_at, plan.updated_at, plan.activated_at, plan.cleared_at,
                plan.canceled_at, plan.recurring_rule_id, plan.recurrence_sequence,
                after_rotation.status AS after_rotation_status
           FROM planned_operational_constraints plan
           LEFT JOIN rotations after_rotation ON after_rotation.id = plan.after_rotation_id
          WHERE plan.operation_day_id = ?1
          ORDER BY
            CASE plan.status WHEN 'ACTIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
            COALESCE(plan.earliest_start_at, plan.created_at), plan.created_at`,
          )
          .bind(eventId),
      ).all<{
        id: string;
        version: number;
        scope_type: "EVENT" | "RESOURCE_GROUP" | "AIRCRAFT" | "PILOT";
        scope_id: string;
        constraint_kind: "PAUSE" | "REFUELING" | "FLIGHT_SHOW" | "WEATHER" | "TECHNICAL" | "OTHER";
        effect_mode: "BLOCKING" | "SLOWDOWN";
        duration_multiplier_percent: number | null;
        start_mode: "TIME_WINDOW" | "AFTER_CURRENT_ROTATION";
        earliest_start_at: string | null;
        latest_start_at: string | null;
        after_rotation_id: string | null;
        minimum_duration_minutes: number;
        typical_duration_minutes: number;
        maximum_duration_minutes: number;
        status: "PLANNED" | "ACTIVE" | "CLEARED" | "CANCELED";
        public_note: string;
        created_at: string;
        updated_at: string;
        activated_at: string | null;
        cleared_at: string | null;
        canceled_at: string | null;
        recurring_rule_id: string | null;
        recurrence_sequence: number | null;
        after_rotation_status: string | null;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT rule.id, rule.operation_day_id, rule.version, rule.scope_type, rule.scope_id,
                rule.operation_kind, rule.trigger_metric, rule.interval_value,
                rule.progress_value, rule.minimum_duration_minutes,
                rule.typical_duration_minutes, rule.maximum_duration_minutes,
                rule.status, rule.sequence_number, rule.reason, rule.last_reset_at,
                rule.created_at, rule.updated_at,
                (SELECT plan.id FROM planned_operational_constraints plan
                  WHERE plan.recurring_rule_id = rule.id
                    AND plan.status IN ('PLANNED', 'ACTIVE')
                  ORDER BY plan.recurrence_sequence DESC LIMIT 1) AS open_plan_id
           FROM recurring_operational_rules rule
          WHERE rule.operation_day_id = ?1
          ORDER BY CASE rule.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
                   rule.scope_type, rule.scope_id, rule.operation_kind`,
          )
          .bind(eventId),
      ).all<{
        id: string;
        operation_day_id: string;
        version: number;
        scope_type: "AIRCRAFT" | "PILOT";
        scope_id: string;
        operation_kind: "PAUSE" | "REFUELING";
        trigger_metric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
        interval_value: number;
        progress_value: number;
        minimum_duration_minutes: number;
        typical_duration_minutes: number;
        maximum_duration_minutes: number;
        status: "ACTIVE" | "DISABLED";
        sequence_number: number;
        reason: string;
        last_reset_at: string;
        created_at: string;
        updated_at: string;
        open_plan_id: string | null;
      }>(),
      d1Read(
        database
          .prepare(
            `SELECT
          (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1
              AND t.status NOT IN ('COMPLETED', 'CANCELED', 'NO_SHOW')) AS open_tickets,
          (SELECT COUNT(*) FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1) AS sold_tickets,
          (SELECT COUNT(*) FROM rotations WHERE operation_day_id = ?1 AND status = 'COMPLETED') AS completed_rotations,
          (SELECT COUNT(*) FROM rotations WHERE operation_day_id = ?1
            AND status IN ('CALLED', 'IN_FLIGHT', 'LANDED')) AS active_rotations,
          (SELECT ROUND(AVG((julianday(departed_at) - julianday(called_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND called_at IS NOT NULL AND departed_at IS NOT NULL)
            AS average_boarding_minutes,
          (SELECT ROUND(AVG((julianday(landed_at) - julianday(departed_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND departed_at IS NOT NULL AND landed_at IS NOT NULL)
            AS average_flight_minutes,
          (SELECT ROUND(AVG((julianday(completed_at) - julianday(landed_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND landed_at IS NOT NULL AND completed_at IS NOT NULL)
            AS average_turnaround_minutes,
          (SELECT ROUND(AVG((julianday(completed_at) - julianday(called_at)) * 1440.0), 1)
            FROM rotations WHERE operation_day_id = ?1 AND called_at IS NOT NULL AND completed_at IS NOT NULL)
            AS average_rotation_minutes,
          (SELECT ROUND(AVG((julianday(r.called_at) - julianday(tg.sold_at)) * 1440.0), 1)
            FROM ticket_groups tg
            JOIN tickets t ON t.ticket_group_id = tg.id
            JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
            JOIN rotations r ON r.id = rt.rotation_id
            WHERE tg.operation_day_id = ?1 AND r.called_at IS NOT NULL) AS average_wait_minutes,
          (SELECT COALESCE(SUM(CASE WHEN t.status <> 'CANCELED' THEN t.price_cents ELSE 0 END), 0)
            FROM tickets t JOIN ticket_groups tg ON tg.id = t.ticket_group_id
            WHERE tg.operation_day_id = ?1) AS informational_revenue_cents,
          (SELECT COUNT(*) FROM paired_devices WHERE operation_day_id = ?1 AND active = 1
            AND last_seen_at >= ?2) AS active_devices,
          (SELECT COUNT(*) FROM web_push_subscriptions WHERE operation_day_id = ?1
            AND status = 'ACTIVE' AND delete_after > ?3) AS active_push_subscriptions`,
          )
          .bind(eventId, new Date(Date.now() - 120_000).toISOString(), new Date().toISOString()),
      ).first<{
        open_tickets: number;
        sold_tickets: number;
        completed_rotations: number;
        active_rotations: number;
        average_boarding_minutes: number | null;
        average_flight_minutes: number | null;
        average_turnaround_minutes: number | null;
        average_rotation_minutes: number | null;
        average_wait_minutes: number | null;
        informational_revenue_cents: number;
        active_devices: number;
        active_push_subscriptions: number;
      }>(),
    ] as const);
  });

  let assistClaims: Array<{
    aircraft_id: string;
    operator_account_id: string;
    login_code: string;
    claimed_at: string;
    expires_at: string;
    revision: number;
  }> = [];
  try {
    const claims = await database
      .prepare(
        `SELECT claim.aircraft_id, claim.operator_account_id, account.login_code,
              claim.claimed_at, claim.expires_at, claim.revision
         FROM flight_line_assist_claims claim
         JOIN operator_accounts account ON account.id = claim.operator_account_id
        WHERE claim.operation_day_id = ?1 AND claim.expires_at > ?2
        ORDER BY claim.claimed_at`,
      )
      .bind(eventId, new Date().toISOString())
      .all<{
        aircraft_id: string;
        operator_account_id: string;
        login_code: string;
        claimed_at: string;
        expires_at: string;
        revision: number;
      }>();
    assistClaims = claims.results;
  } catch (cause) {
    if (!String(cause).includes("no such table: flight_line_assist_claims")) throw cause;
  }

  return {
    products,
    aircraftProductTurnaroundOverrideRows,
    rotations,
    queueGroupRows,
    dispatchLeaseRows,
    durationRows,
    aircraftRows,
    fleetRows,
    pilotRows,
    gatesRows,
    resourceGroupRows,
    plannedOperationRows,
    recurringRuleRows,
    metricsRow,
    assistClaims,
  };
}
