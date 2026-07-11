import { describe, expect, it } from "vitest";
import { estimateDuration, forecastQueueWindows } from "./forecast";

describe("event-driven forecast", () => {
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
});
