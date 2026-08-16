import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForecastTimelineService } from "./forecast-timeline-service";
import type { Env } from "./types";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  calculateForecast: vi.fn(),
  evaluatePrecalls: vi.fn(),
  prepareStatements: vi.fn(),
  persist: vi.fn(),
  queueNotifications: vi.fn(),
  publish: vi.fn(),
  prepareCapture: vi.fn(),
  completeCapture: vi.fn(),
  failCapture: vi.fn(),
}));

vi.mock("./forecast-precall-evaluator", () => ({
  evaluateAutomaticPrecalls: mocks.evaluatePrecalls,
}));

vi.mock("./forecast-timeline-loader", () => ({
  ForecastTimelineLoader: class {
    load = mocks.load;
  },
}));

vi.mock("./forecast-timeline-calculation", () => ({
  calculateForecastTimelineOnce: mocks.calculateForecast,
}));

vi.mock("./forecast-timeline-repository", () => ({
  ForecastTimelineRepository: class {
    prepareStatements = mocks.prepareStatements;
    persist = mocks.persist;
  },
}));

vi.mock("./forecast-publication-service", () => ({
  ForecastPublicationService: class {
    queuePreparationNotifications = mocks.queueNotifications;
    publishForecastUpdated = mocks.publish;
  },
}));

vi.mock("./planning-capture", () => ({
  preparePlanningCapture: mocks.prepareCapture,
  completePlanningCapture: mocks.completeCapture,
  failPlanningCapture: mocks.failCapture,
}));

const event = { version: 17 };
const rotationRows = { results: [{ id: "rotation-1" }] };
const loaded = { event, rotationRows };
const forecastInput = { event: { eventId: "synthetic-event" } };
const calculationResult = {
  projections: [{ rotationId: "rotation-1" }],
  diagnostics: { dispatchPlan: { revision: "dispatch-revision-17" } },
};
const precallEvaluation = {
  projectionByRotationId: new Map([["rotation-1", calculationResult.projections[0]]]),
  queueEntries: [{ rotationId: "rotation-1" }],
  candidateByRotationId: new Map(),
  decisions: [{ rotationId: "rotation-1", decision: "NONE" }],
  candidates: [{ rotationId: "rotation-1" }],
};
const preparedCapture = {
  runId: "planning-run-17",
  mode: "ANCHOR",
  contextId: "context-17",
  anchorRunId: "planning-run-17",
  replayDistance: 0,
  startedAtMs: 1,
};

function createService(): ForecastTimelineService {
  return new ForecastTimelineService({ DB: {} as D1Database } as Env, () => [], vi.fn());
}

describe("forecast timeline service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(loaded);
    mocks.calculateForecast.mockReturnValue({
      forecastInput,
      adaptiveLeadMinutes: 12,
      now: new Date("2026-08-12T08:00:00.000Z"),
      nowIso: "2026-08-12T08:00:00.000Z",
      calculationResult,
      calculationDurationMs: 3,
    });
    mocks.evaluatePrecalls.mockReturnValue(precallEvaluation);
    mocks.prepareStatements.mockReturnValue(["statement-1"]);
    mocks.prepareCapture.mockResolvedValue(preparedCapture);
    mocks.persist.mockResolvedValue(undefined);
    mocks.queueNotifications.mockResolvedValue(undefined);
    mocks.completeCapture.mockResolvedValue(undefined);
    mocks.failCapture.mockResolvedValue(undefined);
  });

  it("loads, calculates, persists, captures, and publishes one forecast run", async () => {
    const result = await createService().recalculateForecastTimelines({
      eventId: "synthetic-event",
      triggerEventType: "ROTATION_UPDATED",
      planningRunId: "planning-run-17",
    });

    expect(mocks.load).toHaveBeenCalledWith(
      {
        eventId: "synthetic-event",
        triggerEventType: "ROTATION_UPDATED",
        planningRunId: "planning-run-17",
      },
      expect.any(String),
    );
    expect(mocks.calculateForecast).toHaveBeenCalledWith(loaded, "synthetic-event");
    expect(mocks.evaluatePrecalls).toHaveBeenCalledWith({
      event,
      rotations: rotationRows.results,
      projections: calculationResult.projections,
      adaptiveLeadMinutes: 12,
      now: new Date("2026-08-12T08:00:00.000Z"),
    });
    expect(mocks.prepareStatements).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "synthetic-event",
        triggerEventType: "ROTATION_UPDATED",
        planningRunId: "planning-run-17",
        adaptiveLeadMinutes: 12,
        event,
        rotationRows,
      }),
    );
    expect(mocks.prepareCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "synthetic-event",
        eventVersion: 17,
        triggerEventType: "ROTATION_UPDATED",
        runId: "planning-run-17",
        forecastInput,
        calculationResult,
        precallInput: precallEvaluation.queueEntries,
        precallOutput: precallEvaluation.decisions,
      }),
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      ["statement-1"],
      "synthetic-event",
      precallEvaluation.candidates,
      "2026-08-12T08:00:00.000Z",
    );
    expect(mocks.queueNotifications).toHaveBeenCalledWith("synthetic-event");
    expect(mocks.completeCapture).toHaveBeenCalledWith(expect.any(Object), preparedCapture);
    expect(mocks.publish).toHaveBeenCalledWith({
      eventId: "synthetic-event",
      eventVersion: 17,
      updatedAt: "2026-08-12T08:00:00.000Z",
      triggerEventType: "ROTATION_UPDATED",
    });
    expect(mocks.prepareCapture.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.persist.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.persist.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publish.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result).toEqual({
      planningRunId: "planning-run-17",
      eventVersion: 17,
      dispatchPlanRevision: "dispatch-revision-17",
    });
  });

  it("generates a run id when a recalculation was not explicitly identified", async () => {
    const randomUuid = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("550e8400-e29b-41d4-a716-446655440017");

    const result = await createService().recalculateForecastTimelines({
      eventId: "synthetic-event",
      triggerEventType: "SCHEDULED_TICK",
    });

    expect(result.planningRunId).toBe("550e8400-e29b-41d4-a716-446655440017");
    expect(mocks.prepareStatements).toHaveBeenCalledWith(
      expect.objectContaining({ planningRunId: "550e8400-e29b-41d4-a716-446655440017" }),
    );
    randomUuid.mockRestore();
  });

  it("does not attempt cleanup when preparing the planning capture fails", async () => {
    const failure = new Error("capture preparation failed");
    mocks.prepareCapture.mockRejectedValue(failure);

    await expect(
      createService().recalculateForecastTimelines({
        eventId: "synthetic-event",
        triggerEventType: "ROTATION_UPDATED",
      }),
    ).rejects.toBe(failure);

    expect(mocks.failCapture).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("marks a prepared capture as failed and preserves the original persistence error", async () => {
    const persistenceFailure = new Error("forecast persistence failed");
    mocks.persist.mockRejectedValue(persistenceFailure);
    mocks.failCapture.mockRejectedValue(new Error("cleanup failed"));

    await expect(
      createService().recalculateForecastTimelines({
        eventId: "synthetic-event",
        triggerEventType: "ROTATION_UPDATED",
        planningRunId: "planning-run-17",
      }),
    ).rejects.toBe(persistenceFailure);

    expect(mocks.failCapture).toHaveBeenCalledWith(expect.any(Object), preparedCapture);
    expect(mocks.queueNotifications).not.toHaveBeenCalled();
    expect(mocks.completeCapture).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
