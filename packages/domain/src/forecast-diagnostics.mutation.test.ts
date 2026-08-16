import { describe, expect, it } from "vitest";
import { assessForecastFreshness, operationsEndAssessment } from "./forecast-diagnostics";

describe("forecast diagnostics mutation boundaries", () => {
  it("rejects invalid clocks and age limits with stable diagnostics", () => {
    expect(() =>
      assessForecastFreshness({
        predictionQuality: "STABLE",
        predictionUpdatedAt: "2026-08-16T10:00:00.000Z",
        now: "invalid",
      }),
    ).toThrow("Forecast freshness time is invalid.");
    for (const maximumAgeMinutes of [-1, Number.NaN]) {
      expect(() =>
        assessForecastFreshness({
          predictionQuality: "STABLE",
          predictionUpdatedAt: "2026-08-16T10:00:00.000Z",
          now: "2026-08-16T10:00:00.000Z",
          maximumAgeMinutes,
        }),
      ).toThrow("Forecast freshness maximum age is invalid.");
    }
  });

  it("distinguishes missing, exact-boundary, future, and stale predictions", () => {
    expect(
      assessForecastFreshness({
        predictionQuality: null,
        predictionUpdatedAt: "2026-08-16T10:00:00.000Z",
        now: "2026-08-16T10:05:00.000Z",
      }),
    ).toEqual({ quality: "UNCERTAIN", reason: "STALE_PREDICTION", ageMinutes: null });
    expect(
      assessForecastFreshness({
        predictionQuality: "CHANGING",
        predictionUpdatedAt: "invalid",
        now: "2026-08-16T10:05:00.000Z",
      }),
    ).toEqual({ quality: "UNCERTAIN", reason: "STALE_PREDICTION", ageMinutes: null });
    expect(
      assessForecastFreshness({
        predictionQuality: "STABLE",
        predictionUpdatedAt: "2026-08-16T10:00:00.000Z",
        now: "2026-08-16T10:05:00.000Z",
        maximumAgeMinutes: 5,
      }),
    ).toEqual({ quality: "STABLE", reason: null, ageMinutes: 5 });
    expect(
      assessForecastFreshness({
        predictionQuality: "CHANGING",
        predictionUpdatedAt: "2026-08-16T10:06:00.000Z",
        now: "2026-08-16T10:05:00.000Z",
      }),
    ).toEqual({ quality: "CHANGING", reason: null, ageMinutes: 0 });
    expect(
      assessForecastFreshness({
        predictionQuality: "STABLE",
        predictionUpdatedAt: "2026-08-16T09:59:59.999Z",
        now: "2026-08-16T10:05:00.000Z",
        maximumAgeMinutes: 5,
      }),
    ).toMatchObject({ quality: "UNCERTAIN", reason: "STALE_PREDICTION" });
  });

  it("rounds only positive operations-end overruns up to complete minutes", () => {
    expect(operationsEndAssessment(null, "2026-08-16T10:00:00.000Z")).toEqual({
      extendsBeyondOperationsEnd: false,
      overtimeMinutes: 0,
    });
    expect(operationsEndAssessment("invalid", "2026-08-16T10:00:00.000Z")).toEqual({
      extendsBeyondOperationsEnd: false,
      overtimeMinutes: 0,
    });
    expect(operationsEndAssessment("2026-08-16T10:00:00.000Z", "2026-08-16T10:00:00.000Z")).toEqual(
      { extendsBeyondOperationsEnd: false, overtimeMinutes: 0 },
    );
    expect(operationsEndAssessment("2026-08-16T10:00:00.001Z", "2026-08-16T10:00:00.000Z")).toEqual(
      { extendsBeyondOperationsEnd: true, overtimeMinutes: 1 },
    );
    expect(operationsEndAssessment("2026-08-16T10:02:00.001Z", "2026-08-16T10:00:00.000Z")).toEqual(
      { extendsBeyondOperationsEnd: true, overtimeMinutes: 3 },
    );
  });
});
