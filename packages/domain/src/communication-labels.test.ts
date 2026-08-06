import { describe, expect, it } from "vitest";
import {
  formatBookingGroupLabel,
  formatBookingGroupPartLabel,
  formatFlightGroupLabel,
} from "./communication-labels";

describe("communication labels", () => {
  it("separates public booking groups from operational resource-group flights", () => {
    expect(formatBookingGroupLabel("rn", 134)).toBe("G-RN-0134");
    expect(formatFlightGroupLabel("rg001", 130)).toBe("F-RG001-130");
  });

  it("keeps numbers wider than the minimum padding intact", () => {
    expect(formatBookingGroupLabel("PAN", 10_000)).toBe("G-PAN-10000");
    expect(formatFlightGroupLabel("RG020", 1_000)).toBe("F-RG020-1000");
  });

  it("adds a compact suffix only for split booking groups", () => {
    expect(formatBookingGroupPartLabel("rn", 106, { partNumber: 1, partCount: 1 })).toBe(
      "G-RN-0106",
    );
    expect(formatBookingGroupPartLabel("rn", 106, { partNumber: 1, partCount: 2 })).toBe(
      "G-RN-0106/1",
    );
    expect(formatBookingGroupPartLabel("rn", 106, { partNumber: 2, partCount: 2 })).toBe(
      "G-RN-0106/2",
    );
  });

  it("rejects invalid booking group part labels", () => {
    expect(() => formatBookingGroupPartLabel("rn", 106, { partNumber: 0, partCount: 2 })).toThrow(
      "positive, consistent integers",
    );
    expect(() => formatBookingGroupPartLabel("rn", 106, { partNumber: 3, partCount: 2 })).toThrow(
      "positive, consistent integers",
    );
  });
});
