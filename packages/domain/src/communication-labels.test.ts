import { describe, expect, it } from "vitest";
import { formatBookingGroupLabel, formatFlightGroupLabel } from "./communication-labels";

describe("communication labels", () => {
  it("separates public booking groups from operational resource-group flights", () => {
    expect(formatBookingGroupLabel("rn", 134)).toBe("G-RN-0134");
    expect(formatFlightGroupLabel("rg001", 130)).toBe("F-RG001-130");
  });

  it("keeps numbers wider than the minimum padding intact", () => {
    expect(formatBookingGroupLabel("PAN", 10_000)).toBe("G-PAN-10000");
    expect(formatFlightGroupLabel("RG020", 1_000)).toBe("F-RG020-1000");
  });
});
