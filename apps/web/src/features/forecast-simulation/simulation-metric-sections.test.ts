import { describe, expect, it } from "vitest";
import type { SimulationForecastSnapshot, SimulationRotation } from "./model";
import {
  boardingForecastAbsoluteChanges,
  calculateForecastAccuracyMetrics,
  calculateStabilityMetrics,
} from "./simulation-metric-sections";
import { findFirstAvailableDraftForecastSnapshot } from "./simulation-snapshot";

function rotation(
  id: string,
  calledAt: string | null,
  createdAt = "2026-08-18T08:00:00.000Z",
): SimulationRotation {
  return {
    id,
    communicationNumber: Number(id.replace(/\D/g, "")) || 1,
    passengerCount: 3,
    createdAt,
    precalledAt: null,
    precallTrigger: null,
    precallPredictionQuality: null,
    precallPredictedBoardingAt: null,
    precallAdaptiveLeadMinutes: null,
    aircraftId: null,
    calledAt,
    departedAt: null,
    landedAt: null,
    completedAt: null,
    boardingMinutes: null,
    flightMinutes: null,
    deboardingMinutes: null,
    bufferMinutes: null,
  };
}

function snapshot(
  rotationId: string,
  capturedAt: string,
  predictedBoardingAt: string,
  overrides: Partial<SimulationForecastSnapshot> = {},
): SimulationForecastSnapshot {
  return {
    rotationId,
    capturedAt,
    status: "DRAFT",
    quality: "STABLE",
    lowerMinutes: 5,
    upperMinutes: 15,
    plannedBoardingAt: predictedBoardingAt,
    predictedBoardingAt,
    predictedDepartureAt: predictedBoardingAt,
    predictedLandingAt: predictedBoardingAt,
    predictedCompletionAt: predictedBoardingAt,
    sampleSize: 3,
    dataAgeMinutes: 0,
    activeCapacity: 1,
    uncertaintyReasons: [],
    forecastState: "DISPATCH_WINDOW",
    countdownDisplayed: true,
    ...overrides,
  };
}

describe("initial boarding forecast accuracy", () => {
  it("finds the earliest available draft snapshot before boarding in unsorted input", () => {
    const values = [
      snapshot("rotation-1", "2026-08-18T10:20:00.000Z", "2026-08-18T10:40:00.000Z"),
      snapshot("rotation-1", "2026-08-18T10:31:00.000Z", "2026-08-18T10:31:00.000Z"),
      snapshot("rotation-1", "2026-08-18T09:00:00.000Z", "2026-08-18T10:10:00.000Z"),
      snapshot("rotation-1", "2026-08-18T08:30:00.000Z", "2026-08-18T09:30:00.000Z", {
        forecastState: "UNAVAILABLE",
      }),
      snapshot("rotation-1", "2026-08-18T08:00:00.000Z", "2026-08-18T09:00:00.000Z", {
        status: "CALLED",
      }),
    ];

    expect(
      findFirstAvailableDraftForecastSnapshot(values, "rotation-1", "2026-08-18T10:30:00.000Z")
        ?.capturedAt,
    ).toBe("2026-08-18T09:00:00.000Z");
  });

  it("summarizes one signed first-forecast error per boarded rotation", () => {
    const rotations = [
      rotation("rotation-1", "2026-08-18T10:30:00.000Z"),
      rotation("rotation-2", "2026-08-18T11:00:00.000Z"),
      rotation("rotation-3", null),
    ];
    const snapshots = [
      snapshot("rotation-1", "2026-08-18T09:00:00.000Z", "2026-08-18T10:10:00.000Z"),
      snapshot("rotation-1", "2026-08-18T10:20:00.000Z", "2026-08-18T10:40:00.000Z"),
      snapshot("rotation-2", "2026-08-18T09:05:00.000Z", "2026-08-18T11:10:00.000Z"),
      snapshot("rotation-3", "2026-08-18T09:10:00.000Z", "2026-08-18T11:30:00.000Z"),
    ];

    const metrics = calculateForecastAccuracyMetrics(rotations, snapshots);

    expect(metrics.initialBoarding).toMatchObject({
      samples: 2,
      maeMinutes: 15,
      medianAbsoluteErrorMinutes: 15,
      biasMinutes: -5,
    });
    expect(metrics.boarding).toMatchObject({
      samples: 2,
      medianAbsoluteErrorMinutes: 10,
    });
  });

  it("does not count rotations without boarding or without an available first forecast", () => {
    const rotations = [
      rotation("rotation-1", "2026-08-18T10:30:00.000Z"),
      rotation("rotation-2", null),
    ];
    const snapshots = [
      snapshot("rotation-1", "2026-08-18T09:00:00.000Z", "2026-08-18T10:00:00.000Z", {
        forecastState: "UNAVAILABLE",
      }),
      snapshot("rotation-2", "2026-08-18T09:00:00.000Z", "2026-08-18T10:00:00.000Z"),
    ];

    expect(calculateForecastAccuracyMetrics(rotations, snapshots).initialBoarding).toEqual({
      samples: 0,
      maeMinutes: null,
      medianAbsoluteErrorMinutes: null,
      p90AbsoluteErrorMinutes: null,
      biasMinutes: null,
    });
  });
});

describe("boarding forecast stability", () => {
  it("measures consecutive available draft forecasts chronologically", () => {
    const snapshots = [
      snapshot("rotation-1", "2026-08-18T10:20:00.000Z", "2026-08-18T10:50:00.000Z"),
      snapshot("rotation-1", "2026-08-18T09:30:00.000Z", "2026-08-18T11:00:00.000Z", {
        forecastState: "UNAVAILABLE",
      }),
      snapshot("rotation-1", "2026-08-18T09:00:00.000Z", "2026-08-18T10:10:00.000Z"),
      snapshot("rotation-1", "2026-08-18T10:00:00.000Z", "2026-08-18T10:40:00.000Z"),
      snapshot("rotation-1", "2026-08-18T10:30:00.000Z", "2026-08-18T11:30:00.000Z", {
        status: "CALLED",
      }),
    ];

    expect(boardingForecastAbsoluteChanges(snapshots)).toEqual([30, 10]);
    expect(calculateStabilityMetrics(snapshots)).toEqual(
      expect.objectContaining({
        changes: 2,
        averageAbsoluteChangeMinutes: 20,
        maximumJumpMinutes: 30,
        jumpsOver15Minutes: 1,
        jumpsOver30Minutes: 0,
      }),
    );
  });
});
