import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The operational Node scenario is executed directly as ESM and tested here.
import * as availabilityHarness from "../../../scripts/lib/availability-harness.mjs";

const {
  assertAvailabilityReport,
  availabilityConfigFromEnvironment,
  availabilityProbes,
  probeAvailabilityEndpoint,
  runAvailabilityScenario,
} = availabilityHarness;

describe("Cloudflare availability acceptance harness", () => {
  it("validates duration, thresholds and secure targets at their boundaries", () => {
    expect(availabilityConfigFromEnvironment({}).durationSeconds).toBe(12 * 60 * 60);
    expect(
      availabilityConfigFromEnvironment({
        AVAILABILITY_ALLOW_HTTP: "true",
        AVAILABILITY_DURATION_SECONDS: "20",
        AVAILABILITY_INTERVAL_SECONDS: "1",
        AVAILABILITY_REQUIRED_PERCENT: "0",
        AVAILABILITY_TARGET_ORIGIN: "http://127.0.0.1:8787",
        AVAILABILITY_TIMEOUT_SECONDS: "1",
      }),
    ).toMatchObject({ durationSeconds: 20, requiredAvailabilityPercent: 0 });
    expect(() =>
      availabilityConfigFromEnvironment({ AVAILABILITY_TARGET_ORIGIN: "http://example.test" }),
    ).toThrow("HTTPS");
    expect(() =>
      availabilityConfigFromEnvironment({ AVAILABILITY_REQUIRED_PERCENT: "100.01" }),
    ).toThrow("zwischen 0 und 100");
  });

  it("executes the health validator and converts an invalid response to evidence", async () => {
    expect(availabilityProbes.map(({ name }: { name: string }) => name)).toEqual([
      "web-shell",
      "worker-health",
      "d1-setup-status",
    ]);
    let elapsed = 10;
    const result = await probeAvailabilityEndpoint(
      {
        probe: availabilityProbes[1],
        targetOrigin: new URL("https://acceptance.example"),
        timeoutSeconds: 2,
      },
      {
        fetch: vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })),
        performanceNow: () => (elapsed += 5),
        timeoutSignal: vi.fn(() => undefined),
      },
    );
    expect(result).toMatchObject({
      available: false,
      elapsedMilliseconds: 5,
      failure: "INVALID_RESPONSE",
      name: "worker-health",
      status: 200,
    });
  });

  it("counts complete intervals and rejects a report below the threshold", async () => {
    let now = Date.parse("2026-08-16T08:00:00.000Z");
    const outcomes = [true, false, true];
    const report = await runAvailabilityScenario(
      {
        durationSeconds: 3,
        intervalSeconds: 1,
        requiredAvailabilityPercent: 70,
        targetOrigin: new URL("https://acceptance.example"),
        timeoutSeconds: 1,
      },
      {
        now: () => now,
        probe: vi.fn(async ({ probe }) => ({
          available: outcomes.shift() ?? false,
          elapsedMilliseconds: 12,
          failure: null,
          name: probe.name,
          status: 200,
        })),
        probes: [{ name: "synthetic", path: "/", validate: vi.fn() }],
        sleep: async (milliseconds: number) => {
          now += milliseconds;
        },
      },
    );
    expect(report).toMatchObject({
      intervals: 3,
      availableIntervals: 2,
      unavailableIntervals: 1,
      plannedMaintenanceExcluded: false,
      success: false,
    });
    expect(report.availabilityPercent).toBeCloseTo(200 / 3);
    expect(() => assertAvailabilityReport(report)).toThrow("unterschreitet 70.000 %");
  });
});
