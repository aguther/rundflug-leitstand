import { calculateForecastTimelines, type ForecastRotationStatus } from "@rundflug/domain";
import type { SimulationConfig, SimulationPlannedOperation } from "./model";
import { SIMULATION_DISPATCH_PLANNING_LIMITS } from "./model";
import {
  dispatchPublicStatus,
  EVENT_ID,
  type OperationalAircraft,
  type OperationalPilot,
  type OperationalPlan,
  type OperationalRecurringRule,
  type OperationalRotation,
  planAppliesToGroup,
} from "./operational-simulation-scenario";
import { toSimulationIso as iso, SIMULATION_MINUTE_MS as MINUTE_MS } from "./simulation-primitives";

export function calculateOperationalSimulationProjections(input: {
  config: SimulationConfig;
  nowMs: number;
  operationsStartMs: number;
  operationsEndMs: number;
  rotations: readonly OperationalRotation[];
  aircraft: readonly OperationalAircraft[];
  pilots: readonly OperationalPilot[];
  plans: readonly OperationalPlan[];
  recurringRules: readonly OperationalRecurringRule[];
  planIsActive: (plan: OperationalPlan, nowMs: number) => boolean;
  activePlanFor: (
    scopeType: SimulationPlannedOperation["scopeType"],
    scopeId: string,
    nowMs: number,
  ) => boolean;
  planAppliesToRotation: (plan: OperationalPlan, rotation: OperationalRotation) => boolean;
  operationsGloballyAvailable: (nowMs: number) => boolean;
  groupAvailable: (groupId: string, nowMs: number) => boolean;
}) {
  const {
    config,
    nowMs,
    operationsStartMs,
    operationsEndMs,
    rotations,
    aircraft,
    pilots,
    plans,
    recurringRules,
    planIsActive,
    activePlanFor,
    planAppliesToRotation,
    operationsGloballyAvailable,
    groupAvailable,
  } = input;
  const model = config.operationalModel;
  if (!model) throw new Error("Operative Simulationsdaten fehlen.");

  const beforeOperationsStart = nowMs < operationsStartMs;
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
          left.id.localeCompare(right.id),
      )
      .forEach((rotation, index) => {
        queueSequences.set(rotation.id, index + 1);
      });
  }
  const durationSamples = rotations.flatMap((rotation) =>
    rotation.completedAt && rotation.calledAt && rotation.slowdownMultiplierPercent === 100
      ? [
          {
            minutes: (Date.parse(rotation.completedAt) - Date.parse(rotation.calledAt)) / MINUTE_MS,
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
  const forecastPilotIds = new Set<string>();
  const confirmedForecastPilotIds = new Set(
    rotations.flatMap((rotation) =>
      ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status) && rotation.pilotId
        ? [rotation.pilotId]
        : [],
    ),
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
    const availabilityLanes = groupAircraft.flatMap((entry) => {
      const activeRotation = entry.activeRotationId
        ? rotations.find((rotation) => rotation.id === entry.activeRotationId)
        : null;
      const lanePilot =
        (activeRotation?.pilotId
          ? pilots.find(
              (pilot) => pilot.id === activeRotation.pilotId && !forecastPilotIds.has(pilot.id),
            )
          : null) ??
        orderedPilots.find(
          (pilot) => !forecastPilotIds.has(pilot.id) && !confirmedForecastPilotIds.has(pilot.id),
        );
      if (!lanePilot) return [];
      forecastPilotIds.add(lanePilot.id);
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
      return [
        {
          laneId: entry.id,
          aircraftId: entry.id,
          aircraftType: entry.aircraftType,
          pilotId: lanePilot.id,
          passengerSeats: entry.capacity,
          availableLowerAt: iso(expectedAt),
          availableExpectedAt: iso(expectedAt),
          availableUpperAt: iso(expectedAt + (expectedAt > nowMs ? 5 * MINUTE_MS : 0)),
          constraints,
          recurringConstraints: recurringRules
            .filter(
              (rule) =>
                (rule.scopeType === "AIRCRAFT" && rule.scopeId === entry.id) ||
                (rule.scopeType === "PILOT" && rule.scopeId === lanePilot.id),
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
        },
      ];
    });
    const activePilotCapacity = pilots.filter(
      (pilot) => pilot.active && !activePlanFor("PILOT", pilot.id, nowMs),
    ).length;
    return {
      resourceGroupId: group.id,
      activeAircraft:
        beforeOperationsStart || groupAvailable(group.id, nowMs)
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
      operationalInterrupted:
        nowMs >= operationsStartMs &&
        nowMs < operationsEndMs &&
        !operationsGloballyAvailable(nowMs),
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
        resourceGroupStatus:
          beforeOperationsStart || groupAvailable(groupId, nowMs)
            ? ("ACTIVE" as const)
            : ("PAUSED" as const),
        queueSequence: queueSequences.get(rotation.id) ?? 1,
        dispatchGroupIds: [rotation.id],
        productId: product?.id ?? rotation.productCode ?? "SIM",
        gateId: product?.gateId ?? `gate:${groupId}`,
        soldAt: rotation.createdAt,
        attendanceStatus: "WAITING" as const,
        standby: false,
        publicStatus: dispatchPublicStatus(rotation),
        confirmedOvertakeCount: rotation.dispatchConfirmedOvertakeCount ?? 0,
        passengerCount: rotation.passengerCount,
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
    dispatchPlanningLimits: SIMULATION_DISPATCH_PLANNING_LIMITS,
  });
}
