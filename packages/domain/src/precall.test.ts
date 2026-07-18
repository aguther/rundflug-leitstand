import { describe, expect, it } from "vitest";
import {
  type AutomaticPrecallInput,
  decideAutomaticPrecall,
  deriveAdaptivePrecallLeadMinutes,
} from "./precall";

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
  predictedBoardingMinutes: 12,
  adaptiveLeadMinutes: 15,
  minutesSinceLastGatePrecall: 5,
  gateCooldownMinutes: 2,
};

describe("automatischer Voraufruf (F-BEN-030)", () => {
  it("allows only the first fitting group inside the adaptive lead", () => {
    expect(decideAutomaticPrecall(eligible)).toEqual({ eligible: true, reason: "ELIGIBLE" });
    expect(decideAutomaticPrecall({ ...eligible, firstWaitingGroup: false }).reason).toBe(
      "NOT_QUEUE_FRONT",
    );
    expect(decideAutomaticPrecall({ ...eligible, groupSize: 4 }).reason).toBe(
      "NO_FITTING_AIRCRAFT",
    );
  });

  it("does not turn uncertainty or a soft gate-wait target into a hard block", () => {
    expect(decideAutomaticPrecall({ ...eligible, predictionQuality: "UNCERTAIN" }).eligible).toBe(
      true,
    );
    expect(decideAutomaticPrecall({ ...eligible, predictedBoardingMinutes: 16 }).reason).toBe(
      "TOO_EARLY",
    );
    expect(decideAutomaticPrecall({ ...eligible, minutesSinceLastGatePrecall: 1 }).reason).toBe(
      "GATE_COOLDOWN",
    );
  });

  it("learns a bounded lead from observed precall-to-boarding waits", () => {
    expect(deriveAdaptivePrecallLeadMinutes({ observedGateWaitMinutes: [] })).toBe(12);
    expect(deriveAdaptivePrecallLeadMinutes({ observedGateWaitMinutes: [18, 20, 22, 120] })).toBe(
      6,
    );
    expect(deriveAdaptivePrecallLeadMinutes({ observedGateWaitMinutes: [2, 3, 4] })).toBe(15);
  });

  it("never treats a precall as an aircraft assignment", () => {
    expect(JSON.stringify(eligible)).not.toMatch(/aircraftId|pilotId|assignment/i);
  });
});
