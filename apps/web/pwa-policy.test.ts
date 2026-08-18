import { describe, expect, it } from "vitest";
import { PWA_NETWORK_NAVIGATION_DENYLIST } from "./pwa-policy";

function usesCurrentApplicationShell(pathname: string): boolean {
  return PWA_NETWORK_NAVIGATION_DENYLIST.some((pattern) => pattern.test(pathname));
}

describe("PWA navigation policy", () => {
  it.each([
    "/admin",
    "/fids",
    "/flight-director",
    "/flight-line",
    "/gruppe/synthetic-group",
    "/kasse",
    "/simulation",
    "/simulation/fids",
    "/setup",
    "/ticket/synthetic-ticket",
  ])("loads the current application shell for %s", (pathname) => {
    expect(usesCurrentApplicationShell(pathname)).toBe(true);
  });

  it("keeps the precached root shell available offline", () => {
    expect(usesCurrentApplicationShell("/")).toBe(false);
  });
});
