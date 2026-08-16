import {
  createDispatchPlan,
  type DispatchPlanInput,
  orderDispatchGroupsForProjection,
} from "./dispatch-plan";
import {
  advanceOverduePrediction,
  type QueueAvailabilityConstraint,
  slowdownMultiplier,
} from "./forecast-availability";
import { operationsEndAssessment } from "./forecast-diagnostics";
import {
  type ActiveForecastResourceReservation,
  createDispatchAvailability,
  createLongRangeReplayReservation,
  type ForecastTurnaroundProfile,
  forecastLaneDurationKey,
  type LongRangeReplayReservation,
  replayDispatchBatches,
} from "./forecast-dispatch-replay";
import {
  type ForecastDurationBasis,
  resolveForecastDurationBasis,
} from "./forecast-duration-basis";
import {
  DEFAULT_FORECAST_TUNING_PROFILE,
  type DurationEstimate,
  type ForecastAvailabilityConstraintInput,
  type ForecastCalculationResult,
  type ForecastCapacityStatus,
  type ForecastState,
  type ForecastTimelineProjection,
  type ForecastTimelineRotationInput,
  type ForecastTimelinesInput,
  type ForecastUncertaintyReason,
} from "./forecast-types";
import { deriveReferenceRotationBreakdown } from "./reference-rotation";
import { compareTechnicalStrings } from "./technical-order";

const MINUTE_MS = 60_000;

function addMinutes(value: string | Date, minutes: number): string {
  return new Date(new Date(value).getTime() + minutes * MINUTE_MS).toISOString();
}

function createOffsetMinutes(now: Date): (value: string) => number {
  return (value) => Math.max(0, (Date.parse(value) - now.getTime()) / MINUTE_MS);
}

function integerPredictionWindow(lowerMinutes: number, upperMinutes: number) {
  return {
    lowerMinutes: Math.max(0, Math.floor(lowerMinutes)),
    upperMinutes: Math.max(0, Math.ceil(upperMinutes)),
  };
}

function operationWindowMinutes(
  input: ForecastTimelinesInput,
  offsetMinutes: (value: string) => number,
): { start: number; end: number | null } {
  return {
    start: input.event.plannedOperationsStartAt
      ? offsetMinutes(input.event.plannedOperationsStartAt)
      : 0,
    end: input.event.plannedOperationsEndAt
      ? offsetMinutes(input.event.plannedOperationsEndAt)
      : null,
  };
}

function createQueueConstraintConverter(
  offsetMinutes: (value: string) => number,
): (constraint: ForecastAvailabilityConstraintInput) => QueueAvailabilityConstraint {
  return (constraint) => {
    const earliest = offsetMinutes(constraint.earliestStartAt);
    const latest = Math.max(earliest, offsetMinutes(constraint.latestStartAt));
    return {
      id: constraint.id,
      earliestStartMinutes: earliest,
      expectedStartMinutes: (earliest + latest) / 2,
      latestStartMinutes: latest,
      minimumDurationMinutes: constraint.minimumDurationMinutes,
      typicalDurationMinutes: constraint.typicalDurationMinutes,
      maximumDurationMinutes: constraint.maximumDurationMinutes,
      effectMode: constraint.effectMode ?? "BLOCKING",
      durationMultiplierPercent: constraint.durationMultiplierPercent ?? null,
      active: constraint.active ?? false,
    };
  };
}

function turnaroundProfile(
  input: ForecastTimelinesInput,
  rotation: ForecastTimelineRotationInput,
  aircraftId: string | null,
): ForecastTurnaroundProfile {
  const selected = rotation.turnaroundProfiles?.find(
    (profile) => profile.aircraftId === aircraftId,
  );
  if (selected) return selected;
  if (rotation.confirmedTurnaroundProfile) return rotation.confirmedTurnaroundProfile;
  return {
    boardingMinutes: input.event.plannedBoardingMinutes,
    deboardingMinutes: input.event.plannedDeboardingMinutes,
    bufferMinutes: input.event.plannedBufferMinutes,
    boardingSource: `EVENT:${input.event.eventId}`,
    deboardingSource: `EVENT:${input.event.eventId}`,
    bufferSource: `EVENT:${input.event.eventId}`,
  };
}

function referenceDurationMinutes(
  rotation: ForecastTimelineRotationInput,
  profile: ForecastTurnaroundProfile,
): number {
  return deriveReferenceRotationBreakdown({
    boardingMinutes: profile.boardingMinutes,
    offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
    deboardingMinutes: profile.deboardingMinutes,
    bufferMinutes: profile.bufferMinutes,
  }).totalMinutes;
}

function plannedMilestones(args: {
  rotation: ForecastTimelineRotationInput;
  profile: ForecastTurnaroundProfile;
  activeCapacity: number;
}): Pick<
  ForecastTimelineProjection,
  "plannedBoardingAt" | "plannedDepartureAt" | "plannedLandingAt" | "plannedCompletionAt"
> {
  const planOffset =
    Math.floor(Math.max(0, args.rotation.queueSequence - 1) / Math.max(1, args.activeCapacity)) *
    referenceDurationMinutes(args.rotation, args.profile);
  const plannedBoardingAt = addMinutes(args.rotation.createdAt, planOffset);
  const plannedDepartureAt = addMinutes(plannedBoardingAt, args.profile.boardingMinutes);
  const plannedLandingAt = addMinutes(plannedDepartureAt, args.rotation.referenceDurationMinutes);
  return {
    plannedBoardingAt,
    plannedDepartureAt,
    plannedLandingAt,
    plannedCompletionAt: addMinutes(
      plannedLandingAt,
      args.profile.deboardingMinutes + args.profile.bufferMinutes,
    ),
  };
}

function uncertaintyReasons(
  input: ForecastTimelinesInput,
  rotation: ForecastTimelineRotationInput,
  forecastCapacity: number,
  hasOverdueConstraint: boolean,
): ForecastUncertaintyReason[] {
  const reasons: ForecastUncertaintyReason[] = [];
  if (input.event.operationalInterrupted) reasons.push("OPERATION_INTERRUPTED");
  if (input.event.emergencyMode) reasons.push("EMERGENCY_MODE");
  if (rotation.resourceGroupStatus !== "ACTIVE") reasons.push("RESOURCE_GROUP_INACTIVE");
  if (forecastCapacity === 0) reasons.push("NO_ACTIVE_CAPACITY");
  if (hasOverdueConstraint) reasons.push("PLANNED_CONSTRAINT_OVERDUE");
  return reasons;
}

function hasOverdueConstraint(
  input: ForecastTimelinesInput,
  rotation: ForecastTimelineRotationInput,
): boolean {
  const capacity = input.capacities.find(
    (entry) => entry.resourceGroupId === rotation.resourceGroupId,
  );
  return [
    ...(capacity?.sharedConstraints ?? []),
    ...(capacity?.availabilityLanes ?? []).flatMap((lane) => lane.constraints ?? []),
    ...(rotation.constraints ?? []),
  ].some((constraint) => constraint.overdue);
}

function applyActiveSlowdown(
  estimate: DurationEstimate,
  constraints: readonly QueueAvailabilityConstraint[],
): DurationEstimate {
  const lowerMultiplier = slowdownMultiplier(0, estimate.lowerMinutes, constraints, "lower");
  const expectedMultiplier = slowdownMultiplier(
    0,
    estimate.expectedMinutes,
    constraints,
    "expected",
  );
  const upperMultiplier = slowdownMultiplier(0, estimate.upperMinutes, constraints, "upper");
  return {
    ...estimate,
    lowerMinutes: (estimate.lowerMinutes * lowerMultiplier) / 100,
    expectedMinutes: (estimate.expectedMinutes * expectedMultiplier) / 100,
    upperMinutes: (estimate.upperMinutes * upperMultiplier) / 100,
    quality:
      expectedMultiplier > 100 && estimate.quality === "STABLE" ? "CHANGING" : estimate.quality,
  };
}

function activeMilestones(args: {
  input: ForecastTimelinesInput;
  rotation: ForecastTimelineRotationInput;
  profile: ForecastTurnaroundProfile;
  totalMinutes: number;
}) {
  const { rotation, profile } = args;
  const referenceMinutes = referenceDurationMinutes(rotation, profile);
  const scale = referenceMinutes > 0 ? args.totalMinutes / referenceMinutes : 1;
  const boardingMinutes = profile.boardingMinutes * scale;
  const completionMinutes = (profile.deboardingMinutes + profile.bufferMinutes) * scale;
  const flightMinutes = Math.max(0, args.totalMinutes - boardingMinutes - completionMinutes);
  const predictedBoardingAt = rotation.calledAt ?? args.input.event.now;
  const initialDepartureAt =
    rotation.departedAt ?? addMinutes(predictedBoardingAt, boardingMinutes);
  const initialLandingAt = rotation.landedAt ?? addMinutes(initialDepartureAt, flightMinutes);
  const advanced = advanceOverduePrediction({
    status: rotation.status,
    now: args.input.event.now,
    predictedDepartureAt: initialDepartureAt,
    predictedLandingAt: initialLandingAt,
    predictedCompletionAt: addMinutes(initialLandingAt, completionMinutes),
  });
  return {
    predictedBoardingAt,
    predictedDepartureAt: rotation.departedAt ?? advanced.predictedDepartureAt,
    predictedLandingAt: rotation.landedAt ?? advanced.predictedLandingAt,
    predictedCompletionAt: advanced.predictedCompletionAt,
  };
}

interface ActiveProjectionResult {
  projectionsByRotationId: Map<string, ForecastTimelineProjection>;
  reservations: ActiveForecastResourceReservation[];
}

function projectActiveRotations(args: {
  input: ForecastTimelinesInput;
  offsetMinutes: (value: string) => number;
  convertConstraint: (
    constraint: ForecastAvailabilityConstraintInput,
  ) => QueueAvailabilityConstraint;
}): ActiveProjectionResult {
  const projectionsByRotationId = new Map<string, ForecastTimelineProjection>();
  const reservations: ActiveForecastResourceReservation[] = [];
  const tuning = args.input.tuning ?? DEFAULT_FORECAST_TUNING_PROFILE;
  for (const rotation of args.input.rotations) {
    if (rotation.status === "DRAFT") continue;
    const capacity = args.input.capacities.find(
      (entry) => entry.resourceGroupId === rotation.resourceGroupId,
    );
    const activeCapacity = capacity?.availabilityLanes?.length ?? capacity?.activeAircraft ?? 0;
    const profile = turnaroundProfile(args.input, rotation, rotation.aircraftId ?? null);
    const referenceMinutes = referenceDurationMinutes(rotation, profile);
    const durationBasis = resolveForecastDurationBasis({
      now: args.input.event.now,
      eventId: args.input.event.eventId,
      productCode: rotation.productCode,
      aircraftType: rotation.aircraftType,
      referenceDurationMinutes: referenceMinutes,
      durationSamples: args.input.durationSamples,
      interrupted: args.input.event.operationalInterrupted || args.input.event.emergencyMode,
      activeCapacity,
      tuning,
    });
    const effectiveEstimate = applyActiveSlowdown(
      durationBasis.estimate,
      (rotation.constraints ?? []).map(args.convertConstraint),
    );
    const lower = activeMilestones({
      input: args.input,
      rotation,
      profile,
      totalMinutes: effectiveEstimate.lowerMinutes,
    });
    const expected = activeMilestones({
      input: args.input,
      rotation,
      profile,
      totalMinutes: effectiveEstimate.expectedMinutes,
    });
    const upper = activeMilestones({
      input: args.input,
      rotation,
      profile,
      totalMinutes: effectiveEstimate.upperMinutes,
    });
    const operationsEnd = operationsEndAssessment(
      expected.predictedCompletionAt,
      args.input.event.plannedOperationsEndAt,
    );
    const predictionWindow = integerPredictionWindow(
      args.offsetMinutes(lower.predictedCompletionAt),
      args.offsetMinutes(upper.predictedCompletionAt),
    );
    const overdue = hasOverdueConstraint(args.input, rotation);
    projectionsByRotationId.set(rotation.id, {
      rotationId: rotation.id,
      ...plannedMilestones({ rotation, profile, activeCapacity }),
      ...expected,
      forecastState: "UNAVAILABLE",
      ...operationsEnd,
      predictionQuality:
        overdue && effectiveEstimate.quality === "STABLE" ? "CHANGING" : effectiveEstimate.quality,
      predictionLowerMinutes: predictionWindow.lowerMinutes,
      predictionUpperMinutes: predictionWindow.upperMinutes,
      capacityStatus: "AVAILABLE",
      dataBasisScope: durationBasis.dataBasisScope,
      sampleSize: durationBasis.acceptedSampleSize,
      dataAgeMinutes: durationBasis.dataAgeMinutes,
      activeCapacity,
      referenceDurationMinutes: referenceMinutes,
      assumedAircraftId: rotation.aircraftId ?? null,
      ...profile,
      uncertaintyReasons: uncertaintyReasons(args.input, rotation, activeCapacity, overdue),
      dispatchPlanId: null,
      dispatchPlanRevision: null,
      dispatchBatchId: null,
      dispatchOrder: null,
      dispatchWave: null,
      dispatchLaneId: null,
      dispatchGroupIds: [],
      dispatchOccupiedSeats: null,
      dispatchAvailableSeats: null,
      dispatchCommitmentLevel: null,
      dispatchDecisionReasons: [],
      dispatchDecisionDetails: null,
      dispatchProjectedOvertakeCount: 0,
      dispatchUnplannedReason: null,
    });
    reservations.push({
      resourceGroupId: rotation.resourceGroupId,
      aircraftId: rotation.aircraftId ?? null,
      pilotId: rotation.pilotId ?? null,
      lowerMinutes: args.offsetMinutes(lower.predictedCompletionAt),
      expectedMinutes: args.offsetMinutes(expected.predictedCompletionAt),
      upperMinutes: args.offsetMinutes(upper.predictedCompletionAt),
    });
  }
  return { projectionsByRotationId, reservations };
}

function capacityStatusForUnplannedReason(
  reason: ForecastTimelineProjection["dispatchUnplannedReason"],
): ForecastCapacityStatus {
  if (reason === "NO_FORECAST_CAPACITY" || reason === "UNKNOWN_RESOURCE_RETURN") {
    return "NO_FORECAST_CAPACITY";
  }
  return reason === "WAITING_FOR_FITTING_LANE" ? "NO_FITTING_AIRCRAFT" : "AVAILABLE";
}

function projectedForecastState(
  hardUnavailable: boolean,
  extendsBeyondOperationsEnd: boolean,
  hasDispatchBatch: boolean,
): ForecastState {
  if (hardUnavailable) return "UNAVAILABLE";
  if (extendsBeyondOperationsEnd) return "AFTER_OPERATIONS_END";
  return hasDispatchBatch ? "DISPATCH_WINDOW" : "LONG_RANGE_WINDOW";
}

/** Projects active resource occupancy and all draft groups through one scheduler/replay pipeline. */
export function calculateUnifiedForecastTimelineResult(
  input: ForecastTimelinesInput,
): ForecastCalculationResult {
  const now = new Date(input.event.now);
  if (!Number.isFinite(now.getTime())) throw new Error("Forecast time is invalid.");
  const tuning = input.tuning ?? DEFAULT_FORECAST_TUNING_PROFILE;
  const rotationsById = new Map(input.rotations.map((rotation) => [rotation.id, rotation]));
  const offsetMinutes = createOffsetMinutes(now);
  const { start: operationStartMinutes, end: operationEndMinutes } = operationWindowMinutes(
    input,
    offsetMinutes,
  );
  const convertConstraint = createQueueConstraintConverter(offsetMinutes);
  const active = projectActiveRotations({ input, offsetMinutes, convertConstraint });
  const { availabilityByResourceGroup, pilotIdByLaneId, aircraftTypeByLaneId } =
    createDispatchAvailability({
      input,
      activeReservations: active.reservations,
      operationStartMinutes,
      offsetMinutes,
      convertConstraint,
    });

  const dispatchGroups: DispatchPlanInput["groups"] = input.rotations.flatMap((rotation) =>
    rotation.status === "DRAFT"
      ? [
          {
            id: rotation.id,
            groupIds: [...(rotation.dispatchGroupIds ?? [rotation.id])],
            predecessorMemberIds: [...(rotation.dispatchPredecessorMemberIds ?? [])],
            size: Math.max(1, Math.floor(rotation.passengerCount ?? 1)),
            productId: rotation.productId ?? rotation.productCode,
            resourceGroupId: rotation.resourceGroupId,
            gateId: rotation.gateId ?? rotation.resourceGroupId,
            queueSequence: rotation.queueSequence,
            soldAt: rotation.soldAt ?? rotation.createdAt,
            attendanceStatus: rotation.attendanceStatus ?? "WAITING",
            standby: rotation.standby ?? false,
            publicStatus: rotation.publicStatus ?? "WAITING",
            confirmedOvertakeCount: rotation.confirmedOvertakeCount ?? 0,
            productServiceDeficit: rotation.productServiceDeficit ?? 0,
          },
        ]
      : [],
  );
  const durationBasisByLaneAndProduct = new Map<string, ForecastDurationBasis>();
  const dispatchLanes: DispatchPlanInput["lanes"] = [
    ...availabilityByResourceGroup.entries(),
  ].flatMap(([resourceGroupId, availability]) => {
    const products = [
      ...new Set(
        dispatchGroups
          .filter((group) => group.resourceGroupId === resourceGroupId)
          .map((group) => group.productId),
      ),
    ].sort(compareTechnicalStrings);
    return availability.lanes.map((lane) => {
      const productDurations = products.flatMap((productId) => {
        const group = dispatchGroups.find(
          (candidate) =>
            candidate.resourceGroupId === resourceGroupId && candidate.productId === productId,
        );
        const rotation = group ? rotationsById.get(group.id) : undefined;
        if (!rotation) return [];
        const profile = turnaroundProfile(input, rotation, lane.aircraftId ?? null);
        const durationBasis = resolveForecastDurationBasis({
          now: input.event.now,
          eventId: input.event.eventId,
          productCode: rotation.productCode,
          aircraftType: aircraftTypeByLaneId.get(lane.laneId) ?? rotation.aircraftType,
          referenceDurationMinutes: referenceDurationMinutes(rotation, profile),
          durationSamples: input.durationSamples,
          interrupted: input.event.operationalInterrupted || input.event.emergencyMode,
          activeCapacity: availability.lanes.length,
          tuning,
        });
        durationBasisByLaneAndProduct.set(
          forecastLaneDurationKey(lane.laneId, productId),
          durationBasis,
        );
        return [
          {
            productId,
            lowerMinutes: durationBasis.estimate.lowerMinutes,
            expectedMinutes: durationBasis.estimate.expectedMinutes,
            upperMinutes: durationBasis.estimate.upperMinutes,
          },
        ];
      });
      return {
        id: lane.laneId,
        aircraftId: lane.aircraftId ?? lane.laneId,
        pilotId: pilotIdByLaneId.get(lane.laneId) ?? null,
        resourceGroupId,
        passengerSeats: lane.passengerSeats,
        availableLowerAt: addMinutes(now, lane.lowerMinutes),
        availableExpectedAt: addMinutes(now, lane.expectedMinutes),
        availableUpperAt: addMinutes(now, lane.upperMinutes),
        productDurations,
      };
    });
  });
  const dispatchInput: DispatchPlanInput = {
    now: input.event.now,
    groups: dispatchGroups,
    lanes: dispatchLanes,
    ...(input.previousDispatchPlan === undefined
      ? {}
      : { previousPlan: input.previousDispatchPlan }),
    ...(input.lockedDispatchBatches === undefined
      ? {}
      : { lockedBatches: input.lockedDispatchBatches }),
    ...(input.dispatchPlanningLimits === undefined ? {} : { limits: input.dispatchPlanningLimits }),
  };
  const dispatchPlan = createDispatchPlan(dispatchInput);
  const dispatchLaneById = new Map(dispatchLanes.map((lane) => [lane.id, lane]));
  const reservationByBatchId = replayDispatchBatches({
    dispatchPlan,
    rotationsById,
    availabilityByResourceGroup,
    operationEndMinutes,
    dispatchLaneById,
    durationBasisByLaneAndProduct,
    turnaroundProfile: (rotation, aircraftId) => turnaroundProfile(input, rotation, aircraftId),
  });
  const nearMemberIds = new Set(dispatchPlan.batches.flatMap((batch) => batch.memberIds));
  const longRangeReservationByMemberId = new Map<string, LongRangeReplayReservation>();
  for (const resourceGroupId of [
    ...new Set(dispatchGroups.map((group) => group.resourceGroupId)),
  ].sort(compareTechnicalStrings)) {
    let remaining = orderDispatchGroupsForProjection({
      now: input.event.now,
      groups: dispatchGroups.filter(
        (group) =>
          group.resourceGroupId === resourceGroupId &&
          !nearMemberIds.has(group.id) &&
          group.attendanceStatus !== "MISSING" &&
          group.attendanceStatus !== "CLARIFICATION",
      ),
      ...(input.dispatchPlanningLimits === undefined
        ? {}
        : { limits: input.dispatchPlanningLimits }),
    });
    while (remaining.length > 0) {
      const reservation = createLongRangeReplayReservation({
        remaining,
        resourceGroupId,
        availabilityByResourceGroup,
        dispatchLaneById,
        rotationsById,
        durationBasisByLaneAndProduct,
        turnaroundProfile: (rotation, aircraftId) => turnaroundProfile(input, rotation, aircraftId),
      });
      if (!reservation) break;
      availabilityByResourceGroup.set(resourceGroupId, reservation.availability);
      for (const memberId of reservation.replay.memberIds) {
        longRangeReservationByMemberId.set(memberId, reservation.replay);
      }
      remaining = remaining.filter((group) => !reservation.memberIdSet.has(group.id));
    }
  }
  const batchByMemberId = new Map(
    dispatchPlan.batches.flatMap((batch) =>
      batch.memberIds.map((memberId) => [memberId, batch] as const),
    ),
  );
  const decisionByMemberId = new Map(
    dispatchPlan.groupDecisions.map((decision) => [decision.memberId, decision]),
  );
  const unplannedByMemberId = new Map(
    dispatchPlan.unplannedGroups.map((entry) => [entry.memberId, entry.reason]),
  );

  const projections = input.rotations.map<ForecastTimelineProjection>((rotation) => {
    if (rotation.status !== "DRAFT") {
      const projection = active.projectionsByRotationId.get(rotation.id);
      if (!projection) throw new Error(`Active forecast rotation ${rotation.id} disappeared.`);
      return projection;
    }
    const batch = batchByMemberId.get(rotation.id);
    const decision = decisionByMemberId.get(rotation.id);
    const unplannedReason = unplannedByMemberId.get(rotation.id) ?? null;
    const replay =
      (batch ? reservationByBatchId.get(batch.id) : undefined) ??
      longRangeReservationByMemberId.get(rotation.id);
    const activeCapacity =
      availabilityByResourceGroup.get(rotation.resourceGroupId)?.lanes.length ?? 0;
    const fallbackProfile = turnaroundProfile(input, rotation, null);
    const fallbackBasis = resolveForecastDurationBasis({
      now: input.event.now,
      eventId: input.event.eventId,
      productCode: rotation.productCode,
      aircraftType: null,
      referenceDurationMinutes: referenceDurationMinutes(rotation, fallbackProfile),
      durationSamples: input.durationSamples,
      interrupted: input.event.operationalInterrupted || input.event.emergencyMode,
      activeCapacity,
      tuning,
    });
    const overdue = hasOverdueConstraint(input, rotation);
    const baseUncertainty = uncertaintyReasons(input, rotation, activeCapacity, overdue);
    const planned = plannedMilestones({ rotation, profile: fallbackProfile, activeCapacity });
    if (!replay) {
      const unavailableReason = input.capacities.find(
        (capacity) => capacity.resourceGroupId === rotation.resourceGroupId,
      )?.unavailableReason;
      const effectiveUnplannedReason =
        unplannedReason === "NO_FORECAST_CAPACITY" && unavailableReason
          ? unavailableReason
          : unplannedReason;
      const capacityStatus = capacityStatusForUnplannedReason(effectiveUnplannedReason);
      const reasons: ForecastUncertaintyReason[] = baseUncertainty.filter(
        (reason) => reason !== "NO_FORECAST_CAPACITY" && reason !== "NO_FITTING_AIRCRAFT",
      );
      if (capacityStatus !== "AVAILABLE") reasons.push(capacityStatus);
      return {
        rotationId: rotation.id,
        ...planned,
        predictedBoardingAt: null,
        predictedDepartureAt: null,
        predictedLandingAt: null,
        predictedCompletionAt: null,
        forecastState: "UNAVAILABLE",
        extendsBeyondOperationsEnd: false,
        overtimeMinutes: 0,
        predictionQuality:
          capacityStatus === "AVAILABLE" ? fallbackBasis.estimate.quality : "UNCERTAIN",
        predictionLowerMinutes: null,
        predictionUpperMinutes: null,
        capacityStatus,
        dataBasisScope: fallbackBasis.dataBasisScope,
        sampleSize: fallbackBasis.acceptedSampleSize,
        dataAgeMinutes: fallbackBasis.dataAgeMinutes,
        activeCapacity,
        referenceDurationMinutes: fallbackBasis.referenceDurationMinutes,
        assumedAircraftId: null,
        ...fallbackProfile,
        uncertaintyReasons: reasons,
        dispatchPlanId: dispatchPlan.planId,
        dispatchPlanRevision: dispatchPlan.revision,
        dispatchBatchId: null,
        dispatchOrder: null,
        dispatchWave: null,
        dispatchLaneId: null,
        dispatchGroupIds: [],
        dispatchOccupiedSeats: null,
        dispatchAvailableSeats: null,
        dispatchCommitmentLevel: null,
        dispatchDecisionReasons: [],
        dispatchDecisionDetails: null,
        dispatchProjectedOvertakeCount: 0,
        dispatchUnplannedReason: effectiveUnplannedReason,
      };
    }
    const midpointMinutes = (replay.window.lowerMinutes + replay.window.upperMinutes) / 2;
    const predictedBoardingAt = addMinutes(now, midpointMinutes);
    const totalDurationMinutes = replay.duration.expectedMinutes;
    const boardingMinutes = Math.min(replay.boardingMinutes, totalDurationMinutes);
    const completionMinutes = Math.min(
      replay.deboardingMinutes + replay.bufferMinutes,
      Math.max(0, totalDurationMinutes - boardingMinutes),
    );
    const flightMinutes = Math.max(0, totalDurationMinutes - boardingMinutes - completionMinutes);
    const predictedDepartureAt = addMinutes(predictedBoardingAt, boardingMinutes);
    const predictedLandingAt = addMinutes(predictedDepartureAt, flightMinutes);
    const predictedCompletionAt = addMinutes(predictedLandingAt, completionMinutes);
    const operationsEnd = operationsEndAssessment(
      predictedCompletionAt,
      input.event.plannedOperationsEndAt,
    );
    const predictionWindow = integerPredictionWindow(
      replay.window.lowerMinutes,
      replay.window.upperMinutes,
    );
    const hardUnavailable =
      input.event.emergencyMode ||
      input.event.operationalInterrupted ||
      rotation.resourceGroupStatus === "INTERRUPTED" ||
      rotation.resourceGroupStatus === "ENDED";
    return {
      rotationId: rotation.id,
      ...plannedMilestones({ rotation, profile: replay, activeCapacity }),
      predictedBoardingAt,
      predictedDepartureAt,
      predictedLandingAt,
      predictedCompletionAt,
      forecastState: projectedForecastState(
        hardUnavailable,
        operationsEnd.extendsBeyondOperationsEnd,
        batch !== undefined,
      ),
      ...operationsEnd,
      predictionQuality: replay.window.quality,
      predictionLowerMinutes: predictionWindow.lowerMinutes,
      predictionUpperMinutes: predictionWindow.upperMinutes,
      capacityStatus: replay.capacityStatus,
      dataBasisScope: replay.durationBasis.dataBasisScope,
      sampleSize: replay.durationBasis.acceptedSampleSize,
      dataAgeMinutes: replay.durationBasis.dataAgeMinutes,
      activeCapacity,
      referenceDurationMinutes: replay.durationBasis.referenceDurationMinutes,
      assumedAircraftId:
        replay.selectedAircraftId?.startsWith("forecast-capacity-") === true
          ? null
          : replay.selectedAircraftId,
      boardingMinutes: replay.boardingMinutes,
      deboardingMinutes: replay.deboardingMinutes,
      bufferMinutes: replay.bufferMinutes,
      boardingSource: replay.boardingSource,
      deboardingSource: replay.deboardingSource,
      bufferSource: replay.bufferSource,
      uncertaintyReasons: baseUncertainty.filter(
        (reason) => reason !== "NO_FORECAST_CAPACITY" && reason !== "NO_FITTING_AIRCRAFT",
      ),
      dispatchPlanId: dispatchPlan.planId,
      dispatchPlanRevision: dispatchPlan.revision,
      dispatchBatchId: batch?.id ?? null,
      dispatchOrder: batch?.dispatchOrder ?? null,
      dispatchWave: batch?.wave ?? null,
      dispatchLaneId: batch?.laneId ?? null,
      dispatchGroupIds: batch?.groupIds ?? [],
      dispatchOccupiedSeats: batch?.occupiedSeats ?? null,
      dispatchAvailableSeats: batch?.availableSeats ?? null,
      dispatchCommitmentLevel: batch?.commitmentLevel ?? null,
      dispatchDecisionReasons: batch?.decisionReasons ?? [],
      dispatchDecisionDetails: batch?.decisionDetails ?? null,
      dispatchProjectedOvertakeCount: decision?.projectedOvertakeCount ?? 0,
      dispatchUnplannedReason: batch ? null : unplannedReason,
    };
  });
  return { projections, diagnostics: { dispatchInput, dispatchPlan } };
}
