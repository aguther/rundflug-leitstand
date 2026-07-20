import { describe, expect, it } from "vitest";
import adminSource from "../admin-view.tsx?raw";
import ticketStatusSource from "../ticket-status-view.tsx?raw";
import headerSource from "./AppHeader.tsx?raw";
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
    expect(headerSource).toContain("appDestinations.map");
    expect(headerSource).toContain('aria-disabled="true"');
    expect(headerSource).toContain("Andere Rolle erforderlich");
    expect(headerSource).toContain("view-switcher-menu");
  });

  it("separates the account menu from the view switcher", () => {
    expect(shellSource).toContain("<AppHeader");
    expect(headerSource).toContain('className="account-menu"');
    expect(headerSource).toContain('className="account-menu-popover"');
    expect(headerSource).toContain("Abmelden");
    expect(headerSource).not.toContain('querySelector(".view-switcher")');
  });

  it("moves release information into the header and removes the global footer", () => {
    expect(headerSource).toContain("Rundflug-Leitstand · Version {APP_VERSION}");
    expect(headerSource).toContain('className="app-info-menu"');
    expect(shellSource).not.toContain("<footer>");
    expect(shellSource).not.toContain("Keine flugbetriebliche");
  });

  it("keeps public ticket status free of internal account navigation", () => {
    expect(ticketStatusSource).toContain("<Shell publicView");
    expect(shellSource).toContain("publicView={publicView}");
    expect(headerSource).toContain("!kiosk && !publicView && session");
  });

  it("persists the selected administration area in the URL", () => {
    expect(adminSource).toContain('url.searchParams.set("area", adminArea)');
    expect(adminSource).toContain('url.searchParams.set("section", masterDataCategory)');
    expect(adminSource).toContain('window.history.replaceState(null, "", url)');
  });
});
