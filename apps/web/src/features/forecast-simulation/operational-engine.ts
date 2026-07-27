import {
  calculateForecastTimelines,
  deriveAdaptivePrecallLeadMinutes,
  type ForecastRotationStatus,
  planNextRotations,
  selectAutomaticPrecalls,
} from "@rundflug/domain";

import type {
  ManualIncident,
  SimulationAircraft,
  SimulationAircraftState,
  SimulationConfig,
  SimulationEvent,
  SimulationEventType,
  SimulationForecastSnapshot,
  SimulationMetrics,
  SimulationPilot,
  SimulationPlannedOperation,
  SimulationRecurringOperationalRule,
  SimulationResult,
  SimulationRotation,
  TriangularDistribution,
} from "./model";

const TICK_MS = 30_000;
const MINUTE_MS = 60_000;
const EVENT_ID = "LOCAL_OPERATIONAL_SIMULATION";

interface RandomSource {
  next(): number;
}

interface OperationalRotation extends SimulationRotation {
  status: ForecastRotationStatus | "COMPLETED";
  predictedDepartureAt: string | null;
  predictedLandingAt: string | null;
  predictedCompletionAt: string | null;
  slowdownMultiplierPercent: number;
}

interface OperationalAircraft extends SimulationAircraft {
  state: SimulationAircraftState;
  activeRotationId: string | null;
  blockedUntilMs: number | null;
  completedRotations: number;
  operatingMinutes: number;
  pendingBlocks: OperationalBlock[];
}

interface OperationalPilot extends SimulationPilot {
  activeRotationId: string | null;
}

interface OperationalBlock {
  key: string;
  state: Exclude<SimulationAircraftState, "AVAILABLE" | "ACTIVE">;
  durationMinutes: number;
  dayOutage: boolean;
  source: "AUTOMATIC" | "MANUAL";
}

interface OperationalPlan extends SimulationPlannedOperation {
  candidateStartMs: number | null;
  actualStartMs: number | null;
  actualEndMs: number | null;
  completed: boolean;
  recurringRuleKey: string | null;
}

interface OperationalRecurringRule extends SimulationRecurringOperationalRule {
  currentProgress: number;
  sequenceNumber: number;
}

type MetricsCalculator = (input: {
  rotations: readonly SimulationRotation[];
  snapshots: readonly SimulationForecastSnapshot[];
  events: readonly SimulationEvent[];
  operationsStartAt?: string;
  operationsEndAt?: string;
  aircraftCount?: number;
}) => SimulationMetrics;

function mulberry32(seed: number): RandomSource {
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

function hashSeed(seed: number, key: string): number {
  let hash = (2_166_136_261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash || 1;
}

function sampleTriangular(distribution: TriangularDistribution, randomValue: number): number {
  const { minimum, typical, maximum } = distribution;
  if (maximum === minimum) return minimum;
  const bounded = Math.min(1 - Number.EPSILON, Math.max(0, randomValue));
  const split = (typical - minimum) / (maximum - minimum);
  if (bounded < split) {
    return minimum + Math.sqrt(bounded * (maximum - minimum) * (typical - minimum));
  }
  return maximum - Math.sqrt((1 - bounded) * (maximum - minimum) * (maximum - typical));
}

function deterministicSample(
  seed: number,
  key: string,
  distribution: TriangularDistribution,
): number {
  return sampleTriangular(distribution, mulberry32(hashSeed(seed, key)).next());
}

function deterministicChance(seed: number, key: string): number {
  return mulberry32(hashSeed(seed, key)).next();
}

function roundedTick(value: number): number {
  return Math.ceil(value / TICK_MS) * TICK_MS;
}

function addMinutes(value: number, minutes: number): number {
  return value + minutes * MINUTE_MS;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function createOperationalDemand(config: SimulationConfig): OperationalRotation[] {
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
      const random = mulberry32(
        hashSeed(
          config.seed,
          `demand:${product.id}:${index}:${window.startOffsetMinutes}:${window.endOffsetMinutes}`,
        ),
      );
      const groupRatePerHour = window.personsPerHour / product.referenceCapacity;
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
      passengerCount: product?.referenceCapacity ?? 1,
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

function createOperationalPlans(config: SimulationConfig): OperationalPlan[] {
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

function eventTypeForBlock(state: OperationalBlock["state"]): SimulationEventType {
  if (state === "REFUELING") return "REFUELING_STARTED";
  if (state === "PLANNED_PAUSE") return "PLANNED_PAUSE_STARTED";
  if (state === "UNPLANNED_PAUSE") return "UNPLANNED_PAUSE_STARTED";
  if (state === "DAY_OUT") return "AIRCRAFT_DAY_OUT";
  return "TECHNICAL_DEFECT_REPORTED";
}

function publicRotation(rotation: OperationalRotation): SimulationRotation {
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

function planAppliesToGroup(
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

export function runOperationalSimulation(
  config: SimulationConfig,
  manualIncidents: readonly ManualIncident[],
  calculateMetrics: MetricsCalculator,
): SimulationResult {
  const model = config.operationalModel;
  if (!model) throw new Error("Operative Simulationsdaten fehlen.");
  const operationsStartMs = Date.parse(config.schedule.operationsStartAt);
  const operationsEndMs = Date.parse(config.schedule.operationsEndAt);
  const runStartMs = Math.min(Date.parse(config.schedule.salesStartAt), operationsStartMs);
  let runEndMs = operationsEndMs;
  const rotations = createOperationalDemand(config);
  const missingReferencePlan = config.plannedOperations.find(
    (entry) =>
      entry.startMode === "AFTER_CURRENT_ROTATION" &&
      entry.afterRotationId !== null &&
      !rotations.some((rotation) => rotation.id === entry.afterRotationId),
  );
  if (missingReferencePlan) {
    throw new Error(
      `Planeintrag ${missingReferencePlan.key} verweist auf keinen Umlauf dieses synthetischen Laufs.`,
    );
  }
  const aircraft: OperationalAircraft[] = model.aircraft.map((entry) => ({
    ...structuredClone(entry),
    state: "AVAILABLE",
    activeRotationId: null,
    blockedUntilMs: null,
    completedRotations: 0,
    operatingMinutes: 0,
    pendingBlocks: [],
  }));
  const pilots: OperationalPilot[] = model.pilots.map((entry) => ({
    ...structuredClone(entry),
    activeRotationId: null,
  }));
  const plans = createOperationalPlans(config);
  const recurringRules: OperationalRecurringRule[] = (config.recurringRules ?? []).map((rule) => ({
    ...structuredClone(rule),
    currentProgress: rule.progressValue,
    sequenceNumber: 0,
  }));
  const events: SimulationEvent[] = [];
  const snapshots: SimulationForecastSnapshot[] = [];
  const processedIncidentIds = new Set<string>();
  const recordedIncidentBoundaries = new Set<string>();
  let eventSequence = 0;

  const recordEvent = (
    type: SimulationEventType,
    occurredAtMs: number,
    options: {
      aircraftId?: string | null;
      pilotId?: string | null;
      plannedOperationId?: string | null;
      rotationId?: string | null;
      details: string;
    },
  ) => {
    eventSequence += 1;
    events.push({
      id: `sim-event-${String(eventSequence).padStart(5, "0")}`,
      type,
      occurredAt: iso(occurredAtMs),
      aircraftId: options.aircraftId ?? null,
      pilotId: options.pilotId ?? null,
      plannedOperationId: options.plannedOperationId ?? null,
      rotationId: options.rotationId ?? null,
      details: options.details,
      forecastRecalculatedAt: iso(occurredAtMs),
    });
  };

  const planIsActive = (plan: OperationalPlan, nowMs: number) =>
    plan.actualStartMs !== null &&
    plan.actualEndMs !== null &&
    nowMs >= plan.actualStartMs &&
    nowMs < plan.actualEndMs;

  const activePlanFor = (
    scopeType: SimulationPlannedOperation["scopeType"],
    scopeId: string,
    nowMs: number,
  ) =>
    plans.some(
      (plan) =>
        (plan.effectMode ?? "BLOCKING") === "BLOCKING" &&
        plan.scopeType === scopeType &&
        plan.scopeId === scopeId &&
        planIsActive(plan, nowMs),
    );

  const planAppliesToRotation = (plan: OperationalPlan, rotation: OperationalRotation) =>
    plan.scopeType === "EVENT" ||
    (plan.scopeType === "RESOURCE_GROUP" && plan.scopeId === rotation.resourceGroupId) ||
    (plan.scopeType === "AIRCRAFT" && plan.scopeId === rotation.aircraftId) ||
    (plan.scopeType === "PILOT" && plan.scopeId === rotation.pilotId);

  const activeSlowdownPercent = (rotation: OperationalRotation, nowMs: number) =>
    plans.reduce(
      (maximum, plan) =>
        (plan.effectMode ?? "BLOCKING") === "SLOWDOWN" &&
        planIsActive(plan, nowMs) &&
        planAppliesToRotation(plan, rotation)
          ? Math.max(maximum, plan.durationMultiplierPercent ?? 150)
          : maximum,
      100,
    );

  const applySlowdownToRemainingPhases = (
    rotation: OperationalRotation,
    targetMultiplierPercent: number,
  ) => {
    if (targetMultiplierPercent <= rotation.slowdownMultiplierPercent) return;
    const ratio = targetMultiplierPercent / rotation.slowdownMultiplierPercent;
    if (rotation.status === "CALLED" && rotation.boardingMinutes !== null) {
      rotation.boardingMinutes *= ratio;
    }
    if (
      (rotation.status === "CALLED" || rotation.status === "IN_FLIGHT") &&
      rotation.flightMinutes !== null
    ) {
      rotation.flightMinutes *= ratio;
    }
    if (
      ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status) &&
      rotation.deboardingMinutes !== null &&
      rotation.bufferMinutes !== null
    ) {
      rotation.deboardingMinutes *= ratio;
      rotation.bufferMinutes *= ratio;
    }
    rotation.slowdownMultiplierPercent = targetMultiplierPercent;
  };

  const globalIncidentActive = (nowMs: number) =>
    manualIncidents.some(
      (entry) =>
        entry.type === "EVENT_INTERRUPTION" &&
        nowMs >= roundedTick(Date.parse(entry.at)) &&
        nowMs < roundedTick(addMinutes(Date.parse(entry.at), entry.durationMinutes)),
    );

  const operationsGloballyAvailable = (nowMs: number) =>
    nowMs >= operationsStartMs &&
    nowMs < operationsEndMs &&
    !globalIncidentActive(nowMs) &&
    !activePlanFor("EVENT", "event", nowMs);

  const groupAvailable = (groupId: string, nowMs: number) =>
    operationsGloballyAvailable(nowMs) && !activePlanFor("RESOURCE_GROUP", groupId, nowMs);

  const pilotAvailable = (pilot: OperationalPilot, nowMs: number) =>
    pilot.active && pilot.activeRotationId === null && !activePlanFor("PILOT", pilot.id, nowMs);

  const aircraftAvailable = (entry: OperationalAircraft, nowMs: number) =>
    entry.state === "AVAILABLE" &&
    entry.activeRotationId === null &&
    !activePlanFor("AIRCRAFT", entry.id, nowMs);

  const startBlock = (entry: OperationalAircraft, block: OperationalBlock, nowMs: number) => {
    entry.state = block.dayOutage ? "DAY_OUT" : block.state;
    entry.blockedUntilMs = block.dayOutage ? null : addMinutes(nowMs, block.durationMinutes);
    recordEvent(eventTypeForBlock(entry.state as OperationalBlock["state"]), nowMs, {
      aircraftId: entry.id,
      details: block.dayOutage
        ? "Simulierter Tagesausfall an zulässiger organisatorischer Grenze bestätigt."
        : `${block.source === "AUTOMATIC" ? "Automatisch erzeugte" : "Manuell injizierte"} Sperre für ${Math.round(block.durationMinutes)} Minuten.`,
    });
  };

  const projectionAt = (nowMs: number) => {
    const open = rotations.filter(
      (rotation) => rotation.status !== "COMPLETED" && Date.parse(rotation.createdAt) <= nowMs,
    );
    const queueSequences = new Map<string, number>();
    for (const group of model.resourceGroups) {
      open
        .filter((rotation) => rotation.resourceGroupId === group.id && rotation.status === "DRAFT")
        .sort(
          (left, right) =>
            Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.communicationNumber - right.communicationNumber,
        )
        .forEach((rotation, index) => {
          queueSequences.set(rotation.id, index + 1);
        });
    }
    const durationSamples = rotations.flatMap((rotation) =>
      rotation.completedAt && rotation.calledAt && rotation.slowdownMultiplierPercent === 100
        ? [
            {
              minutes:
                (Date.parse(rotation.completedAt) - Date.parse(rotation.calledAt)) / MINUTE_MS,
              completedAt: rotation.completedAt,
              eventId: EVENT_ID,
              productCode: rotation.productCode ?? "SIM",
              aircraftType: rotation.aircraftId
                ? (aircraft.find((entry) => entry.id === rotation.aircraftId)?.aircraftType ?? null)
                : null,
            },
          ]
        : [],
    );
    const capacities = model.resourceGroups.map((group) => {
      const groupAircraft = aircraft.filter(
        (entry) => entry.resourceGroupId === group.id && entry.state !== "DAY_OUT",
      );
      const sharedConstraints = plans
        .filter(
          (plan) =>
            !plan.completed &&
            ((plan.effectMode ?? "BLOCKING") === "SLOWDOWN" || plan.actualStartMs === null) &&
            plan.startMode === "TIME_WINDOW" &&
            plan.earliestStartAt &&
            plan.latestStartAt &&
            planAppliesToGroup(plan, group.id, aircraft) &&
            plan.scopeType !== "AIRCRAFT",
        )
        .map((plan) => ({
          id: plan.key,
          earliestStartAt:
            plan.actualStartMs !== null
              ? iso(plan.actualStartMs)
              : (plan.earliestStartAt ?? iso(nowMs)),
          latestStartAt:
            plan.actualStartMs !== null
              ? iso(plan.actualStartMs)
              : (plan.latestStartAt ?? iso(nowMs)),
          minimumDurationMinutes: plan.minimumDurationMinutes,
          typicalDurationMinutes: plan.typicalDurationMinutes,
          maximumDurationMinutes: plan.maximumDurationMinutes,
          effectMode: plan.effectMode ?? "BLOCKING",
          durationMultiplierPercent: plan.durationMultiplierPercent ?? null,
          active: planIsActive(plan, nowMs),
          overdue: Date.parse(plan.latestStartAt ?? iso(nowMs)) < nowMs,
        }));
      const orderedPilots = [...pilots]
        .filter((pilot) => pilot.active)
        .sort((left, right) => left.id.localeCompare(right.id));
      const availabilityLanes = groupAircraft.map((entry, laneIndex) => {
        const activeRotation = entry.activeRotationId
          ? rotations.find((rotation) => rotation.id === entry.activeRotationId)
          : null;
        const lanePilot =
          (activeRotation?.pilotId
            ? pilots.find((pilot) => pilot.id === activeRotation.pilotId)
            : null) ?? orderedPilots[laneIndex % Math.max(1, orderedPilots.length)];
        const activeAircraftPlan = plans.find(
          (plan) =>
            (plan.effectMode ?? "BLOCKING") === "BLOCKING" &&
            plan.scopeType === "AIRCRAFT" &&
            plan.scopeId === entry.id &&
            planIsActive(plan, nowMs),
        );
        const expectedAt = Math.max(
          nowMs,
          entry.blockedUntilMs ?? 0,
          activeAircraftPlan?.actualEndMs ?? 0,
          plans.find(
            (plan) =>
              (plan.effectMode ?? "BLOCKING") === "BLOCKING" &&
              plan.scopeType === "PILOT" &&
              plan.scopeId === lanePilot?.id &&
              planIsActive(plan, nowMs),
          )?.actualEndMs ?? 0,
          activeRotation?.predictedCompletionAt
            ? Date.parse(activeRotation.predictedCompletionAt)
            : 0,
        );
        const constraints = plans
          .filter(
            (plan) =>
              !plan.completed &&
              ((plan.effectMode ?? "BLOCKING") === "SLOWDOWN" || plan.actualStartMs === null) &&
              plan.scopeType === "AIRCRAFT" &&
              plan.scopeId === entry.id &&
              plan.startMode === "TIME_WINDOW" &&
              plan.earliestStartAt &&
              plan.latestStartAt,
          )
          .map((plan) => ({
            id: plan.key,
            earliestStartAt:
              plan.actualStartMs !== null
                ? iso(plan.actualStartMs)
                : (plan.earliestStartAt ?? iso(nowMs)),
            latestStartAt:
              plan.actualStartMs !== null
                ? iso(plan.actualStartMs)
                : (plan.latestStartAt ?? iso(nowMs)),
            minimumDurationMinutes: plan.minimumDurationMinutes,
            typicalDurationMinutes: plan.typicalDurationMinutes,
            maximumDurationMinutes: plan.maximumDurationMinutes,
            effectMode: plan.effectMode ?? "BLOCKING",
            durationMultiplierPercent: plan.durationMultiplierPercent ?? null,
            active: planIsActive(plan, nowMs),
            overdue: Date.parse(plan.latestStartAt ?? iso(nowMs)) < nowMs,
          }));
        return {
          laneId: entry.id,
          availableLowerAt: iso(expectedAt),
          availableExpectedAt: iso(expectedAt),
          availableUpperAt: iso(expectedAt + (expectedAt > nowMs ? 5 * MINUTE_MS : 0)),
          constraints,
          recurringConstraints: recurringRules
            .filter(
              (rule) =>
                (rule.scopeType === "AIRCRAFT" && rule.scopeId === entry.id) ||
                (rule.scopeType === "PILOT" && rule.scopeId === lanePilot?.id),
            )
            .map((rule) => ({
              id: rule.key,
              triggerMetric: rule.triggerMetric,
              intervalValue: rule.intervalValue,
              progressValue: plans.some(
                (plan) => plan.recurringRuleKey === rule.key && !plan.completed,
              )
                ? 0
                : rule.currentProgress,
              minimumDurationMinutes: rule.minimumDurationMinutes,
              typicalDurationMinutes: rule.typicalDurationMinutes,
              maximumDurationMinutes: rule.maximumDurationMinutes,
              active: true,
            })),
        };
      });
      const activePilotCapacity = pilots.filter(
        (pilot) => pilot.active && !activePlanFor("PILOT", pilot.id, nowMs),
      ).length;
      return {
        resourceGroupId: group.id,
        activeAircraft: groupAvailable(group.id, nowMs)
          ? Math.min(groupAircraft.length, activePilotCapacity)
          : 0,
        ...(config.forecastTuning.availabilityModel === "TIME_DEPENDENT"
          ? { availabilityLanes, sharedConstraints }
          : {}),
      };
    });
    return calculateForecastTimelines({
      event: {
        eventId: EVENT_ID,
        now: iso(nowMs),
        plannedOperationsStartAt:
          config.forecastTuning.availabilityModel === "TIME_DEPENDENT"
            ? config.schedule.operationsStartAt
            : null,
        plannedOperationsEndAt: config.schedule.operationsEndAt,
        operationalInterrupted: !operationsGloballyAvailable(nowMs),
        emergencyMode: false,
        plannedBoardingMinutes: config.adminParameters.plannedBoardingMinutes,
        plannedDeboardingMinutes: config.adminParameters.plannedDeboardingMinutes,
        plannedBufferMinutes: config.adminParameters.plannedBufferMinutes,
      },
      rotations: open.map((rotation) => {
        const product = model.products.find((entry) => entry.id === rotation.productId);
        const groupId = rotation.resourceGroupId ?? "";
        return {
          id: rotation.id,
          status: rotation.status as ForecastRotationStatus,
          createdAt: rotation.createdAt,
          calledAt: rotation.calledAt,
          departedAt: rotation.departedAt,
          landedAt: rotation.landedAt,
          resourceGroupId: groupId,
          aircraftId: rotation.aircraftId,
          pilotId: rotation.pilotId ?? null,
          resourceGroupStatus: groupAvailable(groupId, nowMs)
            ? ("ACTIVE" as const)
            : ("PAUSED" as const),
          queueSequence: queueSequences.get(rotation.id) ?? 1,
          referenceDurationMinutes:
            product?.referenceDurationMinutes ??
            config.adminParameters.productReferenceDurationMinutes,
          productCode: rotation.productCode ?? "SIM",
          aircraftType: rotation.aircraftId
            ? (aircraft.find((entry) => entry.id === rotation.aircraftId)?.aircraftType ?? null)
            : null,
          predictedDepartureAt: rotation.predictedDepartureAt,
          predictedLandingAt: rotation.predictedLandingAt,
          predictedCompletionAt: rotation.predictedCompletionAt,
          constraints: plans
            .filter(
              (plan) =>
                !plan.completed &&
                plan.startMode === "TIME_WINDOW" &&
                plan.earliestStartAt &&
                plan.latestStartAt &&
                planAppliesToRotation(plan, rotation),
            )
            .map((plan) => ({
              id: plan.key,
              earliestStartAt:
                plan.actualStartMs !== null
                  ? iso(plan.actualStartMs)
                  : (plan.earliestStartAt ?? iso(nowMs)),
              latestStartAt:
                plan.actualStartMs !== null
                  ? iso(plan.actualStartMs)
                  : (plan.latestStartAt ?? iso(nowMs)),
              minimumDurationMinutes: plan.minimumDurationMinutes,
              typicalDurationMinutes: plan.typicalDurationMinutes,
              maximumDurationMinutes: plan.maximumDurationMinutes,
              effectMode: plan.effectMode ?? "BLOCKING",
              durationMultiplierPercent: plan.durationMultiplierPercent ?? null,
              active: planIsActive(plan, nowMs),
              overdue: Date.parse(plan.latestStartAt ?? iso(nowMs)) < nowMs,
            })),
        };
      }),
      durationSamples,
      capacities,
      tuning: config.forecastTuning.forecast,
    });
  };

  for (let nowMs = runStartMs; ; nowMs += TICK_MS) {
    for (const incident of manualIncidents) {
      const startsAt = roundedTick(Date.parse(incident.at));
      if (
        incident.type === "EVENT_INTERRUPTION" &&
        nowMs >= startsAt &&
        !recordedIncidentBoundaries.has(`${incident.id}:start`)
      ) {
        recordedIncidentBoundaries.add(`${incident.id}:start`);
        recordEvent("EVENT_INTERRUPTED", nowMs, {
          details: "Simulierte globale Betriebsunterbrechung bestätigt.",
        });
      }
      const endsAt = roundedTick(addMinutes(Date.parse(incident.at), incident.durationMinutes));
      if (
        incident.type === "EVENT_INTERRUPTION" &&
        nowMs >= endsAt &&
        !recordedIncidentBoundaries.has(`${incident.id}:end`)
      ) {
        recordedIncidentBoundaries.add(`${incident.id}:end`);
        recordEvent("EVENT_RESUMED", nowMs, {
          details: "Simulierte Wiederaufnahme des Betriebs bestätigt.",
        });
      }
      if (
        incident.type !== "EVENT_INTERRUPTION" &&
        nowMs >= startsAt &&
        !processedIncidentIds.has(incident.id)
      ) {
        const entry = aircraft.find((candidate) => candidate.id === incident.aircraftId);
        processedIncidentIds.add(incident.id);
        if (entry) {
          const block: OperationalBlock = {
            key: incident.id,
            state:
              incident.type === "REFUELING"
                ? "REFUELING"
                : incident.type === "UNPLANNED_PAUSE"
                  ? "UNPLANNED_PAUSE"
                  : incident.dayOutage
                    ? "DAY_OUT"
                    : "TECHNICAL_DEFECT",
            durationMinutes: incident.durationMinutes,
            dayOutage: incident.dayOutage,
            source: "MANUAL",
          };
          if (entry.activeRotationId === null && entry.state === "AVAILABLE") {
            startBlock(entry, block, nowMs);
          } else {
            entry.pendingBlocks.push(block);
          }
        }
      }
    }

    for (const plan of plans) {
      if (
        plan.actualStartMs !== null &&
        plan.actualEndMs !== null &&
        nowMs >= plan.actualEndMs &&
        !plan.completed
      ) {
        plan.completed = true;
        if (plan.recurringRuleKey) {
          const rule = recurringRules.find((entry) => entry.key === plan.recurringRuleKey);
          if (rule) rule.currentProgress = 0;
        }
        recordEvent("PLANNED_OPERATION_ENDED", nowMs, {
          aircraftId: plan.scopeType === "AIRCRAFT" ? plan.scopeId : null,
          pilotId: plan.scopeType === "PILOT" ? plan.scopeId : null,
          plannedOperationId: plan.key,
          details: `Geplanter Eintrag ${plan.kind} beendet.`,
        });
      }
    }

    for (const rotation of rotations) {
      if (
        rotation.status === "CALLED" &&
        rotation.calledAt &&
        rotation.boardingMinutes !== null &&
        nowMs >= roundedTick(addMinutes(Date.parse(rotation.calledAt), rotation.boardingMinutes))
      ) {
        rotation.status = "IN_FLIGHT";
        rotation.departedAt = iso(nowMs);
        recordEvent("ROTATION_DEPARTED", nowMs, {
          aircraftId: rotation.aircraftId,
          pilotId: rotation.pilotId ?? null,
          rotationId: rotation.id,
          details: "Start bestätigt.",
        });
      }
      if (
        rotation.status === "IN_FLIGHT" &&
        rotation.departedAt &&
        rotation.flightMinutes !== null &&
        nowMs >= roundedTick(addMinutes(Date.parse(rotation.departedAt), rotation.flightMinutes))
      ) {
        rotation.status = "LANDED";
        rotation.landedAt = iso(nowMs);
        recordEvent("ROTATION_LANDED", nowMs, {
          aircraftId: rotation.aircraftId,
          pilotId: rotation.pilotId ?? null,
          rotationId: rotation.id,
          details: "Landung bestätigt; Ressource bleibt bis zum Abschluss gebunden.",
        });
      }
      if (
        rotation.status === "LANDED" &&
        rotation.landedAt &&
        rotation.deboardingMinutes !== null &&
        rotation.bufferMinutes !== null &&
        nowMs >=
          roundedTick(
            addMinutes(
              Date.parse(rotation.landedAt),
              rotation.deboardingMinutes + rotation.bufferMinutes,
            ),
          )
      ) {
        rotation.status = "COMPLETED";
        rotation.completedAt = iso(nowMs);
        const entry = aircraft.find((candidate) => candidate.id === rotation.aircraftId);
        const pilot = pilots.find((candidate) => candidate.id === rotation.pilotId);
        if (entry) {
          entry.state = "AVAILABLE";
          entry.activeRotationId = null;
          entry.completedRotations += 1;
          entry.operatingMinutes +=
            (rotation.boardingMinutes ?? 0) +
            (rotation.flightMinutes ?? 0) +
            (rotation.deboardingMinutes ?? 0) +
            (rotation.bufferMinutes ?? 0);
          const rotationOperatingMinutes =
            (rotation.boardingMinutes ?? 0) +
            (rotation.flightMinutes ?? 0) +
            (rotation.deboardingMinutes ?? 0) +
            (rotation.bufferMinutes ?? 0);
          const dueRules = recurringRules.filter(
            (rule) =>
              (rule.scopeType === "AIRCRAFT" && rule.scopeId === entry.id) ||
              (rule.scopeType === "PILOT" && rule.scopeId === pilot?.id),
          );
          for (const rule of dueRules) {
            rule.currentProgress +=
              rule.triggerMetric === "COMPLETED_ROTATIONS" ? 1 : rotationOperatingMinutes;
            const hasOpenOccurrence = plans.some(
              (plan) => plan.recurringRuleKey === rule.key && !plan.completed,
            );
            if (rule.currentProgress < rule.intervalValue || hasOpenOccurrence) continue;
            rule.sequenceNumber += 1;
            plans.push({
              key: `${rule.key}:occurrence-${rule.sequenceNumber}`,
              scopeType: rule.scopeType,
              scopeId: rule.scopeId,
              kind: rule.kind,
              effectMode: "BLOCKING",
              durationMultiplierPercent: null,
              startMode: "AFTER_CURRENT_ROTATION",
              earliestStartAt: null,
              latestStartAt: null,
              afterRotationId: rotation.id,
              unresolvedAfterCurrentRotation: false,
              minimumDurationMinutes: rule.minimumDurationMinutes,
              typicalDurationMinutes: rule.typicalDurationMinutes,
              maximumDurationMinutes: rule.maximumDurationMinutes,
              publicNote: "",
              candidateStartMs: null,
              actualStartMs: null,
              actualEndMs: null,
              completed: false,
              recurringRuleKey: rule.key,
            });
          }
          const importedRefuelingRule = recurringRules.some(
            (rule) =>
              rule.kind === "REFUELING" &&
              rule.scopeType === "AIRCRAFT" &&
              rule.scopeId === entry.id,
          );
          if (
            config.realityModel.incidents.refueling.enabled &&
            !importedRefuelingRule &&
            entry.completedRotations % config.realityModel.incidents.refueling.everyRotations === 0
          ) {
            entry.pendingBlocks.push({
              key: `${rotation.id}:refueling`,
              state: "REFUELING",
              durationMinutes: deterministicSample(
                config.seed,
                `${rotation.id}:refueling`,
                config.realityModel.incidents.refueling.duration,
              ),
              dayOutage: false,
              source: "AUTOMATIC",
            });
          }
          const importedPauseRule = recurringRules.some(
            (rule) =>
              rule.kind === "PAUSE" &&
              ((rule.scopeType === "AIRCRAFT" && rule.scopeId === entry.id) ||
                (rule.scopeType === "PILOT" && rule.scopeId === pilot?.id)),
          );
          if (
            config.realityModel.incidents.plannedPause.enabled &&
            !importedPauseRule &&
            Math.floor(
              entry.operatingMinutes /
                config.realityModel.incidents.plannedPause.everyOperatingMinutes,
            ) >
              Math.floor(
                (entry.operatingMinutes -
                  (rotation.boardingMinutes ?? 0) -
                  (rotation.flightMinutes ?? 0) -
                  (rotation.deboardingMinutes ?? 0) -
                  (rotation.bufferMinutes ?? 0)) /
                  config.realityModel.incidents.plannedPause.everyOperatingMinutes,
              )
          ) {
            entry.pendingBlocks.push({
              key: `${rotation.id}:planned-pause`,
              state: "PLANNED_PAUSE",
              durationMinutes: deterministicSample(
                config.seed,
                `${rotation.id}:planned-pause`,
                config.realityModel.incidents.plannedPause.duration,
              ),
              dayOutage: false,
              source: "AUTOMATIC",
            });
          }
          const operatingHours =
            ((rotation.boardingMinutes ?? 0) +
              (rotation.flightMinutes ?? 0) +
              (rotation.deboardingMinutes ?? 0) +
              (rotation.bufferMinutes ?? 0)) /
            60;
          if (
            config.realityModel.incidents.unplannedPause.enabled &&
            deterministicChance(config.seed, `${rotation.id}:unplanned`) <
              1 -
                Math.exp(
                  -config.realityModel.incidents.unplannedPause.ratePerOperatingHour *
                    operatingHours,
                )
          ) {
            entry.pendingBlocks.push({
              key: `${rotation.id}:unplanned`,
              state: "UNPLANNED_PAUSE",
              durationMinutes: deterministicSample(
                config.seed,
                `${rotation.id}:unplanned`,
                config.realityModel.incidents.unplannedPause.duration,
              ),
              dayOutage: false,
              source: "AUTOMATIC",
            });
          }
        }
        if (pilot) pilot.activeRotationId = null;
        recordEvent("ROTATION_COMPLETED", nowMs, {
          aircraftId: rotation.aircraftId,
          pilotId: rotation.pilotId ?? null,
          rotationId: rotation.id,
          details: "Turnaround abgeschlossen; Flugzeug und Pilot wieder verfügbar.",
        });
      }
    }

    for (const entry of aircraft) {
      if (
        entry.blockedUntilMs !== null &&
        nowMs >= entry.blockedUntilMs &&
        entry.state !== "AVAILABLE"
      ) {
        entry.state = "AVAILABLE";
        entry.blockedUntilMs = null;
        recordEvent("AIRCRAFT_RETURN_CONFIRMED", nowMs, {
          aircraftId: entry.id,
          details: "Rückkehr in die Verfügbarkeit bestätigt.",
        });
      }
    }

    for (const plan of plans) {
      if (plan.actualStartMs !== null || plan.completed) continue;
      const afterRotationReady =
        plan.startMode === "AFTER_CURRENT_ROTATION" &&
        plan.afterRotationId &&
        rotations.some(
          (rotation) => rotation.id === plan.afterRotationId && rotation.status === "COMPLETED",
        );
      const timeReady =
        plan.startMode === "TIME_WINDOW" &&
        plan.candidateStartMs !== null &&
        nowMs >= plan.candidateStartMs;
      if (!afterRotationReady && !timeReady) continue;
      const targetIdle =
        (plan.effectMode ?? "BLOCKING") === "SLOWDOWN"
          ? true
          : plan.scopeType === "AIRCRAFT"
            ? aircraft.some(
                (entry) =>
                  entry.id === plan.scopeId &&
                  entry.activeRotationId === null &&
                  entry.state === "AVAILABLE",
              )
            : plan.scopeType === "PILOT"
              ? pilots.some((pilot) => pilot.id === plan.scopeId && pilot.activeRotationId === null)
              : true;
      if (!targetIdle) continue;
      plan.actualStartMs = nowMs;
      plan.actualEndMs = roundedTick(
        addMinutes(
          nowMs,
          deterministicSample(config.seed, `${plan.key}:duration`, {
            minimum: plan.minimumDurationMinutes,
            typical: plan.typicalDurationMinutes,
            maximum: plan.maximumDurationMinutes,
          }),
        ),
      );
      if ((plan.effectMode ?? "BLOCKING") === "SLOWDOWN") {
        for (const rotation of rotations) {
          if (
            ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status) &&
            planAppliesToRotation(plan, rotation)
          ) {
            applySlowdownToRemainingPhases(rotation, activeSlowdownPercent(rotation, nowMs));
          }
        }
      }
      recordEvent("PLANNED_OPERATION_STARTED", nowMs, {
        aircraftId: plan.scopeType === "AIRCRAFT" ? plan.scopeId : null,
        pilotId: plan.scopeType === "PILOT" ? plan.scopeId : null,
        plannedOperationId: plan.key,
        details: `${plan.kind}${plan.publicNote ? ` · ${plan.publicNote}` : ""}`,
      });
    }

    for (const entry of aircraft) {
      if (entry.state === "AVAILABLE" && entry.activeRotationId === null) {
        const block = entry.pendingBlocks.shift();
        if (block) startBlock(entry, block, nowMs);
      }
    }

    const projectionsBeforeDispatch = projectionAt(nowMs);
    const projectionByRotation = new Map(
      projectionsBeforeDispatch.map((entry) => [entry.rotationId, entry]),
    );
    const waiting = rotations.filter(
      (rotation) => rotation.status === "DRAFT" && Date.parse(rotation.createdAt) <= nowMs,
    );
    if (waiting.length > 0) {
      const observedGateWaitMinutes = rotations.flatMap((rotation) =>
        rotation.precalledAt && rotation.calledAt
          ? [(Date.parse(rotation.calledAt) - Date.parse(rotation.precalledAt)) / MINUTE_MS]
          : [],
      );
      const adaptiveLeadMinutes = deriveAdaptivePrecallLeadMinutes({
        observedGateWaitMinutes,
        tuning: config.forecastTuning.precall,
      });
      const latestPrecallAt = rotations.reduce<number | null>((latest, rotation) => {
        if (!rotation.precalledAt) return latest;
        const value = Date.parse(rotation.precalledAt);
        return latest === null ? value : Math.max(latest, value);
      }, null);
      const decisions = selectAutomaticPrecalls(
        waiting.flatMap((rotation) => {
          const projection = projectionByRotation.get(rotation.id);
          const group = model.resourceGroups.find((entry) => entry.id === rotation.resourceGroupId);
          if (!projection || !group) return [];
          const largestEligibleAircraftSeats = aircraft
            .filter((entry) => entry.resourceGroupId === group.id)
            .reduce((maximum, entry) => Math.max(maximum, entry.capacity), 0);
          return [
            {
              id: rotation.id,
              resourceGroupId: group.id,
              enabled: config.adminParameters.eventAutomaticPrecallEnabled,
              eventActive: nowMs >= operationsStartMs && nowMs < operationsEndMs,
              operationsAvailable: groupAvailable(group.id, nowMs),
              resourceGroupActive: groupAvailable(group.id, nowMs),
              resourceGroupEnabled: group.automaticPrecallEnabled,
              alreadyPrecalled: rotation.precalledAt !== null,
              groupSize: rotation.passengerCount,
              largestEligibleAircraftSeats,
              predictionQuality: projection.predictionQuality,
              predictedBoardingMinutes: Math.round(
                (projection.predictionLowerMinutes + projection.predictionUpperMinutes) / 2,
              ),
              adaptiveLeadMinutes,
              minutesSinceLastGatePrecall:
                latestPrecallAt === null
                  ? null
                  : Math.max(0, (nowMs - latestPrecallAt) / MINUTE_MS),
              gateCooldownMinutes: config.forecastTuning.precall.gateCooldownMinutes,
            },
          ];
        }),
      );
      for (const decision of decisions) {
        if (!decision.eligible) continue;
        const rotation = rotations.find((entry) => entry.id === decision.id);
        const projection = projectionByRotation.get(decision.id);
        if (!rotation || !projection) continue;
        rotation.precalledAt = iso(nowMs);
        rotation.precallTrigger = "AUTOMATIC_PRECALL";
        rotation.precallPredictionQuality = projection.predictionQuality;
        rotation.precallPredictedBoardingAt = projection.predictedBoardingAt;
        rotation.precallAdaptiveLeadMinutes = adaptiveLeadMinutes;
        recordEvent("FLIGHT_GROUP_PRECALLED", nowMs, {
          rotationId: rotation.id,
          details: `Automatischer GO TO GATE · ${rotation.gateLabel ?? "Gate"} · Prognose ${projection.predictedBoardingAt}.`,
        });
      }
    }

    const freePilots = pilots
      .filter((pilot) => pilotAvailable(pilot, nowMs))
      .sort((left, right) => left.operationalCode.localeCompare(right.operationalCode));
    for (const group of model.resourceGroups) {
      if (!groupAvailable(group.id, nowMs) || freePilots.length === 0) continue;
      const groupProducts = model.products
        .filter((product) => product.resourceGroupId === group.id)
        .map((product) => product.id);
      const waitingForGroup = rotations
        .filter(
          (rotation) =>
            rotation.status === "DRAFT" &&
            rotation.resourceGroupId === group.id &&
            Date.parse(rotation.createdAt) <= nowMs,
        )
        .sort(
          (left, right) =>
            Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.communicationNumber - right.communicationNumber,
        );
      const plan = planNextRotations({
        groups: waitingForGroup.map((rotation, index) => ({
          id: rotation.id,
          size: rotation.passengerCount,
          queueSequence: index + 1,
          productId: rotation.productId ?? "",
          standby: false,
        })),
        aircraft: aircraft
          .filter((entry) => entry.resourceGroupId === group.id)
          .map((entry) => ({
            id: entry.id,
            capacity: entry.capacity,
            compatibleProductIds: groupProducts,
            available: aircraftAvailable(entry, nowMs),
          })),
        standbyPriority: false,
      });
      for (const assignment of plan.assignments) {
        const pilot = freePilots.shift();
        const rotationId = assignment.groupIds[0];
        const rotation = rotations.find((entry) => entry.id === rotationId);
        const entry = aircraft.find((candidate) => candidate.id === assignment.aircraftId);
        if (!pilot || !rotation || !entry || !aircraftAvailable(entry, nowMs)) break;
        rotation.status = "CALLED";
        rotation.aircraftId = entry.id;
        rotation.pilotId = pilot.id;
        rotation.calledAt = iso(nowMs);
        rotation.boardingMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:boarding`,
          config.realityModel.phases.boarding,
        );
        rotation.flightMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:flight`,
          config.realityModel.phases.flight,
        );
        rotation.deboardingMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:deboarding`,
          config.realityModel.phases.deboarding,
        );
        rotation.bufferMinutes = deterministicSample(
          config.seed,
          `${rotation.id}:buffer`,
          config.realityModel.phases.buffer,
        );
        applySlowdownToRemainingPhases(rotation, activeSlowdownPercent(rotation, nowMs));
        entry.state = "ACTIVE";
        entry.activeRotationId = rotation.id;
        pilot.activeRotationId = rotation.id;
        recordEvent("ROTATION_CALLED", nowMs, {
          aircraftId: entry.id,
          pilotId: pilot.id,
          rotationId: rotation.id,
          details: `Aufruf bestätigt · ${rotation.productCode ?? "Produkt"} · ${group.shortCode} · ${pilot.operationalCode}.`,
        });
      }
    }

    const projections = projectionAt(nowMs);
    for (const projection of projections) {
      const rotation = rotations.find((entry) => entry.id === projection.rotationId);
      if (!rotation || rotation.status === "COMPLETED") continue;
      rotation.predictedDepartureAt = projection.predictedDepartureAt;
      rotation.predictedLandingAt = projection.predictedLandingAt;
      rotation.predictedCompletionAt = projection.predictedCompletionAt;
      snapshots.push({
        rotationId: rotation.id,
        capturedAt: iso(nowMs),
        status: rotation.status,
        quality: projection.predictionQuality,
        lowerMinutes: projection.predictionLowerMinutes,
        upperMinutes: projection.predictionUpperMinutes,
        plannedBoardingAt: projection.plannedBoardingAt,
        predictedBoardingAt: projection.predictedBoardingAt,
        predictedDepartureAt: projection.predictedDepartureAt,
        predictedLandingAt: projection.predictedLandingAt,
        predictedCompletionAt: projection.predictedCompletionAt,
        sampleSize: projection.sampleSize,
        dataAgeMinutes: projection.dataAgeMinutes,
        activeCapacity: projection.activeCapacity,
        uncertaintyReasons: projection.uncertaintyReasons,
        countdownDisplayed: projection.predictionQuality !== "UNCERTAIN",
      });
    }
    if (nowMs >= operationsEndMs && !aircraft.some((entry) => entry.activeRotationId !== null)) {
      runEndMs = nowMs;
      break;
    }
  }

  events.sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id),
  );
  const publicRotations = rotations.map(publicRotation);
  return {
    config: structuredClone(config),
    runWindow: { startAt: iso(runStartMs), endAt: iso(runEndMs) },
    aircraft: aircraft.map(
      ({
        state: _state,
        activeRotationId: _active,
        blockedUntilMs: _blocked,
        completedRotations: _count,
        operatingMinutes: _minutes,
        pendingBlocks: _pending,
        ...entry
      }) => entry,
    ),
    pilots: pilots.map(({ activeRotationId: _active, ...entry }) => entry),
    plannedOperations: plans.map(
      ({
        candidateStartMs: _candidate,
        actualStartMs: _actualStart,
        actualEndMs: _actualEnd,
        completed: _completed,
        recurringRuleKey: _recurringRule,
        ...plan
      }) => structuredClone(plan),
    ),
    recurringRules: structuredClone(config.recurringRules ?? []),
    rotations: publicRotations,
    events,
    snapshots,
    metrics: calculateMetrics({
      rotations: publicRotations,
      snapshots,
      events,
      operationsStartAt: config.schedule.operationsStartAt,
      operationsEndAt: config.schedule.operationsEndAt,
      aircraftCount: aircraft.length,
    }),
  };
}
