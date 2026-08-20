import type { ManualIncident, SimulationConfig } from "./model";
import type { SeedBatchResult } from "./seed-batch";

export interface SeedBatchWorkerRequest {
  requestId: number;
  config: SimulationConfig;
  manualIncidents: ManualIncident[];
  runCount: number;
}

export type SeedBatchWorkerMessage =
  | { type: "progress"; requestId: number; completedRuns: number; totalRuns: number }
  | { type: "result"; requestId: number; result: SeedBatchResult; archive: ArrayBuffer }
  | { type: "error"; requestId: number; message: string };
