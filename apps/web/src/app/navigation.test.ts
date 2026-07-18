import { describe, expect, it } from "vitest";
import adminSource from "../admin-view.tsx?raw";
import ticketStatusSource from "../ticket-status-view.tsx?raw";
import shellSource from "./AppShell.tsx?raw";
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

  it("keeps unauthorized destinations visible and locked in the common switcher", () => {
    expect(shellSource).toContain("appDestinations.map");
    expect(shellSource).toContain('aria-disabled="true"');
    expect(shellSource).toContain("Andere Rolle erforderlich");
    expect(shellSource).toContain("view-switcher-menu");
  });

  it("keeps public ticket status free of internal account navigation", () => {
    expect(ticketStatusSource).toContain("<Shell publicView");
    expect(shellSource).toContain("!publicView && session");
  });

  it("persists the selected administration area in the URL", () => {
    expect(adminSource).toContain('url.searchParams.set("area", adminArea)');
    expect(adminSource).toContain('url.searchParams.set("section", masterDataCategory)');
    expect(adminSource).toContain('window.history.replaceState(null, "", url)');
  });
});
