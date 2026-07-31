import type { ForecastHistory, OperationBoard, ResourceDayHistory } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import {
  analyticsTicketGroups,
  boardingForecastChangeMinutes,
  calculateTimeAxisTicks,
  forecastChartData,
  resourceDayMetrics,
  resourceTimelineRotations,
  TIME_AXIS_STEPS_MINUTES,
} from "./flight-director-analytics-model";

describe("flight director analytics model", () => {
  const timeAxis = (hours: number, zoom: number, baseWidth = 720) =>
    calculateTimeAxisTicks({
      from: Date.parse("2026-07-11T08:00:00.000Z"),
      minimumLabelSpacing: 64,
      pixelWidth: baseWidth * zoom,
      timeZone: "Europe/Berlin",
      until: Date.parse("2026-07-11T08:00:00.000Z") + hours * 60 * 60 * 1_000,
    });

  const tickStepMinutes = (ticks: ReturnType<typeof timeAxis>) =>
    ticks.length >= 2 ? ((ticks[1]?.value ?? 0) - (ticks[0]?.value ?? 0)) / 60_000 : null;

  it("increases time-axis detail with the available zoomed width", () => {
    expect(tickStepMinutes(timeAxis(12, 1))).toBe(120);
    expect(tickStepMinutes(timeAxis(12, 1.5))).toBe(60);
    expect(tickStepMinutes(timeAxis(12, 3))).toBe(30);
    expect(tickStepMinutes(timeAxis(12, 8))).toBe(10);
  });

  it("uses five-minute ticks for a short span in a wide viewport", () => {
    expect(tickStepMinutes(timeAxis(1, 1, 1_600))).toBe(5);
    expect(tickStepMinutes(timeAxis(4, 8, 720))).toBe(5);
  });

  it("uses a coarse supported step for a long span in a narrow viewport", () => {
    expect(tickStepMinutes(timeAxis(24, 1, 480))).toBe(360);
  });

  it("never creates finer ticks than five minutes", () => {
    const ticks = timeAxis(0.5, 8, 1_600);
    const intervals = ticks.slice(1).map((tick, index) => {
      const previous = ticks[index];
      return previous ? (tick.value - previous.value) / 60_000 : 0;
    });
    expect(Math.min(...intervals)).toBeGreaterThanOrEqual(TIME_AXIS_STEPS_MINUTES[0]);
  });

  it("returns unique, strictly ascending ticks aligned to local time boundaries", () => {
    const ticks = calculateTimeAxisTicks({
      from: Date.parse("2026-07-11T08:03:00.000Z"),
      minimumLabelSpacing: 64,
      pixelWidth: 1_600,
      timeZone: "Europe/Berlin",
      until: Date.parse("2026-07-11T09:03:00.000Z"),
    });
    expect(new Set(ticks.map((tick) => tick.value)).size).toBe(ticks.length);
    expect(
      ticks.every((tick, index) => index === 0 || tick.value > (ticks[index - 1]?.value ?? 0)),
    ).toBe(true);
    expect(ticks[0]?.label).toBe("10:05");
    expect(ticks.every((tick) => Number(tick.label.slice(3)) % 5 === 0)).toBe(true);
  });

  it("formats labels in the event time zone and preserves the assumed label spacing", () => {
    const from = Date.parse("2026-07-11T08:00:00.000Z");
    const until = Date.parse("2026-07-11T12:00:00.000Z");
    const pixelWidth = 960;
    const ticks = calculateTimeAxisTicks({
      from,
      minimumLabelSpacing: 64,
      pixelWidth,
      timeZone: "America/New_York",
      until,
    });
    expect(ticks[0]?.label).toBe("04:00");
    const pixelIntervals = ticks.slice(1).map((tick, index) => {
      const previous = ticks[index];
      return previous ? ((tick.value - previous.value) / (until - from)) * pixelWidth : 0;
    });
    expect(Math.min(...pixelIntervals)).toBeGreaterThanOrEqual(64);
  });

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
