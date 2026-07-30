import { describe, expect, it } from "vitest";
import { deriveReferenceRotationBreakdown } from "./reference-rotation";

describe("reference rotation", () => {
  it("derives the complete reference rotation from product and event durations", () => {
    expect(
      deriveReferenceRotationBreakdown({
        boardingMinutes: 8,
        offBlockToOnBlockMinutes: 20,
        deboardingMinutes: 5,
        bufferMinutes: 3,
      }),
    ).toEqual({
      boardingMinutes: 8,
      offBlockToOnBlockMinutes: 20,
      deboardingMinutes: 5,
      bufferMinutes: 3,
      totalMinutes: 36,
    });
  });

  it("keeps a zero operational buffer explicit", () => {
    expect(
      deriveReferenceRotationBreakdown({
        boardingMinutes: 4,
        offBlockToOnBlockMinutes: 12,
        deboardingMinutes: 3,
        bufferMinutes: 0,
      }).totalMinutes,
    ).toBe(19);
  });
});
