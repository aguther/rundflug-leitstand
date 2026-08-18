// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { simulationConfigForPreset } from "./model";
import { useSimulationSeedBatch } from "./useSimulationSeedBatch";

const workers: MockWorker[] = [];

class MockWorker {
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal("Worker", MockWorker);
});

describe("useSimulationSeedBatch", () => {
  it("creates workers lazily and ignores stale results after cancellation", () => {
    const config = simulationConfigForPreset("NORMAL");
    const incidents: never[] = [];
    const { result } = renderHook(() => useSimulationSeedBatch(config, incidents));
    expect(workers).toHaveLength(0);

    act(() => result.current.start(5));
    const worker = workers[0];
    const request = worker?.postMessage.mock.calls[0]?.[0];
    expect(request).toEqual(expect.objectContaining({ runCount: 5, config, manualIncidents: [] }));

    act(() =>
      worker?.onmessage?.(
        new MessageEvent("message", {
          data: { type: "progress", requestId: request.requestId, completedRuns: 3, totalRuns: 5 },
        }),
      ),
    );
    expect(result.current.progress).toEqual({ completed: 3, total: 5 });

    act(() => result.current.cancel());
    expect(worker?.terminate).toHaveBeenCalledOnce();
    act(() =>
      worker?.onmessage?.(
        new MessageEvent("message", {
          data: { type: "result", requestId: request.requestId, result: { runCount: 5 } },
        }),
      ),
    );
    expect(result.current.result).toBeNull();
  });

  it("retries after errors and invalidates work when scenario input changes", () => {
    const config = simulationConfigForPreset("NORMAL");
    const incidents: never[] = [];
    const { result, rerender } = renderHook(
      ({ input }) => useSimulationSeedBatch(input, incidents),
      { initialProps: { input: config } },
    );
    act(() => result.current.start(5));
    act(() => workers[0]?.onerror?.(new Event("error")));
    expect(result.current.error).toMatch(/fehlgeschlagen/);

    act(() => result.current.start(6));
    const retry = workers[1];
    expect(retry?.postMessage).toHaveBeenCalledOnce();
    rerender({ input: { ...config, seed: config.seed + 1 } });
    expect(retry?.terminate).toHaveBeenCalledOnce();
    expect(result.current.running).toBe(false);
  });
});
