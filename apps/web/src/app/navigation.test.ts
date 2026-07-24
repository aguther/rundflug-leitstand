import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminSource from "../admin-view.tsx?raw";
import ticketStatusSource from "../ticket-status-view.tsx?raw";
import headerSource from "./AppHeader.tsx?raw";
import shellSource from "./AppShell.tsx?raw";
import {
  appDestinations,
  destinationsForRole,
  homeForRole,
  isDestinationActive,
  mayOpenEventRoute,
} from "./navigation";

const baseStyles = readFileSync(new URL("../design-system/base.css", import.meta.url), "utf8");

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

  it("keeps Flight Director and Flight Line distinct and removes the old assist route", () => {
    expect(isDestinationActive("/flight-director", "/flight-director")).toBe(true);
    expect(isDestinationActive("/flight-line", "/flight-director")).toBe(false);
    expect(isDestinationActive("/flight-line", "/flight-line")).toBe(true);
    expect(isDestinationActive("/flight-line/assist", "/flight-line")).toBe(false);
    expect(mayOpenEventRoute("FLIGHT_LINE", "/flight-line/assist")).toBe(false);
  });

  it("keeps the standalone simulator route ADMIN-only and out of the global switcher", () => {
    expect(mayOpenEventRoute("ADMIN", "/simulation")).toBe(true);
    expect(mayOpenEventRoute("CASHIER", "/simulation")).toBe(false);
    expect(mayOpenEventRoute("FLIGHT_LINE", "/simulation")).toBe(false);
    expect(mayOpenEventRoute("FLIGHT_DIRECTOR", "/simulation")).toBe(false);
    expect(mayOpenEventRoute("DISPLAY", "/simulation")).toBe(false);
    expect(appDestinations.some((entry) => entry.href === "/simulation")).toBe(false);
  });

  it("opens the role-specific operational home from the standard address", () => {
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

  it("keeps unauthorized destinations visible and locked in the common switcher", () => {
    expect(headerSource).toContain("appDestinations.map");
    expect(headerSource).toContain('aria-disabled="true"');
    expect(headerSource).toContain("Andere Rolle erforderlich");
    expect(headerSource).toContain("view-switcher-menu");
  });

  it("keeps the view switcher within narrow viewports with wrapped text and an inset check", () => {
    expect(baseStyles).toContain("grid-template-columns: 26px minmax(0, 1fr) 22px");
    expect(baseStyles).toContain("@media (max-width: 560px)");
    expect(baseStyles).toContain("position: fixed");
    expect(baseStyles).toContain("env(safe-area-inset-right");
    expect(baseStyles).toContain("env(safe-area-inset-left");
    expect(baseStyles).toContain("width: auto");
    expect(baseStyles).toContain("overflow-wrap: anywhere");
    expect(baseStyles).toContain("justify-self: end");
    expect(baseStyles).toMatch(/\.view-switcher-menu \{[\s\S]*?right: 0;[\s\S]*?left: auto;/);
    expect(baseStyles).toContain("width: min(360px, calc(100vw - 24px))");
  });

  it("separates the account menu from the view switcher", () => {
    expect(shellSource).toContain("<AppHeader");
    expect(headerSource).toContain("account-menu--integrated");
    expect(headerSource).toContain("account-menu-popover--integrated");
    expect(headerSource).toContain("Abmelden");
    expect(headerSource).not.toContain('querySelector(".view-switcher")');
  });

  it("keeps operational branding static and integrates event, theme and about actions", () => {
    expect(headerSource).toContain('<div className="app-brand">');
    expect(headerSource).toContain("Veranstaltung wechseln");
    expect(headerSource).toContain("account-theme-options");
    expect(headerSource).toContain("setPreference(value)");
    expect(headerSource).toContain("Über Rundflug-Leitstand");
    expect(headerSource).toContain("<ModalDialog");
  });

  it("centers the current-view icon and rotates only the explicit chevron", () => {
    expect(headerSource).toContain('className="view-switcher-icon"');
    expect(headerSource).toContain('className="view-switcher-chevron"');
    expect(baseStyles).toContain(".view-switcher-icon");
    expect(baseStyles).toContain(".view-switcher[open] > summary > .view-switcher-chevron");
    expect(baseStyles).not.toContain(".view-switcher[open] > summary > :last-child");
  });

  it("moves release information into the header and removes the global footer", () => {
    expect(headerSource).toContain("Rundflug-Leitstand · Version {APP_VERSION}");
    expect(headerSource).toContain('className="app-info-menu"');
    expect(shellSource).not.toContain("<footer>");
    expect(shellSource).not.toContain("Keine flugbetriebliche");
  });

  it("keeps public ticket status free of internal account navigation", () => {
    expect(ticketStatusSource).toContain("<Shell");
    expect(ticketStatusSource).toContain("publicView");
    expect(shellSource).toContain("publicView={publicView}");
    expect(headerSource).toContain("!kiosk && !publicView && session");
  });

  it("persists the selected administration area in the URL", () => {
    expect(adminSource).toContain('url.searchParams.set("area", adminArea)');
    expect(adminSource).toContain('url.searchParams.set("section", masterDataCategory)');
    expect(adminSource).toContain('window.history.replaceState(null, "", url)');
  });

  it("launches the synthetic simulator from evaluation in a separate tab", () => {
    expect(adminSource).toContain("Prognose-Simulator öffnen");
    expect(adminSource).toContain('href="/simulation"');
    expect(adminSource).toContain('target="_blank"');
    expect(adminSource).toContain('rel="noopener"');
    expect(adminSource).toContain("keine Betriebsdaten verwendet oder gespeichert");
  });
});
