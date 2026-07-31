export type TurnaroundPhase = "boarding" | "deboarding" | "buffer";
export type TurnaroundSourceLevel = "AIRCRAFT_PRODUCT" | "PRODUCT" | "EVENT";

export interface TurnaroundPhaseOverrides {
  boardingMinutes: number | null;
  deboardingMinutes: number | null;
  bufferMinutes: number | null;
}

export interface TurnaroundSourceInput extends TurnaroundPhaseOverrides {
  sourceId: string;
}

export interface ResolvedTurnaroundPhase {
  valueMinutes: number;
  sourceLevel: TurnaroundSourceLevel;
  sourceId: string;
}

export interface ResolvedTurnaroundProfile {
  boarding: ResolvedTurnaroundPhase;
  deboarding: ResolvedTurnaroundPhase;
  buffer: ResolvedTurnaroundPhase;
  totalGroundMinutes: number;
}

function resolvePhase(
  phase: TurnaroundPhase,
  event: TurnaroundSourceInput,
  product?: TurnaroundSourceInput,
  aircraftProduct?: TurnaroundSourceInput,
): ResolvedTurnaroundPhase {
  const field = `${phase}Minutes` as const;
  const aircraftValue = aircraftProduct?.[field];
  if (aircraftValue !== null && aircraftValue !== undefined) {
    return {
      valueMinutes: aircraftValue,
      sourceLevel: "AIRCRAFT_PRODUCT",
      sourceId: aircraftProduct?.sourceId ?? event.sourceId,
    };
  }
  const productValue = product?.[field];
  if (productValue !== null && productValue !== undefined) {
    return {
      valueMinutes: productValue,
      sourceLevel: "PRODUCT",
      sourceId: product?.sourceId ?? event.sourceId,
    };
  }
  return {
    valueMinutes: event[field] ?? 0,
    sourceLevel: "EVENT",
    sourceId: event.sourceId,
  };
}

export function resolveTurnaroundProfile(input: {
  event: TurnaroundSourceInput;
  product?: TurnaroundSourceInput;
  aircraftProduct?: TurnaroundSourceInput;
}): ResolvedTurnaroundProfile {
  const boarding = resolvePhase("boarding", input.event, input.product, input.aircraftProduct);
  const deboarding = resolvePhase("deboarding", input.event, input.product, input.aircraftProduct);
  const buffer = resolvePhase("buffer", input.event, input.product, input.aircraftProduct);
  return {
    boarding,
    deboarding,
    buffer,
    totalGroundMinutes: boarding.valueMinutes + deboarding.valueMinutes + buffer.valueMinutes,
  };
}
