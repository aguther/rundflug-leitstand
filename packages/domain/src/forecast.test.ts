import { describe, expect, it } from "vitest";
import { advanceOverduePrediction, estimateDuration, forecastQueueWindows } from "./forecast";

describe("event-driven forecast", () => {
  it("uses the reference model on cold start without requiring a recent actual event", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [],
      dataAgeMinutes: 120,
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.quality).toBe("CHANGING");
  });

  it("weights recent actual durations without losing the reference baseline", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [18, 20, 21, 22, 22, 23],
      dataAgeMinutes: 1,
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.expectedMinutes).toBeGreaterThanOrEqual(20);
    expect(estimate.quality).toBe("STABLE");
  });

  it("weights even the first actual duration more strongly than the static plan", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [40],
      dataAgeMinutes: 1,
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.expectedMinutes).toBeGreaterThan(30);
  });

  it("gives the newest value the greatest weight when samples are chronological", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [10, 30],
      dataAgeMinutes: 1,
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.expectedMinutes).toBe(22);
  });

  it("marks stale or interrupted data as uncertain without a countdown", () => {
    const estimate = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [20, 21],
      dataAgeMinutes: 6,
      interrupted: false,
      activeCapacity: 1,
    });
    expect(estimate.quality).toBe("UNCERTAIN");
    expect(
      forecastQueueWindows({ queueSequence: 4, activeAircraft: 1, duration: estimate }),
    ).toEqual({
      lowerMinutes: 0,
      upperMinutes: 0,
      quality: "UNCERTAIN",
    });
  });

  it("widens the uncertainty interval for flight groups farther back in the queue", () => {
    const duration = estimateDuration({
      referenceMinutes: 20,
      actualDurationsMinutes: [18, 20, 21, 22, 22, 23],
      dataAgeMinutes: 1,
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
      dataAgeMinutes: 1,
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
});
