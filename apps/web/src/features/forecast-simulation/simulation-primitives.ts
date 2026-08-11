import type { TriangularDistribution } from "./model";

export const SIMULATION_TICK_MS = 30_000;
export const SIMULATION_MINUTE_MS = 60_000;

interface RandomSource {
  next(): number;
}

export function createSeededRandom(seed: number): RandomSource {
  let value = seed >>> 0;
  return {
    next() {
      value = (value + 0x6d2b79f5) | 0;
      let result = Math.imul(value ^ (value >>> 15), 1 | value);
      result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
      return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
}

export function hashSimulationSeed(seed: number, key: string): number {
  let hash = (2_166_136_261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash || 1;
}

export function sampleTriangular(
  distribution: TriangularDistribution,
  randomValue: number,
): number {
  const { minimum, typical, maximum } = distribution;
  if (maximum === minimum) return minimum;
  const bounded = Math.min(1 - Number.EPSILON, Math.max(0, randomValue));
  const split = (typical - minimum) / (maximum - minimum);
  if (bounded < split) {
    return minimum + Math.sqrt(bounded * (maximum - minimum) * (typical - minimum));
  }
  return maximum - Math.sqrt((1 - bounded) * (maximum - minimum) * (maximum - typical));
}

export function deterministicSample(
  seed: number,
  key: string,
  distribution: TriangularDistribution,
): number {
  return sampleTriangular(distribution, createSeededRandom(hashSimulationSeed(seed, key)).next());
}

export function deterministicChance(seed: number, key: string): number {
  return createSeededRandom(hashSimulationSeed(seed, key)).next();
}

export function addSimulationMinutes(value: number, minutes: number): number {
  return value + minutes * SIMULATION_MINUTE_MS;
}

export function toSimulationIso(value: number): string {
  return new Date(value).toISOString();
}

export function roundSimulationTick(value: number): number {
  return Math.ceil(value / SIMULATION_TICK_MS) * SIMULATION_TICK_MS;
}

export function roundSimulationValue(value: number): number {
  return Math.round(value * 100) / 100;
}
