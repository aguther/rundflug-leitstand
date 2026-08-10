import { describe, expect, it, vi } from "vitest";
import {
  createRealtimeRefreshScheduler,
  createTabRefreshDelaySource,
  type RealtimeRefreshRequest,
  type RealtimeRefreshTarget,
  type RealtimeRefreshTimer,
} from "./realtime-refresh-scheduler";

interface ScheduledCallback {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
}

function controlledTimer(): {
  callbacks: ScheduledCallback[];
  timer: RealtimeRefreshTimer;
} {
  const callbacks: ScheduledCallback[] = [];
  return {
    callbacks,
    timer: {
      schedule(callback, delayMs) {
        const scheduled = { callback, delayMs, cancelled: false };
        callbacks.push(scheduled);
        return scheduled;
      },
      cancel(handle) {
        (handle as ScheduledCallback).cancelled = true;
      },
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("realtime refresh scheduler", () => {
  it("uses one non-persisted tab offset for both refresh target ranges", () => {
    const random = vi.fn(() => 0.25);
    const delaySource = createTabRefreshDelaySource(random);

    expect(delaySource("operational")).toBe(69);
    expect(delaySource("public")).toBe(300);
    expect(delaySource("operational")).toBe(69);
    expect(random).toHaveBeenCalledOnce();
  });

  it("delays a realtime burst and coalesces it to the highest event version", async () => {
    const { callbacks, timer } = controlledTimer();
    const refresh = vi.fn(async (_request: RealtimeRefreshRequest) => undefined);
    const scheduler = createRealtimeRefreshScheduler({
      target: "operational",
      refresh,
      delaySource: () => 125,
      timer,
    });

    scheduler.schedule(41);
    scheduler.schedule(43);
    scheduler.schedule(42);

    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]?.delayMs).toBe(125);
    expect(refresh).not.toHaveBeenCalled();

    callbacks[0]?.callback();
    await flushPromises();

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh.mock.calls[0]?.[0]).toMatchObject({
      eventVersion: 43,
      forceFollowUp: false,
    });
  });

  it("runs an immediate refresh without waiting and cancels an outstanding delay", async () => {
    const { callbacks, timer } = controlledTimer();
    const refresh = vi.fn(async (_request: RealtimeRefreshRequest) => undefined);
    const scheduler = createRealtimeRefreshScheduler({
      target: "public",
      refresh,
      delaySource: () => 600,
      timer,
    });

    scheduler.schedule(27);
    const completed = scheduler.refreshNow();
    await completed;

    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]?.cancelled).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh.mock.calls[0]?.[0]).toMatchObject({ eventVersion: 27 });
  });

  it("runs only one refresh at a time and discards an overtaken response", async () => {
    let resolveFirst: (() => void) | undefined;
    const firstResponse = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const appliedVersions: Array<number | null> = [];
    let concurrentRefreshes = 0;
    let maximumConcurrency = 0;
    let callCount = 0;
    let resolveFollowUp: (() => void) | undefined;
    const followUpFinished = new Promise<void>((resolve) => {
      resolveFollowUp = resolve;
    });
    const scheduler = createRealtimeRefreshScheduler({
      target: "operational",
      refresh: async (request) => {
        callCount += 1;
        concurrentRefreshes += 1;
        maximumConcurrency = Math.max(maximumConcurrency, concurrentRefreshes);
        if (callCount === 1) await firstResponse;
        if (request.isCurrent()) appliedVersions.push(request.eventVersion);
        concurrentRefreshes -= 1;
        if (callCount === 2) resolveFollowUp?.();
      },
    });

    void scheduler.refreshNow();
    await flushPromises();
    scheduler.schedule(12);
    scheduler.schedule(13);
    resolveFirst?.();
    await followUpFinished;

    expect(callCount).toBe(2);
    expect(maximumConcurrency).toBe(1);
    expect(appliedVersions).toEqual([13]);
  });

  it.each([
    { clients: 20, target: "operational" as const, minimumMs: 25, maximumMs: 200 },
    { clients: 50, target: "public" as const, minimumMs: 150, maximumMs: 750 },
  ])(
    "distributes $clients $target clients and applies the newest version within the fan-out bound",
    async ({ clients, target, minimumMs, maximumMs }) => {
      const requestStarts: number[] = [];
      const appliedVersions: number[] = [];
      const appliedAt: number[] = [];
      const serverResponseMs = 40;
      const clientTimers: Array<ReturnType<typeof controlledTimer>> = [];
      const schedulers = Array.from({ length: clients }, (_, index) => {
        const clientTimer = controlledTimer();
        clientTimers.push(clientTimer);
        const delayMs = Math.round(
          minimumMs + (index / Math.max(1, clients - 1)) * (maximumMs - minimumMs),
        );
        return createRealtimeRefreshScheduler({
          target: target as RealtimeRefreshTarget,
          delaySource: () => delayMs,
          timer: clientTimer.timer,
          refresh: async (request) => {
            requestStarts.push(delayMs);
            await Promise.resolve();
            if (request.isCurrent() && request.eventVersion !== null) {
              appliedVersions.push(request.eventVersion);
              appliedAt.push(delayMs + serverResponseMs);
            }
          },
        });
      });

      for (const scheduler of schedulers) {
        scheduler.schedule(80);
        scheduler.schedule(82);
        scheduler.schedule(81);
      }
      for (const clientTimer of clientTimers) {
        expect(clientTimer.callbacks).toHaveLength(1);
        clientTimer.callbacks[0]?.callback();
      }
      await flushPromises();

      expect(requestStarts).toHaveLength(clients);
      expect(new Set(requestStarts).size).toBeGreaterThan(clients / 2);
      expect(Math.min(...requestStarts)).toBe(minimumMs);
      expect(Math.max(...requestStarts)).toBe(maximumMs);
      expect(Math.max(...appliedAt)).toBeLessThanOrEqual(1_000 + serverResponseMs);
      expect(appliedVersions).toEqual(Array.from({ length: clients }, () => 82));
    },
  );
});
