import type { ForecastHistory, OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import {
  analyticsTicketGroups,
  boardingForecastChangeMinutes,
  forecastChartData,
  resourceDayMetrics,
  resourceTimelineRotations,
} from "./flight-director-analytics-model";

describe("flight director analytics model", () => {
  it("orders forecast snapshots and calculates the latest boarding change", () => {
    const entries = [
      {
        snapshotId: "later",
        capturedAt: "2026-07-11T08:10:00.000Z",
        predicted: { boardingAt: "2026-07-11T08:30:00.000Z" },
      },
      {
        snapshotId: "earlier",
        capturedAt: "2026-07-11T08:00:00.000Z",
        predicted: { boardingAt: "2026-07-11T08:25:00.000Z" },
      },
    ] as ForecastHistory["entries"];

    expect(forecastChartData(entries).map((entry) => entry.capturedAt)).toEqual([
      Date.parse("2026-07-11T08:00:00.000Z"),
      Date.parse("2026-07-11T08:10:00.000Z"),
    ]);
    expect(boardingForecastChangeMinutes(entries)).toBe(5);
  });

  it("derives organizational metrics from confirmed timestamps only", () => {
    const history = {
      observedUntil: "2026-07-11T10:00:00.000Z",
      rotations: [
        {
          passengerCount: 3,
          usableCapacity: 4,
          actual: {
            boardingAt: "2026-07-11T08:00:00.000Z",
            departureAt: "2026-07-11T08:10:00.000Z",
            landingAt: "2026-07-11T08:30:00.000Z",
            completionAt: "2026-07-11T08:40:00.000Z",
          },
        },
      ],
      blocks: [
        {
          type: "PAUSE",
          startedAt: "2026-07-11T09:00:00.000Z",
          endedAt: "2026-07-11T09:15:00.000Z",
        },
      ],
    } as ResourceDayHistory;

    expect(resourceDayMetrics(history)).toEqual({
      completedRotations: 1,
      bindingMinutes: 40,
      averageTurnaroundMinutes: 10,
      flightMinutes: 20,
      pauseMinutes: 15,
      averageSeatUtilization: 0.75,
    });
  });

  it("uses ticket groups as the master and retains all related rotations", () => {
    const rotations = [
      {
        id: "rotation-2",
        ticketGroupId: "ticket-group-1",
        communicationNumber: 102,
        productCode: "PAN",
        productName: "Panorama",
        bookingGroups: [
          {
            id: "ticket-group-1",
            communicationNumber: 17,
            soldAt: "2026-07-11T08:00:00.000Z",
          },
        ],
      },
      {
        id: "rotation-1",
        ticketGroupId: "ticket-group-1",
        communicationNumber: 101,
        productCode: "PAN",
        productName: "Panorama",
        bookingGroups: [
          {
            id: "ticket-group-1",
            communicationNumber: 17,
            soldAt: "2026-07-11T08:00:00.000Z",
          },
        ],
      },
    ] as OperationBoard["rotations"];

    expect(analyticsTicketGroups(rotations)).toEqual([
      {
        id: "ticket-group-1",
        label: "G-PAN-0017",
        productName: "Panorama",
        soldAt: "2026-07-11T08:00:00.000Z",
        rotationIds: ["rotation-2", "rotation-1"],
      },
    ]);
  });

  it("places all resource rotations sequentially on one event-day lane", () => {
    const history = {
      from: "2026-07-11T08:00:00.000Z",
      until: "2026-07-11T12:00:00.000Z",
      observedUntil: "2026-07-11T12:00:00.000Z",
      rotations: [
        {
          rotationId: "rotation-1",
          communicationLabel: "F-RN-101",
          actual: {
            boardingAt: "2026-07-11T09:00:00.000Z",
            departureAt: "2026-07-11T09:10:00.000Z",
            landingAt: "2026-07-11T09:30:00.000Z",
            completionAt: "2026-07-11T09:40:00.000Z",
          },
        },
        {
          rotationId: "rotation-2",
          communicationLabel: "F-RN-102",
          actual: {
            boardingAt: "2026-07-11T10:00:00.000Z",
            departureAt: null,
            landingAt: null,
            completionAt: null,
          },
        },
      ],
    } as ResourceDayHistory;

    const timeline = resourceTimelineRotations(history);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      startPercent: 25,
      endPercent: expect.closeTo(41.67, 1),
      phases: [
        expect.objectContaining({ type: "BOARDING" }),
        expect.objectContaining({ type: "FLIGHT" }),
        expect.objectContaining({ type: "TURNAROUND" }),
      ],
    });
    expect(timeline[1]).toMatchObject({
      startPercent: 50,
      endPercent: 100,
      phases: [expect.objectContaining({ type: "BOARDING" })],
    });
  });
});
