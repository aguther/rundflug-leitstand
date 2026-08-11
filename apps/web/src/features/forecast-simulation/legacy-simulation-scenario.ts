import type { ForecastRotationStatus } from "@rundflug/domain";
import type {
  ManualIncident,
  SimulationAircraft,
  SimulationAircraftState,
  SimulationConfig,
  SimulationEventType,
  SimulationRotation,
} from "./model";
import {
  addSimulationMinutes as addMinutes,
  createSeededRandom,
  hashSimulationSeed,
  toSimulationIso as iso,
  SIMULATION_MINUTE_MS as MINUTE_MS,
  roundSimulationTick as roundedTick,
} from "./simulation-primitives";
export const PRODUCT_ID = "SYNTHETIC_ROUND_TRIP";
export const RESOURCE_GROUP_ID = "SIMULATION_FLEET";
export const EVENT_ID = "LOCAL_SIMULATION";

export interface RuntimeRotation extends SimulationRotation {
  status: ForecastRotationStatus | "COMPLETED";
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
}

export function dispatchPublicStatus(rotation: SimulationRotation) {
  if (rotation.precallStatus === "GO_TO_GATE" || rotation.precalledAt) {
    return "COME_TO_FLIGHT_LINE" as const;
  }
  return rotation.precallStatus === "PREPARE" ? ("PREPARE" as const) : ("WAITING" as const);
}

export interface PendingBlock {
  key: string;
  state: Exclude<SimulationAircraftState, "AVAILABLE" | "ACTIVE">;
  durationMinutes: number;
  dayOutage: boolean;
  source: "AUTOMATIC" | "MANUAL" | "PRESET";
}

export interface RuntimeAircraft extends SimulationAircraft {
  state: SimulationAircraftState;
  activeRotationId: string | null;
  blockedUntilMs: number | null;
  completedRotations: number;
  operatingMinutes: number;
  nextPauseAtMinutes: number;
  pendingBlocks: PendingBlock[];
}

export function createAircraft(config: SimulationConfig): RuntimeAircraft[] {
  return Array.from({ length: config.adminParameters.aircraftCount }, (_, index) => ({
    id: `aircraft-${index + 1}`,
    registration: `D-SIM${String(index + 1).padStart(2, "0")}`,
    aircraftType: config.adminParameters.aircraftType,
    capacity: config.adminParameters.passengerSeats,
    state: "AVAILABLE",
    activeRotationId: null,
    blockedUntilMs: null,
    completedRotations: 0,
    operatingMinutes: 0,
    nextPauseAtMinutes: 0,
    pendingBlocks: [],
  }));
}

export function createDemand(config: SimulationConfig): RuntimeRotation[] {
  const salesStartMs = Date.parse(config.schedule.salesStartAt);
  const groupSize = config.adminParameters.passengerSeats;
  const arrivalTimes: number[] = [];
  const windows = [...config.realityModel.demand.windows].sort(
    (left, right) =>
      left.startOffsetMinutes - right.startOffsetMinutes ||
      left.endOffsetMinutes - right.endOffsetMinutes,
  );
  for (const [index, window] of windows.entries()) {
    if (window.personsPerHour === 0) continue;
    const windowStartMs = addMinutes(salesStartMs, window.startOffsetMinutes);
    const windowEndMs = addMinutes(salesStartMs, window.endOffsetMinutes);
    const groupRatePerHour = window.personsPerHour / groupSize;
    const random = createSeededRandom(
      hashSimulationSeed(
        config.seed,
        `demand:${index}:${window.startOffsetMinutes}:${window.endOffsetMinutes}`,
      ),
    );
    let arrivalMs = windowStartMs;
    while (arrivalMs < windowEndMs) {
      const draw = Math.max(Number.EPSILON, random.next());
      arrivalMs += (-Math.log(draw) / groupRatePerHour) * 60 * MINUTE_MS;
      if (arrivalMs >= windowEndMs) break;
      arrivalTimes.push(roundedTick(arrivalMs));
    }
  }
  arrivalTimes.sort((left, right) => left - right);
  return arrivalTimes.map((arrivalMs, index) => {
    const sequence = index + 1;
    const id = `rotation-${String(sequence).padStart(3, "0")}`;
    return {
      id,
      communicationNumber: sequence,
      passengerCount: groupSize,
      createdAt: iso(roundedTick(arrivalMs)),
      precalledAt: null,
      precallTrigger: null,
      precallPredictionQuality: null,
      precallPredictedBoardingAt: null,
      precallAdaptiveLeadMinutes: null,
      precallStatus: "WAITING" as const,
      productId: PRODUCT_ID,
      productName: "Rundflug Simulation",
      productCode: PRODUCT_ID,
      resourceGroupId: RESOURCE_GROUP_ID,
      gateLabel: "Simulation Gate",
      aircraftId: null,
      calledAt: null,
      departedAt: null,
      landedAt: null,
      completedAt: null,
      boardingMinutes: null,
      flightMinutes: null,
      deboardingMinutes: null,
      bufferMinutes: null,
      status: "DRAFT",
      predictedDepartureAt: null,
      predictedLandingAt: null,
      predictedCompletionAt: null,
    };
  });
}

export function presetIncidents(config: SimulationConfig): ManualIncident[] {
  const atMs = addMinutes(Date.parse(config.schedule.operationsStartAt), 120);
  if (atMs >= Date.parse(config.schedule.operationsEndAt)) return [];
  const at = iso(atMs);
  if (config.preset === "AIRCRAFT_FAILURE") {
    return [
      {
        id: "preset-aircraft-failure",
        type: "TECHNICAL_DEFECT",
        at,
        aircraftId: "aircraft-2",
        durationMinutes: 0,
        dayOutage: true,
      },
    ];
  }
  if (config.preset === "OPERATION_INTERRUPTION") {
    return [
      {
        id: "preset-event-interruption",
        type: "EVENT_INTERRUPTION",
        at,
        aircraftId: null,
        durationMinutes: 30,
        dayOutage: false,
      },
    ];
  }
  return [];
}

export function eventTypeForBlock(state: PendingBlock["state"]): SimulationEventType {
  if (state === "REFUELING") return "REFUELING_STARTED";
  if (state === "PLANNED_PAUSE") return "PLANNED_PAUSE_STARTED";
  if (state === "UNPLANNED_PAUSE") return "UNPLANNED_PAUSE_STARTED";
  if (state === "DAY_OUT") return "AIRCRAFT_DAY_OUT";
  return "TECHNICAL_DEFECT_REPORTED";
}

export function incidentToBlock(
  incident: ManualIncident,
  source: PendingBlock["source"],
): PendingBlock {
  const state: PendingBlock["state"] =
    incident.type === "REFUELING"
      ? "REFUELING"
      : incident.type === "UNPLANNED_PAUSE"
        ? "UNPLANNED_PAUSE"
        : incident.dayOutage
          ? "DAY_OUT"
          : "TECHNICAL_DEFECT";
  return {
    key: incident.id,
    state,
    durationMinutes: incident.durationMinutes,
    dayOutage: incident.dayOutage,
    source,
  };
}

export function publicRotation(rotation: RuntimeRotation): SimulationRotation {
  const {
    status: _status,
    predictedDepartureAt: _predictedDepartureAt,
    predictedLandingAt: _predictedLandingAt,
    predictedCompletionAt: _predictedCompletionAt,
    ...result
  } = rotation;
  return result;
}
