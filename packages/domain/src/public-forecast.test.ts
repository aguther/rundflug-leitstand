import { describe, expect, it } from "vitest";
import { derivePublicForecastProjection } from "./public-forecast";

const base = {
  rotationStatus: "DRAFT" as const,
  predictionQuality: "CHANGING" as const,
  predictedBoardingAt: "2026-07-22T11:00:00.000Z",
  predictedCompletionAt: "2026-07-22T11:30:00.000Z",
  operationsEndAt: "2026-07-22T18:00:00.000Z",
  dispatchBatchId: null,
  dispatchUnplannedReason: "NOT_IN_NEAR_DISPATCH_BATCH" as const,
  emergencyMode: false,
  operationalInterrupted: false,
  resourceGroupStatus: "ACTIVE" as const,
};

describe("public forecast projection", () => {
  it("distinguishes dispatch, long-range and overtime windows", () => {
    expect(derivePublicForecastProjection(base).forecastState).toBe("LONG_RANGE_WINDOW");
    expect(
      derivePublicForecastProjection({ ...base, dispatchBatchId: "dispatch-batch-1" })
        .forecastState,
    ).toBe("DISPATCH_WINDOW");
    expect(
      derivePublicForecastProjection({
        ...base,
        predictedCompletionAt: "2026-07-22T18:01:00.000Z",
      }).forecastState,
    ).toBe("AFTER_OPERATIONS_END");
  });

  it("publishes only safe unavailable reasons", () => {
    expect(
      derivePublicForecastProjection({
        ...base,
        predictedBoardingAt: null,
        predictedCompletionAt: null,
        predictionQuality: "UNCERTAIN",
        dispatchUnplannedReason: "UNKNOWN_RESOURCE_RETURN",
      }),
    ).toEqual({ forecastState: "UNAVAILABLE", forecastReason: "RETURN_TIME_UNKNOWN" });
    expect(
      derivePublicForecastProjection({
        ...base,
        predictedBoardingAt: null,
        predictedCompletionAt: null,
        predictionQuality: "UNCERTAIN",
        dispatchUnplannedReason: "WAITING_FOR_FITTING_LANE",
      }).forecastReason,
    ).toBe("NO_MATCHING_CAPACITY");
  });

  it("suppresses apparently precise windows during global interruption", () => {
    expect(derivePublicForecastProjection({ ...base, operationalInterrupted: true })).toEqual({
      forecastState: "UNAVAILABLE",
      forecastReason: "OPERATIONS_INTERRUPTED",
    });
  });
});
