import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateConvergedForecastTimeline } from "./forecast-timeline-calculation";

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  applyActiveProjections: vi.fn(),
  calculate: vi.fn(),
}));

vi.mock("@rundflug/domain", () => ({
  calculateForecastTimelineResult: mocks.calculate,
}));

vi.mock("./forecast-timeline-projector", () => ({
  applyActiveForecastProjections: mocks.applyActiveProjections,
  projectForecastTimelineInput: mocks.project,
}));

const loaded = { event: { version: 17 } };
const now = new Date("2026-08-12T08:00:00.000Z");
const initialForecastInput = { event: { eventId: "synthetic-event" } };
const initialResult = {
  projections: [{ rotationId: "rotation-1" }],
  diagnostics: { dispatchPlan: { revision: "initial-revision" } },
};

describe("forecast timeline calculation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.mockReturnValue({
      forecastInput: initialForecastInput,
      adaptiveLeadMinutes: 12,
      now,
      nowIso: now.toISOString(),
    });
    mocks.applyActiveProjections.mockReturnValue(null);
    mocks.calculate.mockReturnValue(initialResult);
  });

  it("keeps a stable first calculation", () => {
    const calculated = calculateConvergedForecastTimeline(loaded as never, "synthetic-event");

    expect(mocks.project).toHaveBeenCalledOnce();
    expect(mocks.calculate).toHaveBeenCalledOnce();
    expect(calculated).toMatchObject({
      forecastInput: initialForecastInput,
      calculationResult: initialResult,
    });
  });

  it("recalculates once with projected active timelines", () => {
    const convergedData = { event: { version: 17 }, convergencePass: true };
    const convergedForecastInput = { event: { eventId: "synthetic-event" }, converged: true };
    const convergedResult = {
      projections: [{ rotationId: "rotation-1", assumedAircraftId: "aircraft-a" }],
      diagnostics: { dispatchPlan: { revision: "converged-revision" } },
    };
    mocks.applyActiveProjections.mockReturnValue(convergedData);
    mocks.project
      .mockReturnValueOnce({
        forecastInput: initialForecastInput,
        adaptiveLeadMinutes: 12,
        now,
        nowIso: now.toISOString(),
      })
      .mockReturnValueOnce({
        forecastInput: convergedForecastInput,
        adaptiveLeadMinutes: 13,
        now,
        nowIso: now.toISOString(),
      });
    mocks.calculate.mockReturnValueOnce(initialResult).mockReturnValueOnce(convergedResult);

    const calculated = calculateConvergedForecastTimeline(loaded as never, "synthetic-event");

    expect(mocks.project).toHaveBeenNthCalledWith(2, convergedData, "synthetic-event", now);
    expect(mocks.calculate).toHaveBeenNthCalledWith(2, convergedForecastInput);
    expect(calculated).toMatchObject({
      forecastInput: convergedForecastInput,
      adaptiveLeadMinutes: 13,
      calculationResult: convergedResult,
    });
  });
});
