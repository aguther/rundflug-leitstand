import { useEffect, useRef, useState } from "react";
import type { BatchComparisonResult } from "./comparison";
import type { ManualIncident, SimulationConfig } from "./model";

type ComparisonMessage =
  | { type: "progress"; completedRuns: number; totalRuns: number }
  | { type: "result"; result: BatchComparisonResult }
  | { type: "error"; message: string };

function createComparisonWorker(): Worker {
  return new Worker(new URL("./comparison-worker.ts", import.meta.url), {
    type: "module",
  });
}

export function useSimulationComparison() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<BatchComparisonResult | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = createComparisonWorker();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  const cancel = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
  };

  const start = (config: SimulationConfig, manualIncidents: readonly ManualIncident[]) => {
    if (running) cancel();
    setOpen(true);
    setResult(null);
    setError(null);
    setProgress({ completed: 0, total: config.forecastTuning.comparisonRuns });
    setRunning(true);
    const worker = workerRef.current ?? createComparisonWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<ComparisonMessage>) => {
      if (event.data.type === "progress") {
        setProgress({
          completed: event.data.completedRuns,
          total: event.data.totalRuns,
        });
        return;
      }
      if (event.data.type === "result") {
        setResult(event.data.result);
      } else {
        setError(event.data.message);
        worker.terminate();
        workerRef.current = null;
      }
      setRunning(false);
    };
    worker.onerror = () => {
      setError("Der lokale A/B-Vergleich ist fehlgeschlagen.");
      worker.terminate();
      workerRef.current = null;
      setRunning(false);
    };
    worker.postMessage({
      config: structuredClone(config),
      manualIncidents: structuredClone(manualIncidents),
    });
  };

  return { cancel, error, open, progress, result, running, setOpen, start };
}
