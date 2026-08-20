import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { simulationConfigForPreset } from "./model";
import { runSeedBatch } from "./seed-batch";
import {
  SEED_BATCH_ARCHIVE_SCHEMA,
  type SeedBatchArchiveSummary,
  SeedBatchArchiveWriter,
} from "./seed-batch-archive";
import { SIMULATION_EXPORT_SCHEMA } from "./simulation-export";

const ARCHIVE_TIMEOUT_MS = 60_000;

describe("seed batch archive", () => {
  it(
    "writes a summary and one complete v8 export for every deterministic seed",
    () => {
      const config = simulationConfigForPreset("NORMAL");
      config.seed = 4_294_967_294;
      config.realityModel.demand.windows = config.realityModel.demand.windows.map((window) => ({
        ...window,
        personsPerHour: 4,
      }));
      const manualIncidents = [
        {
          id: "manual-archive-001",
          type: "EVENT_INTERRUPTION" as const,
          at: config.schedule.operationsStartAt,
          aircraftId: null,
          durationMinutes: 5,
          dayOutage: false,
        },
      ];
      const writer = new SeedBatchArchiveWriter(manualIncidents);
      const seedBatch = runSeedBatch(config, manualIncidents, 5, undefined, (result) =>
        writer.addRun(result),
      );

      const files = unzipSync(writer.finalize(seedBatch));
      expect(Object.keys(files).sort()).toEqual([
        "runs/prognose-simulation-1.json",
        "runs/prognose-simulation-2.json",
        "runs/prognose-simulation-3.json",
        "runs/prognose-simulation-4294967294.json",
        "runs/prognose-simulation-4294967295.json",
        "summary.json",
      ]);

      const summary = JSON.parse(
        strFromU8(files["summary.json"] ?? new Uint8Array()),
      ) as SeedBatchArchiveSummary;
      expect(summary.schema).toBe(SEED_BATCH_ARCHIVE_SCHEMA);
      expect(summary.seedStart).toBe(config.seed);
      expect(summary.runCount).toBe(5);
      expect(summary.files.map((file) => file.seed)).toEqual([
        4_294_967_294, 4_294_967_295, 1, 2, 3,
      ]);
      expect(summary.seedBatch).toEqual(seedBatch);

      const firstRun = JSON.parse(
        strFromU8(files[summary.files[0]?.path ?? ""] ?? new Uint8Array()),
      );
      expect(firstRun.schema).toBe(SIMULATION_EXPORT_SCHEMA);
      expect(firstRun.seed).toBe(4_294_967_294);
      expect(firstRun.manualIncidents).toEqual(manualIncidents);
      expect(firstRun.syntheticEventLedger.length).toBeGreaterThan(0);
      expect(firstRun.forecastSnapshots.length).toBeGreaterThan(0);
      expect(firstRun.aircraft.length).toBeGreaterThan(0);
      expect(firstRun.rotations.length).toBeGreaterThan(0);
      expect(firstRun.metrics).toEqual(seedBatch.runs[0]?.metrics);
      expect(firstRun.batchComparison).toBeNull();
      expect(firstRun.seedBatch).toBeNull();
    },
    ARCHIVE_TIMEOUT_MS,
  );
});
