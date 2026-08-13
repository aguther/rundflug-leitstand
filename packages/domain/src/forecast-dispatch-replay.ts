import type { createDispatchPlan, DispatchPlanInput } from "./dispatch-plan";
import {
  createQueueAvailability,
  type QueueAvailabilityConstraint,
  type QueueAvailabilityState,
  reserveNextQueueWindow,
} from "./forecast-availability";
import type {
  DurationEstimate,
  ForecastAvailabilityConstraintInput,
  ForecastCapacityStatus,
  ForecastTimelineProjection,
  ForecastTimelinesInput,
  PredictionQuality,
} from "./forecast-types";

type ForecastRotation = ForecastTimelinesInput["rotations"][number];
type DispatchGroupInput = DispatchPlanInput["groups"][number];
type DispatchLaneInput = DispatchPlanInput["lanes"][number];

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

export interface ForecastTurnaroundProfile {
  boardingMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
  boardingSource: string;
  deboardingSource: string;
  bufferSource: string;
}

export interface LongRangeReplayReservation extends DispatchReplayReservation {
  selectedLaneId: string;
  memberIds: string[];
  groupIds: string[];
  occupiedSeats: number;
  availableSeats: number;
}

export function collectBusyMinutesByResourceGroup(
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

export function createDispatchAvailability(args: {
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

export function replayDispatchBatches(args: {
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

export function createLongRangeReplayReservation(args: {
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
