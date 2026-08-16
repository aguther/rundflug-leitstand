import type { AircraftOperationalState } from "@rundflug/domain";
import { dispatchSegmentOrderSql } from "./dispatch-ordering-sql";
import { forecastDurationSamplesSql } from "./forecast-duration-samples-query";
import type { ForecastRecalculationRequest } from "./forecast-timeline-types";

export class ForecastTimelineLoader {
  constructor(private readonly db: D1Database) {}

  async load(request: ForecastRecalculationRequest, queryNowIso: string) {
    const { eventId } = request;
    const [
      event,
      rotationRows,
      durationRows,
      capacityRows,
      turnaroundOverrideRows,
      pilotRows,
      gateWaitRows,
      plannedOperationRows,
      recurringRuleRows,
      activeBlockRows,
      activeDispatchLeaseRows,
    ] = await Promise.all([
      this.db
        .prepare(
          `SELECT version, operational_interrupted, emergency_mode, planned_boarding_minutes,
                 planned_deboarding_minutes, planned_buffer_minutes, updated_at, status,
                 operations_start_at, operations_end_at,
                 automatic_precall_enabled, precall_lead_minutes, max_gate_wait_minutes,
                precall_min_quality, notification_lead_minutes
           FROM operation_days WHERE id = ?1`,
        )
        .bind(eventId)
        .first<{
          version: number;
          operational_interrupted: number;
          emergency_mode: number;
          planned_boarding_minutes: number;
          planned_deboarding_minutes: number;
          planned_buffer_minutes: number;
          operations_start_at: string | null;
          operations_end_at: string | null;
          updated_at: string;
          status: "PREPARATION" | "ACTIVE" | "CLOSED" | "ARCHIVED";
          automatic_precall_enabled: number;
          precall_lead_minutes: number;
          max_gate_wait_minutes: number;
          precall_min_quality: "STABLE" | "CHANGING";
          notification_lead_minutes: number;
        }>(),
      this.db
        .prepare(
          `SELECT r.id, r.status, r.created_at, r.called_at, r.departed_at, r.landed_at,
                r.aircraft_id, r.pilot_id,
                r.completed_at, fg.id AS flight_group_id, fg.version AS flight_group_version,
                fg.precalled_at, fg.precall_decision_status, fg.resource_group_id,
                rg.status AS resource_group_status,
                rg.automatic_precall_enabled AS resource_group_precall_enabled,
                p.id AS product_id,
                COALESCE(MIN(tg.queue_sequence), 1) AS queue_sequence,
                ${dispatchSegmentOrderSql("r", "fg")} AS segment_order,
                fg.communication_number,
                COALESCE((SELECT json_group_array(group_ids.id) FROM (
                  SELECT DISTINCT member_group.id
                    FROM rotation_tickets member_assignment
                    JOIN tickets member_ticket ON member_ticket.id = member_assignment.ticket_id
                    JOIN ticket_groups member_group ON member_group.id = member_ticket.ticket_group_id
                   WHERE member_assignment.rotation_id = r.id
                     AND member_assignment.released_at IS NULL
                   ORDER BY member_group.queue_sequence, member_group.id
                ) group_ids), '[]') AS current_group_ids_json,
                MIN(tg.sold_at) AS sold_at,
                MAX(COALESCE(tg.standby, 0)) AS standby,
                CASE
                  WHEN MAX(CASE WHEN tg.status = 'MISSING' THEN 1 ELSE 0 END) = 1 THEN 'MISSING'
                  WHEN MAX(CASE WHEN tg.status = 'CLARIFICATION' THEN 1 ELSE 0 END) = 1
                    THEN 'CLARIFICATION'
                  WHEN COUNT(DISTINCT rt.ticket_id) > 0
                    AND SUM(CASE WHEN t.attendance_status = 'CHECKED_IN' THEN 1 ELSE 0 END)
                      = COUNT(DISTINCT rt.ticket_id) THEN 'PRESENT'
                  ELSE 'WAITING'
                END AS attendance_status,
                COUNT(DISTINCT rt.ticket_id) AS ticket_count,
                COALESCE(p.reference_duration_minutes, 20) AS reference_duration_minutes,
                COALESCE(p.code, '') AS product_code, a.aircraft_type,
                COALESCE(r.gate_id, p.gate_id) AS gate_id,
                COALESCE(g.travel_lead_minutes, 0) AS gate_travel_lead_minutes,
                r.predicted_departure_at, r.predicted_landing_at, r.predicted_completion_at,
                r.predicted_boarding_at, r.prediction_lower_minutes, r.prediction_upper_minutes,
                r.forecast_assumed_aircraft_id,
                r.dispatch_plan_id, r.dispatch_plan_revision, r.dispatch_batch_id,
                r.dispatch_order, r.dispatch_wave, r.dispatch_lane_id,
                r.dispatch_group_ids_json, r.dispatch_occupied_seats,
                r.dispatch_available_seats, r.dispatch_commitment_level,
                r.dispatch_decision_reasons_json, r.dispatch_decision_details_json,
                r.dispatch_confirmed_overtake_count,
                r.dispatch_projected_overtake_count,
                r.dispatch_unplanned_reason,
                r.turnaround_boarding_minutes, r.turnaround_deboarding_minutes,
                r.turnaround_buffer_minutes, r.turnaround_boarding_source,
                r.turnaround_deboarding_source, r.turnaround_buffer_source
           FROM rotations r
           JOIN flight_groups fg ON fg.id = r.flight_group_id
           JOIN resource_groups rg ON rg.id = fg.resource_group_id
           LEFT JOIN rotation_tickets rt ON rt.rotation_id = r.id AND rt.released_at IS NULL
           LEFT JOIN tickets t ON t.id = rt.ticket_id
           LEFT JOIN ticket_groups tg ON tg.id = t.ticket_group_id
           LEFT JOIN products p ON p.id = fg.product_id
           LEFT JOIN aircraft a ON a.id = r.aircraft_id
           LEFT JOIN gates g ON g.id = COALESCE(r.gate_id, p.gate_id)
          WHERE r.operation_day_id = ?1 AND r.status NOT IN ('COMPLETED', 'CANCELED')
          GROUP BY r.id
          ORDER BY CASE WHEN r.status = 'DRAFT' THEN 1 ELSE 0 END,
                   COALESCE(MIN(tg.queue_sequence), 2147483647),
                   MIN(tg.sold_at), r.created_at, r.id`,
        )
        .bind(eventId)
        .all<{
          id: string;
          status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED";
          created_at: string;
          called_at: string | null;
          departed_at: string | null;
          landed_at: string | null;
          aircraft_id: string | null;
          pilot_id: string | null;
          completed_at: string | null;
          flight_group_id: string;
          flight_group_version: number;
          precalled_at: string | null;
          precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
          resource_group_id: string;
          resource_group_status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
          resource_group_precall_enabled: number;
          product_id: string | null;
          queue_sequence: number;
          segment_order: number;
          communication_number: number;
          current_group_ids_json: string;
          sold_at: string | null;
          standby: number;
          attendance_status: "WAITING" | "PRESENT" | "MISSING" | "CLARIFICATION";
          ticket_count: number;
          reference_duration_minutes: number;
          product_code: string;
          aircraft_type: string | null;
          gate_id: string | null;
          gate_travel_lead_minutes: number;
          predicted_boarding_at: string | null;
          prediction_lower_minutes: number | null;
          prediction_upper_minutes: number | null;
          predicted_departure_at: string | null;
          predicted_landing_at: string | null;
          predicted_completion_at: string | null;
          forecast_assumed_aircraft_id: string | null;
          turnaround_boarding_minutes: number | null;
          turnaround_deboarding_minutes: number | null;
          turnaround_buffer_minutes: number | null;
          turnaround_boarding_source: string | null;
          turnaround_deboarding_source: string | null;
          turnaround_buffer_source: string | null;
          dispatch_plan_id: string | null;
          dispatch_plan_revision: string | null;
          dispatch_batch_id: string | null;
          dispatch_order: number | null;
          dispatch_wave: number | null;
          dispatch_lane_id: string | null;
          dispatch_group_ids_json: string;
          dispatch_occupied_seats: number | null;
          dispatch_available_seats: number | null;
          dispatch_commitment_level: "WAITING" | "PREPARE" | "COME_TO_FLIGHT_LINE" | null;
          dispatch_decision_reasons_json: string;
          dispatch_decision_details_json: string | null;
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
        }>(),
      this.db.prepare(forecastDurationSamplesSql).bind(eventId).all<{
        minutes: number;
        completed_at: string;
        operation_day_id: string;
        product_code: string;
        aircraft_type: string | null;
      }>(),
      this.db
        .prepare(
          `SELECT m.resource_group_id, m.current_pilot_id,
                  a.id AS aircraft_id, a.aircraft_type, a.passenger_seats,
                  a.operational_state, a.operational_interrupted,
                  active_rotation.predicted_completion_at,
                  (SELECT block.expected_review_at
                     FROM operational_blocks block
                    WHERE block.operation_day_id = m.operation_day_id
                      AND block.scope_type = 'AIRCRAFT' AND block.scope_id = a.id
                      AND block.status = 'ACTIVE'
                    ORDER BY block.started_at DESC LIMIT 1) AS expected_review_at
             FROM resource_group_memberships m
             JOIN aircraft a ON a.id = m.aircraft_id
             LEFT JOIN rotations active_rotation ON active_rotation.id = (
               SELECT candidate.id FROM rotations candidate
                WHERE candidate.operation_day_id = m.operation_day_id
                  AND candidate.aircraft_id = a.id
                  AND candidate.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                ORDER BY candidate.updated_at DESC LIMIT 1
             )
            WHERE m.operation_day_id = ?1 AND m.active_until IS NULL
            ORDER BY m.resource_group_id, a.registration`,
        )
        .bind(eventId)
        .all<{
          resource_group_id: string;
          current_pilot_id: string | null;
          aircraft_id: string;
          aircraft_type: string;
          passenger_seats: number;
          operational_state: AircraftOperationalState;
          operational_interrupted: number;
          predicted_completion_at: string | null;
          expected_review_at: string | null;
        }>(),
      this.db
        .prepare(
          `SELECT p.id AS product_id, membership.aircraft_id,
                p.planned_boarding_minutes_override AS product_boarding,
                p.planned_deboarding_minutes_override AS product_deboarding,
                p.planned_buffer_minutes_override AS product_buffer,
                override.planned_boarding_minutes_override AS aircraft_boarding,
                override.planned_deboarding_minutes_override AS aircraft_deboarding,
                override.planned_buffer_minutes_override AS aircraft_buffer
           FROM products p
           JOIN resource_group_memberships membership
             ON membership.operation_day_id = p.operation_day_id
            AND membership.resource_group_id = p.resource_group_id
            AND membership.active_until IS NULL
           LEFT JOIN aircraft_product_turnaround_overrides override
             ON override.operation_day_id = p.operation_day_id
            AND override.product_id = p.id
            AND override.aircraft_id = membership.aircraft_id
          WHERE p.operation_day_id = ?1
          ORDER BY p.id, membership.aircraft_id`,
        )
        .bind(eventId)
        .all<{
          product_id: string;
          aircraft_id: string;
          product_boarding: number | null;
          product_deboarding: number | null;
          product_buffer: number | null;
          aircraft_boarding: number | null;
          aircraft_deboarding: number | null;
          aircraft_buffer: number | null;
        }>(),
      this.db
        .prepare(
          `SELECT pilot.id, pilot.paused, pilot.pause_expected_review_at,
                  active_rotation.predicted_completion_at
             FROM pilots pilot
             LEFT JOIN rotations active_rotation ON active_rotation.id = (
               SELECT candidate.id FROM rotations candidate
                WHERE candidate.operation_day_id = pilot.operation_day_id
                  AND candidate.pilot_id = pilot.id
                  AND candidate.status IN ('CALLED', 'IN_FLIGHT', 'LANDED')
                ORDER BY candidate.updated_at DESC LIMIT 1
             )
            WHERE pilot.operation_day_id = ?1 AND pilot.active = 1
            ORDER BY pilot.operational_code`,
        )
        .bind(eventId)
        .all<{
          id: string;
          paused: number;
          pause_expected_review_at: string | null;
          predicted_completion_at: string | null;
        }>(),
      this.db
        .prepare(
          `SELECT (julianday(r.called_at) - julianday(fg.precalled_at)) * 1440.0 AS minutes,
                COALESCE(fg.precall_gate_travel_lead_minutes, 0) AS gate_travel_lead_minutes
           FROM rotations r
           JOIN flight_groups fg ON fg.id = r.flight_group_id
          WHERE r.called_at IS NOT NULL AND fg.precalled_at IS NOT NULL
            AND r.operation_day_id = ?1
            AND r.called_at >= fg.precalled_at
            AND NOT EXISTS (
              SELECT 1 FROM operational_events interruption
               WHERE interruption.operation_day_id = r.operation_day_id
                 AND interruption.event_type IN ('EVENT_OPERATION_INTERRUPTED', 'EMERGENCY_MODE_TRIGGERED')
                 AND interruption.occurred_at < r.called_at
                 AND interruption.occurred_at >= fg.precalled_at
            )
          ORDER BY r.called_at DESC LIMIT 20`,
        )
        .bind(eventId)
        .all<{ minutes: number; gate_travel_lead_minutes: number }>(),
      this.db
        .prepare(
          `SELECT plan.id, plan.scope_type, plan.scope_id, plan.effect_mode,
                  plan.duration_multiplier_percent, plan.status, plan.activated_at,
                  plan.earliest_start_at,
                  plan.latest_start_at, plan.minimum_duration_minutes,
                  plan.typical_duration_minutes, plan.maximum_duration_minutes,
                  plan.after_rotation_id, after_rotation.predicted_completion_at,
                  after_rotation.completed_at
             FROM planned_operational_constraints plan
             LEFT JOIN rotations after_rotation ON after_rotation.id = plan.after_rotation_id
            WHERE plan.operation_day_id = ?1
              AND plan.recurring_rule_id IS NULL
              AND (
                plan.status = 'PLANNED'
                OR (plan.status = 'ACTIVE' AND plan.effect_mode = 'SLOWDOWN')
              )`,
        )
        .bind(eventId)
        .all<{
          id: string;
          scope_type: "EVENT" | "RESOURCE_GROUP" | "AIRCRAFT" | "PILOT";
          scope_id: string;
          effect_mode: "BLOCKING" | "SLOWDOWN";
          duration_multiplier_percent: number | null;
          status: "PLANNED" | "ACTIVE";
          activated_at: string | null;
          earliest_start_at: string | null;
          latest_start_at: string | null;
          minimum_duration_minutes: number;
          typical_duration_minutes: number;
          maximum_duration_minutes: number;
          after_rotation_id: string | null;
          predicted_completion_at: string | null;
          completed_at: string | null;
        }>(),
      this.db
        .prepare(
          `SELECT id, scope_type, scope_id, trigger_metric, interval_value, progress_value,
                minimum_duration_minutes, typical_duration_minutes, maximum_duration_minutes
           FROM recurring_operational_rules
          WHERE operation_day_id = ?1 AND status = 'ACTIVE'
          ORDER BY scope_type, scope_id, operation_kind, id`,
        )
        .bind(eventId)
        .all<{
          id: string;
          scope_type: "AIRCRAFT" | "PILOT";
          scope_id: string;
          trigger_metric: "COMPLETED_ROTATIONS" | "OPERATING_MINUTES";
          interval_value: number;
          progress_value: number;
          minimum_duration_minutes: number;
          typical_duration_minutes: number;
          maximum_duration_minutes: number;
        }>(),
      this.db
        .prepare(
          `SELECT scope_type, scope_id, expected_review_at
             FROM operational_blocks
            WHERE operation_day_id = ?1 AND status = 'ACTIVE'
              AND scope_type IN ('EVENT', 'RESOURCE_GROUP')`,
        )
        .bind(eventId)
        .all<{
          scope_type: "EVENT" | "RESOURCE_GROUP";
          scope_id: string;
          expected_review_at: string | null;
        }>(),
      this.db
        .prepare(
          `SELECT id, aircraft_id, dispatch_batch_id, member_rotation_ids_json
           FROM dispatch_recommendation_leases
          WHERE operation_day_id = ?1 AND status = 'ACTIVE' AND expires_at > ?2
          ORDER BY acquired_at, id`,
        )
        .bind(eventId, queryNowIso)
        .all<{
          id: string;
          aircraft_id: string;
          dispatch_batch_id: string;
          member_rotation_ids_json: string;
        }>(),
    ]);
    if (!event) throw new Error("EVENT_NOT_FOUND");
    if (
      request.expectedEventVersion !== undefined &&
      event.version !== request.expectedEventVersion
    ) {
      throw new Error("ANALYSIS_SNAPSHOT_STALE_VERSION");
    }

    return {
      event,
      rotationRows,
      durationRows,
      capacityRows,
      turnaroundOverrideRows,
      pilotRows,
      gateWaitRows,
      plannedOperationRows,
      recurringRuleRows,
      activeBlockRows,
      activeDispatchLeaseRows,
    };
  }
}
