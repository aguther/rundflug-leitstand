import { describe, expect, it } from "vitest";
import availabilityHarness from "../../../scripts/verify_cloudflare_availability.mjs?raw";

describe("Cloudflare availability acceptance harness", () => {
  it("checks the central web, Worker and D1 paths for the complete event window", () => {
    expect(availabilityHarness).toContain("12 * 60 * 60");
    expect(availabilityHarness).toContain("AVAILABILITY_REQUIRED_PERCENT ?? 99.5");
    expect(availabilityHarness).toContain('name: "web-shell"');
    expect(availabilityHarness).toContain('name: "worker-health"');
    expect(availabilityHarness).toContain('name: "d1-setup-status"');
    expect(availabilityHarness).toContain("Promise.all(probes.map(probe))");
  });

  it("does not permit planned-maintenance exclusions or insecure central probes", () => {
    expect(availabilityHarness).toContain("plannedMaintenanceExcluded: false");
    expect(availabilityHarness).toContain('targetOrigin.protocol !== "https:"');
    expect(availabilityHarness).not.toContain("guestName");
    expect(availabilityHarness).not.toContain("phoneNumber");
  });

  it("fails the acceptance run below the required availability", () => {
    expect(availabilityHarness).toContain("availabilityPercent >= requiredAvailabilityPercent");
    expect(availabilityHarness).toContain("if (!report.success)");
  });
});
