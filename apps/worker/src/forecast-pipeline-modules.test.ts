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
