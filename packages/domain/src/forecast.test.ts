import { describe, expect, it } from "vitest";
import { estimateDuration, forecastQueueWindows } from "./forecast";

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
