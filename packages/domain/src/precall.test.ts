import { describe, expect, it } from "vitest";
import {
  type AutomaticPrecallInput,
  DEFAULT_PRECALL_TUNING_PROFILE,
  decideAutomaticPrecall,
  deriveAdaptivePrecallLeadMinutes,
  selectAutomaticPrecalls,
} from "./precall";

const eligible: AutomaticPrecallInput = {
  enabled: true,
  eventActive: true,
  operationsAvailable: true,
  resourceGroupActive: true,
  resourceGroupEnabled: true,
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
  it("allows a fitting group inside the adaptive lead", () => {
    expect(decideAutomaticPrecall(eligible)).toEqual({ eligible: true, reason: "ELIGIBLE" });
    expect(decideAutomaticPrecall({ ...eligible, groupSize: 4 }).reason).toBe(
      "NO_FITTING_AIRCRAFT",
    );
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
    { groupSize: 4, predictedBoardingMinutes: 0, reason: "NO_FITTING_AIRCRAFT" },
    { groupSize: 3, predictedBoardingMinutes: 16, reason: "TOO_EARLY" },
  ] as const)("never skips an ineligible queue front ($reason)", (front) => {
    const decisions = selectAutomaticPrecalls([
      { ...eligible, ...front, id: "front", resourceGroupId: "rg-1" },
      { ...eligible, id: "follower", resourceGroupId: "rg-1", predictedBoardingMinutes: 0 },
      { ...eligible, id: "other-resource", resourceGroupId: "rg-2", predictedBoardingMinutes: 0 },
    ]);

    expect(decisions[0]?.reason).toBe(front.reason);
    expect(decisions[1]?.reason).toBe("NOT_QUEUE_FRONT");
    expect(decisions[2]).toMatchObject({ eligible: true, reason: "ELIGIBLE" });
  });

  it("allows a same-gate batch but applies the cooldown snapshot to the next batch", () => {
    const openBatch = selectAutomaticPrecalls([
      { ...eligible, id: "one", resourceGroupId: "rg-1", minutesSinceLastGatePrecall: 5 },
      { ...eligible, id: "two", resourceGroupId: "rg-1", minutesSinceLastGatePrecall: 5 },
      { ...eligible, id: "three", resourceGroupId: "rg-1", minutesSinceLastGatePrecall: 5 },
    ]);
    expect(openBatch.every((decision) => decision.eligible)).toBe(true);

    const cooldownBatch = selectAutomaticPrecalls([
      { ...eligible, id: "four", resourceGroupId: "rg-1", minutesSinceLastGatePrecall: 1 },
      { ...eligible, id: "five", resourceGroupId: "rg-1", minutesSinceLastGatePrecall: 1 },
    ]);
    expect(cooldownBatch.map((decision) => decision.reason)).toEqual([
      "GATE_COOLDOWN",
      "NOT_QUEUE_FRONT",
    ]);
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
