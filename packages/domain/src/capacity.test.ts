import { describe, expect, it } from "vitest";
import { assessRemainingCapacity } from "./capacity";

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
    expect(result.status).toBe("LIMITED");
    expect(result.saleRecommended).toBe(true);
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
});
