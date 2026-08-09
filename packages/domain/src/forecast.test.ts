import { describe, expect, it } from "vitest";
import {
  advanceOverduePrediction,
  assessForecastFreshness,
  calculateForecastTimelineResult,
  calculateForecastTimelines,
  createQueueAvailability,
  DEFAULT_FORECAST_TUNING_PROFILE,
  estimateDuration,
  type ForecastTimelinesInput,
  forecastQueueWindows,
  reserveNextQueueWindow,
} from "./forecast";

function learningTimelineInput(sampleMinutes: readonly number[]): ForecastTimelinesInput {
  const now = "2026-08-02T10:00:00.000Z";
  return {
    event: {
      eventId: "event-short-learning",
      now,
      operationalInterrupted: false,
      emergencyMode: false,
      plannedBoardingMinutes: 5,
      plannedDeboardingMinutes: 5,
      plannedBufferMinutes: 2,
    },
    capacities: [
      {
        resourceGroupId: "rg-1",
        activeAircraft: 1,
        availabilityLanes: [
          {
            laneId: "aircraft-1:pilot-1",
            aircraftId: "aircraft-1",
            pilotId: "pilot-1",
            passengerSeats: 3,
            availableLowerAt: now,
            availableExpectedAt: now,
            availableUpperAt: now,
          },
        ],
      },
    ],
    durationSamples: sampleMinutes.map((minutes, index) => ({
      minutes,
      completedAt: new Date(Date.parse(now) - (index + 1) * 60_000).toISOString(),
      eventId: "event-short-learning",
      productCode: "R",
      aircraftType: null,
    })),
    rotations: [
      {
        id: "draft-short-learning",
        status: "DRAFT",
        createdAt: "2026-08-02T09:30:00.000Z",
        calledAt: null,
        departedAt: null,
        landedAt: null,
        resourceGroupId: "rg-1",
        resourceGroupStatus: "ACTIVE",
        queueSequence: 1,
        passengerCount: 3,
        referenceDurationMinutes: 20,
        productCode: "R",
        aircraftType: null,
        predictedDepartureAt: null,
        predictedLandingAt: null,
        predictedCompletionAt: null,
      },
    ],
  };
}

describe("event-driven forecast", () => {
  it("returns deterministic diagnostics without changing the projection wrapper or input", () => {
    const input = {
      event: {
        eventId: "event-diagnostics",
        now: "2026-08-02T10:00:00.000Z",
        plannedOperationsStartAt: "2026-08-02T08:00:00.000Z",
        plannedOperationsEndAt: "2026-08-02T20:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 4,
        plannedBufferMinutes: 2,
      },
      capacities: [],
      durationSamples: [],
      rotations: [
        {
          id: "rotation-diagnostics",
          status: "DRAFT" as const,
          createdAt: "2026-08-02T09:00:00.000Z",
          calledAt: null,
          departedAt: null,
          landedAt: null,
          resourceGroupId: "resource-diagnostics",
          resourceGroupStatus: "ACTIVE" as const,
          queueSequence: 1,
          referenceDurationMinutes: 20,
          productCode: "R",
          aircraftType: null,
          predictedDepartureAt: null,
          predictedLandingAt: null,
          predictedCompletionAt: null,
        },
      ],
    };
    const snapshot = structuredClone(input);
    const first = calculateForecastTimelineResult(input);
    const second = calculateForecastTimelineResult(input);

    expect(first.projections).toEqual(calculateForecastTimelines(input));
    expect(first.diagnostics).toEqual(second.diagnostics);
    expect(first.diagnostics.dispatchInput.now).toBe(input.event.now);
    expect(first.diagnostics.dispatchPlan.revision).toBeTruthy();
    expect(input).toEqual(snapshot);
  });

  it("keeps group 101 in the first equally full dispatch wave after forecast input mapping", () => {
    const now = "2026-07-31T17:42:54.000Z";
    const soldGroups = [
      ["101", 1, "2026-07-31T17:37:30.268Z"],
      ["102", 2, "2026-07-31T17:37:31.503Z"],
      ["103", 2, "2026-07-31T17:37:33.648Z"],
      ["104", 1, "2026-07-31T17:37:34.859Z"],
      ["105", 3, "2026-07-31T17:37:36.154Z"],
      ["106", 3, "2026-07-31T17:37:37.370Z"],
      ["107", 1, "2026-07-31T17:37:39.125Z"],
      ["108", 1, "2026-07-31T17:37:39.888Z"],
      ["109", 2, "2026-07-31T17:37:41.427Z"],
    ] as const;
    const result = calculateForecastTimelineResult({
      event: {
        eventId: "event-101",
        now,
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 4,
        plannedDeboardingMinutes: 4,
        plannedBufferMinutes: 2,
      },
      capacities: [
        {
          resourceGroupId: "touring",
          activeAircraft: 4,
          availabilityLanes: Array.from({ length: 4 }, (_, index) => ({
            laneId: `lane-${index + 1}`,
            aircraftId: `aircraft-${index + 1}`,
            pilotId: `pilot-${index + 1}`,
            passengerSeats: 3,
            availableLowerAt: now,
            availableExpectedAt: now,
            availableUpperAt: now,
          })),
        },
      ],
      durationSamples: [],
      dispatchPlanningLimits: { maximumWaves: 2 },
      rotations: soldGroups.map(([id, passengerCount, soldAt], index) => ({
        id,
        status: "DRAFT" as const,
        createdAt: soldAt,
        soldAt,
        calledAt: null,
        departedAt: null,
        landedAt: null,
        resourceGroupId: "touring",
        resourceGroupStatus: "ACTIVE" as const,
        queueSequence: index + 1,
        passengerCount,
        referenceDurationMinutes: 20,
        productCode: "R",
        productId: "round-flight",
        aircraftType: null,
        predictedDepartureAt: null,
        predictedLandingAt: null,
        predictedCompletionAt: null,
      })),
    });
    const firstWave = result.diagnostics.dispatchPlan.batches
      .filter((batch) => batch.wave === 1)
      .map((batch) => [...batch.memberIds].sort().join("+"))
      .sort();

    expect(firstWave).toEqual(["101+102", "103+104", "105", "106"]);
  });

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

  it("rejects unrealistically short test rotations instead of learning them", () => {
    const estimate = estimateDuration({
      referenceMinutes: 30,
      actualDurationsMinutes: [0.1468, 0.4864, 0.6859, 0.8007, 1.0586, 1.3189],
      interrupted: false,
      activeCapacity: 4,
    });

    expect(estimate).toMatchObject({
      expectedMinutes: 30,
      quality: "CHANGING",
      sampleCount: 0,
    });
  });

  it("keeps plausible short rotations at the documented lower reference boundary", () => {
    const estimate = estimateDuration({
      referenceMinutes: 30,
      actualDurationsMinutes: [15, 16, 17],
      interrupted: false,
      activeCapacity: 4,
    });

    expect(estimate.sampleCount).toBe(3);
    expect(estimate.expectedMinutes).toBeLessThan(30);
  });

  it("uses the same learned total duration for dispatch reservation and visible completion", () => {
    const result = calculateForecastTimelineResult(learningTimelineInput([16, 16, 16, 16, 16]));
    const projection = result.projections[0];
    const batch = result.diagnostics.dispatchPlan.batches[0];

    expect(projection?.sampleSize).toBe(5);
    expect(
      Date.parse(projection?.predictedCompletionAt ?? "") -
        Date.parse(projection?.predictedBoardingAt ?? ""),
    ).toBe(
      Date.parse(batch?.predictedCompletionAt ?? "") -
        Date.parse(batch?.boardingWindowExpectedAt ?? ""),
    );
  });

  it("reports only accepted learning samples in forecast diagnostics", () => {
    const projection = calculateForecastTimelines(
      learningTimelineInput([0.1468, 0.4864, 0.6859, 0.8007, 1.0586, 1.3189]),
    )[0];

    expect(projection).toMatchObject({
      sampleSize: 0,
      dataBasisScope: "REFERENCE_ONLY",
      dataAgeMinutes: 0,
    });
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
    expect(first.window).not.toBeNull();
    expect(second.window).not.toBeNull();
    expect(first.window?.lowerMinutes).toBe(0);
    expect(first.window?.upperMinutes).toBe(5);
    expect(second.window?.lowerMinutes).toBe(4);
    expect(second.window?.upperMinutes).toBe(14);
  });

  it("projects a recurring rotation rule repeatedly on the same availability lane", () => {
    let availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "aircraft-1:pilot-1",
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
          recurringConstraints: [
            {
              id: "refuel-rule",
              triggerMetric: "COMPLETED_ROTATIONS",
              intervalValue: 1,
              lowerProgress: 0,
              expectedProgress: 0,
              upperProgress: 0,
              minimumDurationMinutes: 5,
              typicalDurationMinutes: 5,
              maximumDurationMinutes: 5,
              active: true,
            },
          ],
        },
      ],
    });
    const duration = {
      expectedMinutes: 10,
      lowerMinutes: 10,
      upperMinutes: 10,
      quality: "STABLE" as const,
      sampleCount: 5,
    };
    availability = reserveNextQueueWindow(availability, duration).availability;
    expect(availability.lanes[0]?.expectedMinutes).toBe(10);
    availability = reserveNextQueueWindow(availability, duration).availability;
    expect(availability.lanes[0]?.expectedMinutes).toBe(25);
    availability = reserveNextQueueWindow(availability, duration).availability;
    expect(availability.lanes[0]?.expectedMinutes).toBe(40);
  });

  it("runs simultaneously due aircraft and pilot rules in parallel", () => {
    const availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "combined-lane",
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
          recurringConstraints: [
            {
              id: "aircraft-pause",
              triggerMetric: "COMPLETED_ROTATIONS",
              intervalValue: 1,
              lowerProgress: 1,
              expectedProgress: 1,
              upperProgress: 1,
              minimumDurationMinutes: 5,
              typicalDurationMinutes: 5,
              maximumDurationMinutes: 5,
              active: true,
            },
            {
              id: "pilot-pause",
              triggerMetric: "OPERATING_MINUTES",
              intervalValue: 30,
              lowerProgress: 30,
              expectedProgress: 30,
              upperProgress: 30,
              minimumDurationMinutes: 7,
              typicalDurationMinutes: 9,
              maximumDurationMinutes: 12,
              active: true,
            },
          ],
        },
      ],
    });
    const reserved = reserveNextQueueWindow(availability, {
      expectedMinutes: 10,
      lowerMinutes: 10,
      upperMinutes: 10,
      quality: "STABLE",
      sampleCount: 5,
    });
    expect(reserved.availability.lanes[0]).toMatchObject({
      lowerMinutes: 16,
      expectedMinutes: 19,
      upperMinutes: 22,
    });
  });

  it("does not project disabled or post-horizon recurring rules", () => {
    const lane = {
      laneId: "lane",
      lowerMinutes: 20,
      expectedMinutes: 20,
      upperMinutes: 20,
      constraints: [],
      recurringConstraints: [
        {
          id: "disabled",
          triggerMetric: "COMPLETED_ROTATIONS" as const,
          intervalValue: 1,
          lowerProgress: 1,
          expectedProgress: 1,
          upperProgress: 1,
          minimumDurationMinutes: 5,
          typicalDurationMinutes: 5,
          maximumDurationMinutes: 5,
          active: false,
        },
        {
          id: "after-end",
          triggerMetric: "COMPLETED_ROTATIONS" as const,
          intervalValue: 1,
          lowerProgress: 1,
          expectedProgress: 1,
          upperProgress: 1,
          minimumDurationMinutes: 7,
          typicalDurationMinutes: 7,
          maximumDurationMinutes: 7,
          active: true,
        },
      ],
    };
    const result = reserveNextQueueWindow(
      createQueueAvailability({
        activeAircraft: 1,
        busyAircraftMinutes: [],
        lanes: [lane],
      }),
      {
        expectedMinutes: 10,
        lowerMinutes: 10,
        upperMinutes: 10,
        quality: "STABLE",
        sampleCount: 5,
      },
      20,
    );
    expect(result.availability.lanes[0]?.expectedMinutes).toBe(30);
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
  ])(
    "moves an overdue $status milestone and every following milestone",
    ({ status, now, expected }) => {
      expect(
        advanceOverduePrediction({
          status,
          now,
          predictedDepartureAt: "2026-07-11T12:00:00.000Z",
          predictedLandingAt: "2026-07-11T12:20:00.000Z",
          predictedCompletionAt: "2026-07-11T12:30:00.000Z",
        }),
      ).toEqual({ ...expected, delayedByMissingEvent: true });
    },
  );

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
    expect(elapsed).toBeLessThan(2_500);
  });

  it("projects all 300 eligible groups beyond the bounded dispatch horizon", () => {
    const now = "2026-07-22T08:00:00.000Z";
    const rotations = Array.from({ length: 300 }, (_, index) => {
      const resourceIndex = index % 2;
      const queueSequence = Math.floor(index / 2) + 1;
      return {
        id: `draft-${index + 1}`,
        status: "DRAFT" as const,
        createdAt: new Date(Date.parse(now) - (300 - index) * 60_000).toISOString(),
        calledAt: null,
        departedAt: null,
        landedAt: null,
        resourceGroupId: `rg-${resourceIndex + 1}`,
        resourceGroupStatus: "ACTIVE" as const,
        queueSequence,
        passengerCount: (index % 3) + 1,
        productId: `product-${(index % 4) + 1}`,
        gateId: `gate-${resourceIndex + 1}`,
        referenceDurationMinutes: 18 + (index % 4) * 4,
        productCode: `P${(index % 4) + 1}`,
        aircraftType: null,
        predictedDepartureAt: null,
        predictedLandingAt: null,
        predictedCompletionAt: null,
      };
    });
    const startedAt = performance.now();
    const projections = calculateForecastTimelines({
      event: {
        eventId: "event-scale",
        now,
        plannedOperationsStartAt: now,
        plannedOperationsEndAt: "2026-07-22T12:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 2,
      },
      capacities: [1, 2].map((resourceIndex) => ({
        resourceGroupId: `rg-${resourceIndex}`,
        activeAircraft: 2,
        availabilityLanes: [1, 2].map((laneIndex) => ({
          laneId: `aircraft-${resourceIndex}-${laneIndex}:pilot-${resourceIndex}-${laneIndex}`,
          aircraftId: `aircraft-${resourceIndex}-${laneIndex}`,
          pilotId: `pilot-${resourceIndex}-${laneIndex}`,
          passengerSeats: laneIndex === 1 ? 4 : 3,
          availableLowerAt: now,
          availableExpectedAt: now,
          availableUpperAt: now,
        })),
      })),
      durationSamples: [],
      rotations,
    });
    const elapsed = performance.now() - startedAt;

    expect(projections).toHaveLength(300);
    expect(new Set(projections.map((projection) => projection.rotationId))).toHaveLength(300);
    expect(
      projections.every(
        (projection) =>
          projection.predictedBoardingAt !== null && projection.forecastState !== "UNAVAILABLE",
      ),
    ).toBe(true);
    expect(projections.some((projection) => projection.forecastState === "LONG_RANGE_WINDOW")).toBe(
      true,
    );
    expect(
      projections.some(
        (projection) =>
          projection.forecastState === "AFTER_OPERATIONS_END" && projection.overtimeMinutes > 0,
      ),
    ).toBe(true);
    expect(elapsed).toBeLessThan(2_500);
  });

  it("uses the earliest compatible tail lane after a recurring constraint becomes due", () => {
    const now = "2026-07-22T08:00:00.000Z";
    const projections = calculateForecastTimelines({
      event: {
        eventId: "event-tail-lane",
        now,
        plannedOperationsStartAt: now,
        plannedOperationsEndAt: "2026-07-22T12:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 2,
      },
      capacities: [
        {
          resourceGroupId: "rg-1",
          activeAircraft: 2,
          availabilityLanes: [
            {
              laneId: "aircraft-a:pilot-a",
              aircraftId: "aircraft-a",
              pilotId: "pilot-a",
              passengerSeats: 1,
              availableLowerAt: now,
              availableExpectedAt: now,
              availableUpperAt: now,
              recurringConstraints: [
                {
                  id: "pause-after-one",
                  triggerMetric: "COMPLETED_ROTATIONS",
                  intervalValue: 1,
                  progressValue: 0,
                  minimumDurationMinutes: 60,
                  typicalDurationMinutes: 60,
                  maximumDurationMinutes: 60,
                },
              ],
            },
            {
              laneId: "aircraft-b:pilot-b",
              aircraftId: "aircraft-b",
              pilotId: "pilot-b",
              passengerSeats: 1,
              availableLowerAt: "2026-07-22T08:40:00.000Z",
              availableExpectedAt: "2026-07-22T08:40:00.000Z",
              availableUpperAt: "2026-07-22T08:40:00.000Z",
            },
          ],
        },
      ],
      durationSamples: [],
      dispatchPlanningLimits: { maximumGroupsPerResourceGroup: 1 },
      rotations: [1, 2].map((queueSequence) => ({
        id: `draft-${queueSequence}`,
        status: "DRAFT" as const,
        createdAt: new Date(Date.parse(now) - (3 - queueSequence) * 60_000).toISOString(),
        calledAt: null,
        departedAt: null,
        landedAt: null,
        resourceGroupId: "rg-1",
        resourceGroupStatus: "ACTIVE" as const,
        queueSequence,
        passengerCount: 1,
        productId: "product-1",
        gateId: "gate-1",
        referenceDurationMinutes: 20,
        productCode: "PAN",
        aircraftType: null,
        predictedDepartureAt: null,
        predictedLandingAt: null,
        predictedCompletionAt: null,
      })),
    });

    expect(projections[0]).toMatchObject({
      rotationId: "draft-1",
      assumedAircraftId: "aircraft-a",
      forecastState: "DISPATCH_WINDOW",
    });
    expect(projections[1]).toMatchObject({
      rotationId: "draft-2",
      assumedAircraftId: "aircraft-b",
      forecastState: "LONG_RANGE_WINDOW",
    });
  });

  it("keeps attendance blocks out of regular capacity and reports unknown returns", () => {
    const baseRotation = {
      status: "DRAFT" as const,
      createdAt: "2026-07-22T10:00:00.000Z",
      calledAt: null,
      departedAt: null,
      landedAt: null,
      resourceGroupId: "rg-1",
      resourceGroupStatus: "ACTIVE" as const,
      referenceDurationMinutes: 20,
      productCode: "PAN",
      aircraftType: null,
      predictedDepartureAt: null,
      predictedLandingAt: null,
      predictedCompletionAt: null,
    };
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
      capacities: [
        {
          resourceGroupId: "rg-1",
          activeAircraft: 0,
          availabilityLanes: [],
          unavailableReason: "UNKNOWN_RESOURCE_RETURN",
        },
      ],
      durationSamples: [],
      rotations: [
        { ...baseRotation, id: "missing", queueSequence: 1, attendanceStatus: "MISSING" as const },
        {
          ...baseRotation,
          id: "clarification",
          queueSequence: 2,
          attendanceStatus: "CLARIFICATION" as const,
        },
        { ...baseRotation, id: "waiting", queueSequence: 3, attendanceStatus: "WAITING" as const },
      ],
    });

    expect(projections.map((projection) => projection.dispatchUnplannedReason)).toEqual([
      "ATTENDANCE_MISSING",
      "ATTENDANCE_CLARIFICATION",
      "UNKNOWN_RESOURCE_RETURN",
    ]);
    expect(projections.every((projection) => projection.forecastState === "UNAVAILABLE")).toBe(
      true,
    );
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
      predictionUpperMinutes: 5,
      predictionQuality: "CHANGING",
      predictedBoardingAt: "2026-07-22T10:02:30.000Z",
      dataBasisScope: "REFERENCE_ONLY",
      activeCapacity: 2,
    });
    expect(projections[2]).toMatchObject({
      predictionLowerMinutes: 0,
      predictionUpperMinutes: 5,
      predictedBoardingAt: "2026-07-22T10:02:30.000Z",
      dispatchBatchId: projections[1]?.dispatchBatchId,
    });
    expect(projections[1]?.dispatchOccupiedSeats).toBe(2);
  });

  it("anchors sales forecasts to the planned operating start", () => {
    const projection = calculateForecastTimelines({
      event: {
        eventId: "event-current",
        now: "2026-07-22T09:00:00.000Z",
        plannedOperationsStartAt: "2026-07-22T10:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 2,
      },
      capacities: [
        {
          resourceGroupId: "rg-1",
          activeAircraft: 0,
          availabilityLanes: [
            {
              laneId: "aircraft-1:pilot-1",
              aircraftId: "aircraft-1",
              availableLowerAt: "2026-07-22T09:00:00.000Z",
              availableExpectedAt: "2026-07-22T09:00:00.000Z",
              availableUpperAt: "2026-07-22T09:00:00.000Z",
            },
          ],
        },
      ],
      durationSamples: [],
      rotations: [
        {
          id: "presale",
          status: "DRAFT",
          createdAt: "2026-07-22T09:00:00.000Z",
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
      predictionLowerMinutes: 55,
      predictionUpperMinutes: 65,
      predictedBoardingAt: "2026-07-22T10:00:00.000Z",
      predictionQuality: "CHANGING",
    });
  });

  it("projects a group only onto a forecast lane with enough passenger seats", () => {
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
      capacities: [
        {
          resourceGroupId: "rg-1",
          activeAircraft: 1,
          availabilityLanes: [
            {
              laneId: "two-seater:pilot-1",
              aircraftId: "two-seater",
              passengerSeats: 2,
              availableLowerAt: "2026-07-22T10:00:00.000Z",
              availableExpectedAt: "2026-07-22T10:00:00.000Z",
              availableUpperAt: "2026-07-22T10:00:00.000Z",
            },
            {
              laneId: "four-seater:pilot-2",
              aircraftId: "four-seater",
              passengerSeats: 4,
              availableLowerAt: "2026-07-22T10:10:00.000Z",
              availableExpectedAt: "2026-07-22T10:15:00.000Z",
              availableUpperAt: "2026-07-22T10:20:00.000Z",
            },
          ],
        },
      ],
      durationSamples: [],
      rotations: [
        {
          id: "four-person-group",
          status: "DRAFT",
          createdAt: "2026-07-22T10:00:00.000Z",
          calledAt: null,
          departedAt: null,
          landedAt: null,
          resourceGroupId: "rg-1",
          resourceGroupStatus: "ACTIVE",
          queueSequence: 1,
          passengerCount: 4,
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
      capacityStatus: "AVAILABLE",
      predictionLowerMinutes: 10,
      predictionUpperMinutes: 20,
      predictedBoardingAt: "2026-07-22T10:15:00.000Z",
    });
  });

  it.each([
    {
      title: "no lane at all",
      availabilityLanes: [],
      expectedStatus: "NO_FORECAST_CAPACITY",
    },
    {
      title: "only an undersized aircraft",
      availabilityLanes: [
        {
          laneId: "two-seater:pilot-1",
          aircraftId: "two-seater",
          passengerSeats: 2,
          availableLowerAt: "2026-07-22T10:00:00.000Z",
          availableExpectedAt: "2026-07-22T10:00:00.000Z",
          availableUpperAt: "2026-07-22T10:00:00.000Z",
        },
      ],
      expectedStatus: "NO_FITTING_AIRCRAFT",
    },
  ] as const)("publishes no artificial zero-minute forecast with $title", (scenario) => {
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
      capacities: [
        {
          resourceGroupId: "rg-1",
          activeAircraft: 0,
          availabilityLanes: scenario.availabilityLanes,
        },
      ],
      durationSamples: [],
      rotations: [
        {
          id: "four-person-group",
          status: "DRAFT",
          createdAt: "2026-07-22T10:00:00.000Z",
          calledAt: null,
          departedAt: null,
          landedAt: null,
          resourceGroupId: "rg-1",
          resourceGroupStatus: "ACTIVE",
          queueSequence: 1,
          passengerCount: 4,
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
      capacityStatus: scenario.expectedStatus,
      predictionQuality: "UNCERTAIN",
      predictionLowerMinutes: null,
      predictionUpperMinutes: null,
      predictedBoardingAt: null,
      predictedDepartureAt: null,
      predictedLandingAt: null,
      predictedCompletionAt: null,
    });
  });

  it("reserves a planned constraint without pretending that it already started", () => {
    const projection = calculateForecastTimelines({
      event: {
        eventId: "event-current",
        now: "2026-07-22T10:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 6,
      },
      capacities: [
        {
          resourceGroupId: "rg-1",
          activeAircraft: 1,
          availabilityLanes: [
            {
              laneId: "aircraft-1:pilot-1",
              aircraftId: "aircraft-1",
              availableLowerAt: "2026-07-22T10:00:00.000Z",
              availableExpectedAt: "2026-07-22T10:00:00.000Z",
              availableUpperAt: "2026-07-22T10:00:00.000Z",
              constraints: [
                {
                  id: "pause-1",
                  earliestStartAt: "2026-07-22T10:00:00.000Z",
                  latestStartAt: "2026-07-22T10:00:00.000Z",
                  minimumDurationMinutes: 10,
                  typicalDurationMinutes: 20,
                  maximumDurationMinutes: 30,
                },
              ],
            },
          ],
        },
      ],
      durationSamples: [],
      rotations: [
        {
          id: "draft",
          status: "DRAFT",
          createdAt: "2026-07-22T10:00:00.000Z",
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
      predictionLowerMinutes: 10,
      predictionUpperMinutes: 30,
      predictedBoardingAt: "2026-07-22T10:20:00.000Z",
      uncertaintyReasons: [],
    });
  });

  it("stretches an overlapping rotation without removing capacity", () => {
    const projection = calculateForecastTimelines({
      event: {
        eventId: "event-current",
        now: "2026-07-22T10:00:00.000Z",
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 5,
        plannedDeboardingMinutes: 5,
        plannedBufferMinutes: 6,
      },
      capacities: [
        {
          resourceGroupId: "rg-1",
          activeAircraft: 1,
          availabilityLanes: [
            {
              laneId: "aircraft-1:pilot-1",
              aircraftId: "aircraft-1",
              availableLowerAt: "2026-07-22T10:00:00.000Z",
              availableExpectedAt: "2026-07-22T10:00:00.000Z",
              availableUpperAt: "2026-07-22T10:00:00.000Z",
              constraints: [
                {
                  id: "slowdown-1",
                  earliestStartAt: "2026-07-22T10:00:00.000Z",
                  latestStartAt: "2026-07-22T10:00:00.000Z",
                  minimumDurationMinutes: 60,
                  typicalDurationMinutes: 60,
                  maximumDurationMinutes: 60,
                  effectMode: "SLOWDOWN",
                  durationMultiplierPercent: 150,
                },
              ],
            },
          ],
        },
      ],
      durationSamples: [],
      rotations: [
        {
          id: "draft",
          status: "DRAFT",
          createdAt: "2026-07-22T10:00:00.000Z",
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
      predictedBoardingAt: "2026-07-22T10:02:30.000Z",
      predictedCompletionAt: "2026-07-22T10:56:30.000Z",
      activeCapacity: 1,
    });
  });

  it("uses the highest overlapping slowdown factor instead of multiplying factors", () => {
    const availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "lane-1",
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [125, 175].map((durationMultiplierPercent) => ({
            id: `slowdown-${durationMultiplierPercent}`,
            earliestStartMinutes: 0,
            expectedStartMinutes: 0,
            latestStartMinutes: 0,
            minimumDurationMinutes: 60,
            typicalDurationMinutes: 60,
            maximumDurationMinutes: 60,
            effectMode: "SLOWDOWN" as const,
            durationMultiplierPercent,
            active: false,
          })),
        },
      ],
    });
    const reservation = reserveNextQueueWindow(availability, {
      lowerMinutes: 30,
      expectedMinutes: 36,
      upperMinutes: 42,
      quality: "CHANGING",
      sampleCount: 0,
    });

    expect(reservation.durationMultiplierPercent).toBe(175);
    expect(reservation.duration.expectedMinutes).toBe(63);
  });

  it("aggregates repeated uncertainty by variance instead of linear extrema", () => {
    let availability = createQueueAvailability({ activeAircraft: 1, busyAircraftMinutes: [] });
    const duration = estimateDuration({
      referenceMinutes: 36,
      actualDurationsMinutes: [],
      interrupted: false,
      activeCapacity: 1,
    });
    const first = reserveNextQueueWindow(availability, duration);
    availability = first.availability;
    const second = reserveNextQueueWindow(availability, duration);
    availability = second.availability;
    const third = reserveNextQueueWindow(availability, duration);

    expect(second.window).not.toBeNull();
    expect(third.window).not.toBeNull();
    expect((second.window?.upperMinutes ?? 0) - (second.window?.lowerMinutes ?? 0)).toBe(20);
    expect((third.window?.upperMinutes ?? 0) - (third.window?.lowerMinutes ?? 0)).toBeLessThan(40);
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
      uncertaintyReasons: [
        "EMERGENCY_MODE",
        "RESOURCE_GROUP_INACTIVE",
        "NO_ACTIVE_CAPACITY",
        "NO_FORECAST_CAPACITY",
      ],
    });
  });

  it("returns the assumed aircraft and applies its candidate-specific duration", () => {
    const availability = createQueueAvailability({
      activeAircraft: 2,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "aircraft-a:pilot-a",
          aircraftId: "aircraft-a",
          passengerSeats: 4,
          lowerMinutes: 5,
          expectedMinutes: 5,
          upperMinutes: 5,
          constraints: [],
        },
        {
          laneId: "aircraft-b:pilot-b",
          aircraftId: "aircraft-b",
          passengerSeats: 4,
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
        },
      ],
    });
    const result = reserveNextQueueWindow(
      availability,
      {
        expectedMinutes: 20,
        lowerMinutes: 18,
        upperMinutes: 22,
        quality: "STABLE",
        sampleCount: 0,
      },
      null,
      1,
      new Map([
        [
          "aircraft-b",
          {
            expectedMinutes: 35,
            lowerMinutes: 32,
            upperMinutes: 38,
            quality: "CHANGING" as const,
            sampleCount: 0,
          },
        ],
      ]),
    );

    expect(result.selectedAircraftId).toBe("aircraft-b");
    expect(result.selectedLaneId).toBe("aircraft-b:pilot-b");
    expect(result.duration.expectedMinutes).toBe(35);
    expect(
      result.availability.lanes.find((lane) => lane.aircraftId === "aircraft-b")?.expectedMinutes,
    ).toBe(35);
  });
});
