import { useCallback, useEffect, useRef, useState } from "react";
import type { ManualIncident, SimulationConfig } from "./model";
import type { SeedBatchResult } from "./seed-batch";
import type { SeedBatchWorkerMessage, SeedBatchWorkerRequest } from "./seed-batch-messages";

function createSeedBatchWorker(): Worker {
  return new Worker(new URL("./seed-batch-worker.ts", import.meta.url), { type: "module" });
}

export function useSimulationSeedBatch(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[],
) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SeedBatchResult | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const configRef = useRef(config);
  const manualIncidentsRef = useRef(manualIncidents);

  const terminate = useCallback(() => {
    requestIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
  }, []);

  useEffect(() => {
    configRef.current = config;
    manualIncidentsRef.current = manualIncidents;
    terminate();
    setResult(null);
    setError(null);
  }, [config, manualIncidents, terminate]);

  useEffect(() => terminate, [terminate]);

  const start = useCallback(
    (runCount: number) => {
      terminate();
      const requestId = requestIdRef.current;
      const worker = createSeedBatchWorker();
      workerRef.current = worker;
      setOpen(true);
      setResult(null);
      setError(null);
      setProgress({ completed: 0, total: runCount });
      setRunning(true);
      worker.onmessage = (event: MessageEvent<SeedBatchWorkerMessage>) => {
        if (event.data.requestId !== requestId || requestIdRef.current !== requestId) return;
        if (event.data.type === "progress") {
          setProgress({ completed: event.data.completedRuns, total: event.data.totalRuns });
          return;
        }
        if (event.data.type === "result") setResult(event.data.result);
        else setError(event.data.message);
        worker.terminate();
        workerRef.current = null;
        setRunning(false);
      };
      worker.onerror = () => {
        if (requestIdRef.current !== requestId) return;
        setError("Der lokale Mehrfachlauf ist fehlgeschlagen.");
        worker.terminate();
        workerRef.current = null;
        setRunning(false);
      };
      const request: SeedBatchWorkerRequest = {
        requestId,
        config: structuredClone(configRef.current),
        manualIncidents: structuredClone([...manualIncidentsRef.current]),
        runCount,
      };
      worker.postMessage(request);
    },
    [terminate],
  );

  const close = useCallback(() => {
    terminate();
    setOpen(false);
  }, [terminate]);

  return {
    cancel: terminate,
    close,
    error,
    open,
    openDialog: () => setOpen(true),
    progress,
    result,
    running,
    start,
  };
}
