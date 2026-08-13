import {
  createDispatchPlan,
  type DispatchPlanInput,
  orderDispatchGroupsForProjection,
} from "./dispatch-plan";
import {
  advanceOverduePrediction,
  createQueueAvailability,
  forecastQueueWindows,
  type QueueAvailabilityConstraint,
  type QueueAvailabilityState,
  reserveNextQueueWindow,
  slowdownMultiplier,
} from "./forecast-availability";
import { operationsEndAssessment } from "./forecast-diagnostics";
import { estimateDuration, selectRobustDurationSamples } from "./forecast-sampling";
import {
  DEFAULT_FORECAST_TUNING_PROFILE,
  type DurationEstimate,
  type ForecastAvailabilityConstraintInput,
  type ForecastCalculationResult,
  type ForecastCapacityStatus,
  type ForecastDataBasisScope,
  type ForecastState,
  type ForecastTimelineProjection,
  type ForecastTimelineRotationInput,
  type ForecastTimelinesInput,
  type ForecastUncertaintyReason,
  type PredictionQuality,
} from "./forecast-types";
import { deriveReferenceRotationBreakdown } from "./reference-rotation";
import { compareTechnicalStrings } from "./technical-order";

function addMinutes(value: string | Date, minutes: number): string {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
}

function createOffsetMinutes(now: Date): (value: string) => number {
  return (value) => Math.max(0, (Date.parse(value) - now.getTime()) / 60_000);
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

function forecastDataBasisScope(
  acceptedSampleCount: number,
  hasAircraftHistory: boolean,
): ForecastDataBasisScope {
  if (acceptedSampleCount === 0) return "REFERENCE_ONLY";
  if (hasAircraftHistory) return "AIRCRAFT_PRODUCT_HISTORY";
  return "PRODUCT_HISTORY";
}

function capacityStatusForUnplannedReason(
  reason: ForecastTimelineProjection["dispatchUnplannedReason"],
): ForecastCapacityStatus {
  if (reason === "NO_FORECAST_CAPACITY" || reason === "UNKNOWN_RESOURCE_RETURN") {
    return "NO_FORECAST_CAPACITY";
  }
  if (reason === "WAITING_FOR_FITTING_LANE") return "NO_FITTING_AIRCRAFT";
  return "AVAILABLE";
}

function projectedForecastState(
  hardUnavailable: boolean,
  extendsBeyondOperationsEnd: boolean,
  hasDispatchBatch: boolean,
): ForecastState {
  if (hardUnavailable) return "UNAVAILABLE";
  if (extendsBeyondOperationsEnd) return "AFTER_OPERATIONS_END";
  if (hasDispatchBatch) return "DISPATCH_WINDOW";
  return "LONG_RANGE_WINDOW";
}

type ForecastRotation = ForecastTimelinesInput["rotations"][number];
type ForecastDurationSample = ForecastTimelinesInput["durationSamples"][number];
type ForecastTuning = NonNullable<ForecastTimelinesInput["tuning"]>;
type DispatchGroupInput = DispatchPlanInput["groups"][number];
type DispatchLaneInput = DispatchPlanInput["lanes"][number];

interface LegacyTurnaroundState {
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  boardingSource: string;
  deboardingSource: string;
  bufferSource: string;
  referenceTotalMinutes: number;
  assumedAircraftId: string | null;
}

interface LegacyHistoryBasis {
  actualDurations: number[];
  dataBasisScope: ForecastDataBasisScope;
  dataAgeMinutes: number;
}

function initialLegacyTurnaround(
  input: ForecastTimelinesInput,
  rotation: ForecastRotation,
): LegacyTurnaroundState {
  const profile = rotation.confirmedTurnaroundProfile;
  const boardingMinutes = profile?.boardingMinutes ?? input.event.plannedBoardingMinutes;
  const deboardingMinutes = profile?.deboardingMinutes ?? input.event.plannedDeboardingMinutes;
  const bufferMinutes = profile?.bufferMinutes ?? input.event.plannedBufferMinutes;
  return {
    boardingMinutes,
    deboardingMinutes,
    bufferMinutes,
    boardingSource: profile?.boardingSource ?? `EVENT:${input.event.eventId}`,
    deboardingSource: profile?.deboardingSource ?? `EVENT:${input.event.eventId}`,
    bufferSource: profile?.bufferSource ?? `EVENT:${input.event.eventId}`,
    referenceTotalMinutes: deriveReferenceRotationBreakdown({
      boardingMinutes,
      offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
      deboardingMinutes,
      bufferMinutes,
    }).totalMinutes,
    assumedAircraftId: rotation.status === "DRAFT" ? null : (rotation.aircraftId ?? null),
  };
}

function legacyHistoryBasis(
  input: ForecastTimelinesInput,
  rotation: ForecastRotation,
  newestSamples: ForecastDurationSample[],
  referenceTotalMinutes: number,
  tuning: ForecastTuning,
  now: Date,
): LegacyHistoryBasis {
  const allProductHistory = newestSamples.filter(
    (sample) => sample.productCode === rotation.productCode,
  );
  const currentDayHistory = allProductHistory.filter(
    (sample) => sample.eventId === input.event.eventId,
  );
  const productHistory = currentDayHistory.length > 0 ? currentDayHistory : allProductHistory;
  const aircraftHistory = rotation.aircraftType
    ? productHistory.filter((sample) => sample.aircraftType === rotation.aircraftType)
    : [];
  const selectedHistory = (aircraftHistory.length > 0 ? aircraftHistory : productHistory).slice(
    0,
    tuning.maximumSamples,
  );
  const actualDurations = [...selectedHistory].reverse().map((sample) => sample.minutes);
  const acceptedDurationValues = new Set(
    selectRobustDurationSamples(actualDurations, referenceTotalMinutes, tuning),
  );
  const acceptedHistory = selectedHistory.filter((sample) =>
    acceptedDurationValues.has(sample.minutes),
  );
  const lastActualAt = acceptedHistory[0]?.completedAt;
  return {
    actualDurations,
    dataBasisScope: forecastDataBasisScope(acceptedHistory.length, aircraftHistory.length > 0),
    dataAgeMinutes: lastActualAt
      ? Math.max(0, (now.getTime() - Date.parse(lastActualAt)) / 60_000)
      : 0,
  };
}

function legacyUncertaintyReasons(
  input: ForecastTimelinesInput,
  rotation: ForecastRotation,
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

function legacyPredictionMilestones(args: {
  input: ForecastTimelinesInput;
  rotation: ForecastRotation;
  now: Date;
  window: { lowerMinutes: number; upperMinutes: number } | null;
  estimate: DurationEstimate;
  effectiveEstimate: DurationEstimate;
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
}) {
  const phaseMultiplier =
    args.estimate.expectedMinutes > 0
      ? Math.max(1, args.effectiveEstimate.expectedMinutes / args.estimate.expectedMinutes)
      : 1;
  let predictedBoardingAt = args.window
    ? addMinutes(args.now, (args.window.lowerMinutes + args.window.upperMinutes) / 2)
    : null;
  if (args.rotation.calledAt) predictedBoardingAt = args.rotation.calledAt;
  let predictedDepartureAt = predictedBoardingAt
    ? addMinutes(predictedBoardingAt, args.boardingMinutes * phaseMultiplier)
    : null;
  if (args.rotation.departedAt) predictedDepartureAt = args.rotation.departedAt;
  const expectedFlightMinutes =
    Math.max(
      args.rotation.referenceDurationMinutes,
      args.estimate.expectedMinutes -
        args.boardingMinutes -
        args.deboardingMinutes -
        args.bufferMinutes,
    ) * phaseMultiplier;
  let predictedLandingAt = predictedDepartureAt
    ? addMinutes(predictedDepartureAt, expectedFlightMinutes)
    : null;
  if (args.rotation.landedAt) predictedLandingAt = args.rotation.landedAt;
  let predictedCompletionAt = predictedLandingAt
    ? addMinutes(
        predictedLandingAt,
        (args.deboardingMinutes + args.bufferMinutes) * phaseMultiplier,
      )
    : null;
  if (
    args.rotation.status !== "DRAFT" &&
    predictedDepartureAt &&
    predictedLandingAt &&
    predictedCompletionAt
  ) {
    const advanced = advanceOverduePrediction({
      status: args.rotation.status,
      now: args.input.event.now,
      predictedDepartureAt,
      predictedLandingAt,
      predictedCompletionAt,
    });
    predictedDepartureAt = advanced.predictedDepartureAt;
    predictedLandingAt = advanced.predictedLandingAt;
    predictedCompletionAt = advanced.predictedCompletionAt;
  }
  return {
    predictedBoardingAt,
    predictedDepartureAt,
    predictedLandingAt,
    predictedCompletionAt,
  };
}

/**
 * Projects every open rotation from normalized state. The caller owns storage, transport and time;
 * this function deliberately has no Cloudflare, database or browser dependency.
 */
function calculateLegacyForecastTimelines(
  input: ForecastTimelinesInput,
): ForecastTimelineProjection[] {
  const now = new Date(input.event.now);
  if (!Number.isFinite(now.getTime())) throw new Error("Forecast time is invalid.");
  const tuning = input.tuning ?? DEFAULT_FORECAST_TUNING_PROFILE;
  const capacities = new Map(
    input.capacities.map((entry) => [
      entry.resourceGroupId,
      {
        ...entry,
        activeAircraft: Math.max(0, Math.floor(entry.activeAircraft)),
      },
    ]),
  );
  const busyAircraftMinutes = new Map<string, number[]>();
  for (const rotation of input.rotations) {
    if (rotation.status === "DRAFT") continue;
    let predictedCompletion = rotation.predictedCompletionAt
      ? Date.parse(rotation.predictedCompletionAt)
      : Number.NaN;
    if (
      rotation.predictedDepartureAt &&
      rotation.predictedLandingAt &&
      rotation.predictedCompletionAt
    ) {
      predictedCompletion = Date.parse(
        advanceOverduePrediction({
          status: rotation.status,
          now: input.event.now,
          predictedDepartureAt: rotation.predictedDepartureAt,
          predictedLandingAt: rotation.predictedLandingAt,
          predictedCompletionAt: rotation.predictedCompletionAt,
        }).predictedCompletionAt,
      );
    }
    const fallback = deriveReferenceRotationBreakdown({
      boardingMinutes: input.event.plannedBoardingMinutes,
      offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
      deboardingMinutes: input.event.plannedDeboardingMinutes,
      bufferMinutes: input.event.plannedBufferMinutes,
    }).totalMinutes;
    const remaining = Number.isFinite(predictedCompletion)
      ? Math.max(0, (predictedCompletion - now.getTime()) / 60_000)
      : fallback;
    const values = busyAircraftMinutes.get(rotation.resourceGroupId) ?? [];
    values.push(remaining);
    busyAircraftMinutes.set(rotation.resourceGroupId, values);
  }
  const offsetMinutes = createOffsetMinutes(now);
  const constraintToQueueConstraint = createQueueConstraintConverter(offsetMinutes);
  const { start: operationStartMinutes, end: operationEndMinutes } = operationWindowMinutes(
    input,
    offsetMinutes,
  );
  const queueAvailability = new Map(
    [...capacities.entries()].map(([resourceGroupId, capacity]) => {
      const sharedConstraints = (capacity.sharedConstraints ?? []).map(constraintToQueueConstraint);
      const lanes = capacity.availabilityLanes?.map((lane) => {
        const lower = Math.max(operationStartMinutes, offsetMinutes(lane.availableLowerAt));
        const expected = Math.max(operationStartMinutes, offsetMinutes(lane.availableExpectedAt));
        const upper = Math.max(
          expected,
          operationStartMinutes,
          offsetMinutes(lane.availableUpperAt),
        );
        return {
          laneId: lane.laneId,
          aircraftId: lane.aircraftId,
          ...(lane.passengerSeats === undefined ? {} : { passengerSeats: lane.passengerSeats }),
          lowerMinutes: Math.min(lower, expected),
          expectedMinutes: expected,
          upperMinutes: upper,
          constraints: [
            ...sharedConstraints,
            ...(lane.constraints ?? []).map(constraintToQueueConstraint),
          ].sort(
            (left, right) =>
              left.earliestStartMinutes - right.earliestStartMinutes ||
              left.id.localeCompare(right.id),
          ),
          recurringConstraints: (lane.recurringConstraints ?? []).map((constraint) => ({
            id: constraint.id,
            triggerMetric: constraint.triggerMetric,
            intervalValue: constraint.intervalValue,
            lowerProgress: constraint.progressValue,
            expectedProgress: constraint.progressValue,
            upperProgress: constraint.progressValue,
            minimumDurationMinutes: constraint.minimumDurationMinutes,
            typicalDurationMinutes: constraint.typicalDurationMinutes,
            maximumDurationMinutes: constraint.maximumDurationMinutes,
            active: constraint.active ?? true,
          })),
        };
      });
      if (lanes && lanes.length > 0) {
        return [
          resourceGroupId,
          createQueueAvailability({
            activeAircraft: lanes.length,
            busyAircraftMinutes: [],
            lanes,
          }),
        ] as const;
      }
      const busy = busyAircraftMinutes.get(resourceGroupId) ?? [];
      const idleCount = Math.max(0, capacity.activeAircraft - busy.length);
      const fallbackBusy = busy.slice(0, capacity.activeAircraft);
      const fallbackLanes = [
        ...fallbackBusy.map((minutes, index) => ({
          laneId: `busy-${index + 1}`,
          lowerMinutes: minutes,
          expectedMinutes: minutes,
          upperMinutes: minutes,
          constraints: sharedConstraints,
          recurringConstraints: [],
        })),
        ...Array.from({ length: idleCount }, (_, index) => ({
          laneId: `idle-${index + 1}`,
          lowerMinutes: operationStartMinutes,
          expectedMinutes: operationStartMinutes,
          upperMinutes: operationStartMinutes,
          constraints: sharedConstraints,
          recurringConstraints: [],
        })),
      ];
      return [
        resourceGroupId,
        createQueueAvailability({
          activeAircraft: capacity.activeAircraft,
          busyAircraftMinutes: fallbackBusy,
          lanes: fallbackLanes,
        }),
      ] as const;
    }),
  );
  const newestSamples = [...input.durationSamples].sort(
    (left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt),
  );

  return input.rotations.map((rotation) => {
    const initialTurnaround = initialLegacyTurnaround(input, rotation);
    let {
      boardingMinutes: boarding,
      deboardingMinutes: deboarding,
      bufferMinutes: buffer,
      boardingSource,
      deboardingSource,
      bufferSource,
      referenceTotalMinutes: referenceTotal,
      assumedAircraftId,
    } = initialTurnaround;
    const capacity = capacities.get(rotation.resourceGroupId);
    const activeCapacity = capacity?.activeAircraft ?? 0;
    const forecastCapacity = queueAvailability.get(rotation.resourceGroupId)?.lanes.length ?? 0;
    const { actualDurations, dataBasisScope, dataAgeMinutes } = legacyHistoryBasis(
      input,
      rotation,
      newestSamples,
      referenceTotal,
      tuning,
      now,
    );
    const hasOverdueConstraint = [
      ...(capacity?.sharedConstraints ?? []),
      ...(capacity?.availabilityLanes ?? []).flatMap((lane) => lane.constraints ?? []),
    ].some((constraint) => constraint.overdue);
    const uncertaintyReasons = legacyUncertaintyReasons(
      input,
      rotation,
      forecastCapacity,
      hasOverdueConstraint,
    );
    const estimate = estimateDuration({
      referenceMinutes: referenceTotal,
      actualDurationsMinutes: actualDurations,
      interrupted: input.event.emergencyMode || input.event.operationalInterrupted,
      activeCapacity: forecastCapacity,
      tuning,
    });
    const predictionQuality =
      hasOverdueConstraint && estimate.quality === "STABLE" ? "CHANGING" : estimate.quality;
    let effectiveEstimate = { ...estimate, quality: predictionQuality };
    let capacityStatus: ForecastCapacityStatus = "AVAILABLE";
    let window: {
      lowerMinutes: number;
      upperMinutes: number;
      quality: PredictionQuality;
    } | null = forecastQueueWindows({
      queueSequence: rotation.queueSequence,
      activeAircraft: forecastCapacity,
      duration: effectiveEstimate,
    });
    if (rotation.status === "DRAFT") {
      const availability =
        queueAvailability.get(rotation.resourceGroupId) ??
        createQueueAvailability({
          activeAircraft: forecastCapacity,
          busyAircraftMinutes: [],
        });
      const reservation = reserveNextQueueWindow(
        availability,
        effectiveEstimate,
        operationEndMinutes,
        rotation.passengerCount ?? 1,
        new Map(
          (rotation.turnaroundProfiles ?? []).map((profile) => [
            profile.aircraftId,
            estimateDuration({
              referenceMinutes: deriveReferenceRotationBreakdown({
                boardingMinutes: profile.boardingMinutes,
                offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
                deboardingMinutes: profile.deboardingMinutes,
                bufferMinutes: profile.bufferMinutes,
              }).totalMinutes,
              actualDurationsMinutes: actualDurations,
              interrupted: input.event.emergencyMode || input.event.operationalInterrupted,
              activeCapacity: forecastCapacity,
              tuning,
            }),
          ]),
        ),
      );
      window = reservation.window;
      capacityStatus = reservation.capacityStatus;
      effectiveEstimate = reservation.duration;
      assumedAircraftId = reservation.selectedAircraftId;
      const selectedProfile = rotation.turnaroundProfiles?.find(
        (profile) => profile.aircraftId === reservation.selectedAircraftId,
      );
      if (selectedProfile) {
        boarding = selectedProfile.boardingMinutes;
        deboarding = selectedProfile.deboardingMinutes;
        buffer = selectedProfile.bufferMinutes;
        boardingSource = selectedProfile.boardingSource;
        deboardingSource = selectedProfile.deboardingSource;
        bufferSource = selectedProfile.bufferSource;
        referenceTotal = deriveReferenceRotationBreakdown({
          boardingMinutes: boarding,
          offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
          deboardingMinutes: deboarding,
          bufferMinutes: buffer,
        }).totalMinutes;
      }
      queueAvailability.set(rotation.resourceGroupId, reservation.availability);
      if (capacityStatus !== "AVAILABLE") {
        uncertaintyReasons.push(capacityStatus);
        effectiveEstimate = { ...effectiveEstimate, quality: "UNCERTAIN" };
      }
    } else if (rotation.constraints && rotation.constraints.length > 0) {
      const converted = rotation.constraints.map(constraintToQueueConstraint);
      const lowerMultiplier = slowdownMultiplier(
        0,
        effectiveEstimate.lowerMinutes,
        converted,
        "lower",
      );
      const expectedMultiplier = slowdownMultiplier(
        0,
        effectiveEstimate.expectedMinutes,
        converted,
        "expected",
      );
      const upperMultiplier = slowdownMultiplier(
        0,
        effectiveEstimate.upperMinutes,
        converted,
        "upper",
      );
      effectiveEstimate = {
        ...effectiveEstimate,
        lowerMinutes: (effectiveEstimate.lowerMinutes * lowerMultiplier) / 100,
        expectedMinutes: (effectiveEstimate.expectedMinutes * expectedMultiplier) / 100,
        upperMinutes: (effectiveEstimate.upperMinutes * upperMultiplier) / 100,
        quality:
          expectedMultiplier > 100 && effectiveEstimate.quality === "STABLE"
            ? "CHANGING"
            : effectiveEstimate.quality,
      };
    }
    const planOffset =
      Math.floor(Math.max(0, rotation.queueSequence - 1) / Math.max(1, forecastCapacity)) *
      referenceTotal;
    const plannedBoardingAt = addMinutes(rotation.createdAt, planOffset);
    const plannedDepartureAt = addMinutes(plannedBoardingAt, boarding);
    const plannedLandingAt = addMinutes(plannedDepartureAt, rotation.referenceDurationMinutes);
    const plannedCompletionAt = addMinutes(plannedLandingAt, deboarding + buffer);
    const { predictedBoardingAt, predictedDepartureAt, predictedLandingAt, predictedCompletionAt } =
      legacyPredictionMilestones({
        input,
        rotation,
        now,
        window,
        estimate,
        effectiveEstimate,
        boardingMinutes: boarding,
        deboardingMinutes: deboarding,
        bufferMinutes: buffer,
      });
    const operationsEnd = operationsEndAssessment(
      predictedCompletionAt,
      input.event.plannedOperationsEndAt,
    );
    return {
      rotationId: rotation.id,
      plannedBoardingAt,
      plannedDepartureAt,
      plannedLandingAt,
      plannedCompletionAt,
      predictedBoardingAt,
      predictedDepartureAt,
      predictedLandingAt,
      predictedCompletionAt,
      forecastState: "UNAVAILABLE" as const,
      ...operationsEnd,
      predictionQuality: effectiveEstimate.quality,
      predictionLowerMinutes: window?.lowerMinutes ?? null,
      predictionUpperMinutes: window?.upperMinutes ?? null,
      capacityStatus,
      dataBasisScope,
      sampleSize: estimate.sampleCount,
      dataAgeMinutes,
      activeCapacity,
      referenceDurationMinutes: referenceTotal,
      assumedAircraftId,
      boardingMinutes: boarding,
      deboardingMinutes: deboarding,
      bufferMinutes: buffer,
      boardingSource,
      deboardingSource,
      bufferSource,
      uncertaintyReasons,
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
      dispatchProjectedOvertakeCount: 0,
      dispatchUnplannedReason: null,
    };
  });
}

interface DispatchReplayReservation {
  window: {
    lowerMinutes: number;
    upperMinutes: number;
    quality: PredictionQuality;
  };
  capacityStatus: ForecastCapacityStatus;
  selectedAircraftId: string | null;
  duration: DurationEstimate;
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  boardingSource: string;
  deboardingSource: string;
  bufferSource: string;
}

interface ForecastTurnaroundProfile {
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  boardingSource: string;
  deboardingSource: string;
  bufferSource: string;
}

interface LongRangeReplayReservation extends DispatchReplayReservation {
  selectedLaneId: string;
  memberIds: string[];
  groupIds: string[];
  occupiedSeats: number;
  availableSeats: number;
}

function collectBusyMinutesByResourceGroup(
  legacy: ForecastTimelineProjection[],
  rotationsById: Map<string, ForecastRotation>,
  now: Date,
): Map<string, number[]> {
  const busyMinutesByResourceGroup = new Map<string, number[]>();
  for (const projection of legacy) {
    const rotation = rotationsById.get(projection.rotationId);
    if (!rotation || rotation.status === "DRAFT") continue;
    const completionMs = projection.predictedCompletionAt
      ? Date.parse(projection.predictedCompletionAt)
      : Number.NaN;
    const remaining = Number.isFinite(completionMs)
      ? Math.max(0, (completionMs - now.getTime()) / 60_000)
      : projection.referenceDurationMinutes;
    const values = busyMinutesByResourceGroup.get(rotation.resourceGroupId) ?? [];
    values.push(remaining);
    busyMinutesByResourceGroup.set(rotation.resourceGroupId, values);
  }
  return busyMinutesByResourceGroup;
}

function createDispatchAvailability(args: {
  input: ForecastTimelinesInput;
  busyMinutesByResourceGroup: Map<string, number[]>;
  operationStartMinutes: number;
  offsetMinutes: (value: string) => number;
  convertConstraint: (
    constraint: ForecastAvailabilityConstraintInput,
  ) => QueueAvailabilityConstraint;
}): {
  availabilityByResourceGroup: Map<string, QueueAvailabilityState>;
  pilotIdByLaneId: Map<string, string | null>;
} {
  const availabilityByResourceGroup = new Map<string, QueueAvailabilityState>();
  const pilotIdByLaneId = new Map<string, string | null>();
  for (const capacity of args.input.capacities) {
    const sharedConstraints = (capacity.sharedConstraints ?? []).map(args.convertConstraint);
    const explicitLanes = capacity.availabilityLanes?.map((lane) => {
      pilotIdByLaneId.set(lane.laneId, lane.pilotId ?? null);
      const lower = Math.max(args.operationStartMinutes, args.offsetMinutes(lane.availableLowerAt));
      const expected = Math.max(
        args.operationStartMinutes,
        args.offsetMinutes(lane.availableExpectedAt),
      );
      const upper = Math.max(
        expected,
        args.operationStartMinutes,
        args.offsetMinutes(lane.availableUpperAt),
      );
      return {
        laneId: lane.laneId,
        aircraftId: lane.aircraftId,
        ...(lane.passengerSeats === undefined ? {} : { passengerSeats: lane.passengerSeats }),
        lowerMinutes: Math.min(lower, expected),
        expectedMinutes: expected,
        upperMinutes: upper,
        constraints: [
          ...sharedConstraints,
          ...(lane.constraints ?? []).map(args.convertConstraint),
        ].sort(
          (left, right) =>
            left.earliestStartMinutes - right.earliestStartMinutes ||
            left.id.localeCompare(right.id),
        ),
        recurringConstraints: (lane.recurringConstraints ?? []).map((constraint) => ({
          id: constraint.id,
          triggerMetric: constraint.triggerMetric,
          intervalValue: constraint.intervalValue,
          lowerProgress: constraint.progressValue,
          expectedProgress: constraint.progressValue,
          upperProgress: constraint.progressValue,
          minimumDurationMinutes: constraint.minimumDurationMinutes,
          typicalDurationMinutes: constraint.typicalDurationMinutes,
          maximumDurationMinutes: constraint.maximumDurationMinutes,
          active: constraint.active ?? true,
        })),
      };
    });
    if (explicitLanes && explicitLanes.length > 0) {
      availabilityByResourceGroup.set(
        capacity.resourceGroupId,
        createQueueAvailability({
          activeAircraft: explicitLanes.length,
          busyAircraftMinutes: [],
          lanes: explicitLanes,
        }),
      );
      continue;
    }
    const activeAircraft = Math.max(0, Math.floor(capacity.activeAircraft));
    const busy = (args.busyMinutesByResourceGroup.get(capacity.resourceGroupId) ?? []).slice(
      0,
      activeAircraft,
    );
    const fallbackLanes = [
      ...busy.map((minutes, index) => ({
        laneId: `busy-${capacity.resourceGroupId}-${index + 1}`,
        aircraftId: `forecast-capacity-${capacity.resourceGroupId}-${index + 1}`,
        passengerSeats: Number.MAX_SAFE_INTEGER,
        lowerMinutes: minutes,
        expectedMinutes: minutes,
        upperMinutes: minutes,
        constraints: sharedConstraints,
        recurringConstraints: [],
      })),
      ...Array.from({ length: Math.max(0, activeAircraft - busy.length) }, (_, index) => ({
        laneId: `idle-${capacity.resourceGroupId}-${index + 1}`,
        aircraftId: `forecast-capacity-${capacity.resourceGroupId}-${busy.length + index + 1}`,
        passengerSeats: Number.MAX_SAFE_INTEGER,
        lowerMinutes: args.operationStartMinutes,
        expectedMinutes: args.operationStartMinutes,
        upperMinutes: args.operationStartMinutes,
        constraints: sharedConstraints,
        recurringConstraints: [],
      })),
    ];
    availabilityByResourceGroup.set(
      capacity.resourceGroupId,
      createQueueAvailability({
        activeAircraft,
        busyAircraftMinutes: busy,
        lanes: fallbackLanes,
      }),
    );
  }
  return { availabilityByResourceGroup, pilotIdByLaneId };
}

function replayDispatchBatches(args: {
  dispatchPlan: ReturnType<typeof createDispatchPlan>;
  rotationsById: Map<string, ForecastRotation>;
  availabilityByResourceGroup: Map<string, QueueAvailabilityState>;
  operationEndMinutes: number | null;
  durationEstimate: (
    rotation: ForecastRotation,
    aircraftId: string | null,
    activeCapacity: number,
  ) => DurationEstimate;
  turnaroundProfile: (
    rotation: ForecastRotation,
    aircraftId: string | null,
  ) => ForecastTurnaroundProfile;
}): Map<string, DispatchReplayReservation> {
  const reservationByBatchId = new Map<string, DispatchReplayReservation>();
  for (const batch of args.dispatchPlan.batches) {
    const member = args.rotationsById.get(batch.memberIds[0] ?? "");
    const availability = args.availabilityByResourceGroup.get(batch.resourceGroupId);
    if (!member || !availability) continue;
    const estimatesByAircraftId = new Map(
      availability.lanes.flatMap((lane) =>
        lane.aircraftId
          ? [
              [
                lane.aircraftId,
                args.durationEstimate(member, lane.aircraftId, availability.lanes.length),
              ] as const,
            ]
          : [],
      ),
    );
    const estimate = args.durationEstimate(
      member,
      batch.assumedAircraftId,
      availability.lanes.length,
    );
    const reservation = reserveNextQueueWindow(
      availability,
      estimate,
      args.operationEndMinutes,
      batch.occupiedSeats,
      estimatesByAircraftId,
      batch.laneId,
    );
    args.availabilityByResourceGroup.set(batch.resourceGroupId, reservation.availability);
    if (!reservation.window) continue;
    const profile = args.turnaroundProfile(member, reservation.selectedAircraftId);
    reservationByBatchId.set(batch.id, {
      window: reservation.window,
      capacityStatus: reservation.capacityStatus,
      selectedAircraftId: reservation.selectedAircraftId,
      duration: reservation.duration,
      ...profile,
    });
  }
  return reservationByBatchId;
}

function laneSupportsDispatchGroup(
  lane: QueueAvailabilityState["lanes"][number],
  group: DispatchGroupInput,
  dispatchLaneById: Map<string, DispatchLaneInput>,
): boolean {
  const dispatchLane = dispatchLaneById.get(lane.laneId);
  return (
    dispatchLane !== undefined &&
    group.size <= lane.passengerSeats &&
    dispatchLane.productDurations.some((duration) => duration.productId === group.productId)
  );
}

function collectLongRangeMembers(
  remaining: DispatchGroupInput[],
  anchorGroup: DispatchGroupInput,
  passengerSeats: number,
): { memberIds: string[]; occupiedSeats: number } {
  const memberIds = [anchorGroup.id];
  let occupiedSeats = anchorGroup.size;
  for (const group of remaining) {
    if (
      group.id === anchorGroup.id ||
      group.productId !== anchorGroup.productId ||
      group.gateId !== anchorGroup.gateId ||
      occupiedSeats + group.size > passengerSeats
    ) {
      continue;
    }
    memberIds.push(group.id);
    occupiedSeats += group.size;
  }
  return { memberIds, occupiedSeats };
}

function createLongRangeReplayReservation(args: {
  remaining: DispatchGroupInput[];
  resourceGroupId: string;
  availabilityByResourceGroup: Map<string, QueueAvailabilityState>;
  dispatchLaneById: Map<string, DispatchLaneInput>;
  rotationsById: Map<string, ForecastRotation>;
  durationEstimate: (
    rotation: ForecastRotation,
    aircraftId: string | null,
    activeCapacity: number,
  ) => DurationEstimate;
  turnaroundProfile: (
    rotation: ForecastRotation,
    aircraftId: string | null,
  ) => ForecastTurnaroundProfile;
}): {
  replay: LongRangeReplayReservation;
  memberIdSet: Set<string>;
  availability: QueueAvailabilityState;
} | null {
  const availability = args.availabilityByResourceGroup.get(args.resourceGroupId);
  if (!availability || availability.lanes.length === 0) return null;
  const anchorGroup = args.remaining.find((group) =>
    availability.lanes.some((lane) =>
      laneSupportsDispatchGroup(lane, group, args.dispatchLaneById),
    ),
  );
  if (!anchorGroup) return null;
  const member = args.rotationsById.get(anchorGroup.id);
  if (!member) throw new Error(`Forecast rotation ${anchorGroup.id} disappeared.`);
  const estimatesByAircraftId = new Map(
    availability.lanes.flatMap((lane) =>
      lane.aircraftId
        ? [
            [
              lane.aircraftId,
              args.durationEstimate(member, lane.aircraftId, availability.lanes.length),
            ] as const,
          ]
        : [],
    ),
  );
  const estimate = args.durationEstimate(member, null, availability.lanes.length);
  const eligibleLaneIds = new Set(
    availability.lanes
      .filter((lane) => laneSupportsDispatchGroup(lane, anchorGroup, args.dispatchLaneById))
      .map((lane) => lane.laneId),
  );
  const laneSelection = reserveNextQueueWindow(
    availability,
    estimate,
    null,
    anchorGroup.size,
    estimatesByAircraftId,
    undefined,
    eligibleLaneIds,
  );
  const selectedLane = availability.lanes.find(
    (lane) => lane.laneId === laneSelection.selectedLaneId,
  );
  if (!selectedLane) return null;
  const { memberIds, occupiedSeats } = collectLongRangeMembers(
    args.remaining,
    anchorGroup,
    selectedLane.passengerSeats,
  );
  const reservation = reserveNextQueueWindow(
    availability,
    estimate,
    null,
    occupiedSeats,
    estimatesByAircraftId,
    selectedLane.laneId,
  );
  if (!reservation.window || !reservation.selectedLaneId) return null;
  const profile = args.turnaroundProfile(member, reservation.selectedAircraftId);
  const memberIdSet = new Set(memberIds);
  return {
    availability: reservation.availability,
    memberIdSet,
    replay: {
      window: {
        ...reservation.window,
        quality: reservation.window.quality === "UNCERTAIN" ? "UNCERTAIN" : "CHANGING",
      },
      capacityStatus: reservation.capacityStatus,
      selectedAircraftId: reservation.selectedAircraftId,
      selectedLaneId: reservation.selectedLaneId,
      duration: reservation.duration,
      ...profile,
      memberIds,
      groupIds: args.remaining
        .filter((group) => memberIdSet.has(group.id))
        .flatMap((group) => group.groupIds),
      occupiedSeats,
      availableSeats: selectedLane.passengerSeats - occupiedSeats,
    },
  };
}

/**
 * Builds a shared multi-lane dispatch plan and overlays its batch windows on the established
 * milestone forecast. A batch advances its forecast lane exactly once, regardless of how many
 * complete booking groups it contains.
 */
export function calculateForecastTimelineResult(
  input: ForecastTimelinesInput,
): ForecastCalculationResult {
  const legacy = calculateLegacyForecastTimelines(input);
  const now = new Date(input.event.now);
  if (!Number.isFinite(now.getTime())) throw new Error("Forecast time is invalid.");
  const tuning = input.tuning ?? DEFAULT_FORECAST_TUNING_PROFILE;
  const rotationsById = new Map(input.rotations.map((rotation) => [rotation.id, rotation]));
  const newestSamples = [...input.durationSamples].sort(
    (left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt),
  );
  const offsetMinutes = createOffsetMinutes(now);
  const { start: operationStartMinutes, end: operationEndMinutes } = operationWindowMinutes(
    input,
    offsetMinutes,
  );
  const constraintToQueueConstraint = createQueueConstraintConverter(offsetMinutes);
  const busyMinutesByResourceGroup = collectBusyMinutesByResourceGroup(legacy, rotationsById, now);
  const { availabilityByResourceGroup, pilotIdByLaneId } = createDispatchAvailability({
    input,
    busyMinutesByResourceGroup,
    operationStartMinutes,
    offsetMinutes,
    convertConstraint: constraintToQueueConstraint,
  });

  const turnaroundProfile = (
    rotation: ForecastTimelineRotationInput,
    aircraftId: string | null,
  ): ForecastTurnaroundProfile => {
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
  };
  const durationEstimate = (
    rotation: ForecastTimelineRotationInput,
    aircraftId: string | null,
    activeCapacity: number,
  ): DurationEstimate => {
    const profile = turnaroundProfile(rotation, aircraftId);
    const referenceMinutes = deriveReferenceRotationBreakdown({
      boardingMinutes: profile.boardingMinutes,
      offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
      deboardingMinutes: profile.deboardingMinutes,
      bufferMinutes: profile.bufferMinutes,
    }).totalMinutes;
    const allProductHistory = newestSamples.filter(
      (sample) => sample.productCode === rotation.productCode,
    );
    const currentDayHistory = allProductHistory.filter(
      (sample) => sample.eventId === input.event.eventId,
    );
    const selectedHistory = (currentDayHistory.length > 0 ? currentDayHistory : allProductHistory)
      .slice(0, tuning.maximumSamples)
      .reverse()
      .map((sample) => sample.minutes);
    return estimateDuration({
      referenceMinutes,
      actualDurationsMinutes: selectedHistory,
      interrupted: input.event.operationalInterrupted || input.event.emergencyMode,
      activeCapacity,
      tuning,
    });
  };
  const dispatchGroups = input.rotations.flatMap((rotation) => {
    if (rotation.status !== "DRAFT") return [];
    return [
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
    ];
  });
  const dispatchLanes = [...availabilityByResourceGroup.entries()].flatMap(
    ([resourceGroupId, availability]) => {
      const products = [
        ...new Set(
          dispatchGroups
            .filter((group) => group.resourceGroupId === resourceGroupId)
            .map((group) => group.productId),
        ),
      ].sort(compareTechnicalStrings);
      return availability.lanes.map((lane) => ({
        id: lane.laneId,
        aircraftId: lane.aircraftId ?? lane.laneId,
        pilotId: pilotIdByLaneId.get(lane.laneId) ?? null,
        resourceGroupId,
        passengerSeats: lane.passengerSeats,
        availableLowerAt: addMinutes(now, lane.lowerMinutes),
        availableExpectedAt: addMinutes(now, lane.expectedMinutes),
        availableUpperAt: addMinutes(now, lane.upperMinutes),
        productDurations: products.flatMap((productId) => {
          const group = dispatchGroups.find(
            (candidate) =>
              candidate.resourceGroupId === resourceGroupId && candidate.productId === productId,
          );
          const rotation = group ? rotationsById.get(group.id) : undefined;
          if (!rotation) return [];
          const estimate = durationEstimate(
            rotation,
            lane.aircraftId ?? null,
            availability.lanes.length,
          );
          return [
            {
              productId,
              lowerMinutes: estimate.lowerMinutes,
              expectedMinutes: estimate.expectedMinutes,
              upperMinutes: estimate.upperMinutes,
            },
          ];
        }),
      }));
    },
  );
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
  const reservationByBatchId = replayDispatchBatches({
    dispatchPlan,
    rotationsById,
    availabilityByResourceGroup,
    operationEndMinutes,
    durationEstimate,
    turnaroundProfile,
  });
  const dispatchLaneById = new Map(dispatchLanes.map((lane) => [lane.id, lane]));
  const nearMemberIds = new Set(dispatchPlan.batches.flatMap((batch) => batch.memberIds));
  const longRangeReservationByMemberId = new Map<string, LongRangeReplayReservation>();
  const resourceGroupIdsForTail = [
    ...new Set(dispatchGroups.map((group) => group.resourceGroupId)),
  ].sort(compareTechnicalStrings);
  for (const resourceGroupId of resourceGroupIdsForTail) {
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
        durationEstimate,
        turnaroundProfile,
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
  const projections = legacy.map((projection) => {
    const rotation = rotationsById.get(projection.rotationId);
    if (rotation?.status !== "DRAFT") {
      const operationsEnd = operationsEndAssessment(
        projection.predictedCompletionAt,
        input.event.plannedOperationsEndAt,
      );
      return {
        ...projection,
        forecastState: "UNAVAILABLE" as const,
        ...operationsEnd,
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
        dispatchProjectedOvertakeCount: 0,
        dispatchUnplannedReason: null,
      };
    }
    const batch = batchByMemberId.get(rotation.id);
    const decision = decisionByMemberId.get(rotation.id);
    const unplannedReason = unplannedByMemberId.get(rotation.id) ?? null;
    const dispatchReplay = batch ? reservationByBatchId.get(batch.id) : undefined;
    const longRangeReplay = longRangeReservationByMemberId.get(rotation.id);
    const replay = dispatchReplay ?? longRangeReplay;
    if (!replay) {
      const capacityUnavailableReason = input.capacities.find(
        (capacity) => capacity.resourceGroupId === rotation.resourceGroupId,
      )?.unavailableReason;
      const effectiveUnplannedReason =
        unplannedReason === "NO_FORECAST_CAPACITY" && capacityUnavailableReason
          ? capacityUnavailableReason
          : unplannedReason;
      const capacityStatus = capacityStatusForUnplannedReason(effectiveUnplannedReason);
      const uncertaintyReasons: ForecastUncertaintyReason[] = [
        ...projection.uncertaintyReasons,
      ].filter((reason) => reason !== "NO_FORECAST_CAPACITY" && reason !== "NO_FITTING_AIRCRAFT");
      if (capacityStatus !== "AVAILABLE") uncertaintyReasons.push(capacityStatus);
      return {
        ...projection,
        predictedBoardingAt: null,
        predictedDepartureAt: null,
        predictedLandingAt: null,
        predictedCompletionAt: null,
        forecastState: "UNAVAILABLE" as const,
        extendsBeyondOperationsEnd: false,
        overtimeMinutes: 0,
        predictionLowerMinutes: null,
        predictionUpperMinutes: null,
        predictionQuality:
          capacityStatus === "AVAILABLE" ? projection.predictionQuality : "UNCERTAIN",
        capacityStatus,
        assumedAircraftId: null,
        uncertaintyReasons,
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
        dispatchProjectedOvertakeCount: 0,
        dispatchUnplannedReason: effectiveUnplannedReason,
      };
    }
    const midpointMinutes = (replay.window.lowerMinutes + replay.window.upperMinutes) / 2;
    const predictedBoardingAt = addMinutes(now, midpointMinutes);
    const totalDurationMinutes = replay.duration.expectedMinutes;
    const boardingMinutes = Math.min(replay.boardingMinutes, totalDurationMinutes);
    const remainingAfterBoarding = Math.max(0, totalDurationMinutes - boardingMinutes);
    const completionTurnaroundMinutes = Math.min(
      replay.deboardingMinutes + replay.bufferMinutes,
      remainingAfterBoarding,
    );
    const expectedFlightMinutes = remainingAfterBoarding - completionTurnaroundMinutes;
    const predictedDepartureAt = addMinutes(predictedBoardingAt, boardingMinutes);
    const predictedLandingAt = addMinutes(predictedDepartureAt, expectedFlightMinutes);
    const predictedCompletionAt = addMinutes(predictedLandingAt, completionTurnaroundMinutes);
    const operationsEnd = operationsEndAssessment(
      predictedCompletionAt,
      input.event.plannedOperationsEndAt,
    );
    const hardUnavailable =
      input.event.emergencyMode ||
      input.event.operationalInterrupted ||
      rotation.resourceGroupStatus === "INTERRUPTED" ||
      rotation.resourceGroupStatus === "ENDED";
    const forecastState = projectedForecastState(
      hardUnavailable,
      operationsEnd.extendsBeyondOperationsEnd,
      batch !== undefined,
    );
    const referenceDurationMinutes = deriveReferenceRotationBreakdown({
      boardingMinutes: replay.boardingMinutes,
      offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
      deboardingMinutes: replay.deboardingMinutes,
      bufferMinutes: replay.bufferMinutes,
    }).totalMinutes;
    return {
      ...projection,
      predictedBoardingAt,
      predictedDepartureAt,
      predictedLandingAt,
      predictedCompletionAt,
      forecastState,
      ...operationsEnd,
      predictionQuality: replay.window.quality,
      predictionLowerMinutes: replay.window.lowerMinutes,
      predictionUpperMinutes: replay.window.upperMinutes,
      capacityStatus: replay.capacityStatus,
      assumedAircraftId:
        replay.selectedAircraftId?.startsWith("forecast-capacity-") === true
          ? null
          : replay.selectedAircraftId,
      referenceDurationMinutes,
      boardingMinutes: replay.boardingMinutes,
      deboardingMinutes: replay.deboardingMinutes,
      bufferMinutes: replay.bufferMinutes,
      boardingSource: replay.boardingSource,
      deboardingSource: replay.deboardingSource,
      bufferSource: replay.bufferSource,
      uncertaintyReasons: projection.uncertaintyReasons.filter(
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
      dispatchProjectedOvertakeCount: decision?.projectedOvertakeCount ?? 0,
      dispatchUnplannedReason: batch ? null : unplannedReason,
    };
  });
  return {
    projections,
    diagnostics: {
      dispatchInput,
      dispatchPlan,
    },
  };
}

export function calculateForecastTimelines(
  input: ForecastTimelinesInput,
): ForecastTimelineProjection[] {
  return calculateForecastTimelineResult(input).projections;
}
