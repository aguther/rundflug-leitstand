import { describe, expect, it } from "vitest";
import {
  advanceOverduePrediction,
  assessForecastFreshness,
  calculateForecastTimelines,
  createQueueAvailability,
  DEFAULT_FORECAST_TUNING_PROFILE,
  estimateDuration,
  forecastQueueWindows,
  reserveNextQueueWindow,
} from "./forecast";

describe("event-driven forecast", () => {
  it("uses the reference model on cold start without requiring a recent actual event", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [],
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.quality).toBe("CHANGING");
  });

  it("weights recent actual durations without losing the reference baseline", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [18, 20, 21, 22, 22, 23],
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.expectedMinutes).toBeGreaterThanOrEqual(20);
    expect(estimate.quality).toBe("STABLE");
  });

  it("weights even the first actual duration more strongly than the static plan", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [32],
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.expectedMinutes).toBeGreaterThan(25);
  });

  it("gives the newest value the greatest weight when samples are chronological", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [10, 30],
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.expectedMinutes).toBe(22);
  });

  it("keeps the explicit production tuning profile bit-identical to omitted tuning", () => {
    const input = {
      referenceMinutes: 20,
      actualDurationsMinutes: [18, 20, 21, 22, 22, 23],
      interrupted: false,
      activeCapacity: 1,
    };
    expect(estimateDuration({ ...input, tuning: { ...DEFAULT_FORECAST_TUNING_PROFILE } })).toEqual(
      estimateDuration(input),
    );
  });

  it("applies experimental weights, sample limits, quality thresholds and margins", () => {
    const weighted = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [10, 30],
      interrupted: false,
      activeCapacity: 1,
      tuning: {
        ...DEFAULT_FORECAST_TUNING_PROFILE,
        referenceWeight: 10,
        firstSampleWeight: 1,
        recencyWeightIncrement: 0,
      },
    });
    expect(weighted.expectedMinutes).toBe(20);

    const changing = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [18, 19, 20, 21, 22, 23],
      interrupted: false,
      activeCapacity: 1,
      tuning: {
        ...DEFAULT_FORECAST_TUNING_PROFILE,
        maximumSamples: 3,
        stableMinimumSamples: 3,
        stableMaximumMeanDeviationMinutes: 0,
        changingMarginMinutes: 17,
      },
    });
    expect(changing.quality).toBe("CHANGING");
    expect(changing.sampleCount).toBe(3);
    expect(changing.lowerMinutes).toBe(changing.expectedMinutes - 17);
    expect(changing.upperMinutes).toBe(changing.expectedMinutes + 17);
  });

  it("opens the reference outlier boundary only for an explicit candidate profile", () => {
    const input = {
      referenceMinutes: 20,
      actualDurationsMinutes: [19, 20, 21, 34, 36],
      interrupted: false,
      activeCapacity: 1,
    };
    const baseline = estimateDuration(input);
    const candidate = estimateDuration({
      ...input,
      tuning: {
        ...DEFAULT_FORECAST_TUNING_PROFILE,
        referenceOutlierMultiplier: 2,
        stableMinimumSamples: 6,
      },
    });
    expect(baseline.sampleCount).toBe(4);
    expect(candidate.sampleCount).toBe(5);
  });

  it("rejects a single statistical outlier without changing the learned duration", () => {
    const regular = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [19, 20, 20, 21, 22],
      interrupted: false,
      activeCapacity: 1,
    });
    const withOutlier = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [19, 20, 20, 21, 22, 55],
      interrupted: false,
      activeCapacity: 1,
    });

    expect(withOutlier.expectedMinutes).toBe(regular.expectedMinutes);
    expect(withOutlier.sampleCount).toBe(regular.sampleCount);
  });

  it("does not learn a sequence of weather or airshow delays as the new normal", () => {
    const estimate = estimateDuration({
      referenceMinutes: 36,
      actualDurationsMinutes: [34, 36, 92, 96, 101],
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.sampleCount).toBe(2);
    expect(estimate.expectedMinutes).toBeLessThan(40);
  });

  it("counts down from actual aircraft availability and exposes an idle aircraft immediately", () => {
    let availability = createQueueAvailability({ activeAircraft: 2, busyAircraftMinutes: [9] });
    const duration = estimateDuration({
      referenceMinutes: 36,
      actualDurationsMinutes: [],
      interrupted: false,
      activeCapacity: 2,
    });
    const first = reserveNextQueueWindow(availability, duration);
    availability = first.availability;
    const second = reserveNextQueueWindow(availability, duration);
    expect(first.window.lowerMinutes).toBe(0);
    expect(first.window.upperMinutes).toBe(0);
    expect(second.window.lowerMinutes).toBe(9);
    expect(second.window.upperMinutes).toBe(9);
  });

  it("keeps old learning samples diagnostic without making a fresh estimate uncertain", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [20, 21],
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.quality).toBe("CHANGING");
    expect(
      forecastQueueWindows({ queueSequence: 4, activeAircraft: 1, duration: estimate }),
    ).toEqual({
      lowerMinutes: 33,
      upperMinutes: 124,
      quality: "CHANGING",
    });
  });

  it("uses the last successful prediction update for the five-minute freshness boundary", () => {
    expect(
      assessForecastFreshness({
        predictionQuality: "STABLE",
        predictionUpdatedAt: "2026-07-22T09:55:00.000Z",
        now: "2026-07-22T10:00:00.000Z",
      }),
    ).toEqual({ quality: "STABLE", reason: null, ageMinutes: 5 });
    expect(
      assessForecastFreshness({
        predictionQuality: "STABLE",
        predictionUpdatedAt: "2026-07-22T09:54:59.999Z",
        now: "2026-07-22T10:00:00.000Z",
      }),
    ).toMatchObject({ quality: "UNCERTAIN", reason: "STALE_PREDICTION" });
  });

  it("treats missing or invalid persisted prediction timestamps as stale", () => {
    for (const predictionUpdatedAt of [null, "invalid"]) {
      expect(
        assessForecastFreshness({
          predictionQuality: "CHANGING",
          predictionUpdatedAt,
          now: "2026-07-22T10:00:00.000Z",
        }),
      ).toEqual({ quality: "UNCERTAIN", reason: "STALE_PREDICTION", ageMinutes: null });
    }
  });

  it("widens the uncertainty interval for flight groups farther back in the queue", () => {
    const duration = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [18, 20, 21, 22, 22, 23],
      interrupted: false,
      activeCapacity: 3,
    });
    const windows = [1, 4, 7].map((queueSequence) =>
      forecastQueueWindows({ queueSequence, activeAircraft: 3, duration }),
    );
    const widths = windows.map((window) => window.upperMinutes - window.lowerMinutes);

    expect(windows.every((window) => window.quality === "STABLE")).toBe(true);
    expect(widths[1]).toBeGreaterThan(widths[0] ?? 0);
    expect(widths[2]).toBeGreaterThan(widths[1] ?? 0);
  });

  it.each([
    {
      status: "CALLED" as const,
      now: "2026-07-11T12:30:00.000Z",
      expected: {
        predictedDepartureAt: "2026-07-11T12:30:00.000Z",
        predictedLandingAt: "2026-07-11T12:50:00.000Z",
        predictedCompletionAt: "2026-07-11T13:00:00.000Z",
      },
    },
    {
      status: "IN_FLIGHT" as const,
      now: "2026-07-11T12:30:00.000Z",
      expected: {
        predictedDepartureAt: "2026-07-11T12:00:00.000Z",
        predictedLandingAt: "2026-07-11T12:30:00.000Z",
        predictedCompletionAt: "2026-07-11T12:40:00.000Z",
      },
    },
    {
      status: "LANDED" as const,
      now: "2026-07-11T12:40:00.000Z",
      expected: {
        predictedDepartureAt: "2026-07-11T12:00:00.000Z",
        predictedLandingAt: "2026-07-11T12:20:00.000Z",
        predictedCompletionAt: "2026-07-11T12:40:00.000Z",
      },
    },
  ])("moves an overdue $status milestone and every following milestone", ({
    status,
    now,
    expected,
  }) => {
    expect(
      advanceOverduePrediction({
        status,
        now,
        predictedDepartureAt: "2026-07-11T12:00:00.000Z",
        predictedLandingAt: "2026-07-11T12:20:00.000Z",
        predictedCompletionAt: "2026-07-11T12:30:00.000Z",
      }),
    ).toEqual({ ...expected, delayedByMissingEvent: true });
  });

  it("does not move a future milestone without a missing event", () => {
    expect(
      advanceOverduePrediction({
        status: "IN_FLIGHT",
        now: "2026-07-11T12:10:00.000Z",
        predictedDepartureAt: "2026-07-11T12:00:00.000Z",
        predictedLandingAt: "2026-07-11T12:20:00.000Z",
        predictedCompletionAt: "2026-07-11T12:30:00.000Z",
      }).delayedByMissingEvent,
    ).toBe(false);
  });

  it("recalculates the V1 sizing scenario well below two seconds", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [18, 19, 20, 21, 22, 20, 19, 21, 20, 22, 21, 20],
      interrupted: false,
      activeCapacity: 3,
    });
    const startedAt = performance.now();
    const forecasts = Array.from({ length: 300 }, (_, index) =>
      forecastQueueWindows({ queueSequence: index + 1, activeAircraft: 3, duration: estimate }),
    );
    const elapsed = performance.now() - startedAt;
    expect(forecasts).toHaveLength(300);
    expect(forecasts.at(-1)?.upperMinutes).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("projects active availability and queued rotations with an explicit clock", () => {
    const projections = calculateForecastTimelines({
      event: {
        eventId: "event-current",
        now: "2026-07-22T10:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 2,
      },
      capacities: [{ resourceGroupId: "rg-1", activeAircraft: 2 }],
      durationSamples: [],
      rotations: [
        {
          id: "active",
          status: "IN_FLIGHT",
          createdAt: "2026-07-22T09:00:00.000Z",
          calledAt: "2026-07-22T09:40:00.000Z",
          departedAt: "2026-07-22T09:50:00.000Z",
          landedAt: null,
          resourceGroupId: "rg-1",
          resourceGroupStatus: "ACTIVE",
          queueSequence: 1,
          referenceDurationMinutes: 20,
          productCode: "PAN",
          aircraftType: "SYN-A",
          predictedDepartureAt: "2026-07-22T09:50:00.000Z",
          predictedLandingAt: "2026-07-22T10:12:00.000Z",
          predictedCompletionAt: "2026-07-22T10:19:00.000Z",
        },
        {
          id: "first-draft",
          status: "DRAFT",
          createdAt: "2026-07-22T09:45:00.000Z",
          calledAt: null,
          departedAt: null,
          landedAt: null,
          resourceGroupId: "rg-1",
          resourceGroupStatus: "ACTIVE",
          queueSequence: 2,
          referenceDurationMinutes: 20,
          productCode: "PAN",
          aircraftType: null,
          predictedDepartureAt: null,
          predictedLandingAt: null,
          predictedCompletionAt: null,
        },
        {
          id: "second-draft",
          status: "DRAFT",
          createdAt: "2026-07-22T09:46:00.000Z",
          calledAt: null,
          departedAt: null,
          landedAt: null,
          resourceGroupId: "rg-1",
          resourceGroupStatus: "ACTIVE",
          queueSequence: 3,
          referenceDurationMinutes: 20,
          productCode: "PAN",
          aircraftType: null,
          predictedDepartureAt: null,
          predictedLandingAt: null,
          predictedCompletionAt: null,
        },
      ],
    });

    expect(projections.map((projection) => projection.rotationId)).toEqual([
      "active",
      "first-draft",
      "second-draft",
    ]);
    expect(projections[1]).toMatchObject({
      predictionLowerMinutes: 0,
      predictionUpperMinutes: 0,
      predictionQuality: "CHANGING",
      predictedBoardingAt: "2026-07-22T10:00:00.000Z",
      dataBasisScope: "REFERENCE_ONLY",
      activeCapacity: 2,
    });
    expect(projections[2]).toMatchObject({
      predictionLowerMinutes: 19,
      predictionUpperMinutes: 19,
      predictedBoardingAt: "2026-07-22T10:19:00.000Z",
    });
  });

  it("keeps robust current-day samples stable even when their age exceeds five minutes", () => {
    const projection = calculateForecastTimelines({
      event: {
        eventId: "event-current",
        now: "2026-07-22T10:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 2,
      },
      capacities: [{ resourceGroupId: "rg-1", activeAircraft: 1 }],
      durationSamples: [
        ...[31, 32, 33, 32, 31].map((minutes, index) => ({
          minutes,
          completedAt: `2026-07-22T08:5${index + 5}:00.000Z`,
          eventId: "event-current",
          productCode: "PAN",
          aircraftType: "SYN-A",
        })),
        {
          minutes: 48,
          completedAt: "2026-07-21T12:00:00.000Z",
          eventId: "event-old",
          productCode: "PAN",
          aircraftType: "SYN-A",
        },
      ],
      rotations: [
        {
          id: "draft",
          status: "DRAFT",
          createdAt: "2026-07-22T09:55:00.000Z",
          calledAt: null,
          departedAt: null,
          landedAt: null,
          resourceGroupId: "rg-1",
          resourceGroupStatus: "ACTIVE",
          queueSequence: 1,
          referenceDurationMinutes: 20,
          productCode: "PAN",
          aircraftType: "SYN-A",
          predictedDepartureAt: null,
          predictedLandingAt: null,
          predictedCompletionAt: null,
        },
      ],
    })[0];

    expect(projection).toMatchObject({
      predictionQuality: "STABLE",
      dataBasisScope: "AIRCRAFT_PRODUCT_HISTORY",
      sampleSize: 5,
      dataAgeMinutes: 61,
      uncertaintyReasons: [],
    });
  });

  it("marks every projection uncertain during an interruption without publishing a countdown", () => {
    const projection = calculateForecastTimelines({
      event: {
        eventId: "event-current",
        now: "2026-07-22T10:00:00.000Z",
        operationalInterrupted: true,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 2,
      },
      capacities: [{ resourceGroupId: "rg-1", activeAircraft: 2 }],
      durationSamples: [],
      rotations: [
        {
          id: "draft",
          status: "DRAFT",
          createdAt: "2026-07-22T09:55:00.000Z",
          calledAt: null,
          departedAt: null,
          landedAt: null,
          resourceGroupId: "rg-1",
          resourceGroupStatus: "ACTIVE",
          queueSequence: 1,
          referenceDurationMinutes: 20,
          productCode: "PAN",
          aircraftType: null,
          predictedDepartureAt: null,
          predictedLandingAt: null,
          predictedCompletionAt: null,
        },
      ],
    })[0];

    expect(projection).toMatchObject({
      predictionQuality: "UNCERTAIN",
      predictionLowerMinutes: 0,
      predictionUpperMinutes: 0,
      uncertaintyReasons: ["OPERATION_INTERRUPTED"],
    });
  });

  it("reports every hard operational uncertainty reason explicitly", () => {
    const projection = calculateForecastTimelines({
      event: {
        eventId: "event-current",
        now: "2026-07-22T10:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: true,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 2,
      },
      capacities: [{ resourceGroupId: "rg-1", activeAircraft: 0 }],
      durationSamples: [],
      rotations: [
        {
          id: "draft",
          status: "DRAFT",
          createdAt: "2026-07-22T09:55:00.000Z",
          calledAt: null,
          departedAt: null,
          landedAt: null,
          resourceGroupId: "rg-1",
          resourceGroupStatus: "PAUSED",
          queueSequence: 1,
          referenceDurationMinutes: 20,
          productCode: "PAN",
          aircraftType: null,
          predictedDepartureAt: null,
          predictedLandingAt: null,
          predictedCompletionAt: null,
        },
      ],
    })[0];

    expect(projection).toMatchObject({
      predictionQuality: "UNCERTAIN",
      uncertaintyReasons: ["EMERGENCY_MODE", "RESOURCE_GROUP_INACTIVE", "NO_ACTIVE_CAPACITY"],
    });
  });
});
