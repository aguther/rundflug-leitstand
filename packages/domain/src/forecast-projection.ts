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
  const offsetMinutes = (value: string): number =>
    Math.max(0, (Date.parse(value) - now.getTime()) / 60_000);
  const constraintToQueueConstraint = (
    constraint: ForecastAvailabilityConstraintInput,
  ): QueueAvailabilityConstraint => {
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
  const operationStartMinutes = input.event.plannedOperationsStartAt
    ? offsetMinutes(input.event.plannedOperationsStartAt)
    : 0;
  const operationEndMinutes = input.event.plannedOperationsEndAt
    ? offsetMinutes(input.event.plannedOperationsEndAt)
    : null;
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
    const confirmedProfile = rotation.confirmedTurnaroundProfile;
    let boarding = confirmedProfile?.boardingMinutes ?? input.event.plannedBoardingMinutes;
    let deboarding = confirmedProfile?.deboardingMinutes ?? input.event.plannedDeboardingMinutes;
    let buffer = confirmedProfile?.bufferMinutes ?? input.event.plannedBufferMinutes;
    let boardingSource = confirmedProfile?.boardingSource ?? `EVENT:${input.event.eventId}`;
    let deboardingSource = confirmedProfile?.deboardingSource ?? `EVENT:${input.event.eventId}`;
    let bufferSource = confirmedProfile?.bufferSource ?? `EVENT:${input.event.eventId}`;
    let assumedAircraftId = rotation.status === "DRAFT" ? null : (rotation.aircraftId ?? null);
    let referenceTotal = deriveReferenceRotationBreakdown({
      boardingMinutes: boarding,
      offBlockToOnBlockMinutes: rotation.referenceDurationMinutes,
      deboardingMinutes: deboarding,
      bufferMinutes: buffer,
    }).totalMinutes;
    const capacity = capacities.get(rotation.resourceGroupId);
    const activeCapacity = capacity?.activeAircraft ?? 0;
    const forecastCapacity = queueAvailability.get(rotation.resourceGroupId)?.lanes.length ?? 0;
    const allProductHistory = newestSamples.filter(
      (sample) => sample.productCode === rotation.productCode,
    );
    const currentDayProductHistory = allProductHistory.filter(
      (sample) => sample.eventId === input.event.eventId,
    );
    const productHistory =
      currentDayProductHistory.length > 0 ? currentDayProductHistory : allProductHistory;
    const aircraftHistory = rotation.aircraftType
      ? productHistory.filter((sample) => sample.aircraftType === rotation.aircraftType)
      : [];
    const selectedHistory = (aircraftHistory.length > 0 ? aircraftHistory : productHistory).slice(
      0,
      tuning.maximumSamples,
    );
    const actualDurations = [...selectedHistory].reverse().map((sample) => sample.minutes);
    const acceptedDurationValues = new Set(
      selectRobustDurationSamples(actualDurations, referenceTotal, tuning),
    );
    const acceptedHistory = selectedHistory.filter((sample) =>
      acceptedDurationValues.has(sample.minutes),
    );
    const dataBasisScope: ForecastDataBasisScope =
      acceptedHistory.length === 0
        ? "REFERENCE_ONLY"
        : aircraftHistory.length > 0
          ? "AIRCRAFT_PRODUCT_HISTORY"
          : "PRODUCT_HISTORY";
    const lastActualAt = acceptedHistory[0]?.completedAt;
    const dataAgeMinutes = lastActualAt
      ? Math.max(0, (now.getTime() - Date.parse(lastActualAt)) / 60_000)
      : 0;
    const uncertaintyReasons: ForecastUncertaintyReason[] = [];
    if (input.event.operationalInterrupted) uncertaintyReasons.push("OPERATION_INTERRUPTED");
    if (input.event.emergencyMode) uncertaintyReasons.push("EMERGENCY_MODE");
    if (rotation.resourceGroupStatus !== "ACTIVE") {
      uncertaintyReasons.push("RESOURCE_GROUP_INACTIVE");
    }
    if (forecastCapacity === 0) uncertaintyReasons.push("NO_ACTIVE_CAPACITY");
    const hasOverdueConstraint = [
      ...(capacity?.sharedConstraints ?? []),
      ...(capacity?.availabilityLanes ?? []).flatMap((lane) => lane.constraints ?? []),
    ].some((constraint) => constraint.overdue);
    if (hasOverdueConstraint) {
      uncertaintyReasons.push("PLANNED_CONSTRAINT_OVERDUE");
    }
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
    const phaseMultiplier =
      estimate.expectedMinutes > 0
        ? Math.max(1, effectiveEstimate.expectedMinutes / estimate.expectedMinutes)
        : 1;
    let predictedBoardingAt = window
      ? addMinutes(now, (window.lowerMinutes + window.upperMinutes) / 2)
      : null;
    if (rotation.calledAt) predictedBoardingAt = rotation.calledAt;
    let predictedDepartureAt = predictedBoardingAt
      ? addMinutes(predictedBoardingAt, boarding * phaseMultiplier)
      : null;
    if (rotation.departedAt) predictedDepartureAt = rotation.departedAt;
    const expectedFlightMinutes =
      Math.max(
        rotation.referenceDurationMinutes,
        estimate.expectedMinutes - boarding - deboarding - buffer,
      ) * phaseMultiplier;
    let predictedLandingAt = predictedDepartureAt
      ? addMinutes(predictedDepartureAt, expectedFlightMinutes)
      : null;
    if (rotation.landedAt) predictedLandingAt = rotation.landedAt;
    let predictedCompletionAt = predictedLandingAt
      ? addMinutes(predictedLandingAt, (deboarding + buffer) * phaseMultiplier)
      : null;
    if (
      rotation.status !== "DRAFT" &&
      predictedDepartureAt &&
      predictedLandingAt &&
      predictedCompletionAt
    ) {
      const advanced = advanceOverduePrediction({
        status: rotation.status,
        now: input.event.now,
        predictedDepartureAt,
        predictedLandingAt,
        predictedCompletionAt,
      });
      predictedDepartureAt = advanced.predictedDepartureAt;
      predictedLandingAt = advanced.predictedLandingAt;
      predictedCompletionAt = advanced.predictedCompletionAt;
    }
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

interface LongRangeReplayReservation extends DispatchReplayReservation {
  selectedLaneId: string;
  memberIds: string[];
  groupIds: string[];
  occupiedSeats: number;
  availableSeats: number;
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
  const offsetMinutes = (value: string): number =>
    Math.max(0, (Date.parse(value) - now.getTime()) / 60_000);
  const operationStartMinutes = input.event.plannedOperationsStartAt
    ? offsetMinutes(input.event.plannedOperationsStartAt)
    : 0;
  const operationEndMinutes = input.event.plannedOperationsEndAt
    ? offsetMinutes(input.event.plannedOperationsEndAt)
    : null;
  const constraintToQueueConstraint = (
    constraint: ForecastAvailabilityConstraintInput,
  ): QueueAvailabilityConstraint => {
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
  const availabilityByResourceGroup = new Map<string, QueueAvailabilityState>();
  const pilotIdByLaneId = new Map<string, string | null>();
  for (const capacity of input.capacities) {
    const sharedConstraints = (capacity.sharedConstraints ?? []).map(constraintToQueueConstraint);
    const explicitLanes = capacity.availabilityLanes?.map((lane) => {
      pilotIdByLaneId.set(lane.laneId, lane.pilotId ?? null);
      const lower = Math.max(operationStartMinutes, offsetMinutes(lane.availableLowerAt));
      const expected = Math.max(operationStartMinutes, offsetMinutes(lane.availableExpectedAt));
      const upper = Math.max(expected, operationStartMinutes, offsetMinutes(lane.availableUpperAt));
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
    const busy = (busyMinutesByResourceGroup.get(capacity.resourceGroupId) ?? []).slice(
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
        lowerMinutes: operationStartMinutes,
        expectedMinutes: operationStartMinutes,
        upperMinutes: operationStartMinutes,
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

  const turnaroundProfile = (
    rotation: ForecastTimelineRotationInput,
    aircraftId: string | null,
  ): {
    boardingMinutes: number;
    deboardingMinutes: number;
    bufferMinutes: number;
    boardingSource: string;
    deboardingSource: string;
    bufferSource: string;
  } => {
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
  const reservationByBatchId = new Map<string, DispatchReplayReservation>();
  for (const batch of dispatchPlan.batches) {
    const member = rotationsById.get(batch.memberIds[0] ?? "");
    const availability = availabilityByResourceGroup.get(batch.resourceGroupId);
    if (!member || !availability) continue;
    const estimatesByAircraftId = new Map(
      availability.lanes.flatMap((lane) =>
        lane.aircraftId
          ? [
              [
                lane.aircraftId,
                durationEstimate(member, lane.aircraftId, availability.lanes.length),
              ] as const,
            ]
          : [],
      ),
    );
    const estimate = durationEstimate(member, batch.assumedAircraftId, availability.lanes.length);
    const reservation = reserveNextQueueWindow(
      availability,
      estimate,
      operationEndMinutes,
      batch.occupiedSeats,
      estimatesByAircraftId,
      batch.laneId,
    );
    availabilityByResourceGroup.set(batch.resourceGroupId, reservation.availability);
    if (!reservation.window) continue;
    const profile = turnaroundProfile(member, reservation.selectedAircraftId);
    reservationByBatchId.set(batch.id, {
      window: reservation.window,
      capacityStatus: reservation.capacityStatus,
      selectedAircraftId: reservation.selectedAircraftId,
      duration: reservation.duration,
      ...profile,
    });
  }
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
      const availability = availabilityByResourceGroup.get(resourceGroupId);
      if (!availability || availability.lanes.length === 0) break;
      const anchorGroup = remaining.find((group) =>
        availability.lanes.some((lane) => {
          const dispatchLane = dispatchLaneById.get(lane.laneId);
          if (!dispatchLane) return false;
          return (
            group.size <= lane.passengerSeats &&
            dispatchLane.productDurations.some((duration) => duration.productId === group.productId)
          );
        }),
      );
      if (!anchorGroup) break;
      const member = rotationsById.get(anchorGroup.id);
      if (!member) throw new Error(`Forecast rotation ${anchorGroup.id} disappeared.`);
      const estimatesByAircraftId = new Map(
        availability.lanes.flatMap((lane) =>
          lane.aircraftId
            ? [
                [
                  lane.aircraftId,
                  durationEstimate(member, lane.aircraftId, availability.lanes.length),
                ] as const,
              ]
            : [],
        ),
      );
      const estimate = durationEstimate(member, null, availability.lanes.length);
      const eligibleLaneIds = new Set(
        availability.lanes
          .filter((lane) => {
            const dispatchLane = dispatchLaneById.get(lane.laneId);
            return (
              dispatchLane !== undefined &&
              anchorGroup.size <= lane.passengerSeats &&
              dispatchLane.productDurations.some(
                (duration) => duration.productId === anchorGroup.productId,
              )
            );
          })
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
      if (!selectedLane) break;
      const memberIds = [anchorGroup.id];
      let occupiedSeats = anchorGroup.size;
      for (const group of remaining) {
        if (
          group.id === anchorGroup.id ||
          group.productId !== anchorGroup.productId ||
          group.gateId !== anchorGroup.gateId ||
          occupiedSeats + group.size > selectedLane.passengerSeats
        ) {
          continue;
        }
        memberIds.push(group.id);
        occupiedSeats += group.size;
      }
      const reservation = reserveNextQueueWindow(
        availability,
        estimate,
        null,
        occupiedSeats,
        estimatesByAircraftId,
        selectedLane.laneId,
      );
      if (!reservation.window || !reservation.selectedLaneId) break;
      availabilityByResourceGroup.set(resourceGroupId, reservation.availability);
      const profile = turnaroundProfile(member, reservation.selectedAircraftId);
      const memberIdSet = new Set(memberIds);
      const replay: LongRangeReplayReservation = {
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
        groupIds: remaining
          .filter((group) => memberIdSet.has(group.id))
          .flatMap((group) => group.groupIds),
        occupiedSeats,
        availableSeats: selectedLane.passengerSeats - occupiedSeats,
      };
      for (const memberId of memberIds) longRangeReservationByMemberId.set(memberId, replay);
      remaining = remaining.filter((group) => !memberIdSet.has(group.id));
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
      const capacityStatus: ForecastCapacityStatus =
        effectiveUnplannedReason === "NO_FORECAST_CAPACITY" ||
        effectiveUnplannedReason === "UNKNOWN_RESOURCE_RETURN"
          ? "NO_FORECAST_CAPACITY"
          : effectiveUnplannedReason === "WAITING_FOR_FITTING_LANE"
            ? "NO_FITTING_AIRCRAFT"
            : "AVAILABLE";
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
    const forecastState: ForecastState = hardUnavailable
      ? "UNAVAILABLE"
      : operationsEnd.extendsBeyondOperationsEnd
        ? "AFTER_OPERATIONS_END"
        : batch
          ? "DISPATCH_WINDOW"
          : "LONG_RANGE_WINDOW";
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
