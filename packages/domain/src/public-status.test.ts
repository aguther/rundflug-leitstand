import { describe, expect, it } from "vitest";
import { derivePublicRotationStatus } from "./public-status";

describe("F-BRD-020 / F-BEN-010 public rotation status", () => {
  it("publishes CALLED as BOARDING independently of ticket attendance", () => {
    expect(
      derivePublicRotationStatus({
        rotationState: "CALLED",
        draftStatus: "COME_TO_FLIGHT_LINE",
      }),
    ).toBe("BOARDING");
  });

  it.each([
    ["DRAFT", "WAITING", "WAITING"],
    ["DRAFT", "PREPARE", "PREPARE"],
    ["DRAFT", "COME_TO_FLIGHT_LINE", "COME_TO_FLIGHT_LINE"],
    ["IN_FLIGHT", "WAITING", "IN_FLIGHT"],
    ["LANDED", "WAITING", "LANDED"],
    ["COMPLETED", "WAITING", "COMPLETED"],
  ] as const)("maps %s with draft status %s to %s", (rotationState, draftStatus, expected) => {
    expect(derivePublicRotationStatus({ rotationState, draftStatus })).toBe(expected);
  });
});
