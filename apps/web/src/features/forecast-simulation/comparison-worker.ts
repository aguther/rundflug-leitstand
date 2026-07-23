/// <reference lib="webworker" />

import { runBatchComparison } from "./comparison";
import type { ManualIncident, SimulationConfig } from "./model";

interface ComparisonWorkerRequest {
  config: SimulationConfig;
  manualIncidents: ManualIncident[];
}

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<ComparisonWorkerRequest>) => {
  try {
    const result = runBatchComparison(
      event.data.config,
      event.data.manualIncidents,
      (completedRuns, totalRuns) => {
        self.postMessage({ type: "progress", completedRuns, totalRuns });
      },
    );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Der A/B-Vergleich ist fehlgeschlagen.",
    });
  }
};
