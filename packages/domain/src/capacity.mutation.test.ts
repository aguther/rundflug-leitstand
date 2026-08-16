import { describe, expect, it } from "vitest";
import { assessMarginalProductCapacity, assessRemainingCapacity } from "./capacity";
import { createQueueAvailability } from "./forecast-availability";

describe("capacity mutation boundaries", () => {
  it("filters non-positive and fractional aircraft seats before projecting complete cycles", () => {
    expect(
      assessRemainingCapacity({
        remainingOperatingMinutes: 61,
        expectedRotationMinutes: 30,
        activeAircraftSeats: [4, 2.5, 0, -2, Number.NaN],
        openTickets: -3,
        reservedSeats: -5,
        predictionQuality: "STABLE",
        warningThreshold: 3,
        criticalThreshold: 1,
      }),
    ).toEqual({
      projectedSeats: 8,
      remainingSellableSeats: 8,
      status: "AVAILABLE",
      saleRecommended: true,
    });
  });

  it("uses exact warning and critical thresholds for sale guidance", () => {
    const assess = (openTickets: number) =>
      assessRemainingCapacity({
        remainingOperatingMinutes: 10,
        expectedRotationMinutes: 10,
        activeAircraftSeats: [4],
        openTickets,
        predictionQuality: "STABLE",
        warningThreshold: 3,
        criticalThreshold: 1,
      });

    expect(assess(1)).toEqual({
      projectedSeats: 4,
      remainingSellableSeats: 3,
      status: "LIMITED",
      saleRecommended: true,
    });
    expect(assess(3)).toEqual({
      projectedSeats: 4,
      remainingSellableSeats: 1,
      status: "MANUAL_REVIEW",
      saleRecommended: false,
    });
  });

  it("counts a marginal batch ending exactly at operations end and removes exhausted lanes", () => {
    const availability = createQueueAvailability({
      activeAircraft: 2,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "lane-a",
          aircraftId: "aircraft-a",
          passengerSeats: 3,
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
        },
        {
          laneId: "lane-b",
          aircraftId: "aircraft-b",
          passengerSeats: 2,
          lowerMinutes: 50,
          expectedMinutes: 50,
          upperMinutes: 50,
          constraints: [],
        },
      ],
    });
    const result = assessMarginalProductCapacity({
      operationsEndMinutes: 20,
      availabilityAfterQueue: availability,
      duration: {
        lowerMinutes: 10,
        expectedMinutes: 10,
        upperMinutes: 10,
        quality: "STABLE",
        sampleCount: 0,
      },
      durationByAircraftId: new Map([
        [
          "aircraft-b",
          {
            lowerMinutes: 1,
            expectedMinutes: 1,
            upperMinutes: 1,
            quality: "STABLE",
            sampleCount: 0,
          },
        ],
      ]),
      compatibleAircraftIds: new Set(["aircraft-a", "aircraft-b"]),
      queuedSeatsCompletedByEnd: 1,
      openTickets: 2,
      predictionQuality: "STABLE",
      warningThreshold: 3,
      criticalThreshold: 1,
    });

    expect(result).toEqual({
      projectedSeats: 7,
      remainingSellableSeats: 5,
      status: "AVAILABLE",
      saleRecommended: true,
    });
  });

  it("keeps anonymous compatible lanes and clamps a negative projected remainder", () => {
    const availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "anonymous",
          passengerSeats: 2,
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
        },
      ],
    });
    expect(
      assessMarginalProductCapacity({
        operationsEndMinutes: 10,
        availabilityAfterQueue: availability,
        duration: {
          lowerMinutes: 10,
          expectedMinutes: 10,
          upperMinutes: 10,
          quality: "STABLE",
          sampleCount: 0,
        },
        compatibleAircraftIds: new Set(["aircraft-a"]),
        queuedSeatsCompletedByEnd: -10,
        openTickets: 20,
        predictionQuality: "STABLE",
        warningThreshold: 3,
        criticalThreshold: 1,
      }),
    ).toEqual({
      projectedSeats: 0,
      remainingSellableSeats: 0,
      status: "SOLD_OUT",
      saleRecommended: false,
    });
  });
});
