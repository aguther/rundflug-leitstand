import { describe, expect, it } from "vitest";
import { expectedReviewAtFromPause } from "./flight-line-pause";

describe("Flight Director pause review", () => {
  it("calculates the optional review time without scheduling an automatic release", () => {
    expect(expectedReviewAtFromPause(20, Date.parse("2026-07-16T10:00:00.000Z"))).toBe(
      "2026-07-16T10:20:00.000Z",
    );
    expect(expectedReviewAtFromPause(null)).toBeNull();
  });
});
