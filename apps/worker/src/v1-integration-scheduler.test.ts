import { describe, expect, it } from "vitest";
import {
  integrationShards,
  parseShardSelection,
  runSequentialSuites,
  suites,
} from "../../../scripts/verify_v1_integrations.mjs";

describe("V1 integration suite scheduling", () => {
  it("assigns every integration suite to exactly one of four shards", () => {
    expect(integrationShards).toHaveLength(4);
    const assignedSuites = integrationShards.flatMap((shard) => shard.suites);
    expect(new Set(assignedSuites).size).toBe(assignedSuites.length);
    expect(assignedSuites).toEqual(suites);
    expect(suites).toHaveLength(18);
  });

  it("selects one configured shard and rejects invalid selectors", () => {
    expect(parseShardSelection([])).toEqual({ name: "all", suites });
    expect(parseShardSelection(["--shard=2/4"])).toEqual(integrationShards[1]);
    expect(() => parseShardSelection(["--shard=0/4"])).toThrow(/must select/);
    expect(() => parseShardSelection(["--shard=1/3"])).toThrow(/must select/);
    expect(() => parseShardSelection(["--other"])).toThrow(/Unknown/);
  });

  it("runs every suite sequentially within a runner", async () => {
    const started: string[] = [];
    const completed: string[] = [];
    const execution = runSequentialSuites({
      selectedSuites: ["suite-1", "suite-2", "suite-3"],
      shardName: "synthetic",
      runSuite: async (suite: string, shard: string) => {
        started.push(suite);
        expect(started).toHaveLength(completed.length + 1);
        completed.push(suite);
        return { suite, shard };
      },
    });

    await expect(execution).resolves.toEqual([
      { suite: "suite-1", shard: "synthetic" },
      { suite: "suite-2", shard: "synthetic" },
      { suite: "suite-3", shard: "synthetic" },
    ]);
    expect(started).toEqual(completed);
  });
});
