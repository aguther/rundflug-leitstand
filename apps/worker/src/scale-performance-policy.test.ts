import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The operational Node scenario is executed directly as ESM and tested here.
import * as scaleScenario from "../../../scripts/lib/cloudflare-scale-scenario.mjs";
// @ts-expect-error The operational Node policy is executed directly as ESM and tested here.
import * as performancePolicy from "../../../scripts/scale-performance-policy.mjs";

const { cloudflareScaleConfigFromEnvironment, runCloudflareScaleScenario } = scaleScenario;

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

  it("runs only public reads and closes all injected WebSockets after successful sampling", async () => {
    const paths: string[] = [];
    const sockets = Array.from({ length: 20 }, (_, id) => ({ id }));
    const connect = vi.fn(async () => sockets[connect.mock.calls.length - 1]);
    const close = vi.fn();
    const timedJson = vi.fn(async (path: string) => {
      paths.push(path);
      if (path === "/api/health") {
        return { response: new Response("{}"), body: { environment: "acceptance" }, elapsedMs: 5 };
      }
      return {
        response: new Response("{}", { headers: { "server-timing": "public-board;dur=100" } }),
        body: { eventName: "Synthetic scale event", fleet: [], groups: Array.from({ length: 20 }) },
        elapsedMs: 120,
      };
    });
    const report = await runCloudflareScaleScenario(
      {
        confirmation: "PERFORMANCE",
        connectedDevices: 20,
        eventId: "perf-release-1",
        requestTimeoutMilliseconds: 15_000,
        sampleRounds: 2,
        targetOrigin: "https://acceptance.example.workers.dev",
      },
      { http: { timedJson }, websocket: { close, connect } },
    );

    expect(report).toMatchObject({
      ok: true,
      executionProfile: "cloudflare-acceptance-read-only",
      dataset: { connectedDevices: 20, operationSamples: 40 },
    });
    expect(paths).toHaveLength(42);
    expect(paths.every((path) => path === "/api/health" || path.endsWith("/board"))).toBe(true);
    expect(connect).toHaveBeenCalledTimes(20);
    expect(close).toHaveBeenCalledTimes(20);
  });

  it("rejects invalid remote sampling bounds before any network work", () => {
    expect(() =>
      cloudflareScaleConfigFromEnvironment({
        CLOUDFLARE_SCALE_CONFIRMATION: "PERFORMANCE",
        CLOUDFLARE_SCALE_EVENT_ID: "perf-release-1",
        CLOUDFLARE_SCALE_SAMPLE_ROUNDS: "1",
        CLOUDFLARE_SCALE_TARGET_ORIGIN: "https://acceptance.example.workers.dev",
      }),
    ).toThrow("between 2 and 10");
  });
});
