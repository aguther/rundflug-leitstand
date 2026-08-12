import { describe, expect, it } from "vitest";
import {
  type AutomaticPrecallInput,
  DEFAULT_PRECALL_TUNING_PROFILE,
  decideAutomaticPrecall,
  deriveAdaptivePrecallLeadMinutes,
  normalizePrecallObservation,
  selectAutomaticPrecalls,
} from "./precall";

const eligible: AutomaticPrecallInput = {
  enabled: true,
  eventActive: true,
  operationsAvailable: true,
  resourceGroupActive: true,
  resourceGroupEnabled: true,
  alreadyPrecalled: false,
  forecastCapacityStatus: "AVAILABLE",
  predictionQuality: "CHANGING",
  predictedBoardingMinutes: 12,
  adaptiveLeadMinutes: 15,
};

describe("automatischer Voraufruf (F-BEN-030)", () => {
  it("allows a fitting group inside the adaptive lead", () => {
    expect(decideAutomaticPrecall(eligible)).toEqual({
      eligible: true,
      status: "GO_TO_GATE",
      reason: "ELIGIBLE",
    });
    expect(
      decideAutomaticPrecall({ ...eligible, forecastCapacityStatus: "NO_FITTING_AIRCRAFT" }).reason,
    ).toBe("NO_FITTING_AIRCRAFT");
  });

  it("selects every queue-stable group inside the shared forecast window", () => {
    const decisions = selectAutomaticPrecalls([
      { ...eligible, id: "one", resourceGroupId: "rg-1", predictedBoardingMinutes: 0 },
      { ...eligible, id: "two", resourceGroupId: "rg-1", predictedBoardingMinutes: 0 },
      { ...eligible, id: "three", resourceGroupId: "rg-1", predictedBoardingMinutes: 10 },
      { ...eligible, id: "four", resourceGroupId: "rg-1", predictedBoardingMinutes: 16 },
    ]);

    expect(
      decisions.filter((decision) => decision.eligible).map((decision) => decision.id),
    ).toEqual(["one", "two", "three"]);
    expect(decisions[3]?.reason).toBe("TOO_EARLY");
  });

  it("keeps an existing GO TO GATE in the queue without blocking eligible followers", () => {
    const decisions = selectAutomaticPrecalls([
      { ...eligible, id: "existing", resourceGroupId: "rg-1", alreadyPrecalled: true },
      { ...eligible, id: "next", resourceGroupId: "rg-1", predictedBoardingMinutes: 0 },
      { ...eligible, id: "third", resourceGroupId: "rg-1", predictedBoardingMinutes: 10 },
    ]);

    expect(
      decisions.map(({ id, eligible: isEligible, reason }) => [id, isEligible, reason]),
    ).toEqual([
      ["existing", false, "ALREADY_PRECALLED"],
      ["next", true, "ELIGIBLE"],
      ["third", true, "ELIGIBLE"],
    ]);
  });

  it.each([
    {
      forecastCapacityStatus: "NO_FITTING_AIRCRAFT",
      predictedBoardingMinutes: 0,
      reason: "NO_FITTING_AIRCRAFT",
    },
    { groupSize: 3, predictedBoardingMinutes: 16, reason: "TOO_EARLY" },
  ] as const)(
    "does not let an ineligible queue entry block planned followers ($reason)",
    (front) => {
      const decisions = selectAutomaticPrecalls([
        { ...eligible, ...front, id: "front", resourceGroupId: "rg-1" },
        { ...eligible, id: "follower", resourceGroupId: "rg-1", predictedBoardingMinutes: 0 },
        { ...eligible, id: "other-resource", resourceGroupId: "rg-2", predictedBoardingMinutes: 0 },
      ]);

      expect(decisions[0]?.reason).toBe(front.reason);
      expect(decisions[1]?.reason).toBe("ELIGIBLE");
      expect(decisions[2]).toMatchObject({ eligible: true, reason: "ELIGIBLE" });
    },
  );

  it("does not let another resource group's same-gate call block capacity", () => {
    const decisions = selectAutomaticPrecalls([
      { ...eligible, id: "oldtimer", resourceGroupId: "rg-oldtimer" },
      { ...eligible, id: "rundflug", resourceGroupId: "rg-rundflug" },
    ]);
    expect(decisions.every((decision) => decision.eligible)).toBe(true);
  });

  it("does not turn uncertainty or a soft gate-wait target into a hard block", () => {
    expect(decideAutomaticPrecall({ ...eligible, predictionQuality: "UNCERTAIN" }).eligible).toBe(
      true,
    );
    expect(decideAutomaticPrecall({ ...eligible, predictedBoardingMinutes: 16 }).reason).toBe(
      "TOO_EARLY",
    );
    expect(
      decideAutomaticPrecall({ ...eligible, forecastCapacityStatus: "NO_FORECAST_CAPACITY" })
        .reason,
    ).toBe("NO_FORECAST_CAPACITY");
  });

  it("becomes eligible from elapsed time alone on the next periodic evaluation", () => {
    expect(decideAutomaticPrecall({ ...eligible, predictedBoardingMinutes: 15.5 }).reason).toBe(
      "TOO_EARLY",
    );
    expect(decideAutomaticPrecall(eligible)).toEqual({
      eligible: true,
      status: "GO_TO_GATE",
      reason: "ELIGIBLE",
    });
  });

  it("learns a bounded lead from observed precall-to-boarding waits", () => {
    expect(deriveAdaptivePrecallLeadMinutes({ observedGateWaitMinutes: [] })).toBe(12);
    expect(deriveAdaptivePrecallLeadMinutes({ observedGateWaitMinutes: [18, 20, 22, 120] })).toBe(
      6,
    );
    expect(deriveAdaptivePrecallLeadMinutes({ observedGateWaitMinutes: [2, 3, 4] })).toBe(15);
  });

  it("adds gate travel time after bounding the adaptive base lead", () => {
    expect(
      decideAutomaticPrecall({
        ...eligible,
        predictedBoardingMinutes: 20,
        adaptiveLeadMinutes: 15,
        prepareLeadMinutes: 18,
        gateTravelLeadMinutes: 6,
      }),
    ).toEqual({ eligible: true, status: "GO_TO_GATE", reason: "ELIGIBLE" });
    expect(
      decideAutomaticPrecall({
        ...eligible,
        predictedBoardingMinutes: 22,
        adaptiveLeadMinutes: 15,
        prepareLeadMinutes: 18,
        gateTravelLeadMinutes: 6,
      }).status,
    ).toBe("PREPARE");
    expect(
      normalizePrecallObservation({
        observedGoToGateToBoardingMinutes: 14,
        gateTravelLeadMinutesUsed: 6,
      }),
    ).toBe(8);
    expect(() =>
      normalizePrecallObservation({
        observedGoToGateToBoardingMinutes: Number.NaN,
        gateTravelLeadMinutesUsed: 6,
      }),
    ).toThrow(TypeError);
  });

  it("keeps production defaults identical and applies a local experimental profile", () => {
    const input = { observedGateWaitMinutes: [2, 3, 4] };
    expect(
      deriveAdaptivePrecallLeadMinutes({
        ...input,
        tuning: { ...DEFAULT_PRECALL_TUNING_PROFILE },
      }),
    ).toBe(deriveAdaptivePrecallLeadMinutes(input));
    expect(
      deriveAdaptivePrecallLeadMinutes({
        ...input,
        tuning: {
          ...DEFAULT_PRECALL_TUNING_PROFILE,
          baselineLeadMinutes: 20,
          correctionFactor: 1,
          minimumLeadMinutes: 2,
          maximumLeadMinutes: 30,
          observationSampleLimit: 2,
        },
      }),
    ).toBe(25);
  });

  it("never treats a precall as an aircraft assignment", () => {
    expect(JSON.stringify(eligible)).not.toMatch(/aircraftId|pilotId|assignment/i);
  });
});
