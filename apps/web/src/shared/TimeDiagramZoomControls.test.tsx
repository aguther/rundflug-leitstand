import { describe, expect, it } from "vitest";
import { formatTimeDiagramVisibleSpan } from "./time-diagram-viewport";

describe("time diagram zoom controls", () => {
  it.each([
    [15 * 60_000, "15 Min."],
    [90 * 60_000, "1 Std. 30 Min."],
    [6 * 60 * 60_000, "6 Std."],
  ])("formats a visible span of %s milliseconds as %s", (spanMs, expected) => {
    expect(formatTimeDiagramVisibleSpan(spanMs)).toBe(expected);
  });
});
