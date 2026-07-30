import type { ForecastHistory, ResourceDayHistory } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import {
  boardingForecastChangeMinutes,
  forecastChartData,
  resourceDayMetrics,
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
});
