import { strToU8, Zip, ZipDeflate } from "fflate";
import type { ManualIncident, SimulationResult } from "./model";
import type { SeedBatchResult } from "./seed-batch";
import { createSimulationExport } from "./simulation-export";

export const SEED_BATCH_ARCHIVE_SCHEMA = "rundflug-forecast-simulation-seed-batch/v1" as const;

export interface SeedBatchArchiveFile {
  path: string;
  seed: number;
}

export interface SeedBatchArchiveSummary {
  schema: typeof SEED_BATCH_ARCHIVE_SCHEMA;
  seedStart: number;
  runCount: number;
  files: SeedBatchArchiveFile[];
  seedBatch: SeedBatchResult;
}

function concatenateChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export class SeedBatchArchiveWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly files: SeedBatchArchiveFile[] = [];
  private readonly zip: Zip;
  private byteLength = 0;
  private failure: Error | null = null;
  private finalized = false;

  constructor(private readonly manualIncidents: readonly ManualIncident[]) {
    this.zip = new Zip((error, data) => {
      if (error) {
        this.failure = error;
        return;
      }
      if (data.byteLength === 0) return;
      const stableChunk = data.slice();
      this.chunks.push(stableChunk);
      this.byteLength += stableChunk.byteLength;
    });
  }

  addRun(result: SimulationResult): void {
    if (this.finalized) throw new Error("SEED_BATCH_ARCHIVE_ALREADY_FINALIZED");
    const path = `runs/prognose-simulation-${result.config.seed}.json`;
    this.addJsonEntry(path, createSimulationExport(result, this.manualIncidents, null, null));
    this.files.push({ path, seed: result.config.seed });
  }

  finalize(seedBatch: SeedBatchResult): Uint8Array {
    if (this.finalized) throw new Error("SEED_BATCH_ARCHIVE_ALREADY_FINALIZED");
    this.finalized = true;
    const summary: SeedBatchArchiveSummary = {
      schema: SEED_BATCH_ARCHIVE_SCHEMA,
      seedStart: seedBatch.seedStart,
      runCount: seedBatch.runCount,
      files: this.files,
      seedBatch,
    };
    this.addJsonEntry("summary.json", summary);
    this.zip.end();
    if (this.failure) throw this.failure;
    return concatenateChunks(this.chunks, this.byteLength);
  }

  private addJsonEntry(path: string, value: unknown): void {
    if (this.failure) throw this.failure;
    const entry = new ZipDeflate(path, { level: 6 });
    this.zip.add(entry);
    entry.push(strToU8(`${JSON.stringify(value, null, 2)}\n`), true);
    if (this.failure) throw this.failure;
  }
}
