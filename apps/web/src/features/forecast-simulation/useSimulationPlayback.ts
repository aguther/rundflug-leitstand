import { useEffect } from "react";

interface SimulationPlaybackOptions {
  endAt: number;
  running: boolean;
  setCurrentMs: (updater: (current: number) => number) => void;
  setRunning: (running: boolean) => void;
  speed: number;
}

export function useSimulationPlayback({
  endAt,
  running,
  setCurrentMs,
  setRunning,
  speed,
}: SimulationPlaybackOptions): void {
  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - previous;
      previous = now;
      setCurrentMs((current) => {
        const next = Math.min(endAt, current + elapsed * speed);
        if (next >= endAt) setRunning(false);
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [endAt, running, setCurrentMs, setRunning, speed]);
}
