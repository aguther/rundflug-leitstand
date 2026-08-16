import { describe, expect, it } from "vitest";
import type { DispatchPlanInput } from "./dispatch-plan";
import { createQueueAvailability } from "./forecast-availability";
import {
  createDispatchAvailability,
  createLongRangeReplayReservation,
  forecastLaneDurationKey,
  replayDispatchBatches,
} from "./forecast-dispatch-replay";
import type { ForecastDurationBasis } from "./forecast-duration-basis";
import type { ForecastTimelinesInput } from "./forecast-types";

const now = "2026-08-16T10:00:00.000Z";

function durationBasis(expectedMinutes = 10, quality: "STABLE" | "UNCERTAIN" = "STABLE") {
  return {
    estimate: {
      lowerMinutes: expectedMinutes - 2,
      expectedMinutes,
      upperMinutes: expectedMinutes + 2,
      quality,
      sampleCount: 5,
    },
    dataBasisScope: "AIRCRAFT_PRODUCT_HISTORY",
    dataAgeMinutes: 2,
    acceptedSampleSize: 5,
    aircraftType: "TYPE-A",
    referenceDurationMinutes: expectedMinutes,
  } satisfies ForecastDurationBasis;
}

function rotation(id: string): ForecastTimelinesInput["rotations"][number] {
  return {
    id,
    status: "DRAFT",
    createdAt: now,
    calledAt: null,
    departedAt: null,
    landedAt: null,
    resourceGroupId: "rg-1",
    resourceGroupStatus: "ACTIVE",
    queueSequence: 1,
    passengerCount: 2,
    referenceDurationMinutes: 10,
    productCode: "P1",
    productId: "product-1",
    gateId: "gate-1",
    aircraftType: null,
    predictedDepartureAt: null,
    predictedLandingAt: null,
    predictedCompletionAt: null,
  };
}

function dispatchGroup(
  id: string,
  overrides: Partial<DispatchPlanInput["groups"][number]> = {},
): DispatchPlanInput["groups"][number] {
  return {
    id,
    groupIds: [`group-${id}`],
    size: 2,
    productId: "product-1",
    resourceGroupId: "rg-1",
    gateId: "gate-1",
    queueSequence: 1,
    soldAt: now,
    attendanceStatus: "PRESENT",
    standby: false,
    publicStatus: "WAITING",
    ...overrides,
  };
}

function dispatchLane(id: string, productId = "product-1"): DispatchPlanInput["lanes"][number] {
  return {
    id,
    aircraftId: `aircraft-${id}`,
    pilotId: `pilot-${id}`,
    resourceGroupId: "rg-1",
    passengerSeats: 4,
    availableLowerAt: now,
    availableExpectedAt: now,
    availableUpperAt: now,
    productDurations: [{ productId, lowerMinutes: 8, expectedMinutes: 10, upperMinutes: 12 }],
  };
}

describe("forecast dispatch replay mutation boundaries", () => {
  it("treats aircraft and non-null pilot reservations as independent lane constraints", () => {
    const input: ForecastTimelinesInput = {
      event: {
        eventId: "event-1",
        now,
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 2,
        plannedDeboardingMinutes: 2,
        plannedBufferMinutes: 0,
      },
      durationSamples: [],
      rotations: [],
      capacities: [
        {
          resourceGroupId: "rg-1",
          activeAircraft: 2,
          availabilityLanes: [
            {
              laneId: "aircraft-match",
              aircraftId: "aircraft-1",
              pilotId: "pilot-1",
              availableLowerAt: now,
              availableExpectedAt: now,
              availableUpperAt: now,
            },
            {
              laneId: "pilot-match",
              aircraftId: "aircraft-2",
              pilotId: "pilot-2",
              availableLowerAt: now,
              availableExpectedAt: now,
              availableUpperAt: now,
            },
          ],
        },
      ],
    };
    const result = createDispatchAvailability({
      input,
      operationStartMinutes: 0,
      activeReservations: [
        {
          resourceGroupId: "rg-1",
          aircraftId: "aircraft-1",
          pilotId: "pilot-x",
          lowerMinutes: 8,
          expectedMinutes: 10,
          upperMinutes: 12,
        },
        {
          resourceGroupId: "rg-1",
          aircraftId: "aircraft-x",
          pilotId: "pilot-2",
          lowerMinutes: 18,
          expectedMinutes: 20,
          upperMinutes: 22,
        },
        {
          resourceGroupId: "rg-1",
          aircraftId: "aircraft-x",
          pilotId: null,
          lowerMinutes: 80,
          expectedMinutes: 90,
          upperMinutes: 100,
        },
      ],
      offsetMinutes: () => 0,
      convertConstraint: () => {
        throw new Error("No constraints expected");
      },
    });

    expect(
      result.availabilityByResourceGroup
        .get("rg-1")
        ?.lanes.map(({ laneId, lowerMinutes, expectedMinutes, upperMinutes }) => ({
          laneId,
          lowerMinutes,
          expectedMinutes,
          upperMinutes,
        })),
    ).toEqual([
      { laneId: "aircraft-match", lowerMinutes: 8, expectedMinutes: 10, upperMinutes: 12 },
      { laneId: "pilot-match", lowerMinutes: 18, expectedMinutes: 20, upperMinutes: 22 },
    ]);
  });

  it("combines explicit lane availability with matching aircraft and pilot reservations only", () => {
    const input: ForecastTimelinesInput = {
      event: {
        eventId: "event-1",
        now,
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 2,
        plannedDeboardingMinutes: 2,
        plannedBufferMinutes: 0,
      },
      durationSamples: [],
      rotations: [],
      capacities: [
        {
          resourceGroupId: "rg-1",
          activeAircraft: 1,
          sharedConstraints: [
            {
              id: "shared-z",
              earliestStartAt: "2026-08-16T10:30:00.000Z",
              latestStartAt: "2026-08-16T10:30:00.000Z",
              minimumDurationMinutes: 2,
              typicalDurationMinutes: 3,
              maximumDurationMinutes: 4,
            },
          ],
          availabilityLanes: [
            {
              laneId: "lane-1",
              aircraftId: "aircraft-1",
              pilotId: "pilot-1",
              aircraftType: "TYPE-A",
              passengerSeats: 4,
              availableLowerAt: "2026-08-16T10:01:00.000Z",
              availableExpectedAt: "2026-08-16T10:02:00.000Z",
              availableUpperAt: "2026-08-16T10:03:00.000Z",
              constraints: [
                {
                  id: "lane-a",
                  earliestStartAt: "2026-08-16T10:20:00.000Z",
                  latestStartAt: "2026-08-16T10:20:00.000Z",
                  minimumDurationMinutes: 1,
                  typicalDurationMinutes: 1,
                  maximumDurationMinutes: 1,
                },
              ],
              recurringConstraints: [
                {
                  id: "recurring",
                  triggerMetric: "COMPLETED_ROTATIONS",
                  intervalValue: 2,
                  progressValue: 1,
                  minimumDurationMinutes: 2,
                  typicalDurationMinutes: 3,
                  maximumDurationMinutes: 4,
                },
              ],
            },
          ],
        },
      ],
    };
    const result = createDispatchAvailability({
      input,
      operationStartMinutes: 5,
      activeReservations: [
        {
          resourceGroupId: "rg-1",
          aircraftId: "aircraft-1",
          pilotId: "pilot-x",
          lowerMinutes: 8,
          expectedMinutes: 10,
          upperMinutes: 12,
        },
        {
          resourceGroupId: "rg-1",
          aircraftId: "aircraft-x",
          pilotId: "pilot-1",
          lowerMinutes: 18,
          expectedMinutes: 20,
          upperMinutes: 22,
        },
        {
          resourceGroupId: "other",
          aircraftId: "aircraft-1",
          pilotId: "pilot-1",
          lowerMinutes: 80,
          expectedMinutes: 90,
          upperMinutes: 100,
        },
      ],
      offsetMinutes: (value) => (Date.parse(value) - Date.parse(now)) / 60_000,
      convertConstraint: (constraint) => ({
        id: constraint.id,
        earliestStartMinutes: (Date.parse(constraint.earliestStartAt) - Date.parse(now)) / 60_000,
        expectedStartMinutes: (Date.parse(constraint.earliestStartAt) - Date.parse(now)) / 60_000,
        latestStartMinutes: (Date.parse(constraint.latestStartAt) - Date.parse(now)) / 60_000,
        minimumDurationMinutes: constraint.minimumDurationMinutes,
        typicalDurationMinutes: constraint.typicalDurationMinutes,
        maximumDurationMinutes: constraint.maximumDurationMinutes,
        effectMode: constraint.effectMode ?? "BLOCKING",
        durationMultiplierPercent: constraint.durationMultiplierPercent ?? null,
        active: constraint.active ?? true,
      }),
    });

    expect(result.pilotIdByLaneId.get("lane-1")).toBe("pilot-1");
    expect(result.aircraftTypeByLaneId.get("lane-1")).toBe("TYPE-A");
    expect(result.availabilityByResourceGroup.get("rg-1")?.lanes[0]).toMatchObject({
      laneId: "lane-1",
      passengerSeats: 4,
      lowerMinutes: 18,
      expectedMinutes: 20,
      upperMinutes: 22,
      recurringConstraints: [
        expect.objectContaining({
          id: "recurring",
          lowerProgress: 1,
          expectedProgress: 1,
          upperProgress: 1,
          active: true,
        }),
      ],
    });
    expect(
      result.availabilityByResourceGroup
        .get("rg-1")
        ?.lanes[0]?.constraints.map((constraint) => constraint.id),
    ).toEqual(["lane-a", "shared-z"]);
  });

  it("builds deterministic busy and idle fallback lanes per resource group", () => {
    const input: ForecastTimelinesInput = {
      event: {
        eventId: "event-1",
        now,
        operationalInterrupted: false,
        emergencyMode: false,
        plannedBoardingMinutes: 2,
        plannedDeboardingMinutes: 2,
        plannedBufferMinutes: 0,
      },
      durationSamples: [],
      rotations: [],
      capacities: [
        { resourceGroupId: "rg-1", activeAircraft: 2.9 },
        { resourceGroupId: "rg-2", activeAircraft: 2 },
      ],
    };
    const result = createDispatchAvailability({
      input,
      operationStartMinutes: 5,
      activeReservations: [
        {
          resourceGroupId: "rg-1",
          aircraftId: "a",
          pilotId: null,
          lowerMinutes: 1,
          expectedMinutes: 7,
          upperMinutes: 8,
        },
        {
          resourceGroupId: "other",
          aircraftId: "b",
          pilotId: null,
          lowerMinutes: 1,
          expectedMinutes: 1,
          upperMinutes: 1,
        },
        {
          resourceGroupId: "rg-1",
          aircraftId: "c",
          pilotId: null,
          lowerMinutes: 1,
          expectedMinutes: 3,
          upperMinutes: 4,
        },
        {
          resourceGroupId: "rg-1",
          aircraftId: "d",
          pilotId: null,
          lowerMinutes: 1,
          expectedMinutes: 9,
          upperMinutes: 10,
        },
        {
          resourceGroupId: "rg-2",
          aircraftId: "e",
          pilotId: null,
          lowerMinutes: 1,
          expectedMinutes: 6,
          upperMinutes: 7,
        },
      ],
      offsetMinutes: () => 0,
      convertConstraint: () => {
        throw new Error("No constraints expected");
      },
    });

    expect(
      result.availabilityByResourceGroup
        .get("rg-1")
        ?.lanes.map(({ laneId, expectedMinutes }) => ({ laneId, expectedMinutes })),
    ).toEqual([
      { laneId: "busy-rg-1-2", expectedMinutes: 3 },
      { laneId: "busy-rg-1-1", expectedMinutes: 7 },
    ]);
    expect(
      result.availabilityByResourceGroup
        .get("rg-2")
        ?.lanes.map(({ laneId, expectedMinutes }) => ({ laneId, expectedMinutes })),
    ).toEqual([
      { laneId: "idle-rg-2-1", expectedMinutes: 5 },
      { laneId: "busy-rg-2-1", expectedMinutes: 6 },
    ]);
  });

  it("replays only complete dispatch batches and preserves the selected duration basis", () => {
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
        },
      ],
    });
    const basis = durationBasis(14);
    const batches = [
      {
        id: "missing-member",
        memberIds: ["missing"],
        resourceGroupId: "rg-1",
        productId: "product-1",
        occupiedSeats: 2,
        laneId: "lane-1",
      },
      {
        id: "missing-availability",
        memberIds: ["rotation-1"],
        resourceGroupId: "other",
        productId: "product-1",
        occupiedSeats: 2,
        laneId: "lane-1",
      },
      {
        id: "missing-basis",
        memberIds: ["rotation-1"],
        resourceGroupId: "rg-1",
        productId: "other",
        occupiedSeats: 2,
        laneId: "lane-1",
      },
      {
        id: "valid",
        memberIds: ["rotation-1"],
        resourceGroupId: "rg-1",
        productId: "product-1",
        occupiedSeats: 2,
        laneId: "lane-1",
      },
    ];
    const result = replayDispatchBatches({
      dispatchPlan: { batches } as never,
      rotationsById: new Map([["rotation-1", rotation("rotation-1")]]),
      availabilityByResourceGroup: new Map([["rg-1", availability]]),
      operationEndMinutes: null,
      dispatchLaneById: new Map(),
      durationBasisByLaneAndProduct: new Map([
        [forecastLaneDurationKey("lane-1", "product-1"), basis],
      ]),
      turnaroundProfile: () => ({
        boardingMinutes: 2,
        deboardingMinutes: 3,
        bufferMinutes: 4,
        boardingSource: "event",
        deboardingSource: "event",
        bufferSource: "event",
      }),
    });

    expect([...result.keys()]).toEqual(["valid"]);
    expect(result.get("valid")).toMatchObject({
      selectedAircraftId: "aircraft-1",
      duration: basis.estimate,
      durationBasis: { ...basis, estimate: basis.estimate },
      boardingMinutes: 2,
      deboardingMinutes: 3,
      bufferMinutes: 4,
    });
  });

  it("combines only compatible long-range groups without exceeding the selected lane", () => {
    const remaining = [
      dispatchGroup("a"),
      dispatchGroup("b", { queueSequence: 2 }),
      dispatchGroup("other-gate", { gateId: "gate-2", queueSequence: 3 }),
      dispatchGroup("other-product", { productId: "product-2", queueSequence: 4 }),
      dispatchGroup("too-large", { size: 1, queueSequence: 5 }),
    ];
    const availability = createQueueAvailability({
      activeAircraft: 2,
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
        },
        {
          laneId: "lane-2",
          aircraftId: "aircraft-2",
          passengerSeats: 6,
          lowerMinutes: 5,
          expectedMinutes: 5,
          upperMinutes: 5,
          constraints: [],
        },
      ],
    });
    const result = createLongRangeReplayReservation({
      remaining,
      resourceGroupId: "rg-1",
      availabilityByResourceGroup: new Map([["rg-1", availability]]),
      dispatchLaneById: new Map([
        ["lane-1", dispatchLane("lane-1")],
        ["lane-2", dispatchLane("lane-2", "product-2")],
      ]),
      rotationsById: new Map([["a", rotation("a")]]),
      durationBasisByLaneAndProduct: new Map([
        [forecastLaneDurationKey("lane-1", "product-1"), durationBasis()],
      ]),
      turnaroundProfile: () => ({
        boardingMinutes: 2,
        deboardingMinutes: 3,
        bufferMinutes: 4,
        boardingSource: "event",
        deboardingSource: "event",
        bufferSource: "event",
      }),
    });

    expect(result?.memberIdSet).toEqual(new Set(["a", "b"]));
    expect(result?.replay).toMatchObject({
      selectedLaneId: "lane-1",
      selectedAircraftId: "aircraft-1",
      memberIds: ["a", "b"],
      groupIds: ["group-a", "group-b"],
      occupiedSeats: 4,
      availableSeats: 0,
      window: { quality: "CHANGING" },
    });
  });

  it("returns null for unavailable long-range inputs and reports a lost rotation", () => {
    const group = dispatchGroup("a");
    const lane = dispatchLane("lane-1");
    const availability = createQueueAvailability({
      activeAircraft: 1,
      busyAircraftMinutes: [],
      lanes: [
        {
          laneId: "lane-1",
          aircraftId: "aircraft-1",
          passengerSeats: 1,
          lowerMinutes: 0,
          expectedMinutes: 0,
          upperMinutes: 0,
          constraints: [],
        },
      ],
    });
    const common = {
      remaining: [group],
      resourceGroupId: "rg-1",
      dispatchLaneById: new Map([["lane-1", lane]]),
      rotationsById: new Map([["a", rotation("a")]]),
      durationBasisByLaneAndProduct: new Map([
        [forecastLaneDurationKey("lane-1", "product-1"), durationBasis()],
      ]),
      turnaroundProfile: () => ({
        boardingMinutes: 2,
        deboardingMinutes: 3,
        bufferMinutes: 4,
        boardingSource: "event",
        deboardingSource: "event",
        bufferSource: "event",
      }),
    };

    expect(
      createLongRangeReplayReservation({
        ...common,
        availabilityByResourceGroup: new Map(),
      }),
    ).toBeNull();
    expect(
      createLongRangeReplayReservation({
        ...common,
        availabilityByResourceGroup: new Map([["rg-1", availability]]),
      }),
    ).toBeNull();

    const fittingAvailability = createQueueAvailability({
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
        },
      ],
    });
    expect(() =>
      createLongRangeReplayReservation({
        ...common,
        rotationsById: new Map(),
        availabilityByResourceGroup: new Map([["rg-1", fittingAvailability]]),
      }),
    ).toThrow("Forecast rotation a disappeared.");
  });
});
