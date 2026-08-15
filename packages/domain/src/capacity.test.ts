import { describe, expect, it } from "vitest";
import { assessMarginalProductCapacity, assessRemainingCapacity } from "./capacity";
import { createQueueAvailability } from "./forecast";

describe("verbleibende Kapazität", () => {
  it("zieht offene Tickets von konservativ bewerteten Umläufen ab", () => {
    expect(
      assessRemainingCapacity({
        remainingOperatingMinutes: 120,
        expectedRotationMinutes: 30,
        activeAircraftSeats: [4, 3],
        openTickets: 10,
        predictionQuality: "CHANGING",
        warningThreshold: 8,
        criticalThreshold: 3,
      }),
    ).toEqual({
      projectedSeats: 23,
      remainingSellableSeats: 13,
      status: "AVAILABLE",
      saleRecommended: true,
    });
  });

  it("reduziert bei unsicherer Prognose die Empfehlung konservativ", () => {
    const result = assessRemainingCapacity({
      remainingOperatingMinutes: 90,
      expectedRotationMinutes: 30,
      activeAircraftSeats: [4],
      openTickets: 1,
      predictionQuality: "UNCERTAIN",
      warningThreshold: 8,
      criticalThreshold: 3,
    });
    expect(result.projectedSeats).toBe(7);
    expect(result.remainingSellableSeats).toBe(6);
    expect(result.status).toBe("MANUAL_REVIEW");
    expect(result.saleRecommended).toBe(false);
  });

  it("weist ohne Restzeit oder aktive Sitzplätze ausverkauft aus", () => {
    expect(
      assessRemainingCapacity({
        remainingOperatingMinutes: 0,
        expectedRotationMinutes: 20,
        activeAircraftSeats: [],
        openTickets: 0,
        predictionQuality: "STABLE",
        warningThreshold: 8,
        criticalThreshold: 3,
      }).status,
    ).toBe("SOLD_OUT");
  });

  it("distinguishes a limited sale recommendation from a critical manual review", () => {
    const assess = (openTickets: number) =>
      assessRemainingCapacity({
        remainingOperatingMinutes: 20,
        expectedRotationMinutes: 20,
        activeAircraftSeats: [4],
        openTickets,
        predictionQuality: "STABLE",
        warningThreshold: 3,
        criticalThreshold: 1,
      });

    expect(assess(2)).toMatchObject({
      remainingSellableSeats: 2,
      status: "LIMITED",
      saleRecommended: true,
    });
    expect(assess(3)).toMatchObject({
      remainingSellableSeats: 1,
      status: "MANUAL_REVIEW",
      saleRecommended: false,
    });
  });

  it("reserves one conservative gap for planned refueling", () => {
    const result = assessRemainingCapacity({
      remainingOperatingMinutes: 120,
      expectedRotationMinutes: 20,
      activeAircraftSeats: [4],
      openTickets: 4,
      reservedSeats: 4,
      predictionQuality: "STABLE",
      warningThreshold: 8,
      criticalThreshold: 3,
    });
    expect(result.projectedSeats).toBe(20);
    expect(result.remainingSellableSeats).toBe(16);
  });

  it("derives product capacity from shared post-queue resource lanes", () => {
    const availability = createQueueAvailability({
      activeAircraft: 2,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "large",
          aircraftId: "large",
          passengerSeats: 4,
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
        },
        {
          laneId: "small",
          aircraftId: "small",
          passengerSeats: 2,
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
        },
      ],
    });
    const assess = (expectedMinutes: number) =>
      assessMarginalProductCapacity({
        operationsEndMinutes: 60,
        availabilityAfterQueue: availability,
        duration: {
          lowerMinutes: expectedMinutes,
          expectedMinutes,
          upperMinutes: expectedMinutes,
          quality: "STABLE",
          sampleCount: 0,
        },
        queuedSeatsCompletedByEnd: 6,
        openTickets: 6,
        predictionQuality: "STABLE",
        warningThreshold: 4,
        criticalThreshold: 2,
      });

    expect(assess(30)).toMatchObject({ projectedSeats: 18, remainingSellableSeats: 12 });
    expect(assess(45)).toMatchObject({ projectedSeats: 12, remainingSellableSeats: 6 });
  });

  it("does not recommend a sale when no compatible resource lane remains", () => {
    const availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "incompatible",
          aircraftId: "aircraft-other",
          passengerSeats: 4,
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
        },
      ],
    });

    expect(
      assessMarginalProductCapacity({
        operationsEndMinutes: 60,
        availabilityAfterQueue: availability,
        duration: {
          lowerMinutes: 20,
          expectedMinutes: 20,
          upperMinutes: 20,
          quality: "STABLE",
          sampleCount: 0,
        },
        compatibleAircraftIds: new Set(["aircraft-compatible"]),
        queuedSeatsCompletedByEnd: 0,
        openTickets: 0,
        predictionQuality: "STABLE",
        warningThreshold: 4,
        criticalThreshold: 2,
      }),
    ).toMatchObject({
      projectedSeats: 0,
      remainingSellableSeats: 0,
      status: "SOLD_OUT",
      saleRecommended: false,
    });
  });

  it("applies recurring pauses before recommending another sale batch", () => {
    const availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "lane-1",
          aircraftId: "aircraft-1",
          passengerSeats: 4,
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
          recurringConstraints: [
            {
              id: "pause",
              triggerMetric: "COMPLETED_ROTATIONS",
              intervalValue: 1,
              lowerProgress: 1,
              expectedProgress: 1,
              upperProgress: 1,
              minimumDurationMinutes: 10,
              typicalDurationMinutes: 10,
              maximumDurationMinutes: 10,
              active: true,
            },
          ],
        },
      ],
    });
    const result = assessMarginalProductCapacity({
      operationsEndMinutes: 45,
      availabilityAfterQueue: availability,
      duration: {
        lowerMinutes: 20,
        expectedMinutes: 20,
        upperMinutes: 20,
        quality: "STABLE",
        sampleCount: 0,
      },
      queuedSeatsCompletedByEnd: 0,
      openTickets: 0,
      predictionQuality: "STABLE",
      warningThreshold: 3,
      criticalThreshold: 1,
    });

    expect(result).toMatchObject({ projectedSeats: 4, remainingSellableSeats: 4 });
  });
});
