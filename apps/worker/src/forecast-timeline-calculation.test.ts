import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateForecastTimelineOnce } from "./forecast-timeline-calculation";

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  calculate: vi.fn(),
}));

vi.mock("@rundflug/domain", () => ({
  calculateForecastTimelineResult: mocks.calculate,
}));

vi.mock("./forecast-timeline-projector", () => ({
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
    mocks.calculate.mockReturnValue(initialResult);
  });

  it("keeps a stable first calculation", () => {
    const calculated = calculateForecastTimelineOnce(loaded as never, "synthetic-event");

    expect(mocks.project).toHaveBeenCalledOnce();
    expect(mocks.calculate).toHaveBeenCalledOnce();
    expect(calculated).toMatchObject({
      forecastInput: initialForecastInput,
      calculationResult: initialResult,
    });
  });

  it("calculates active occupancy and draft dispatch in one domain pass", () => {
    calculateForecastTimelineOnce(loaded as never, "synthetic-event");

    expect(mocks.project).toHaveBeenCalledOnce();
    expect(mocks.calculate).toHaveBeenCalledOnce();
    expect(mocks.calculate).toHaveBeenCalledWith(initialForecastInput);
  });
});
