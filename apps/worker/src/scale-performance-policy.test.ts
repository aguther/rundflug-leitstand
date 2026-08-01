// @ts-expect-error The policy test reads checked-in operational files in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error The operational Node helper is executed directly as ESM and tested here.
import * as performancePolicy from "../../../scripts/scale-performance-policy.mjs";

describe("scale performance policy", () => {
  it("keeps runner guardrails separate from Cloudflare SLO thresholds", () => {
    const measurements = {
      initialOperations: 114,
      parallelDeviceP95: 2_339,
      history: 167,
      cashierPageOne: 40,
      cashierPageTwo: 35,
      cashierRevalidation: 20,
      sale: 33,
      forecast: 401,
    };

    expect(performancePolicy.localScaleGuardrails(measurements)).toEqual({
      initialOperationsWithinCiGuardrail: true,
      parallelDeviceP95WithinCiGuardrail: true,
      historyWithinCiGuardrail: true,
      cashierPaginationWithinCiGuardrail: true,
      cashierRevalidationWithinCiGuardrail: true,
      saleWithinCiGuardrail: true,
      forecastWithinCiGuardrail: true,
    });
    expect(
      performancePolicy.cloudflareScaleSlo({
        initialPublicBoardServer: 114,
        parallelPublicBoardServerP95: 2_339,
      }).parallelPublicBoardServerP95UnderTwoSeconds,
    ).toBe(false);
  });

  it("parses server timing and calculates p95 deterministically", () => {
    expect(
      performancePolicy.serverTimingDuration(
        "command-queue;dur=1.2, command;dur=32.5, sale-persist;dur=8.4",
        "command",
      ),
    ).toBe(32.5);
    expect(performancePolicy.serverTimingDuration("command;desc=test", "command")).toBeNull();
    expect(
      performancePolicy.percentile95(Array.from({ length: 20 }, (_, index) => index + 1)),
    ).toBe(19);
  });

  it("restricts remote measurements to explicit synthetic acceptance targets", () => {
    expect(
      performancePolicy.assertCloudflareScaleTarget({
        confirmation: "PERFORMANCE",
        environment: "acceptance",
        eventId: "perf-release-1",
        targetOrigin: "https://acceptance.example.workers.dev",
      }).origin,
    ).toBe("https://acceptance.example.workers.dev");

    for (const invalid of [
      { environment: "production" },
      { eventId: "demo-2026" },
      { targetOrigin: "http://localhost:8787" },
      { targetOrigin: "https://acceptance.example.workers.dev/path" },
      { confirmation: "DEPLOY" },
    ]) {
      expect(() =>
        performancePolicy.assertCloudflareScaleTarget({
          confirmation: "PERFORMANCE",
          environment: "acceptance",
          eventId: "perf-release-1",
          targetOrigin: "https://acceptance.example.workers.dev",
          ...invalid,
        }),
      ).toThrow();
    }
  });

  it("keeps the remote SLO harness read-only and outside the regular CI workflow", () => {
    const remoteHarness = readFileSync(
      new URL("../../../scripts/verify_cloudflare_scale_performance.mjs", import.meta.url),
      "utf8",
    );
    const ciWorkflow = readFileSync(
      new URL("../../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    const performanceWorkflow = readFileSync(
      new URL("../../../.github/workflows/cloudflare-performance.yml", import.meta.url),
      "utf8",
    );

    expect(remoteHarness).toContain("/board");
    expect(remoteHarness).toContain("/live");
    expect(remoteHarness).not.toContain("/api/auth/");
    expect(remoteHarness).not.toContain("/commands");
    expect(remoteHarness).not.toContain("SELL_TICKET_GROUP");
    expect(ciWorkflow).not.toContain("test:cloudflare-scale-performance");
    expect(performanceWorkflow).toContain("workflow_dispatch");
    expect(performanceWorkflow).toContain("test:cloudflare-scale-performance");
  });
});
