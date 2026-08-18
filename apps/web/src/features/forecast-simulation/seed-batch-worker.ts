/// <reference lib="webworker" />

import { runSeedBatch } from "./seed-batch";
import type { SeedBatchWorkerMessage, SeedBatchWorkerRequest } from "./seed-batch-messages";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<SeedBatchWorkerRequest>) => {
  const { config, manualIncidents, requestId, runCount } = event.data;
  try {
    const result = runSeedBatch(config, manualIncidents, runCount, (completedRuns, totalRuns) => {
      const message: SeedBatchWorkerMessage = {
        type: "progress",
        requestId,
        completedRuns,
        totalRuns,
      };
      self.postMessage(message);
    });
    const message: SeedBatchWorkerMessage = { type: "result", requestId, result };
    self.postMessage(message);
  } catch (error) {
    const message: SeedBatchWorkerMessage = {
      type: "error",
      requestId,
      message:
        error instanceof Error ? error.message : "Der lokale Mehrfachlauf ist fehlgeschlagen.",
    };
    self.postMessage(message);
  }
};
