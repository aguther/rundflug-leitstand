import { describe, expect, it } from "vitest";
import type { SimulationForecastSnapshot, SimulationRotation } from "./model";
import { buildBoardingErrorTrendPoints } from "./simulation-error-trend";

function rotation(
  id: string,
  communicationNumber: number,
  calledAt: string | null,
): SimulationRotation {
  return {
    id,
    communicationNumber,
    passengerCount: 3,
    createdAt: "2026-08-18T08:00:00.000Z",
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

describe("boarding error trend", () => {
  it("plots the earliest available forecast against actual boarding in boarding order", () => {
    const rotations = [
      rotation("rotation-2", 102, "2026-08-18T11:00:00.000Z"),
      rotation("rotation-1", 101, "2026-08-18T10:30:00.000Z"),
    ];
    const snapshots = [
      snapshot("rotation-1", "2026-08-18T10:20:00.000Z", "2026-08-18T10:40:00.000Z"),
      snapshot("rotation-2", "2026-08-18T09:05:00.000Z", "2026-08-18T11:10:00.000Z"),
      snapshot("rotation-1", "2026-08-18T09:00:00.000Z", "2026-08-18T10:10:00.000Z"),
    ];

    expect(buildBoardingErrorTrendPoints(rotations, snapshots, "INITIAL")).toMatchObject([
      { communicationNumber: 101, error: -20 },
      { communicationNumber: 102, error: 10 },
    ]);
  });

  it("ignores unavailable first forecasts, snapshots after boarding and rotations without boarding", () => {
    const rotations = [
      rotation("rotation-1", 101, "2026-08-18T10:30:00.000Z"),
      rotation("rotation-2", 102, null),
    ];
    const snapshots = [
      snapshot("rotation-1", "2026-08-18T09:00:00.000Z", "2026-08-18T10:00:00.000Z", {
        forecastState: "UNAVAILABLE",
      }),
      snapshot("rotation-1", "2026-08-18T10:31:00.000Z", "2026-08-18T10:35:00.000Z"),
      snapshot("rotation-2", "2026-08-18T09:00:00.000Z", "2026-08-18T11:00:00.000Z"),
    ];

    expect(buildBoardingErrorTrendPoints(rotations, snapshots, "INITIAL")).toEqual([]);
  });

  it("keeps the latest-snapshot trend behavior separate from the initial forecast", () => {
    const rotations = [rotation("rotation-1", 101, "2026-08-18T10:30:00.000Z")];
    const snapshots = [
      snapshot("rotation-1", "2026-08-18T09:00:00.000Z", "2026-08-18T10:10:00.000Z"),
      snapshot("rotation-1", "2026-08-18T10:20:00.000Z", "2026-08-18T10:35:00.000Z"),
    ];

    expect(buildBoardingErrorTrendPoints(rotations, snapshots, "INITIAL")[0]?.error).toBe(-20);
    expect(buildBoardingErrorTrendPoints(rotations, snapshots, "LATEST")[0]?.error).toBe(5);
  });
});
