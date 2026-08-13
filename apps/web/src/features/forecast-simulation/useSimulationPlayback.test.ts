// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSimulationPlayback } from "./useSimulationPlayback";

describe("useSimulationPlayback", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not schedule playback while paused", () => {
    vi.useFakeTimers();
    const setCurrentMs = vi.fn();

    renderHook(() =>
      useSimulationPlayback({
        endAt: 1_000,
        running: false,
        setCurrentMs,
        setRunning: vi.fn(),
        speed: 1,
      }),
    );

    vi.advanceTimersByTime(500);
    expect(setCurrentMs).not.toHaveBeenCalled();
  });

  it("advances playback, stops at the end, and clears its timer", () => {
    vi.useFakeTimers();
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const setRunning = vi.fn();
    let currentMs = 50;
    const setCurrentMs = vi.fn((update: (current: number) => number) => {
      currentMs = update(currentMs);
    });

    const { unmount } = renderHook(() =>
      useSimulationPlayback({
        endAt: 100,
        running: true,
        setCurrentMs,
        setRunning,
        speed: 1,
      }),
    );

    now = 125;
    vi.advanceTimersByTime(100);
    expect(currentMs).toBe(75);
    expect(setRunning).not.toHaveBeenCalled();

    now = 200;
    vi.advanceTimersByTime(100);
    expect(currentMs).toBe(100);
    expect(setRunning).toHaveBeenCalledWith(false);

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledOnce();
  });
});
