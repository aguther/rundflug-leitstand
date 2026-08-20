/// <reference lib="webworker" />

import { runSeedBatch } from "./seed-batch";
import { SeedBatchArchiveWriter } from "./seed-batch-archive";
import type { SeedBatchWorkerMessage, SeedBatchWorkerRequest } from "./seed-batch-messages";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<SeedBatchWorkerRequest>) => {
  const { config, manualIncidents, requestId, runCount } = event.data;
  try {
    const archiveWriter = new SeedBatchArchiveWriter(manualIncidents);
    const result = runSeedBatch(
      config,
      manualIncidents,
      runCount,
      (completedRuns, totalRuns) => {
        const message: SeedBatchWorkerMessage = {
          type: "progress",
          requestId,
          completedRuns,
          totalRuns,
        };
        self.postMessage(message);
      },
      (runResult) => archiveWriter.addRun(runResult),
    );
    const archiveBytes = archiveWriter.finalize(result);
    const archive = archiveBytes.buffer as ArrayBuffer;
    const message: SeedBatchWorkerMessage = { type: "result", requestId, result, archive };
    self.postMessage(message, [archive]);
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
