export const MAX_SIMULATION_SEED = 4_294_967_295;

export function advanceSimulationSeed(seedStart: number, offset: number): number {
  return ((seedStart - 1 + offset) % MAX_SIMULATION_SEED) + 1;
}

export function simulationQuantile(values: readonly number[], probability: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  return lower + (upper - lower) * (position - lowerIndex);
}
