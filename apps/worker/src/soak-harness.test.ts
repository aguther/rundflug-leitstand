import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The operational Node scenario is executed directly as ESM and tested here.
import * as soakHarness from "../../../scripts/lib/soak-reliability-scenario.mjs";

const { requestJson, runSoakReliabilityScenario, soakConfigFromEnvironment } = soakHarness;

function scenarioHarness(overrides: Record<string, unknown> = {}) {
  let now = 0;
  let version = 1;
  let stateChanges = 0;
  const response = (body: unknown) => ({ body, elapsedMilliseconds: 25 });
  const harness = {
    adminPin: "synthetic-admin-authorization",
    http: {
      health: vi.fn(async () => response({ ok: true })),
      board: vi.fn(async () => response({ event: { version } })),
      command: vi.fn(async (_expectedVersion: number, type: string) => {
        version += 1;
        if (type === "SELL_TICKET_GROUP")
          return response({ aggregate: { id: "synthetic-group" }, event: { version } });
        stateChanges += 1;
        return response({ event: { version } });
      }),
    },
    now: () => now,
    process: { isAlive: () => true },
    realtime: {
      ensureHealthy: vi.fn(async () => undefined),
      metrics: () => ({
        realtimeMessages: stateChanges,
        realtimeStateChanges: stateChanges,
        realtimePongs: 1,
        realtimeReconnects: 0,
        realtimeCloses: 0,
      }),
      stateChanges: () => stateChanges,
      waitForStateChange: vi.fn(async (previous: number) => {
        if (stateChanges <= previous) throw new Error("missing state change");
      }),
    },
    sleep: async (milliseconds: number) => {
      now += milliseconds;
    },
    ...overrides,
  };
  return harness;
}

describe("V1 twelve-hour reliability harness", () => {
  it("validates duration, interval and isolated port boundaries", () => {
    expect(soakConfigFromEnvironment({})).toEqual({
      durationSeconds: 12 * 60 * 60,
      intervalSeconds: 60,
      port: 8_797,
    });
    expect(() => soakConfigFromEnvironment({ SOAK_DURATION_SECONDS: "19" })).toThrow(
      "mindestens 20",
    );
    expect(() => soakConfigFromEnvironment({ SOAK_PORT: "80" })).toThrow("zwischen 1024 und 55000");
  });

  it("rejects HTTP failures and the exact latency threshold through injected adapters", async () => {
    await expect(
      requestJson(
        { url: "https://worker.test", init: {}, maximumMilliseconds: 2_000 },
        {
          diagnostic: () => "bounded diagnostic",
          fetch: vi.fn(
            async () =>
              new Response(JSON.stringify({ error: { code: "D1_BUSY" } }), { status: 503 }),
          ),
          performanceNow: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(10),
          sleep: vi.fn(async () => undefined),
          timeoutSignal: vi.fn(() => undefined),
        },
      ),
    ).rejects.toThrow("D1_BUSY · bounded diagnostic");

    await expect(
      requestJson(
        { url: "https://worker.test", init: {}, maximumMilliseconds: 2_000 },
        {
          diagnostic: () => "",
          fetch: vi.fn(async () => new Response("{}")),
          performanceNow: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(2_000),
          sleep: vi.fn(async () => undefined),
          timeoutSignal: vi.fn(() => undefined),
        },
      ),
    ).rejects.toThrow("überschritt 2000 ms");
  });

  it("executes authenticated write, read and realtime behavior without a process restart", async () => {
    const harness = scenarioHarness();
    const report = await runSoakReliabilityScenario(
      { durationSeconds: 20, intervalSeconds: 20, port: 8_797 },
      harness,
    );
    expect(report).toMatchObject({
      ok: true,
      cycles: 1,
      requests: 5,
      workerRestarted: false,
      anonymousSyntheticDataOnly: true,
    });
    expect(harness.http.command).toHaveBeenNthCalledWith(
      1,
      1,
      "SELL_TICKET_GROUP",
      expect.objectContaining({ ticketCount: 1 }),
    );
    expect(harness.http.command).toHaveBeenNthCalledWith(
      2,
      2,
      "CANCEL_TICKET_GROUP",
      expect.objectContaining({ adminPin: "synthetic-admin-authorization" }),
    );
    expect(harness.realtime.ensureHealthy).toHaveBeenCalledOnce();
  });

  it("fails immediately when the injected Worker process is no longer alive", async () => {
    const harness = scenarioHarness({ process: { isAlive: () => false } });
    await expect(
      runSoakReliabilityScenario(
        { durationSeconds: 20, intervalSeconds: 20, port: 8_797 },
        harness,
      ),
    ).rejects.toThrow("Worker-Prozess wurde während des Langlaufs beendet");
  });
});
