import type { ForecastRotationStatus } from "@rundflug/domain";
import type {
  SimulationAircraft,
  SimulationAircraftState,
  SimulationConfig,
  SimulationDispatchDiagnostics,
  SimulationEvent,
  SimulationEventType,
  SimulationForecastSnapshot,
  SimulationMetrics,
  SimulationPilot,
  SimulationPlannedOperation,
  SimulationRecurringOperationalRule,
  SimulationRotation,
} from "./model";
import {
  addSimulationMinutes as addMinutes,
  createSeededRandom,
  deterministicChance,
  hashSimulationSeed,
  toSimulationIso as iso,
  SIMULATION_MINUTE_MS as MINUTE_MS,
  roundSimulationTick as roundedTick,
} from "./simulation-primitives";
export const EVENT_ID = "LOCAL_OPERATIONAL_SIMULATION";

export interface OperationalRotation extends SimulationRotation {
  status: ForecastRotationStatus | "COMPLETED";
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
  slowdownMultiplierPercent: number;
}

export function dispatchPublicStatus(rotation: SimulationRotation) {
  if (rotation.precallStatus === "GO_TO_GATE" || rotation.precalledAt) {
    return "COME_TO_FLIGHT_LINE" as const;
  }
  return rotation.precallStatus === "PREPARE" ? ("PREPARE" as const) : ("WAITING" as const);
}

export interface OperationalAircraft extends SimulationAircraft {
  state: SimulationAircraftState;
  activeRotationId: string | null;
  blockedUntilMs: number | null;
  completedRotations: number;
  operatingMinutes: number;
  pendingBlocks: OperationalBlock[];
}

export interface OperationalPilot extends SimulationPilot {
  activeRotationId: string | null;
}

export interface OperationalBlock {
  key: string;
  state: Exclude<SimulationAircraftState, "AVAILABLE" | "ACTIVE">;
  durationMinutes: number;
  dayOutage: boolean;
  source: "AUTOMATIC" | "MANUAL";
}

export interface OperationalPlan extends SimulationPlannedOperation {
  candidateStartMs: number | null;
  actualStartMs: number | null;
  actualEndMs: number | null;
  completed: boolean;
  recurringRuleKey: string | null;
}

export interface OperationalRecurringRule extends SimulationRecurringOperationalRule {
  currentProgress: number;
  sequenceNumber: number;
}

export type OperationalSimulationEventRecorder = (
  type: SimulationEventType,
  occurredAtMs: number,
  options: {
    aircraftId?: string | null;
    pilotId?: string | null;
    plannedOperationId?: string | null;
    rotationId?: string | null;
    details: string;
  },
) => void;

export type MetricsCalculator = (input: {
  rotations: readonly SimulationRotation[];
  snapshots: readonly SimulationForecastSnapshot[];
  events: readonly SimulationEvent[];
  operationsStartAt?: string;
  operationsEndAt?: string;
  aircraftCount?: number;
  dispatchDiagnostics?: SimulationDispatchDiagnostics;
}) => SimulationMetrics;

export function createOperationalDemand(config: SimulationConfig): OperationalRotation[] {
  const model = config.operationalModel;
  if (!model) return [];
  const salesStartMs = Date.parse(config.schedule.salesStartAt);
  const arrivals: Array<{ at: number; productId: string }> = [];
  for (const product of model.products) {
    const demand = config.demandByProduct?.[product.id];
    if (!demand) continue;
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
      const windowEndMs = addMinutes(salesStartMs, window.endOffsetMinutes);
      let arrivalMs = addMinutes(salesStartMs, window.startOffsetMinutes);
      while (arrivalMs < windowEndMs) {
        const draw = Math.max(Number.EPSILON, random.next());
        arrivalMs += (-Math.log(draw) / groupRatePerHour) * 60 * MINUTE_MS;
        if (arrivalMs < windowEndMs) {
          arrivals.push({ at: roundedTick(arrivalMs), productId: product.id });
        }
      }
    }
  }
  arrivals.sort(
    (left, right) => left.at - right.at || left.productId.localeCompare(right.productId),
  );
  return arrivals.map((arrival, index) => {
    const product = model.products.find((entry) => entry.id === arrival.productId);
    if (!product) {
      throw new Error(`Die Nachfrage verweist auf ein unbekanntes Produkt (${arrival.productId}).`);
    }
    const gate = model.gates.find((entry) => entry.id === product?.gateId);
    const sequence = index + 1;
    return {
      id: `rotation-${String(sequence).padStart(3, "0")}`,
      communicationNumber: sequence,
      passengerCount:
        1 +
        Math.floor(
          deterministicChance(config.seed, `group-size:${product.id}:${sequence}`) *
            product.referenceCapacity,
        ),
      createdAt: iso(arrival.at),
      precalledAt: null,
      precallTrigger: null,
      precallPredictionQuality: null,
      precallPredictedBoardingAt: null,
      precallAdaptiveLeadMinutes: null,
      aircraftId: null,
      pilotId: null,
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      resourceGroupId: product.resourceGroupId,
      ...(gate ? { gateLabel: gate.label } : {}),
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
      slowdownMultiplierPercent: 100,
    };
  });
}

export function createOperationalPlans(config: SimulationConfig): OperationalPlan[] {
  return config.plannedOperations.map((entry) => {
    let candidateStartMs: number | null = null;
    if (entry.startMode === "TIME_WINDOW" && entry.earliestStartAt && entry.latestStartAt) {
      const earliest = Date.parse(entry.earliestStartAt);
      const latest = Date.parse(entry.latestStartAt);
      candidateStartMs = roundedTick(
        earliest +
          deterministicChance(config.seed, `${entry.key}:start`) * Math.max(0, latest - earliest),
      );
    }
    return {
      ...structuredClone(entry),
      candidateStartMs,
      actualStartMs: null,
      actualEndMs: null,
      completed: false,
      recurringRuleKey: null,
    };
  });
}

export function eventTypeForBlock(state: OperationalBlock["state"]): SimulationEventType {
  if (state === "REFUELING") return "REFUELING_STARTED";
  if (state === "PLANNED_PAUSE") return "PLANNED_PAUSE_STARTED";
  if (state === "UNPLANNED_PAUSE") return "UNPLANNED_PAUSE_STARTED";
  if (state === "DAY_OUT") return "AIRCRAFT_DAY_OUT";
  return "TECHNICAL_DEFECT_REPORTED";
}

export function publicRotation(rotation: OperationalRotation): SimulationRotation {
  const {
    status: _status,
    predictedDepartureAt: _predictedDepartureAt,
    predictedLandingAt: _predictedLandingAt,
    predictedCompletionAt: _predictedCompletionAt,
    slowdownMultiplierPercent: _slowdownMultiplierPercent,
    ...result
  } = rotation;
  return result;
}

export function planAppliesToGroup(
  plan: OperationalPlan,
  groupId: string,
  aircraft: readonly OperationalAircraft[],
): boolean {
  if (plan.scopeType === "EVENT") return true;
  if (plan.scopeType === "RESOURCE_GROUP") return plan.scopeId === groupId;
  if (plan.scopeType === "AIRCRAFT") {
    return aircraft.some((entry) => entry.id === plan.scopeId && entry.resourceGroupId === groupId);
  }
  return plan.scopeType === "PILOT";
}
