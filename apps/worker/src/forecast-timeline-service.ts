import {
  type AircraftOperationalState,
  type AutomaticPrecallQueueEntry,
  calculateForecastTimelineResult,
  DEFAULT_DISPATCH_PLANNING_LIMITS,
  type DispatchLockedBatchInput,
  type DispatchPlan,
  deriveAdaptivePrecallLeadMinutes,
  type ForecastTimelinesInput,
  normalizePrecallObservation,
  resolveTurnaroundProfile,
  selectAutomaticPrecalls,
} from "@rundflug/domain";
import { dispatchSegmentOrderSql } from "./dispatch-ordering-sql";
import {
  completePlanningCapture,
  failPlanningCapture,
  type PreparedPlanningCapture,
  preparePlanningCapture,
} from "./planning-capture";
import type { Env } from "./types";
import { queueEligiblePreparationNotifications, sendRotationPushNotifications } from "./web-push";

export interface ForecastRecalculationRequest {
  eventId: string;
  triggerEventType: string;
  planningRunId?: string;
  expectedEventVersion?: number;
}

export interface ForecastRecalculationResult {
  planningRunId: string;
  eventVersion: number;
  dispatchPlanRevision: string;
}

export class ForecastTimelineService {
  constructor(
    private readonly env: Env,
    private readonly getWebSockets: () => WebSocket[],
    private readonly scheduleFollowUp: (request: ForecastRecalculationRequest) => void,
  ) {}

  private stringArray(value: string): string[] {
    try {
      return (JSON.parse(value) as unknown[]).filter(
        (entry): entry is string => typeof entry === "string",
      );
    } catch {
      return [];
    }
  }

  async recalculateForecastTimelines(
    request: ForecastRecalculationRequest,
  ): Promise<ForecastRecalculationResult> {
    const { eventId, triggerEventType } = request;
    const queryNowIso = new Date().toISOString();
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
      this.env.DB.prepare(
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
      this.env.DB.prepare(
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
                r.dispatch_decision_reasons_json, r.dispatch_confirmed_overtake_count,
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
      this.env.DB.prepare(
        `SELECT (julianday(r.completed_at) - julianday(r.called_at)) * 1440.0 AS minutes,
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
                   OR (slowdown.scope_type = 'RESOURCE_GROUP'
                       AND slowdown.scope_id = fg.resource_group_id)
                   OR (slowdown.scope_type = 'AIRCRAFT' AND slowdown.scope_id = r.aircraft_id)
                   OR (slowdown.scope_type = 'PILOT' AND slowdown.scope_id = r.pilot_id)
                 )
            )
          GROUP BY r.id, p.code, a.aircraft_type
          ORDER BY r.completed_at DESC LIMIT 200`,
      ).all<{
        minutes: number;
        completed_at: string;
        operation_day_id: string;
        product_code: string;
        aircraft_type: string | null;
      }>(),
      this.env.DB.prepare(
        `SELECT m.resource_group_id, m.current_pilot_id,
                  a.id AS aircraft_id, a.passenger_seats,
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
          passenger_seats: number;
          operational_state: AircraftOperationalState;
          operational_interrupted: number;
          predicted_completion_at: string | null;
          expected_review_at: string | null;
        }>(),
      this.env.DB.prepare(
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
      this.env.DB.prepare(
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
      this.env.DB.prepare(
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
      this.env.DB.prepare(
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
      this.env.DB.prepare(
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
      this.env.DB.prepare(
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
      this.env.DB.prepare(
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

    const now = new Date();
    const nowIso = now.toISOString();
    const availabilityWindow = (
      value: string | null,
      immediatelyAvailable: boolean,
    ): { lowerAt: string; expectedAt: string; upperAt: string } | null => {
      if (immediatelyAvailable) {
        return { lowerAt: nowIso, expectedAt: nowIso, upperAt: nowIso };
      }
      if (!value || !Number.isFinite(Date.parse(value))) return null;
      const expected = Math.max(now.getTime(), Date.parse(value));
      return {
        lowerAt: new Date(Math.max(now.getTime(), expected - 5 * 60_000)).toISOString(),
        expectedAt: new Date(expected).toISOString(),
        upperAt: new Date(expected + 5 * 60_000).toISOString(),
      };
    };
    const resolvedPlans = plannedOperationRows.results.flatMap((plan) => {
      const afterRotationAt = plan.completed_at ?? plan.predicted_completion_at;
      const earliest =
        (plan.status === "ACTIVE" ? plan.activated_at : plan.earliest_start_at) ??
        (afterRotationAt ? new Date(Date.parse(afterRotationAt)).toISOString() : null);
      const latest =
        (plan.status === "ACTIVE" ? plan.activated_at : plan.latest_start_at) ??
        (afterRotationAt ? new Date(Date.parse(afterRotationAt) + 5 * 60_000).toISOString() : null);
      if (!earliest || !latest) return [];
      return [
        {
          id: plan.id,
          scopeType: plan.scope_type,
          scopeId: plan.scope_id,
          effectMode: plan.effect_mode,
          durationMultiplierPercent: plan.duration_multiplier_percent,
          active: plan.status === "ACTIVE",
          earliestStartAt: earliest,
          latestStartAt: latest,
          minimumDurationMinutes: plan.minimum_duration_minutes,
          typicalDurationMinutes: plan.typical_duration_minutes,
          maximumDurationMinutes: plan.maximum_duration_minutes,
          overdue:
            plan.status === "ACTIVE"
              ? Date.parse(earliest) + plan.maximum_duration_minutes * 60_000 <= now.getTime()
              : Date.parse(latest) <= now.getTime(),
        },
      ];
    });
    const blockAvailability = (
      resourceGroupId: string,
    ): { lowerAt: string; expectedAt: string; upperAt: string } | null | undefined => {
      const effective = activeBlockRows.results.filter(
        (block) =>
          (block.scope_type === "EVENT" && block.scope_id === eventId) ||
          (block.scope_type === "RESOURCE_GROUP" && block.scope_id === resourceGroupId),
      );
      if (effective.length === 0) return undefined;
      if (effective.some((block) => block.expected_review_at === null)) return null;
      const latestReviewAt = effective.reduce<string | null>(
        (latest, block) =>
          !latest || Date.parse(block.expected_review_at ?? "") > Date.parse(latest)
            ? block.expected_review_at
            : latest,
        null,
      );
      return availabilityWindow(latestReviewAt, false);
    };
    const availablePilotWindows = pilotRows.results.flatMap((pilot) => {
      const immediatelyAvailable = pilot.paused === 0 && pilot.predicted_completion_at === null;
      const expectedReturnAt =
        pilot.paused === 1
          ? pilot.pause_expected_review_at &&
            Math.max(
              Date.parse(pilot.pause_expected_review_at),
              Date.parse(pilot.predicted_completion_at ?? pilot.pause_expected_review_at),
            )
          : pilot.predicted_completion_at;
      const window = availabilityWindow(
        typeof expectedReturnAt === "number"
          ? new Date(expectedReturnAt).toISOString()
          : expectedReturnAt,
        immediatelyAvailable,
      );
      return window ? [{ pilotId: pilot.id, ...window }] : [];
    });
    const resourceGroupIds = [
      ...new Set([
        ...capacityRows.results.map((row) => row.resource_group_id),
        ...rotationRows.results.map((row) => row.resource_group_id),
      ]),
    ].sort();
    type ForecastAircraftWindow = {
      resourceGroupId: string;
      aircraftId: string;
      currentPilotId: string | null;
      passengerSeats: number;
      lowerAt: string;
      expectedAt: string;
      upperAt: string;
      groupBlock: { lowerAt: string; expectedAt: string; upperAt: string } | null | undefined;
    };
    const aircraftWindows = resourceGroupIds.flatMap((resourceGroupId) => {
      const groupBlock = blockAvailability(resourceGroupId);
      if (groupBlock === null) return [];
      return capacityRows.results
        .filter((row) => row.resource_group_id === resourceGroupId)
        .flatMap((aircraft) => {
          if (aircraft.operational_interrupted === 1 || aircraft.operational_state === "INACTIVE") {
            return [];
          }
          const blocked = ["PAUSED", "REFUELING"].includes(aircraft.operational_state);
          const immediatelyAvailable = aircraft.predicted_completion_at === null && !blocked;
          const expectedReturnAt =
            blocked && aircraft.expected_review_at
              ? new Date(
                  Math.max(
                    Date.parse(aircraft.expected_review_at),
                    Date.parse(aircraft.predicted_completion_at ?? aircraft.expected_review_at),
                  ),
                ).toISOString()
              : blocked
                ? null
                : aircraft.predicted_completion_at;
          const window = availabilityWindow(expectedReturnAt, immediatelyAvailable);
          return window
            ? [
                {
                  resourceGroupId,
                  aircraftId: aircraft.aircraft_id,
                  currentPilotId: aircraft.current_pilot_id,
                  passengerSeats: aircraft.passenger_seats,
                  groupBlock,
                  ...window,
                } satisfies ForecastAircraftWindow,
              ]
            : [];
        })
        .sort(
          (left, right) =>
            Date.parse(left.expectedAt) - Date.parse(right.expectedAt) ||
            left.aircraftId.localeCompare(right.aircraftId),
        );
    });
    const orderedPilots = [...availablePilotWindows].sort(
      (left, right) =>
        Date.parse(left.expectedAt) - Date.parse(right.expectedAt) ||
        left.pilotId.localeCompare(right.pilotId),
    );
    const pilotById = new Map(orderedPilots.map((pilot) => [pilot.pilotId, pilot]));
    const usedPilotIds = new Set<string>();
    const pairedAircraftIds = new Set<string>();
    const resourcePairs: Array<{
      aircraft: ForecastAircraftWindow;
      pilot: (typeof orderedPilots)[number];
    }> = [];
    const pair = (
      aircraft: ForecastAircraftWindow,
      pilot: (typeof orderedPilots)[number] | undefined,
    ) => {
      if (!pilot || usedPilotIds.has(pilot.pilotId) || pairedAircraftIds.has(aircraft.aircraftId)) {
        return;
      }
      usedPilotIds.add(pilot.pilotId);
      pairedAircraftIds.add(aircraft.aircraftId);
      resourcePairs.push({ aircraft, pilot });
    };
    for (const aircraft of aircraftWindows
      .filter((entry) => entry.currentPilotId !== null)
      .sort(
        (left, right) =>
          left.resourceGroupId.localeCompare(right.resourceGroupId) ||
          left.aircraftId.localeCompare(right.aircraftId),
      )) {
      pair(aircraft, pilotById.get(aircraft.currentPilotId ?? ""));
    }
    const unpairedPilots = orderedPilots.filter((pilot) => !usedPilotIds.has(pilot.pilotId));
    let nextPilotIndex = 0;
    for (const aircraft of aircraftWindows
      .filter((entry) => !pairedAircraftIds.has(entry.aircraftId))
      .sort(
        (left, right) =>
          Date.parse(left.expectedAt) - Date.parse(right.expectedAt) ||
          left.resourceGroupId.localeCompare(right.resourceGroupId) ||
          left.aircraftId.localeCompare(right.aircraftId),
      )) {
      pair(aircraft, unpairedPilots[nextPilotIndex]);
      nextPilotIndex += 1;
    }
    const forecastCapacities = resourceGroupIds.map((resourceGroupId) => {
      const availabilityLanes = resourcePairs
        .filter(({ aircraft }) => aircraft.resourceGroupId === resourceGroupId)
        .map(({ aircraft, pilot }) => {
          const groupBlock = aircraft.groupBlock;
          const lowerAt = new Date(
            Math.max(
              Date.parse(aircraft.lowerAt),
              Date.parse(pilot.lowerAt),
              groupBlock ? Date.parse(groupBlock.lowerAt) : 0,
            ),
          ).toISOString();
          const expectedAt = new Date(
            Math.max(
              Date.parse(aircraft.expectedAt),
              Date.parse(pilot.expectedAt),
              groupBlock ? Date.parse(groupBlock.expectedAt) : 0,
            ),
          ).toISOString();
          const upperAt = new Date(
            Math.max(
              Date.parse(aircraft.upperAt),
              Date.parse(pilot.upperAt),
              groupBlock ? Date.parse(groupBlock.upperAt) : 0,
            ),
          ).toISOString();
          const constraints = resolvedPlans.filter(
            (plan) =>
              (plan.scopeType === "AIRCRAFT" && plan.scopeId === aircraft.aircraftId) ||
              (plan.scopeType === "PILOT" && plan.scopeId === pilot.pilotId),
          );
          return {
            laneId: `${aircraft.aircraftId}:${pilot.pilotId}`,
            aircraftId: aircraft.aircraftId,
            pilotId: pilot.pilotId,
            passengerSeats: aircraft.passengerSeats,
            availableLowerAt: lowerAt,
            availableExpectedAt: expectedAt,
            availableUpperAt: upperAt,
            constraints,
            recurringConstraints: recurringRuleRows.results
              .filter(
                (rule) =>
                  (rule.scope_type === "AIRCRAFT" && rule.scope_id === aircraft.aircraftId) ||
                  (rule.scope_type === "PILOT" && rule.scope_id === pilot.pilotId),
              )
              .map((rule) => ({
                id: rule.id,
                triggerMetric: rule.trigger_metric,
                intervalValue: rule.interval_value,
                progressValue: rule.progress_value,
                minimumDurationMinutes: rule.minimum_duration_minutes,
                typicalDurationMinutes: rule.typical_duration_minutes,
                maximumDurationMinutes: rule.maximum_duration_minutes,
                active: true,
              })),
          };
        });
      const groupReturnUnknown = activeBlockRows.results.some(
        (block) =>
          block.expected_review_at === null &&
          ((block.scope_type === "EVENT" && block.scope_id === eventId) ||
            (block.scope_type === "RESOURCE_GROUP" && block.scope_id === resourceGroupId)),
      );
      const aircraftReturnUnknown = capacityRows.results.some(
        (aircraft) =>
          aircraft.resource_group_id === resourceGroupId &&
          (["PAUSED", "REFUELING"].includes(aircraft.operational_state) ||
            aircraft.operational_interrupted === 1) &&
          aircraft.expected_review_at === null,
      );
      const pilotReturnUnknown =
        aircraftWindows.some((aircraft) => aircraft.resourceGroupId === resourceGroupId) &&
        availabilityLanes.length === 0 &&
        pilotRows.results.some(
          (pilot) => pilot.paused === 1 && pilot.pause_expected_review_at === null,
        );
      return {
        resourceGroupId,
        activeAircraft: availabilityLanes.filter(
          (lane) => Date.parse(lane.availableExpectedAt) <= now.getTime(),
        ).length,
        availabilityLanes,
        sharedConstraints: resolvedPlans.filter(
          (plan) =>
            (plan.scopeType === "EVENT" && plan.scopeId === eventId) ||
            (plan.scopeType === "RESOURCE_GROUP" && plan.scopeId === resourceGroupId),
        ),
        unavailableReason:
          availabilityLanes.length === 0 &&
          (groupReturnUnknown || aircraftReturnUnknown || pilotReturnUnknown)
            ? ("UNKNOWN_RESOURCE_RETURN" as const)
            : null,
      };
    });
    const adaptiveLeadMinutes = deriveAdaptivePrecallLeadMinutes({
      observedGateWaitMinutes: [...gateWaitRows.results].reverse().map((row) =>
        normalizePrecallObservation({
          observedGoToGateToBoardingMinutes: row.minutes,
          gateTravelLeadMinutesUsed: row.gate_travel_lead_minutes,
        }),
      ),
    });
    const productServiceDeficits = new Map<string, number>();
    for (const rotation of rotationRows.results.filter((entry) => entry.status === "DRAFT")) {
      if (!rotation.product_id) continue;
      const waitingMinutes = Math.max(
        0,
        (now.getTime() - Date.parse(rotation.sold_at ?? rotation.created_at)) / 60_000,
      );
      const deficit =
        (waitingMinutes * Math.max(1, rotation.ticket_count)) /
        Math.max(1, rotation.reference_duration_minutes);
      productServiceDeficits.set(
        rotation.product_id,
        (productServiceDeficits.get(rotation.product_id) ?? 0) + deficit,
      );
    }
    const previousRevision = rotationRows.results.find(
      (rotation) => rotation.status === "DRAFT" && rotation.dispatch_plan_revision !== null,
    )?.dispatch_plan_revision;
    const previousRows = previousRevision
      ? rotationRows.results.filter(
          (rotation) =>
            rotation.status === "DRAFT" && rotation.dispatch_plan_revision === previousRevision,
        )
      : [];
    const previousBatchIds = [
      ...new Set(
        previousRows.flatMap((rotation) =>
          rotation.dispatch_batch_id ? [rotation.dispatch_batch_id] : [],
        ),
      ),
    ];
    const previousDispatchPlan: DispatchPlan | null =
      previousRows.length > 0 && previousBatchIds.length > 0
        ? {
            planId: previousRows[0]?.dispatch_plan_id ?? `legacy-${previousRevision}`,
            revision: previousRevision ?? "",
            batches: previousBatchIds.map((batchId) => {
              const members = previousRows.filter(
                (rotation) => rotation.dispatch_batch_id === batchId,
              );
              const first = members[0];
              if (!first) throw new Error(`Stored dispatch batch ${batchId} has no members.`);
              const expectedBoardingAt = first.predicted_boarding_at ?? nowIso;
              const lowerAt =
                first.prediction_lower_minutes === null
                  ? expectedBoardingAt
                  : new Date(now.getTime() + first.prediction_lower_minutes * 60_000).toISOString();
              const upperAt =
                first.prediction_upper_minutes === null
                  ? expectedBoardingAt
                  : new Date(now.getTime() + first.prediction_upper_minutes * 60_000).toISOString();
              return {
                id: batchId,
                resourceGroupId: first.resource_group_id,
                productId: first.product_id ?? `legacy-product:${first.id}`,
                gateId: first.gate_id ?? `legacy-gate:${first.resource_group_id}`,
                laneId: first.dispatch_lane_id ?? "legacy-lane",
                assumedAircraftId:
                  first.forecast_assumed_aircraft_id ?? first.aircraft_id ?? "legacy-aircraft",
                assumedPilotId: first.dispatch_lane_id?.split(":")[1] ?? null,
                memberIds: members.map((member) => member.id),
                groupIds: JSON.parse(first.dispatch_group_ids_json) as string[],
                occupiedSeats: first.dispatch_occupied_seats ?? first.ticket_count,
                availableSeats: first.dispatch_available_seats ?? 0,
                dispatchOrder: first.dispatch_order ?? 1,
                wave: first.dispatch_wave ?? 1,
                boardingWindowLowerAt: lowerAt,
                boardingWindowExpectedAt: expectedBoardingAt,
                boardingWindowUpperAt: upperAt,
                predictedCompletionAt: first.predicted_completion_at ?? expectedBoardingAt,
                commitmentLevel: first.dispatch_commitment_level ?? "WAITING",
                decisionReasons: JSON.parse(
                  first.dispatch_decision_reasons_json,
                ) as DispatchPlan["batches"][number]["decisionReasons"],
              };
            }),
            groupDecisions: previousRows.flatMap((rotation) =>
              rotation.dispatch_batch_id && rotation.dispatch_lane_id && rotation.dispatch_order
                ? [
                    {
                      memberId: rotation.id,
                      batchId: rotation.dispatch_batch_id,
                      laneId: rotation.dispatch_lane_id,
                      dispatchOrder: rotation.dispatch_order,
                      projectedOvertakeCount: rotation.dispatch_projected_overtake_count,
                      decisionReasons: JSON.parse(
                        rotation.dispatch_decision_reasons_json,
                      ) as DispatchPlan["groupDecisions"][number]["decisionReasons"],
                    },
                  ]
                : [],
            ),
            unplannedGroups: previousRows.flatMap((rotation) =>
              rotation.dispatch_unplanned_reason
                ? [{ memberId: rotation.id, reason: rotation.dispatch_unplanned_reason }]
                : [],
            ),
            limits: { ...DEFAULT_DISPATCH_PLANNING_LIMITS },
          }
        : null;
    const draftRotationById = new Map(
      rotationRows.results
        .filter((rotation) => rotation.status === "DRAFT")
        .map((rotation) => [rotation.id, rotation] as const),
    );
    const lockedDispatchBatches: DispatchLockedBatchInput[] = activeDispatchLeaseRows.results.map(
      (lease) => {
        const memberIds = this.stringArray(lease.member_rotation_ids_json);
        const members = memberIds.flatMap((memberId) => {
          const member = draftRotationById.get(memberId);
          return member ? [member] : [];
        });
        const first = members[0];
        if (!first || members.length !== memberIds.length || !first.product_id || !first.gate_id) {
          throw new Error(`Active dispatch lease ${lease.id} references unavailable members.`);
        }
        return {
          id: lease.dispatch_batch_id,
          resourceGroupId: first.resource_group_id,
          productId: first.product_id,
          gateId: first.gate_id,
          aircraftId: lease.aircraft_id,
          memberIds,
        };
      },
    );
    const draftSegmentsByBookingGroup = new Map<string, typeof rotationRows.results>();
    for (const rotation of rotationRows.results) {
      if (rotation.status !== "DRAFT") continue;
      const bookingGroupIds = JSON.parse(rotation.current_group_ids_json) as string[];
      for (const bookingGroupId of bookingGroupIds) {
        const segments = draftSegmentsByBookingGroup.get(bookingGroupId) ?? [];
        segments.push(rotation);
        draftSegmentsByBookingGroup.set(bookingGroupId, segments);
      }
    }
    const dispatchPredecessorsByMember = new Map<string, Set<string>>();
    for (const segments of draftSegmentsByBookingGroup.values()) {
      segments.sort(
        (left, right) =>
          left.segment_order - right.segment_order ||
          left.created_at.localeCompare(right.created_at) ||
          left.id.localeCompare(right.id),
      );
      for (let index = 1; index < segments.length; index += 1) {
        const current = segments[index];
        const predecessor = segments[index - 1];
        if (!current || !predecessor) continue;
        const memberPredecessors = dispatchPredecessorsByMember.get(current.id) ?? new Set();
        memberPredecessors.add(predecessor.id);
        dispatchPredecessorsByMember.set(current.id, memberPredecessors);
      }
    }
    const forecastInput = {
      event: {
        eventId,
        now: nowIso,
        plannedOperationsStartAt: event.operations_start_at,
        plannedOperationsEndAt: event.operations_end_at,
        operationalInterrupted: event.operational_interrupted === 1,
        emergencyMode: event.emergency_mode === 1,
        plannedBoardingMinutes: event.planned_boarding_minutes,
        plannedDeboardingMinutes: event.planned_deboarding_minutes,
        plannedBufferMinutes: event.planned_buffer_minutes,
      },
      capacities: forecastCapacities,
      previousDispatchPlan,
      lockedDispatchBatches,
      durationSamples: durationRows.results.map((row) => ({
        minutes: row.minutes,
        completedAt: row.completed_at,
        eventId: row.operation_day_id,
        productCode: row.product_code,
        aircraftType: row.aircraft_type,
      })),
      rotations: rotationRows.results.map((rotation) => {
        const turnaroundProfiles = turnaroundOverrideRows.results
          .filter((row) => row.product_id === rotation.product_id)
          .map((row) => {
            const resolved = resolveTurnaroundProfile({
              event: {
                sourceId: eventId,
                boardingMinutes: event.planned_boarding_minutes,
                deboardingMinutes: event.planned_deboarding_minutes,
                bufferMinutes: event.planned_buffer_minutes,
              },
              product: {
                sourceId: row.product_id,
                boardingMinutes: row.product_boarding,
                deboardingMinutes: row.product_deboarding,
                bufferMinutes: row.product_buffer,
              },
              aircraftProduct: {
                sourceId: `${row.aircraft_id}:${row.product_id}`,
                boardingMinutes: row.aircraft_boarding,
                deboardingMinutes: row.aircraft_deboarding,
                bufferMinutes: row.aircraft_buffer,
              },
            });
            return {
              aircraftId: row.aircraft_id,
              boardingMinutes: resolved.boarding.valueMinutes,
              deboardingMinutes: resolved.deboarding.valueMinutes,
              bufferMinutes: resolved.buffer.valueMinutes,
              boardingSource: `${resolved.boarding.sourceLevel}:${resolved.boarding.sourceId}`,
              deboardingSource: `${resolved.deboarding.sourceLevel}:${resolved.deboarding.sourceId}`,
              bufferSource: `${resolved.buffer.sourceLevel}:${resolved.buffer.sourceId}`,
            };
          });
        const confirmedTurnaroundProfile =
          rotation.turnaround_boarding_minutes !== null &&
          rotation.turnaround_deboarding_minutes !== null &&
          rotation.turnaround_buffer_minutes !== null
            ? {
                boardingMinutes: rotation.turnaround_boarding_minutes,
                deboardingMinutes: rotation.turnaround_deboarding_minutes,
                bufferMinutes: rotation.turnaround_buffer_minutes,
                boardingSource: rotation.turnaround_boarding_source ?? "LEGACY_UNKNOWN",
                deboardingSource: rotation.turnaround_deboarding_source ?? "LEGACY_UNKNOWN",
                bufferSource: rotation.turnaround_buffer_source ?? "LEGACY_UNKNOWN",
              }
            : null;
        return {
          id: rotation.id,
          status: rotation.status,
          createdAt: rotation.created_at,
          calledAt: rotation.called_at,
          departedAt: rotation.departed_at,
          landedAt: rotation.landed_at,
          resourceGroupId: rotation.resource_group_id,
          aircraftId: rotation.aircraft_id,
          pilotId: rotation.pilot_id,
          resourceGroupStatus: rotation.resource_group_status,
          queueSequence: rotation.queue_sequence,
          dispatchGroupIds: JSON.parse(rotation.current_group_ids_json) as string[],
          dispatchPredecessorMemberIds: [
            ...(dispatchPredecessorsByMember.get(rotation.id) ?? new Set<string>()),
          ],
          productId: rotation.product_id ?? `legacy-product:${rotation.id}`,
          gateId: rotation.gate_id ?? `legacy-gate:${rotation.resource_group_id}`,
          soldAt: rotation.sold_at ?? rotation.created_at,
          attendanceStatus: rotation.attendance_status,
          standby: rotation.standby === 1,
          publicStatus:
            rotation.precall_decision_status === "GO_TO_GATE"
              ? "COME_TO_FLIGHT_LINE"
              : rotation.precall_decision_status === "PREPARE"
                ? "PREPARE"
                : "WAITING",
          confirmedOvertakeCount: rotation.dispatch_confirmed_overtake_count,
          productServiceDeficit: rotation.product_id
            ? (productServiceDeficits.get(rotation.product_id) ?? 0)
            : 0,
          passengerCount: rotation.ticket_count,
          referenceDurationMinutes: rotation.reference_duration_minutes,
          productCode: rotation.product_code,
          aircraftType: rotation.aircraft_type,
          predictedDepartureAt: rotation.predicted_departure_at,
          predictedLandingAt: rotation.predicted_landing_at,
          predictedCompletionAt: rotation.predicted_completion_at,
          turnaroundProfiles,
          confirmedTurnaroundProfile,
          constraints: resolvedPlans.filter(
            (plan) =>
              (plan.scopeType === "EVENT" && plan.scopeId === eventId) ||
              (plan.scopeType === "RESOURCE_GROUP" &&
                plan.scopeId === rotation.resource_group_id) ||
              (plan.scopeType === "AIRCRAFT" && plan.scopeId === rotation.aircraft_id) ||
              (plan.scopeType === "PILOT" && plan.scopeId === rotation.pilot_id),
          ),
        };
      }),
    } satisfies ForecastTimelinesInput;
    const calculationStartedAtMs = performance.now();
    const calculationResult = calculateForecastTimelineResult(forecastInput);
    const calculationDurationMs = Math.max(0, performance.now() - calculationStartedAtMs);
    const projections = calculationResult.projections;
    const planningRunId = request.planningRunId ?? crypto.randomUUID();
    const projectionByRotationId = new Map(
      projections.map((projection) => [projection.rotationId, projection]),
    );
    const precallQueueEntries: AutomaticPrecallQueueEntry[] = [];
    const precallCandidateByRotationId = new Map<
      string,
      {
        flightGroupId: string;
        rotationId: string;
        resourceGroupId: string;
        expectedVersion: number;
        gateId: string | null;
        predictionUpperMinutes: number;
        predictionQuality: "STABLE" | "CHANGING" | "UNCERTAIN";
        adaptiveLeadMinutes: number;
        gateTravelLeadMinutes: number;
        effectiveLeadMinutes: number;
        boardingWindowLowerAt: string | null;
        boardingWindowUpperAt: string | null;
        dispatchPlanRevision: string | null;
        dispatchBatchId: string | null;
      }
    >();
    const statements: D1PreparedStatement[] = [];
    for (const rotation of rotationRows.results) {
      const projection = projectionByRotationId.get(rotation.id);
      if (!projection) throw new Error(`Forecast projection missing for rotation ${rotation.id}.`);
      if (rotation.status === "DRAFT") {
        precallQueueEntries.push({
          id: rotation.id,
          resourceGroupId: rotation.resource_group_id,
          enabled: event.automatic_precall_enabled === 1,
          eventActive: event.status === "ACTIVE",
          operationsAvailable: event.operational_interrupted === 0 && event.emergency_mode === 0,
          resourceGroupActive: rotation.resource_group_status === "ACTIVE",
          resourceGroupEnabled: rotation.resource_group_precall_enabled === 1,
          alreadyPrecalled: rotation.precalled_at !== null,
          forecastCapacityStatus: projection.capacityStatus,
          predictionQuality: projection.predictionQuality,
          predictedBoardingMinutes:
            projection.predictionLowerMinutes === null
              ? Number.MAX_SAFE_INTEGER
              : Math.ceil(projection.predictionLowerMinutes),
          adaptiveLeadMinutes,
          prepareLeadMinutes: event.notification_lead_minutes,
          gateTravelLeadMinutes: rotation.gate_travel_lead_minutes,
          dispatchPlanFresh: projection.dispatchPlanRevision !== null,
          inNearDispatchBatch: projection.dispatchWave !== null && projection.dispatchWave <= 2,
          gateCapacityCovered: false,
          waitingForProductFairness:
            projection.dispatchUnplannedReason === "WAITING_FOR_PRODUCT_FAIRNESS",
          waitingForFittingLane: projection.dispatchUnplannedReason === "WAITING_FOR_FITTING_LANE",
          commitmentLocked: projection.dispatchUnplannedReason === "COMMITMENT_LOCKED",
          dispatchOrder: projection.dispatchOrder,
          queueSequence: rotation.queue_sequence,
        });
        precallCandidateByRotationId.set(rotation.id, {
          flightGroupId: rotation.flight_group_id,
          rotationId: rotation.id,
          resourceGroupId: rotation.resource_group_id,
          expectedVersion: rotation.flight_group_version,
          gateId: rotation.gate_id,
          predictionUpperMinutes: projection.predictionUpperMinutes ?? 0,
          predictionQuality: projection.predictionQuality,
          adaptiveLeadMinutes,
          gateTravelLeadMinutes: rotation.gate_travel_lead_minutes,
          effectiveLeadMinutes: adaptiveLeadMinutes + rotation.gate_travel_lead_minutes,
          boardingWindowLowerAt:
            projection.predictionLowerMinutes === null
              ? null
              : new Date(now.getTime() + projection.predictionLowerMinutes * 60_000).toISOString(),
          boardingWindowUpperAt:
            projection.predictionUpperMinutes === null
              ? null
              : new Date(now.getTime() + projection.predictionUpperMinutes * 60_000).toISOString(),
          dispatchPlanRevision: projection.dispatchPlanRevision,
          dispatchBatchId: projection.dispatchBatchId,
        });
      }
      statements.push(
        this.env.DB.prepare(
          `UPDATE rotations SET
            planned_boarding_at = COALESCE(planned_boarding_at, ?1),
            planned_departure_at = COALESCE(planned_departure_at, ?2),
            planned_landing_at = COALESCE(planned_landing_at, ?3),
            planned_completion_at = COALESCE(planned_completion_at, ?4),
            predicted_boarding_at = ?5, predicted_departure_at = ?6,
            predicted_landing_at = ?7, predicted_completion_at = ?8,
            prediction_quality = ?9, prediction_lower_minutes = ?10,
            prediction_upper_minutes = ?11, prediction_updated_at = ?12,
            forecast_assumed_aircraft_id =
              CASE WHEN status = 'DRAFT' THEN ?13 ELSE forecast_assumed_aircraft_id END
           WHERE id = ?14`,
        ).bind(
          projection.plannedBoardingAt,
          projection.plannedDepartureAt,
          projection.plannedLandingAt,
          projection.plannedCompletionAt,
          projection.predictedBoardingAt,
          projection.predictedDepartureAt,
          projection.predictedLandingAt,
          projection.predictedCompletionAt,
          projection.predictionQuality,
          projection.predictionLowerMinutes,
          projection.predictionUpperMinutes,
          nowIso,
          projection.assumedAircraftId,
          rotation.id,
        ),
        this.env.DB.prepare(
          `UPDATE rotations SET
              dispatch_plan_id = ?1, dispatch_plan_revision = ?2,
              dispatch_batch_id = ?3, dispatch_order = ?4, dispatch_wave = ?5,
              dispatch_lane_id = ?6, dispatch_group_ids_json = ?7,
              dispatch_occupied_seats = ?8, dispatch_available_seats = ?9,
              dispatch_commitment_level = ?10, dispatch_decision_reasons_json = ?11,
              dispatch_projected_overtake_count = ?12, dispatch_unplanned_reason = ?13
            WHERE id = ?14 AND status = 'DRAFT'`,
        ).bind(
          projection.dispatchPlanId,
          projection.dispatchPlanRevision,
          projection.dispatchBatchId,
          projection.dispatchOrder,
          projection.dispatchWave,
          projection.dispatchLaneId,
          JSON.stringify(projection.dispatchGroupIds),
          projection.dispatchOccupiedSeats,
          projection.dispatchAvailableSeats,
          projection.dispatchCommitmentLevel,
          JSON.stringify(projection.dispatchDecisionReasons),
          projection.dispatchProjectedOvertakeCount,
          projection.dispatchUnplannedReason,
          rotation.id,
        ),
      );
      if (
        projection.capacityStatus === "AVAILABLE" &&
        projection.predictionLowerMinutes !== null &&
        projection.predictionUpperMinutes !== null
      ) {
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO forecast_snapshots
            (id, operation_day_id, rotation_id, operation_day_version, captured_at, quality,
             lower_minutes, upper_minutes, predicted_boarding_at, predicted_departure_at,
             predicted_landing_at, predicted_completion_at, trigger_event_type, data_basis_scope,
             sample_size, data_age_minutes, active_capacity, reference_duration_minutes,
             product_id, assumed_aircraft_id, boarding_minutes, deboarding_minutes, buffer_minutes,
             boarding_source, deboarding_source, buffer_source,
             dispatch_plan_id, dispatch_plan_revision, dispatch_batch_id, dispatch_order,
             dispatch_wave, dispatch_lane_id, dispatch_group_ids_json,
             dispatch_occupied_seats, dispatch_available_seats, dispatch_commitment_level,
             dispatch_decision_reasons_json, dispatch_confirmed_overtake_count,
             dispatch_projected_overtake_count, dispatch_unplanned_reason, planning_run_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                   ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                   ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40, ?41)`,
          ).bind(
            crypto.randomUUID(),
            eventId,
            rotation.id,
            event.version,
            nowIso,
            projection.predictionQuality,
            projection.predictionLowerMinutes,
            projection.predictionUpperMinutes,
            projection.predictedBoardingAt,
            projection.predictedDepartureAt,
            projection.predictedLandingAt,
            projection.predictedCompletionAt,
            triggerEventType,
            projection.dataBasisScope,
            projection.sampleSize,
            projection.dataAgeMinutes,
            projection.activeCapacity,
            projection.referenceDurationMinutes,
            rotation.product_id,
            projection.assumedAircraftId,
            projection.boardingMinutes,
            projection.deboardingMinutes,
            projection.bufferMinutes,
            projection.boardingSource,
            projection.deboardingSource,
            projection.bufferSource,
            projection.dispatchPlanId,
            projection.dispatchPlanRevision,
            projection.dispatchBatchId,
            projection.dispatchOrder,
            projection.dispatchWave,
            projection.dispatchLaneId,
            JSON.stringify(projection.dispatchGroupIds),
            projection.dispatchOccupiedSeats,
            projection.dispatchAvailableSeats,
            projection.dispatchCommitmentLevel,
            JSON.stringify(projection.dispatchDecisionReasons),
            rotation.dispatch_confirmed_overtake_count,
            projection.dispatchProjectedOvertakeCount,
            projection.dispatchUnplannedReason,
            planningRunId,
          ),
        );
      }
    }
    const precallDecisions = selectAutomaticPrecalls(precallQueueEntries);
    for (const decision of precallDecisions) {
      const candidate = precallCandidateByRotationId.get(decision.id);
      const projection = projectionByRotationId.get(decision.id);
      if (!candidate || !projection) continue;
      const legacyReasons = new Set([
        "ELIGIBLE",
        "DISABLED",
        "OPERATIONS_BLOCKED",
        "NOT_QUEUE_FRONT",
        "ALREADY_PRECALLED",
        "NO_FORECAST_CAPACITY",
        "NO_FITTING_AIRCRAFT",
        "TOO_EARLY",
      ]);
      const legacyReason = legacyReasons.has(decision.reason) ? decision.reason : "TOO_EARLY";
      const dispatchReason = legacyReasons.has(decision.reason) ? null : decision.reason;
      statements.push(
        this.env.DB.prepare(
          `UPDATE flight_groups
              SET precall_decision_status = ?1,
                  precall_decision_reason = ?2,
                  precall_dispatch_reason = ?3,
                  precall_decision_at = ?4,
                  precall_predicted_boarding_at = ?5,
                  precall_adaptive_lead_minutes = ?6,
                  precall_gate_id = ?7,
                  precall_adaptive_base_lead_minutes = ?8,
                  precall_gate_travel_lead_minutes = ?9,
                  precall_effective_lead_minutes = ?10,
                  precall_boarding_window_lower_at = ?11,
                  precall_boarding_window_upper_at = ?12
            WHERE id = ?13 AND operation_day_id = ?14`,
        ).bind(
          decision.status,
          legacyReason,
          dispatchReason,
          nowIso,
          projection.predictedBoardingAt,
          adaptiveLeadMinutes,
          candidate.gateId,
          adaptiveLeadMinutes,
          candidate.gateTravelLeadMinutes,
          candidate.effectiveLeadMinutes,
          candidate.boardingWindowLowerAt,
          candidate.boardingWindowUpperAt,
          candidate.flightGroupId,
          eventId,
        ),
      );
    }
    const precallCandidates: Array<{
      flightGroupId: string;
      rotationId: string;
      resourceGroupId: string;
      expectedVersion: number;
      gateId: string | null;
      predictionUpperMinutes: number;
      predictionQuality: "STABLE" | "CHANGING" | "UNCERTAIN";
      adaptiveLeadMinutes: number;
      gateTravelLeadMinutes: number;
      effectiveLeadMinutes: number;
      boardingWindowLowerAt: string | null;
      boardingWindowUpperAt: string | null;
      dispatchPlanRevision: string;
      dispatchBatchId: string;
    }> = precallDecisions.flatMap((decision) => {
      if (!decision.eligible) return [];
      const candidate = precallCandidateByRotationId.get(decision.id);
      if (!candidate) throw new Error(`Precall candidate missing for rotation ${decision.id}.`);
      if (!candidate.dispatchPlanRevision || !candidate.dispatchBatchId) return [];
      return [
        {
          ...candidate,
          dispatchPlanRevision: candidate.dispatchPlanRevision,
          dispatchBatchId: candidate.dispatchBatchId,
        },
      ];
    });
    let planningCapture: PreparedPlanningCapture | null = null;
    try {
      planningCapture = await preparePlanningCapture({
        env: this.env,
        eventId,
        eventVersion: event.version,
        calculationNow: nowIso,
        capturedAt: new Date().toISOString(),
        triggerEventType,
        forecastInput,
        calculationResult,
        precallInput: precallQueueEntries,
        precallOutput: precallDecisions,
        durationMs: calculationDurationMs,
        runId: planningRunId,
      });
      for (let index = 0; index < statements.length; index += 80) {
        await this.env.DB.batch(statements.slice(index, index + 80));
      }
      await this.persistAutomaticPrecalls(eventId, precallCandidates, nowIso);
      await queueEligiblePreparationNotifications(this.env, eventId);
      await completePlanningCapture(this.env, planningCapture);
    } catch (error) {
      if (planningCapture) {
        await failPlanningCapture(this.env, planningCapture).catch(() => undefined);
      }
      throw error;
    }
    const forecastMessage = JSON.stringify({
      type: "forecast-updated",
      eventId,
      eventVersion: event.version,
      updatedAt: nowIso,
    });
    for (const socket of this.getWebSockets()) {
      try {
        socket.send(forecastMessage);
      } catch {
        socket.close(1011, "Prognose-Broadcast fehlgeschlagen");
      }
    }
    if (
      triggerEventType === "PLANNED_SLOWDOWN_STARTED" ||
      triggerEventType === "PLANNED_SLOWDOWN_ENDED"
    ) {
      this.scheduleFollowUp({
        eventId,
        triggerEventType: `${triggerEventType}_FOLLOW_UP`,
      });
    }
    return {
      planningRunId,
      eventVersion: event.version,
      dispatchPlanRevision: calculationResult.diagnostics.dispatchPlan.revision,
    };
  }

  private async persistAutomaticPrecalls(
    eventId: string,
    candidates: Array<{
      flightGroupId: string;
      rotationId: string;
      resourceGroupId: string;
      expectedVersion: number;
      gateId: string | null;
      predictionUpperMinutes: number;
      predictionQuality: "STABLE" | "CHANGING" | "UNCERTAIN";
      adaptiveLeadMinutes: number;
      gateTravelLeadMinutes: number;
      effectiveLeadMinutes: number;
      boardingWindowLowerAt: string | null;
      boardingWindowUpperAt: string | null;
      dispatchPlanRevision: string;
      dispatchBatchId: string;
    }>,
    now: string,
  ): Promise<void> {
    for (const candidate of candidates) {
      const systemCommandId = crypto.randomUUID();
      const nextVersion = candidate.expectedVersion + 1;
      const payload = JSON.stringify({
        trigger: "AUTOMATIC_PRECALL",
        gateId: candidate.gateId,
        predictionUpperMinutes: candidate.predictionUpperMinutes,
        predictionQuality: candidate.predictionQuality,
        adaptiveLeadMinutes: candidate.adaptiveLeadMinutes,
        gateTravelLeadMinutes: candidate.gateTravelLeadMinutes,
        effectiveLeadMinutes: candidate.effectiveLeadMinutes,
        boardingWindowLowerAt: candidate.boardingWindowLowerAt,
        boardingWindowUpperAt: candidate.boardingWindowUpperAt,
        dispatchPlanRevision: candidate.dispatchPlanRevision,
        dispatchBatchId: candidate.dispatchBatchId,
      });
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE flight_groups
              SET precalled_at = ?1, precall_trigger = ?2, version = ?3, updated_at = ?1,
                  precall_decision_status = 'GO_TO_GATE',
                  precall_decision_reason = 'ELIGIBLE',
                  precall_dispatch_reason = NULL,
                  precall_decision_at = ?1,
                  precall_gate_id = ?4,
                  precall_adaptive_base_lead_minutes = ?5,
                  precall_gate_travel_lead_minutes = ?6,
                  precall_effective_lead_minutes = ?7,
                  precall_boarding_window_lower_at = ?8,
                  precall_boarding_window_upper_at = ?9
            WHERE id = ?10 AND operation_day_id = ?11 AND version = ?12
              AND precalled_at IS NULL`,
        ).bind(
          now,
          systemCommandId,
          nextVersion,
          candidate.gateId,
          candidate.adaptiveLeadMinutes,
          candidate.gateTravelLeadMinutes,
          candidate.effectiveLeadMinutes,
          candidate.boardingWindowLowerAt,
          candidate.boardingWindowUpperAt,
          candidate.flightGroupId,
          eventId,
          candidate.expectedVersion,
        ),
        this.env.DB.prepare(
          `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           SELECT ?1, ?2, 'FLIGHT_GROUP_PRECALLED', ?3, 'SYSTEM', 'FLIGHT_GROUP', ?4, ?5, ?6
             FROM flight_groups WHERE id = ?4 AND precall_trigger = ?1`,
        ).bind(systemCommandId, eventId, now, candidate.flightGroupId, nextVersion, payload),
        this.env.DB.prepare(
          `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
           SELECT ?1, ?2, 'EVENT_STATE_CHANGED', ?3, ?4
             FROM flight_groups WHERE id = ?5 AND precall_trigger = ?6`,
        ).bind(
          crypto.randomUUID(),
          eventId,
          payload,
          now,
          candidate.flightGroupId,
          systemCommandId,
        ),
      ]);
      const persisted = await this.env.DB.prepare(
        "SELECT 1 AS persisted FROM flight_groups WHERE id = ?1 AND precall_trigger = ?2",
      )
        .bind(candidate.flightGroupId, systemCommandId)
        .first<{ persisted: number }>();
      if (!persisted) {
        continue;
      }
      await sendRotationPushNotifications(this.env, candidate.rotationId, "GO_TO_GATE");
    }
  }
}
