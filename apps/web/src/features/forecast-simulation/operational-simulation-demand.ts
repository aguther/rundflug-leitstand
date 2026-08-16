import type { SimulationConfig } from "./model";
import {
  addSimulationMinutes,
  createSeededRandom,
  hashSimulationSeed,
  roundSimulationTick,
  SIMULATION_MINUTE_MS,
} from "./simulation-primitives";

export function productDemandArrivals(
  config: SimulationConfig,
  product: NonNullable<SimulationConfig["operationalModel"]>["products"][number],
  salesStartMs: number,
): Array<{ at: number; productId: string }> {
  const demand = config.demandByProduct?.[product.id];
  if (!demand) return [];
  const arrivals: Array<{ at: number; productId: string }> = [];
  const windows = [...demand.windows].sort(
    (left, right) =>
      left.startOffsetMinutes - right.startOffsetMinutes ||
      left.endOffsetMinutes - right.endOffsetMinutes,
  );
  for (const [index, window] of windows.entries()) {
    if (window.personsPerHour === 0) continue;
    const random = createSeededRandom(
      hashSimulationSeed(
        config.seed,
        `demand:${product.id}:${index}:${window.startOffsetMinutes}:${window.endOffsetMinutes}`,
      ),
    );
    const expectedGroupSize = (product.referenceCapacity + 1) / 2;
    const groupRatePerHour = window.personsPerHour / expectedGroupSize;
    const windowEndMs = addSimulationMinutes(salesStartMs, window.endOffsetMinutes);
    let arrivalMs = addSimulationMinutes(salesStartMs, window.startOffsetMinutes);
    while (arrivalMs < windowEndMs) {
      const draw = Math.max(Number.EPSILON, random.next());
      arrivalMs += (-Math.log(draw) / groupRatePerHour) * 60 * SIMULATION_MINUTE_MS;
      if (arrivalMs < windowEndMs) {
        const roundedArrivalMs = roundSimulationTick(arrivalMs);
        if (roundedArrivalMs < windowEndMs) {
          arrivals.push({ at: roundedArrivalMs, productId: product.id });
        }
      }
    }
  }
  return arrivals;
}
