import {
  calculateForecastTimelines,
  type DispatchPlan,
  type ForecastRotationStatus,
} from "@rundflug/domain";
import {
  dispatchPublicStatus,
  EVENT_ID,
  PRODUCT_ID,
  RESOURCE_GROUP_ID,
  type RuntimeAircraft,
  type RuntimeRotation,
} from "./legacy-simulation-scenario";
import type { ManualIncident, SimulationConfig } from "./model";
import { SIMULATION_DISPATCH_PLANNING_LIMITS } from "./model";
import {
  addSimulationMinutes as addMinutes,
  toSimulationIso as iso,
  SIMULATION_MINUTE_MS as MINUTE_MS,
} from "./simulation-primitives";

export function calculateLegacySimulationProjections(input: {
  config: SimulationConfig;
  nowMs: number;
  operationsStartMs: number;
  resourceGroupStatus: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
  rotations: readonly RuntimeRotation[];
  aircraft: readonly RuntimeAircraft[];
  activeInterruptions: readonly ManualIncident[];
  previousDispatchPlan: DispatchPlan | null;
}) {
  const {
    config,
    nowMs,
    operationsStartMs,
    resourceGroupStatus,
    rotations,
    aircraft,
    activeInterruptions,
    previousDispatchPlan,
  } = input;

  const operationalInterrupted = resourceGroupStatus === "INTERRUPTED";
  const forecastResourceGroupStatus =
    resourceGroupStatus === "PAUSED" && nowMs < operationsStartMs ? "ACTIVE" : resourceGroupStatus;
  const open = rotations.filter(
    (rotation) => rotation.status !== "COMPLETED" && Date.parse(rotation.createdAt) <= nowMs,
  );
  const durationSamples = rotations
    .filter((rotation) => rotation.completedAt && rotation.calledAt)
    .map((rotation) => ({
      minutes:
        (Date.parse(rotation.completedAt ?? "") - Date.parse(rotation.calledAt ?? "")) / MINUTE_MS,
      completedAt: rotation.completedAt ?? config.schedule.operationsStartAt,
      eventId: EVENT_ID,
      productCode: PRODUCT_ID,
      aircraftType: rotation.aircraftId
        ? (aircraft.find((entry) => entry.id === rotation.aircraftId)?.aircraftType ?? null)
        : null,
    }));
  const draftSequence = new Map(
    open
      .filter((rotation) => rotation.status === "DRAFT")
      .map((rotation, index) => [rotation.id, index + 1]),
  );
  const activeCapacity =
    forecastResourceGroupStatus === "ACTIVE"
      ? Math.min(
          config.adminParameters.activePilotCount,
          aircraft.filter((entry) => entry.state === "AVAILABLE" || entry.state === "ACTIVE")
            .length,
        )
      : 0;
  const activeInterruptionEndMs = activeInterruptions.reduce<number | null>(
    (latest, interruption) => {
      const startsAt = Date.parse(interruption.at);
      const endsAt = addMinutes(startsAt, interruption.durationMinutes);
      if (nowMs < startsAt || nowMs >= endsAt) return latest;
      return latest === null ? endsAt : Math.max(latest, endsAt);
    },
    null,
  );
  const referenceTotalMinutes =
    config.adminParameters.plannedBoardingMinutes +
    config.adminParameters.productReferenceDurationMinutes +
    config.adminParameters.plannedDeboardingMinutes +
    config.adminParameters.plannedBufferMinutes;
  const availabilityLanes = aircraft
    .flatMap((entry) => {
      if (entry.state === "DAY_OUT") return [];
      const activeRotation = entry.activeRotationId
        ? rotations.find((rotation) => rotation.id === entry.activeRotationId)
        : null;
      const resourceExpectedAt =
        entry.blockedUntilMs ??
        (activeRotation?.predictedCompletionAt
          ? Date.parse(activeRotation.predictedCompletionAt)
          : entry.state === "ACTIVE"
            ? addMinutes(nowMs, referenceTotalMinutes)
            : nowMs);
      const expectedAt = Math.max(nowMs, resourceExpectedAt, activeInterruptionEndMs ?? 0);
      const futureUncertainty = expectedAt > nowMs ? 5 * MINUTE_MS : 0;
      const constraints = [];
      const remainingUntilPlannedPause = entry.nextPauseAtMinutes - entry.operatingMinutes;
      if (
        config.realityModel.incidents.plannedPause.enabled &&
        entry.state !== "PLANNED_PAUSE" &&
        remainingUntilPlannedPause <= referenceTotalMinutes
      ) {
        constraints.push({
          id: `${entry.id}:next-planned-pause`,
          earliestStartAt: iso(expectedAt),
          latestStartAt: iso(addMinutes(expectedAt, 5)),
          minimumDurationMinutes: config.realityModel.incidents.plannedPause.duration.minimum,
          typicalDurationMinutes: config.realityModel.incidents.plannedPause.duration.typical,
          maximumDurationMinutes: config.realityModel.incidents.plannedPause.duration.maximum,
        });
      }
      if (
        config.realityModel.incidents.refueling.enabled &&
        entry.state !== "REFUELING" &&
        (entry.completedRotations + 1) % config.realityModel.incidents.refueling.everyRotations ===
          0
      ) {
        constraints.push({
          id: `${entry.id}:next-refueling`,
          earliestStartAt: iso(expectedAt),
          latestStartAt: iso(addMinutes(expectedAt, 5)),
          minimumDurationMinutes: config.realityModel.incidents.refueling.duration.minimum,
          typicalDurationMinutes: config.realityModel.incidents.refueling.duration.typical,
          maximumDurationMinutes: config.realityModel.incidents.refueling.duration.maximum,
        });
      }
      return [
        {
          laneId: entry.id,
          aircraftId: entry.id,
          passengerSeats: entry.capacity,
          availableLowerAt: iso(Math.max(nowMs, expectedAt - futureUncertainty)),
          availableExpectedAt: iso(expectedAt),
          availableUpperAt: iso(expectedAt + futureUncertainty),
          constraints,
        },
      ];
    })
    .sort(
      (left, right) =>
        Date.parse(left.availableExpectedAt) - Date.parse(right.availableExpectedAt) ||
        left.laneId.localeCompare(right.laneId),
    )
    .slice(0, config.adminParameters.activePilotCount);
  return calculateForecastTimelines({
    event: {
      eventId: EVENT_ID,
      now: iso(nowMs),
      plannedOperationsStartAt:
        config.forecastTuning.availabilityModel === "TIME_DEPENDENT"
          ? config.schedule.operationsStartAt
          : null,
      operationalInterrupted,
      emergencyMode: false,
      plannedBoardingMinutes: config.adminParameters.plannedBoardingMinutes,
      plannedDeboardingMinutes: config.adminParameters.plannedDeboardingMinutes,
      plannedBufferMinutes: config.adminParameters.plannedBufferMinutes,
    },
    rotations: open.map((rotation) => ({
      id: rotation.id,
      status: rotation.status as ForecastRotationStatus,
      createdAt: rotation.createdAt,
      calledAt: rotation.calledAt,
      departedAt: rotation.departedAt,
      landedAt: rotation.landedAt,
      resourceGroupId: RESOURCE_GROUP_ID,
      resourceGroupStatus: forecastResourceGroupStatus,
      queueSequence: rotation.status === "DRAFT" ? (draftSequence.get(rotation.id) ?? 1) : 1,
      dispatchGroupIds: [rotation.id],
      productId: PRODUCT_ID,
      gateId: "SIMULATION_GATE",
      soldAt: rotation.createdAt,
      attendanceStatus: "WAITING" as const,
      standby: false,
      publicStatus: dispatchPublicStatus(rotation),
      confirmedOvertakeCount: rotation.dispatchConfirmedOvertakeCount ?? 0,
      passengerCount: rotation.passengerCount,
      referenceDurationMinutes: config.adminParameters.productReferenceDurationMinutes,
      productCode: PRODUCT_ID,
      aircraftType: rotation.aircraftId
        ? (aircraft.find((entry) => entry.id === rotation.aircraftId)?.aircraftType ?? null)
        : null,
      predictedDepartureAt: rotation.predictedDepartureAt,
      predictedLandingAt: rotation.predictedLandingAt,
      predictedCompletionAt: rotation.predictedCompletionAt,
    })),
    durationSamples,
    capacities: [
      {
        resourceGroupId: RESOURCE_GROUP_ID,
        activeAircraft: activeCapacity,
        ...(config.forecastTuning.availabilityModel === "TIME_DEPENDENT"
          ? { availabilityLanes }
          : {}),
      },
    ],
    tuning: config.forecastTuning.forecast,
    previousDispatchPlan,
    dispatchPlanningLimits: SIMULATION_DISPATCH_PLANNING_LIMITS,
  });
}
