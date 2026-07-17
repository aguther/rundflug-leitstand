import { describe, expect, it } from "vitest";
import { appDestinations, isDestinationActive } from "./navigation";

describe("V1.2 app navigation", () => {
  it("exposes every approved internal work surface", () => {
    expect(appDestinations.map((entry) => entry.href)).toEqual([
      "/kasse",
      "/flight-line",
      "/flight-line/assist",
      "/fids",
      "/admin",
    ]);
  });

  it("does not confuse the supervisor route with assist", () => {
    expect(isDestinationActive("/flight-line", "/flight-line")).toBe(true);
    expect(isDestinationActive("/flight-line/assist", "/flight-line")).toBe(false);
    expect(isDestinationActive("/flight-line/assist", "/flight-line/assist")).toBe(true);
  });
});
