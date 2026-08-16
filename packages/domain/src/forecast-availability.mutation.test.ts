import { describe, expect, it } from "vitest";
import {
  advanceOverduePrediction,
  createQueueAvailability,
  forecastQueueWindows,
  type QueueAvailabilityConstraint,
  reserveNextQueueWindow,
  slowdownMultiplier,
} from "./forecast-availability";
import type { DurationEstimate } from "./forecast-types";

const stableDuration: DurationEstimate = {
  lowerMinutes: 8,
  expectedMinutes: 10,
  upperMinutes: 12,
  quality: "STABLE",
  sampleCount: 5,
};

describe("forecast availability mutation boundaries", () => {
  it("normalizes, copies, and deterministically orders explicit lanes", () => {
    const constraints: QueueAvailabilityConstraint[] = [];
    const recurringConstraints = [
      {
        id: "rotation-pause",
        triggerMetric: "COMPLETED_ROTATIONS" as const,
        intervalValue: 3,
        lowerProgress: 0,
        expectedProgress: 0,
        upperProgress: 0,
        minimumDurationMinutes: 2,
        typicalDurationMinutes: 3,
        maximumDurationMinutes: 4,
        active: true,
      },
    ];
    const availability = createQueueAvailability({
      activeAircraft: 99,
      busyAircraftMinutes: [999],
      lanes: [
        {
          laneId: "lane-b",
          passengerSeats: 3.9,
          lowerMinutes: -2,
          expectedMinutes: 5,
          upperMinutes: 7,
          constraints,
          recurringConstraints,
        },
        {
          laneId: "lane-a",
          passengerSeats: 0,
          lowerMinutes: 2,
          expectedMinutes: 5,
          upperMinutes: 6,
          constraints: [],
        },
      ],
    });

    expect(availability.lowerMinutes).toEqual([0, 2]);
    expect(availability.expectedMinutes).toEqual([5, 5]);
    expect(availability.upperMinutes).toEqual([7, 6]);
    expect(availability.lanes.map((lane) => lane.laneId)).toEqual(["lane-b", "lane-a"]);
    expect(availability.lanes[0]).toMatchObject({
      passengerSeats: 3,
      lowerMinutes: 0,
      expectedMinutes: 5,
      upperMinutes: 7,
    });
    expect(availability.lanes[0]?.constraints).not.toBe(constraints);
    expect(availability.lanes[0]?.recurringConstraints).not.toBe(recurringConstraints);
    expect(availability.lanes[1]).toMatchObject({ passengerSeats: 1, recurringConstraints: [] });
  });

  it("filters invalid busy values, limits them to capacity, and creates stable lane identifiers", () => {
    const availability = createQueueAvailability({
      activeAircraft: 2.9,
      busyAircraftMinutes: [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 7, 3, 9],
    });

    expect(availability).toMatchObject({
      lowerMinutes: [3, 7],
      expectedMinutes: [3, 7],
      upperMinutes: [3, 7],
    });
    expect(
      availability.lanes.map(({ laneId, expectedMinutes }) => ({ laneId, expectedMinutes })),
    ).toEqual([
      { laneId: "capacity-1", expectedMinutes: 3 },
      { laneId: "capacity-2", expectedMinutes: 7 },
    ]);
    expect(createQueueAvailability({ activeAircraft: -1, busyAircraftMinutes: [5] }).lanes).toEqual(
      [],
    );
  });

  it("applies due recurring constraints per scenario and advances each progress metric", () => {
    const initial = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "lane-recurring",
          lowerMinutes: 10,
          expectedMinutes: 10,
          upperMinutes: 10,
          constraints: [],
          recurringConstraints: [
            {
              id: "completed",
              triggerMetric: "COMPLETED_ROTATIONS",
              intervalValue: 3,
              lowerProgress: 2,
              expectedProgress: 3,
              upperProgress: 4,
              minimumDurationMinutes: 5,
              typicalDurationMinutes: 6,
              maximumDurationMinutes: 7,
              active: true,
            },
            {
              id: "operating",
              triggerMetric: "OPERATING_MINUTES",
              intervalValue: 100,
              lowerProgress: 1,
              expectedProgress: 2,
              upperProgress: 3,
              minimumDurationMinutes: 20,
              typicalDurationMinutes: 20,
              maximumDurationMinutes: 20,
              active: true,
            },
            {
              id: "disabled",
              triggerMetric: "COMPLETED_ROTATIONS",
              intervalValue: 1,
              lowerProgress: 1,
              expectedProgress: 1,
              upperProgress: 1,
              minimumDurationMinutes: 30,
              typicalDurationMinutes: 30,
              maximumDurationMinutes: 30,
              active: false,
            },
          ],
        },
      ],
    });

    const reservation = reserveNextQueueWindow(initial, stableDuration);
    const lane = reservation.availability.lanes[0];
    expect(reservation.window).toEqual({ lowerMinutes: 10, upperMinutes: 19, quality: "STABLE" });
    expect(lane).toMatchObject({ expectedMinutes: 26 });
    expect(lane?.recurringConstraints).toEqual([
      expect.objectContaining({
        id: "completed",
        lowerProgress: 3,
        expectedProgress: 1,
        upperProgress: 1,
      }),
      expect.objectContaining({
        id: "operating",
        lowerProgress: 9,
        expectedProgress: 12,
        upperProgress: 15,
      }),
      expect.objectContaining({
        id: "disabled",
        lowerProgress: 0,
        expectedProgress: 0,
        upperProgress: 0,
      }),
    ]);
  });

  it("does not apply recurring pauses at or beyond the operating horizon", () => {
    const availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "late-lane",
          lowerMinutes: 20,
          expectedMinutes: 20,
          upperMinutes: 20,
          constraints: [],
          recurringConstraints: [
            {
              id: "due",
              triggerMetric: "COMPLETED_ROTATIONS",
              intervalValue: 1,
              lowerProgress: 1,
              expectedProgress: 1,
              upperProgress: 1,
              minimumDurationMinutes: 30,
              typicalDurationMinutes: 30,
              maximumDurationMinutes: 30,
              active: true,
            },
          ],
        },
      ],
    });

    expect(
      reserveNextQueueWindow(availability, stableDuration, 20).availability.lanes[0],
    ).toMatchObject({ expectedMinutes: 30 });
  });

  it("uses scenario-specific slowdown windows and strict overlap boundaries", () => {
    const constraint: QueueAvailabilityConstraint = {
      id: "slowdown",
      earliestStartMinutes: 10,
      expectedStartMinutes: 20,
      latestStartMinutes: 30,
      minimumDurationMinutes: 5,
      typicalDurationMinutes: 10,
      maximumDurationMinutes: 15,
      effectMode: "SLOWDOWN",
      durationMultiplierPercent: 150,
      active: false,
    };

    expect(slowdownMultiplier(32, 2, [constraint], "lower")).toBe(150);
    expect(slowdownMultiplier(32, 2, [constraint], "expected")).toBe(100);
    expect(slowdownMultiplier(8, 2, [constraint], "upper")).toBe(100);
    expect(slowdownMultiplier(8, 3, [constraint], "upper")).toBe(150);
    expect(
      slowdownMultiplier(
        0,
        10,
        [
          {
            ...constraint,
            earliestStartMinutes: 0,
            maximumDurationMinutes: 10,
            durationMultiplierPercent: null,
          },
        ],
        "upper",
      ),
    ).toBe(100);
  });

  it("projects blocking and slowdown constraints into the selected duration and lane", () => {
    const availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "constrained",
          aircraftId: "aircraft-1",
          passengerSeats: 4,
          lowerMinutes: 5,
          expectedMinutes: 5,
          upperMinutes: 5,
          constraints: [
            {
              id: "blocking",
              earliestStartMinutes: 6,
              expectedStartMinutes: 8,
              latestStartMinutes: 10,
              minimumDurationMinutes: 2,
              typicalDurationMinutes: 4,
              maximumDurationMinutes: 6,
              effectMode: "BLOCKING",
              durationMultiplierPercent: null,
              active: false,
            },
            {
              id: "slowdown-125",
              earliestStartMinutes: 0,
              expectedStartMinutes: 0,
              latestStartMinutes: 0,
              minimumDurationMinutes: 60,
              typicalDurationMinutes: 60,
              maximumDurationMinutes: 60,
              effectMode: "SLOWDOWN",
              durationMultiplierPercent: 125,
              active: false,
            },
          ],
        },
      ],
    });

    const result = reserveNextQueueWindow(availability, stableDuration, null, 4);
    expect(result).toMatchObject({
      selectedLaneId: "constrained",
      selectedAircraftId: "aircraft-1",
      durationMultiplierPercent: 125,
      capacityStatus: "AVAILABLE",
      duration: {
        lowerMinutes: 10,
        expectedMinutes: 12.5,
        upperMinutes: 15,
        quality: "CHANGING",
      },
    });
    expect(result.availability.lanes[0]).toMatchObject({ expectedMinutes: 24.5 });
  });

  it("distinguishes missing capacity from every lane eligibility filter", () => {
    const empty = createQueueAvailability({ activeAircraft: 0, busyAircraftMinutes: [] });
    expect(reserveNextQueueWindow(empty, stableDuration)).toMatchObject({
      window: null,
      capacityStatus: "NO_FORECAST_CAPACITY",
      selectedLaneId: null,
      selectedAircraftId: null,
    });

    const availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "lane-1",
          passengerSeats: 2,
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
        },
      ],
    });
    for (const result of [
      reserveNextQueueWindow(availability, stableDuration, null, 3),
      reserveNextQueueWindow(availability, stableDuration, null, 1, undefined, "lane-2"),
      reserveNextQueueWindow(
        availability,
        stableDuration,
        null,
        1,
        undefined,
        undefined,
        new Set(["lane-2"]),
      ),
    ]) {
      expect(result).toMatchObject({
        window: null,
        capacityStatus: "NO_FITTING_AIRCRAFT",
        selectedLaneId: null,
        selectedAircraftId: null,
      });
    }
  });

  it("selects by expected time, lower time, and lane id and preserves non-selected lanes", () => {
    const availability = createQueueAvailability({
      activeAircraft: 3,
      busyAircraftMinutes: [],
      lanes: [
        { laneId: "lane-c", lowerMinutes: 2, expectedMinutes: 4, upperMinutes: 5, constraints: [] },
        { laneId: "lane-b", lowerMinutes: 1, expectedMinutes: 4, upperMinutes: 5, constraints: [] },
        { laneId: "lane-a", lowerMinutes: 1, expectedMinutes: 4, upperMinutes: 5, constraints: [] },
      ],
    });
    const result = reserveNextQueueWindow(availability, stableDuration);

    expect(result.selectedLaneId).toBe("lane-a");
    expect(
      result.availability.lanes.map(({ laneId, expectedMinutes }) => ({ laneId, expectedMinutes })),
    ).toEqual([
      { laneId: "lane-b", expectedMinutes: 4 },
      { laneId: "lane-c", expectedMinutes: 4 },
      { laneId: "lane-a", expectedMinutes: 14 },
    ]);
  });

  it("uses exact milestone and queue boundaries", () => {
    expect(
      advanceOverduePrediction({
        status: "CALLED",
        now: "2026-08-16T10:00:00.000Z",
        predictedDepartureAt: "2026-08-16T10:00:00.000Z",
        predictedLandingAt: "2026-08-16T10:20:00.000Z",
        predictedCompletionAt: "2026-08-16T10:25:00.000Z",
      }),
    ).toEqual({
      predictedDepartureAt: "2026-08-16T10:00:00.000Z",
      predictedLandingAt: "2026-08-16T10:20:00.000Z",
      predictedCompletionAt: "2026-08-16T10:25:00.000Z",
      delayedByMissingEvent: false,
    });
    expect(
      forecastQueueWindows({ queueSequence: 4, activeAircraft: 3, duration: stableDuration }),
    ).toEqual({ lowerMinutes: 8, upperMinutes: 24, quality: "STABLE" });
    expect(
      forecastQueueWindows({ queueSequence: 1, activeAircraft: 0, duration: stableDuration }),
    ).toEqual({ lowerMinutes: 0, upperMinutes: 0, quality: "UNCERTAIN" });
    expect(
      forecastQueueWindows({
        queueSequence: 1,
        activeAircraft: 2,
        duration: { ...stableDuration, quality: "UNCERTAIN" },
      }),
    ).toEqual({ lowerMinutes: 0, upperMinutes: 0, quality: "UNCERTAIN" });
  });
});
