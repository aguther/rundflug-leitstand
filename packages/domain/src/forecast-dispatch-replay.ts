import type { createDispatchPlan, DispatchPlanInput } from "./dispatch-plan";
import {
  createQueueAvailability,
  type QueueAvailabilityConstraint,
  type QueueAvailabilityState,
  reserveNextQueueWindow,
} from "./forecast-availability";
import type { ForecastDurationBasis } from "./forecast-duration-basis";
import type {
  DurationEstimate,
  ForecastAvailabilityConstraintInput,
  ForecastCapacityStatus,
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
  durationBasis: ForecastDurationBasis;
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

export interface ActiveForecastResourceReservation {
  resourceGroupId: string;
  aircraftId: string | null;
  pilotId: string | null;
  lowerMinutes: number;
  expectedMinutes: number;
  upperMinutes: number;
}

export function forecastLaneDurationKey(laneId: string, productId: string): string {
  return `${laneId}\u0000${productId}`;
}

export function createDispatchAvailability(args: {
  input: ForecastTimelinesInput;
  activeReservations: readonly ActiveForecastResourceReservation[];
  operationStartMinutes: number;
  offsetMinutes: (value: string) => number;
  convertConstraint: (
    constraint: ForecastAvailabilityConstraintInput,
  ) => QueueAvailabilityConstraint;
}): {
  availabilityByResourceGroup: Map<string, QueueAvailabilityState>;
  pilotIdByLaneId: Map<string, string | null>;
  aircraftTypeByLaneId: Map<string, string | null>;
} {
  const availabilityByResourceGroup = new Map<string, QueueAvailabilityState>();
  const pilotIdByLaneId = new Map<string, string | null>();
  const aircraftTypeByLaneId = new Map<string, string | null>();
  for (const capacity of args.input.capacities) {
    const sharedConstraints = (capacity.sharedConstraints ?? []).map(args.convertConstraint);
    const explicitLanes = capacity.availabilityLanes?.map((lane) => {
      pilotIdByLaneId.set(lane.laneId, lane.pilotId ?? null);
      aircraftTypeByLaneId.set(lane.laneId, lane.aircraftType ?? null);
      const activeReservations = args.activeReservations.filter(
        (reservation) =>
          reservation.resourceGroupId === capacity.resourceGroupId &&
          (reservation.aircraftId === lane.aircraftId ||
            (reservation.pilotId !== null && reservation.pilotId === (lane.pilotId ?? null))),
      );
      const activeLowerMinutes =
        activeReservations.length === 0
          ? null
          : Math.max(...activeReservations.map((reservation) => reservation.lowerMinutes));
      const activeExpectedMinutes =
        activeReservations.length === 0
          ? null
          : Math.max(...activeReservations.map((reservation) => reservation.expectedMinutes));
      const activeUpperMinutes =
        activeReservations.length === 0
          ? null
          : Math.max(...activeReservations.map((reservation) => reservation.upperMinutes));
      const lower = Math.max(
        args.operationStartMinutes,
        activeLowerMinutes ?? args.offsetMinutes(lane.availableLowerAt),
      );
      const expected = Math.max(
        args.operationStartMinutes,
        activeExpectedMinutes ?? args.offsetMinutes(lane.availableExpectedAt),
      );
      const upper = Math.max(
        expected,
        args.operationStartMinutes,
        activeUpperMinutes ?? args.offsetMinutes(lane.availableUpperAt),
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
    const busy = args.activeReservations
      .filter((reservation) => reservation.resourceGroupId === capacity.resourceGroupId)
      .map((reservation) => reservation.expectedMinutes)
      .slice(0, activeAircraft);
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
  return { availabilityByResourceGroup, pilotIdByLaneId, aircraftTypeByLaneId };
}

export function replayDispatchBatches(args: {
  dispatchPlan: ReturnType<typeof createDispatchPlan>;
  rotationsById: Map<string, ForecastRotation>;
  availabilityByResourceGroup: Map<string, QueueAvailabilityState>;
  operationEndMinutes: number | null;
  dispatchLaneById: Map<string, DispatchLaneInput>;
  durationBasisByLaneAndProduct: ReadonlyMap<string, ForecastDurationBasis>;
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
        lane.aircraftId &&
        args.durationBasisByLaneAndProduct.has(
          forecastLaneDurationKey(lane.laneId, batch.productId),
        )
          ? [
              [
                lane.aircraftId,
                args.durationBasisByLaneAndProduct.get(
                  forecastLaneDurationKey(lane.laneId, batch.productId),
                )?.estimate as DurationEstimate,
              ] as const,
            ]
          : [],
      ),
    );
    const durationBasis = args.durationBasisByLaneAndProduct.get(
      forecastLaneDurationKey(batch.laneId, batch.productId),
    );
    if (!durationBasis) continue;
    const reservation = reserveNextQueueWindow(
      availability,
      durationBasis.estimate,
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
      durationBasis: { ...durationBasis, estimate: reservation.duration },
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
  durationBasisByLaneAndProduct: ReadonlyMap<string, ForecastDurationBasis>;
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
      lane.aircraftId &&
      args.durationBasisByLaneAndProduct.has(
        forecastLaneDurationKey(lane.laneId, anchorGroup.productId),
      )
        ? [
            [
              lane.aircraftId,
              args.durationBasisByLaneAndProduct.get(
                forecastLaneDurationKey(lane.laneId, anchorGroup.productId),
              )?.estimate as DurationEstimate,
            ] as const,
          ]
        : [],
    ),
  );
  const eligibleLaneIds = new Set(
    availability.lanes
      .filter((lane) => laneSupportsDispatchGroup(lane, anchorGroup, args.dispatchLaneById))
      .map((lane) => lane.laneId),
  );
  const firstEligibleLaneId = [...eligibleLaneIds].sort()[0];
  const initialDurationBasis = firstEligibleLaneId
    ? args.durationBasisByLaneAndProduct.get(
        forecastLaneDurationKey(firstEligibleLaneId, anchorGroup.productId),
      )
    : undefined;
  if (!initialDurationBasis) return null;
  const laneSelection = reserveNextQueueWindow(
    availability,
    initialDurationBasis.estimate,
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
  const selectedDurationBasis = args.durationBasisByLaneAndProduct.get(
    forecastLaneDurationKey(selectedLane.laneId, anchorGroup.productId),
  );
  if (!selectedDurationBasis) return null;
  const { memberIds, occupiedSeats } = collectLongRangeMembers(
    args.remaining,
    anchorGroup,
    selectedLane.passengerSeats,
  );
  const reservation = reserveNextQueueWindow(
    availability,
    selectedDurationBasis.estimate,
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
      durationBasis: { ...selectedDurationBasis, estimate: reservation.duration },
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
