import type { AutomaticPrecallQueueDecision, ForecastCalculationResult } from "@rundflug/domain";
import type {
  AutomaticPrecallCandidate,
  PersistableAutomaticPrecallCandidate,
} from "./forecast-precall-evaluator";
import type { ForecastTimelineLoader } from "./forecast-timeline-loader";
import type { Env } from "./types";
import { sendRotationPushNotifications } from "./web-push";

type ForecastTimelineData = Awaited<ReturnType<ForecastTimelineLoader["load"]>>;
type ForecastProjection = ForecastCalculationResult["projections"][number];

export class ForecastTimelineRepository {
  constructor(private readonly env: Env) {}

  prepareStatements(input: {
    eventId: string;
    triggerEventType: string;
    planningRunId: string;
    nowIso: string;
    adaptiveLeadMinutes: number;
    event: ForecastTimelineData["event"];
    rotationRows: ForecastTimelineData["rotationRows"];
    projectionByRotationId: ReadonlyMap<string, ForecastProjection>;
    precallCandidateByRotationId: ReadonlyMap<string, AutomaticPrecallCandidate>;
    precallDecisions: readonly AutomaticPrecallQueueDecision[];
  }): D1PreparedStatement[] {
    const {
      eventId,
      triggerEventType,
      planningRunId,
      nowIso,
      adaptiveLeadMinutes,
      event,
      rotationRows,
      projectionByRotationId,
      precallCandidateByRotationId,
      precallDecisions,
    } = input;
    const statements: D1PreparedStatement[] = [];
    for (const rotation of rotationRows.results) {
      const projection = projectionByRotationId.get(rotation.id);
      if (!projection) throw new Error(`Forecast projection missing for rotation ${rotation.id}.`);
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
    return statements;
  }

  async persist(
    statements: readonly D1PreparedStatement[],
    eventId: string,
    candidates: readonly PersistableAutomaticPrecallCandidate[],
    nowIso: string,
  ): Promise<void> {
    for (let index = 0; index < statements.length; index += 80) {
      await this.env.DB.batch(statements.slice(index, index + 80));
    }
    await this.persistAutomaticPrecalls(eventId, candidates, nowIso);
  }

  private async persistAutomaticPrecalls(
    eventId: string,
    candidates: readonly PersistableAutomaticPrecallCandidate[],
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
