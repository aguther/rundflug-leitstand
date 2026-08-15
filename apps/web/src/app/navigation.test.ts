import { describe, expect, it } from "vitest";
import {
  appDestinations,
  destinationsForRole,
  homeForRole,
  isDestinationActive,
  mayOpenEventRoute,
} from "./navigation";

describe("V1.2 app navigation", () => {
  it("exposes every approved internal work surface", () => {
    expect(appDestinations.map((entry) => entry.href)).toEqual([
      "/kasse",
      "/flight-director",
      "/flight-line",
      "/fids",
      "/admin",
    ]);
  });

  it("keeps Flight Director and Flight Line distinct and rejects the retired assist route", () => {
    expect(isDestinationActive("/flight-director", "/flight-director")).toBe(true);
    expect(isDestinationActive("/flight-line", "/flight-director")).toBe(false);
    expect(isDestinationActive("/flight-line", "/flight-line")).toBe(true);
    expect(isDestinationActive("/flight-line/assist", "/flight-line")).toBe(false);
    expect(mayOpenEventRoute("FLIGHT_LINE", "/flight-line/assist")).toBe(false);
  });

  it("keeps simulator routes restricted to administrators", () => {
    for (const path of ["/simulation", "/simulation/fids"] as const) {
      expect(mayOpenEventRoute("ADMIN", path)).toBe(true);
      expect(mayOpenEventRoute("CASHIER", path)).toBe(false);
      expect(mayOpenEventRoute("FLIGHT_LINE", path)).toBe(false);
      expect(mayOpenEventRoute("FLIGHT_DIRECTOR", path)).toBe(false);
      expect(mayOpenEventRoute("DISPLAY", path)).toBe(false);
    }
    expect(appDestinations.some((entry) => entry.href === "/simulation")).toBe(false);
  });

  it("resolves the operational home and visible destinations for every role", () => {
    expect(homeForRole("CASHIER")).toBe("/kasse");
    expect(homeForRole("FLIGHT_LINE")).toBe("/flight-line");
    expect(homeForRole("FLIGHT_DIRECTOR")).toBe("/flight-director");
    expect(homeForRole("ADMIN")).toBe("/admin");
    expect(homeForRole("DISPLAY")).toBe("/fids");
    expect(appDestinations.find((entry) => entry.href === "/fids")?.roles).toEqual([
      "DISPLAY",
      "ADMIN",
    ]);
    expect(destinationsForRole("ADMIN").some((entry) => entry.href === "/fids")).toBe(true);
    expect(destinationsForRole("CASHIER").some((entry) => entry.href === "/fids")).toBe(false);
    expect(destinationsForRole("FLIGHT_LINE").some((entry) => entry.href === "/fids")).toBe(false);
    expect(destinationsForRole("FLIGHT_DIRECTOR").some((entry) => entry.href === "/fids")).toBe(
      false,
    );
  });
});
