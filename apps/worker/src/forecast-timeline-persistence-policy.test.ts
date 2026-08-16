import { describe, expect, it } from "vitest";
import {
  isForecastSnapshotEligible,
  mapForecastPrecallReasons,
} from "./forecast-timeline-persistence-policy";

describe("forecast timeline persistence policy", () => {
  it("persists only bounded forecasts with available capacity", () => {
    const available = {
      capacityStatus: "AVAILABLE",
      predictionLowerMinutes: 4,
      predictionUpperMinutes: 8,
    } as unknown as Parameters<typeof isForecastSnapshotEligible>[0];

    expect(isForecastSnapshotEligible(available)).toBe(true);
    expect(
      isForecastSnapshotEligible({ ...available, capacityStatus: "NO_FORECAST_CAPACITY" }),
    ).toBe(false);
    expect(isForecastSnapshotEligible({ ...available, predictionLowerMinutes: null })).toBe(false);
    expect(isForecastSnapshotEligible({ ...available, predictionUpperMinutes: null })).toBe(false);
  });

  it("keeps legacy reasons separate from dispatch-specific reasons", () => {
    expect(mapForecastPrecallReasons("ELIGIBLE")).toEqual({
      legacyReason: "ELIGIBLE",
      dispatchReason: null,
    });
    expect(mapForecastPrecallReasons("COMMITMENT_LOCKED")).toEqual({
      legacyReason: "TOO_EARLY",
      dispatchReason: "COMMITMENT_LOCKED",
    });
  });
});
