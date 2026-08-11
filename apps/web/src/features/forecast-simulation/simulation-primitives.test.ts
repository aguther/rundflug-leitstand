import { describe, expect, it } from "vitest";
import { sampleTriangular as legacySampleTriangular } from "./engine";
import {
  createSeededRandom,
  deterministicChance,
  deterministicSample,
  hashSimulationSeed,
  sampleTriangular,
} from "./simulation-primitives";

describe("deterministic simulation primitives", () => {
  it.each([
    {
      seed: 20_260_722,
      key: "rotation-001:boarding",
      hash: 2_674_171_307,
      sequence: [0.277123587904498, 0.3008785326965153, 0.2159539081621915],
    },
    {
      seed: 1,
      key: "demand:0:0:120",
      hash: 881_486_808,
      sequence: [0.7983788081910461, 0.20260656788013875, 0.09512812830507755],
    },
    {
      seed: 4_294_967_295,
      key: "äöü:key",
      hash: 679_884_749,
      sequence: [0.8904901971109211, 0.12056579883210361, 0.3444467263761908],
    },
  ])("keeps the published seed stream stable for $seed and $key", (example) => {
    const hash = hashSimulationSeed(example.seed, example.key);
    const random = createSeededRandom(hash);

    expect(hash).toBe(example.hash);
    expect([random.next(), random.next(), random.next()]).toEqual(example.sequence);
    expect(deterministicChance(example.seed, example.key)).toBe(example.sequence[0]);
  });

  it("keeps triangular sampling compatible with the legacy engine export", () => {
    const distribution = { minimum: 3, typical: 5, maximum: 11 };

    expect(deterministicSample(20_260_722, "rotation-001:boarding", distribution)).toBe(
      sampleTriangular(distribution, 0.277123587904498),
    );
    expect(legacySampleTriangular(distribution, 0.75)).toBe(sampleTriangular(distribution, 0.75));
  });
});
