import { describe, expect, it } from "vitest";
import { recordConfirmedOvertakes } from "./confirmed-overtakes";
import type { SimulationRotation } from "./model";

type DispatchableRotation = SimulationRotation & {
  status: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
};

function rotation(id: string, createdAt: string): DispatchableRotation {
  return {
    id,
    communicationNumber: 1,
    passengerCount: 1,
    createdAt,
    precalledAt: null,
    precallTrigger: null,
    precallPredictionQuality: null,
    precallPredictedBoardingAt: null,
    precallAdaptiveLeadMinutes: null,
    aircraftId: null,
    calledAt: null,
    departedAt: null,
    landedAt: null,
    completedAt: null,
    boardingMinutes: null,
    flightMinutes: null,
    deboardingMinutes: null,
    bufferMinutes: null,
    resourceGroupId: "resource-a",
    status: "DRAFT",
  };
}

describe("recordConfirmedOvertakes", () => {
  it("uses sale time and stable id independently of the communication number", () => {
    const rotations = [
      { ...rotation("rotation-first", "2026-08-05T08:00:00.000Z"), communicationNumber: 999 },
      rotation("rotation-middle", "2026-08-05T08:01:00.000Z"),
      { ...rotation("rotation-last", "2026-08-05T08:02:00.000Z"), communicationNumber: 1 },
    ];

    recordConfirmedOvertakes({
      rotations,
      selectedRotationIds: ["rotation-middle", "rotation-last"],
      resourceGroupId: "resource-a",
    });

    expect(rotations[0]?.dispatchConfirmedOvertakeCount).toBe(2);
    expect(rotations[1]?.dispatchConfirmedOvertakeCount).toBeUndefined();
    expect(rotations[2]?.dispatchConfirmedOvertakeCount).toBeUndefined();
  });
});
