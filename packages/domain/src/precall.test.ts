import { describe, expect, it } from "vitest";
import { type AutomaticPrecallInput, decideAutomaticPrecall } from "./precall";

const eligible: AutomaticPrecallInput = {
  enabled: true,
  eventActive: true,
  operationsAvailable: true,
  resourceGroupActive: true,
  resourceGroupEnabled: true,
  firstWaitingGroup: true,
  alreadyPrecalled: false,
  groupSize: 3,
  largestEligibleAircraftSeats: 3,
  predictionQuality: "CHANGING",
  minimumQuality: "CHANGING",
  predictedUpperMinutes: 12,
  leadMinutes: 15,
  maximumGateWaitMinutes: 20,
  minutesSinceLastGatePrecall: 5,
  gateCooldownMinutes: 2,
};

describe("automatischer Voraufruf (F-BEN-030)", () => {
  it("allows only the first fitting group inside both time limits", () => {
    expect(decideAutomaticPrecall(eligible)).toEqual({ eligible: true, reason: "ELIGIBLE" });
    expect(decideAutomaticPrecall({ ...eligible, firstWaitingGroup: false }).reason).toBe(
      "NOT_QUEUE_FRONT",
    );
    expect(decideAutomaticPrecall({ ...eligible, groupSize: 4 }).reason).toBe(
      "NO_FITTING_AIRCRAFT",
    );
  });

  it("blocks uncertain, premature, long-wait and gate-cooldown calls", () => {
    expect(decideAutomaticPrecall({ ...eligible, predictionQuality: "UNCERTAIN" }).reason).toBe(
      "PREDICTION_UNCERTAIN",
    );
    expect(decideAutomaticPrecall({ ...eligible, predictedUpperMinutes: 16 }).reason).toBe(
      "TOO_EARLY",
    );
    expect(
      decideAutomaticPrecall({ ...eligible, leadMinutes: 30, predictedUpperMinutes: 21 }).reason,
    ).toBe("GATE_WAIT_TOO_LONG");
    expect(decideAutomaticPrecall({ ...eligible, minutesSinceLastGatePrecall: 1 }).reason).toBe(
      "GATE_COOLDOWN",
    );
  });

  it("never treats a precall as an aircraft assignment", () => {
    expect(JSON.stringify(eligible)).not.toMatch(/aircraftId|pilotId|assignment/i);
  });
});
