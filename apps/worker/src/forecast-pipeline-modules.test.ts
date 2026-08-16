import type { ForecastTimelineProjection } from "@rundflug/domain";
import { describe, expect, it, vi } from "vitest";
import { evaluateAutomaticPrecalls } from "./forecast-precall-evaluator";
import { ForecastPublicationService } from "./forecast-publication-service";
import { ForecastTimelineLoader } from "./forecast-timeline-loader";
import { projectForecastTimelineInput } from "./forecast-timeline-projector";
import { ForecastTimelineRepository } from "./forecast-timeline-repository";

const EVENT_ROW = {
  version: 7,
  operational_interrupted: 0,
  emergency_mode: 0,
  planned_boarding_minutes: 5,
  planned_deboarding_minutes: 4,
  planned_buffer_minutes: 2,
  operations_start_at: "2026-08-12T08:00:00.000Z",
  operations_end_at: "2026-08-12T18:00:00.000Z",
  updated_at: "2026-08-12T09:00:00.000Z",
  status: "ACTIVE" as const,
  automatic_precall_enabled: 1,
  precall_lead_minutes: 12,
  max_gate_wait_minutes: 20,
  precall_min_quality: "CHANGING" as const,
  notification_lead_minutes: 18,
};

function emptyResult() {
  return { results: [], success: true, meta: {} };
}

function projection(
  overrides: Partial<ForecastTimelineProjection> = {},
): ForecastTimelineProjection {
  return {
    rotationId: "rotation-1",
    plannedBoardingAt: "2026-08-12T09:04:00.000Z",
    plannedDepartureAt: "2026-08-12T09:09:00.000Z",
    plannedLandingAt: "2026-08-12T09:29:00.000Z",
    plannedCompletionAt: "2026-08-12T09:35:00.000Z",
    predictedBoardingAt: "2026-08-12T09:04:00.000Z",
    predictedDepartureAt: "2026-08-12T09:09:00.000Z",
    predictedLandingAt: "2026-08-12T09:29:00.000Z",
    predictedCompletionAt: "2026-08-12T09:35:00.000Z",
    forecastState: "DISPATCH_WINDOW",
    extendsBeyondOperationsEnd: false,
    overtimeMinutes: 0,
    predictionQuality: "STABLE",
    predictionLowerMinutes: 4,
    predictionUpperMinutes: 6,
    capacityStatus: "AVAILABLE",
    dataBasisScope: "REFERENCE_ONLY",
    sampleSize: 0,
    dataAgeMinutes: 0,
    activeCapacity: 1,
    referenceDurationMinutes: 31,
    assumedAircraftId: "aircraft-1",
    boardingMinutes: 5,
    deboardingMinutes: 4,
    bufferMinutes: 2,
    boardingSource: "EVENT:event-1",
    deboardingSource: "EVENT:event-1",
    bufferSource: "EVENT:event-1",
    uncertaintyReasons: [],
    dispatchPlanId: "plan-1",
    dispatchPlanRevision: "revision-1",
    dispatchBatchId: "batch-1",
    dispatchOrder: 1,
    dispatchWave: 1,
    dispatchLaneId: "lane-1",
    dispatchGroupIds: ["group-1"],
    dispatchOccupiedSeats: 2,
    dispatchAvailableSeats: 4,
    dispatchCommitmentLevel: "COME_TO_FLIGHT_LINE",
    dispatchDecisionReasons: [],
    dispatchProjectedOvertakeCount: 0,
    dispatchUnplannedReason: null,
    ...overrides,
  };
}

describe("forecast pipeline module boundaries", () => {
  it("rejects stale event versions at the loader boundary", async () => {
    const statement = {
      bind: vi.fn(),
      first: vi.fn().mockResolvedValue(EVENT_ROW),
      all: vi.fn().mockResolvedValue(emptyResult()),
    };
    statement.bind.mockReturnValue(statement);
    const db = {
      prepare: vi.fn().mockReturnValue(statement),
    } as unknown as D1Database;

    await expect(
      new ForecastTimelineLoader(db).load(
        {
          eventId: "event-1",
          triggerEventType: "TEST",
          expectedEventVersion: 6,
        },
        "2026-08-12T09:00:00.000Z",
      ),
    ).rejects.toThrow("ANALYSIS_SNAPSHOT_STALE_VERSION");
    expect(db.prepare).toHaveBeenCalledTimes(11);
  });

  it("projects an empty normalized data set without infrastructure access", () => {
    const data = {
      event: EVENT_ROW,
      rotationRows: emptyResult(),
      durationRows: emptyResult(),
      capacityRows: emptyResult(),
      turnaroundOverrideRows: emptyResult(),
      pilotRows: emptyResult(),
      gateWaitRows: emptyResult(),
      plannedOperationRows: emptyResult(),
      recurringRuleRows: emptyResult(),
      activeBlockRows: emptyResult(),
      activeDispatchLeaseRows: emptyResult(),
    } as unknown as Parameters<typeof projectForecastTimelineInput>[0];
    const now = new Date("2026-08-12T09:00:00.000Z");

    const result = projectForecastTimelineInput(data, "event-1", now);

    expect(result.now).toBe(now);
    expect(result.nowIso).toBe("2026-08-12T09:00:00.000Z");
    expect(result.adaptiveLeadMinutes).toBe(12);
    expect(result.forecastInput).toMatchObject({
      event: { eventId: "event-1", now: result.nowIso },
      rotations: [],
      capacities: [],
      durationSamples: [],
    });
  });

  it("projects availability, persisted dispatch state, plans, and split-group ordering", () => {
    const draftRotation = {
      id: "rotation-draft-1",
      status: "DRAFT",
      created_at: "2026-08-12T08:30:00.000Z",
      called_at: null,
      departed_at: null,
      landed_at: null,
      completed_at: null,
      aircraft_id: null,
      pilot_id: null,
      flight_group_id: "flight-group-1",
      flight_group_version: 2,
      precalled_at: null,
      precall_decision_status: "GO_TO_GATE",
      resource_group_id: "resource-1",
      resource_group_status: "ACTIVE",
      resource_group_precall_enabled: 1,
      product_id: "product-1",
      queue_sequence: 1,
      segment_order: 1,
      communication_number: 1,
      current_group_ids_json: '["booking-group-1"]',
      sold_at: "2026-08-12T08:30:00.000Z",
      standby: 0,
      attendance_status: "PRESENT",
      ticket_count: 2,
      reference_duration_minutes: 20,
      product_code: "P20",
      aircraft_type: null,
      gate_id: "gate-1",
      gate_travel_lead_minutes: 3,
      predicted_boarding_at: "2026-08-12T09:10:00.000Z",
      predicted_departure_at: "2026-08-12T09:15:00.000Z",
      predicted_landing_at: "2026-08-12T09:35:00.000Z",
      predicted_completion_at: "2026-08-12T09:41:00.000Z",
      prediction_lower_minutes: 5,
      prediction_upper_minutes: 15,
      forecast_assumed_aircraft_id: "aircraft-1",
      turnaround_boarding_minutes: null,
      turnaround_deboarding_minutes: null,
      turnaround_buffer_minutes: null,
      turnaround_boarding_source: null,
      turnaround_deboarding_source: null,
      turnaround_buffer_source: null,
      dispatch_plan_id: "stored-plan",
      dispatch_plan_revision: "stored-revision",
      dispatch_batch_id: "stored-batch",
      dispatch_order: 1,
      dispatch_wave: 1,
      dispatch_lane_id: "aircraft-1:pilot-1",
      dispatch_group_ids_json: '["booking-group-1"]',
      dispatch_occupied_seats: 2,
      dispatch_available_seats: 4,
      dispatch_commitment_level: "COME_TO_FLIGHT_LINE",
      dispatch_decision_reasons_json: "[]",
      dispatch_confirmed_overtake_count: 0,
      dispatch_projected_overtake_count: 0,
      dispatch_unplanned_reason: null,
    };
    const secondSegment = {
      ...draftRotation,
      id: "rotation-draft-2",
      flight_group_id: "flight-group-2",
      segment_order: 2,
      dispatch_batch_id: null,
      dispatch_order: null,
      dispatch_lane_id: null,
      dispatch_unplanned_reason: "NOT_IN_NEAR_DISPATCH_BATCH",
    };
    const activeRotation = {
      ...draftRotation,
      id: "rotation-active",
      status: "CALLED",
      called_at: "2026-08-12T08:50:00.000Z",
      aircraft_id: "aircraft-1",
      pilot_id: "pilot-1",
      current_group_ids_json: '["booking-group-2"]',
      dispatch_plan_revision: null,
      dispatch_batch_id: null,
      dispatch_order: null,
      dispatch_lane_id: null,
      turnaround_boarding_minutes: 6,
      turnaround_deboarding_minutes: 5,
      turnaround_buffer_minutes: 3,
      turnaround_boarding_source: "AIRCRAFT_PRODUCT:aircraft-1:product-1",
      turnaround_deboarding_source: "PRODUCT:product-1",
      turnaround_buffer_source: "EVENT:event-1",
    };
    const data = {
      event: EVENT_ROW,
      rotationRows: {
        ...emptyResult(),
        results: [draftRotation, secondSegment, activeRotation],
      },
      durationRows: {
        ...emptyResult(),
        results: [
          {
            minutes: 23,
            completed_at: "2026-08-12T08:00:00.000Z",
            operation_day_id: "event-1",
            product_code: "P20",
            aircraft_type: "TYPE-A",
          },
        ],
      },
      capacityRows: {
        ...emptyResult(),
        results: [
          {
            resource_group_id: "resource-1",
            current_pilot_id: "pilot-1",
            aircraft_id: "aircraft-1",
            passenger_seats: 4,
            operational_state: "AVAILABLE",
            operational_interrupted: 0,
            predicted_completion_at: null,
            expected_review_at: null,
          },
          {
            resource_group_id: "resource-1",
            current_pilot_id: null,
            aircraft_id: "aircraft-2",
            passenger_seats: 3,
            operational_state: "REFUELING",
            operational_interrupted: 0,
            predicted_completion_at: "2026-08-12T09:20:00.000Z",
            expected_review_at: "2026-08-12T09:10:00.000Z",
          },
        ],
      },
      turnaroundOverrideRows: {
        ...emptyResult(),
        results: [
          {
            product_id: "product-1",
            aircraft_id: "aircraft-1",
            product_boarding: 7,
            product_deboarding: null,
            product_buffer: 4,
            aircraft_boarding: 8,
            aircraft_deboarding: 6,
            aircraft_buffer: null,
          },
        ],
      },
      pilotRows: {
        ...emptyResult(),
        results: [
          {
            id: "pilot-1",
            paused: 0,
            pause_expected_review_at: null,
            predicted_completion_at: null,
          },
          {
            id: "pilot-2",
            paused: 1,
            pause_expected_review_at: "2026-08-12T09:15:00.000Z",
            predicted_completion_at: "2026-08-12T09:05:00.000Z",
          },
        ],
      },
      gateWaitRows: {
        ...emptyResult(),
        results: [{ minutes: 9, gate_travel_lead_minutes: 3 }],
      },
      plannedOperationRows: {
        ...emptyResult(),
        results: [
          {
            id: "plan-event",
            scope_type: "EVENT",
            scope_id: "event-1",
            effect_mode: "SLOWDOWN",
            duration_multiplier_percent: 150,
            status: "ACTIVE",
            activated_at: "2026-08-12T08:55:00.000Z",
            earliest_start_at: null,
            latest_start_at: null,
            minimum_duration_minutes: 5,
            typical_duration_minutes: 10,
            maximum_duration_minutes: 15,
            after_rotation_id: null,
            predicted_completion_at: null,
            completed_at: null,
          },
          {
            id: "plan-aircraft",
            scope_type: "AIRCRAFT",
            scope_id: "aircraft-1",
            effect_mode: "BLOCKING",
            duration_multiplier_percent: null,
            status: "PLANNED",
            activated_at: null,
            earliest_start_at: null,
            latest_start_at: null,
            minimum_duration_minutes: 5,
            typical_duration_minutes: 10,
            maximum_duration_minutes: 15,
            after_rotation_id: "rotation-active",
            predicted_completion_at: "2026-08-12T09:41:00.000Z",
            completed_at: null,
          },
        ],
      },
      recurringRuleRows: {
        ...emptyResult(),
        results: [
          {
            id: "rule-1",
            scope_type: "AIRCRAFT",
            scope_id: "aircraft-1",
            trigger_metric: "COMPLETED_ROTATIONS",
            interval_value: 4,
            progress_value: 2,
            minimum_duration_minutes: 5,
            typical_duration_minutes: 10,
            maximum_duration_minutes: 15,
          },
        ],
      },
      activeBlockRows: {
        ...emptyResult(),
        results: [
          {
            scope_type: "RESOURCE_GROUP",
            scope_id: "resource-1",
            expected_review_at: "2026-08-12T09:05:00.000Z",
          },
        ],
      },
      activeDispatchLeaseRows: {
        ...emptyResult(),
        results: [
          {
            id: "lease-1",
            aircraft_id: "aircraft-1",
            dispatch_batch_id: "locked-batch",
            member_rotation_ids_json: '["rotation-draft-1"]',
          },
        ],
      },
    } as unknown as Parameters<typeof projectForecastTimelineInput>[0];

    const result = projectForecastTimelineInput(
      data,
      "event-1",
      new Date("2026-08-12T09:00:00.000Z"),
    );

    expect(result.forecastInput.capacities).toEqual([
      expect.objectContaining({
        resourceGroupId: "resource-1",
        activeAircraft: 0,
        unavailableReason: null,
        availabilityLanes: expect.arrayContaining([
          expect.objectContaining({
            laneId: "aircraft-1:pilot-1",
            constraints: expect.arrayContaining([expect.objectContaining({ id: "plan-aircraft" })]),
            recurringConstraints: [expect.objectContaining({ id: "rule-1" })],
          }),
        ]),
      }),
    ]);
    expect(result.forecastInput.previousDispatchPlan).toMatchObject({
      planId: "stored-plan",
      revision: "stored-revision",
      batches: [expect.objectContaining({ id: "stored-batch" })],
    });
    expect(result.forecastInput.lockedDispatchBatches).toEqual([
      expect.objectContaining({ id: "locked-batch", memberIds: ["rotation-draft-1"] }),
    ]);
    expect(result.forecastInput.rotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "rotation-draft-2",
          dispatchPredecessorMemberIds: ["rotation-draft-1"],
          publicStatus: "COME_TO_FLIGHT_LINE",
        }),
        expect.objectContaining({
          id: "rotation-active",
          confirmedTurnaroundProfile: expect.objectContaining({
            boardingMinutes: 6,
            boardingSource: "AIRCRAFT_PRODUCT:aircraft-1:product-1",
          }),
        }),
      ]),
    );
    expect(result.forecastInput.durationSamples).toEqual([
      expect.objectContaining({ minutes: 23, productCode: "P20" }),
    ]);
  });

  it("rejects active leases that reference unavailable draft members", () => {
    const data = {
      event: EVENT_ROW,
      rotationRows: emptyResult(),
      durationRows: emptyResult(),
      capacityRows: emptyResult(),
      turnaroundOverrideRows: emptyResult(),
      pilotRows: emptyResult(),
      gateWaitRows: emptyResult(),
      plannedOperationRows: emptyResult(),
      recurringRuleRows: emptyResult(),
      activeBlockRows: emptyResult(),
      activeDispatchLeaseRows: {
        ...emptyResult(),
        results: [
          {
            id: "lease-invalid",
            aircraft_id: "aircraft-1",
            dispatch_batch_id: "batch-invalid",
            member_rotation_ids_json: '["missing-rotation"]',
          },
        ],
      },
    } as unknown as Parameters<typeof projectForecastTimelineInput>[0];

    expect(() =>
      projectForecastTimelineInput(data, "event-1", new Date("2026-08-12T09:00:00.000Z")),
    ).toThrow("Active dispatch lease lease-invalid references unavailable members.");
  });

  it("selects only precalls backed by a fresh dispatch batch", () => {
    const rotation = {
      id: "rotation-1",
      status: "DRAFT",
      flight_group_id: "flight-group-1",
      resource_group_id: "resource-1",
      flight_group_version: 3,
      gate_id: "gate-1",
      gate_travel_lead_minutes: 2,
      resource_group_status: "ACTIVE",
      resource_group_precall_enabled: 1,
      precalled_at: null,
      queue_sequence: 1,
    } as never;

    const result = evaluateAutomaticPrecalls({
      event: EVENT_ROW,
      rotations: [rotation],
      projections: [projection()],
      adaptiveLeadMinutes: 8,
      now: new Date("2026-08-12T09:00:00.000Z"),
    });

    expect(result.decisions).toEqual([
      expect.objectContaining({
        id: "rotation-1",
        eligible: true,
        reason: "ELIGIBLE",
      }),
    ]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        flightGroupId: "flight-group-1",
        dispatchPlanRevision: "revision-1",
        dispatchBatchId: "batch-1",
      }),
    ]);
  });

  it("fails fast when an evaluator projection is missing", () => {
    expect(() =>
      evaluateAutomaticPrecalls({
        event: EVENT_ROW,
        rotations: [{ id: "rotation-missing", status: "DRAFT" } as never],
        projections: [],
        adaptiveLeadMinutes: 8,
        now: new Date("2026-08-12T09:00:00.000Z"),
      }),
    ).toThrow("Forecast projection missing for rotation rotation-missing.");
  });

  it("isolates failed sockets and schedules slowdown follow-ups", () => {
    const healthySocket = { send: vi.fn(), close: vi.fn() };
    const failedSocket = {
      send: vi.fn(() => {
        throw new Error("socket closed");
      }),
      close: vi.fn(),
    };
    const scheduleFollowUp = vi.fn();
    const service = new ForecastPublicationService(
      {} as never,
      () => [healthySocket, failedSocket] as unknown as WebSocket[],
      scheduleFollowUp,
    );

    service.publishForecastUpdated({
      eventId: "event-1",
      eventVersion: 7,
      updatedAt: "2026-08-12T09:00:00.000Z",
      triggerEventType: "PLANNED_SLOWDOWN_STARTED",
    });

    expect(healthySocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "forecast-updated",
        eventId: "event-1",
        eventVersion: 7,
        updatedAt: "2026-08-12T09:00:00.000Z",
      }),
    );
    expect(failedSocket.close).toHaveBeenCalledWith(1011, "Prognose-Broadcast fehlgeschlagen");
    expect(scheduleFollowUp).toHaveBeenCalledWith({
      eventId: "event-1",
      triggerEventType: "PLANNED_SLOWDOWN_STARTED_FOLLOW_UP",
    });
  });

  it("does not touch D1 when the repository has no statements or precalls", async () => {
    const batch = vi.fn();
    const repository = new ForecastTimelineRepository({
      DB: { batch },
    } as never);

    await repository.persist([], "event-1", [], "2026-08-12T09:00:00.000Z");

    expect(batch).not.toHaveBeenCalled();
  });
});
