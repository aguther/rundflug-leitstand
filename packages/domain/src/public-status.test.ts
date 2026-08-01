import { describe, expect, it } from "vitest";
import {
  derivePublicRotationStatus,
  formatBookingGroupPart,
  isSplitBookingGroupPart,
} from "./public-status";

describe("V18-GRP-010 booking group part labels", () => {
  it("formats the canonical compact and long public labels", () => {
    const context = { partNumber: 1, partCount: 2, passengerCount: 3 };

    expect(formatBookingGroupPart(context)).toEqual({
      compact: "Teilflug 1/2",
      long: "Teilflug 1 von 2",
    });
    expect(isSplitBookingGroupPart(context)).toBe(true);
    expect(isSplitBookingGroupPart({ partNumber: 1, partCount: 1, passengerCount: 5 })).toBe(false);
  });

  it("rejects inconsistent part contexts", () => {
    expect(() =>
      formatBookingGroupPart({ partNumber: 3, partCount: 2, passengerCount: 1 }),
    ).toThrow("positive, consistent integers");
  });
});

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
