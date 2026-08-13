import {
  createQueueAvailability,
  type DurationEstimate,
  type PredictionQuality,
  type QueueAvailabilityState,
  reserveNextQueueWindow,
} from "./forecast";

export type CapacityStatus = "AVAILABLE" | "LIMITED" | "MANUAL_REVIEW" | "SOLD_OUT";

export interface CapacityAssessment {
  remainingSellableSeats: number;
  projectedSeats: number;
  status: CapacityStatus;
  saleRecommended: boolean;
}

function predictionQualityFactor(quality: PredictionQuality): number {
  if (quality === "STABLE") return 1;
  if (quality === "CHANGING") return 0.85;
  return 0.6;
}

function capacityStatus(input: {
  remainingSellableSeats: number;
  predictionQuality: PredictionQuality;
  warningThreshold: number;
  criticalThreshold: number;
}): CapacityStatus {
  if (input.remainingSellableSeats === 0) return "SOLD_OUT";
  if (
    input.predictionQuality === "UNCERTAIN" ||
    input.remainingSellableSeats <= input.criticalThreshold
  ) {
    return "MANUAL_REVIEW";
  }
  return input.remainingSellableSeats <= input.warningThreshold ? "LIMITED" : "AVAILABLE";
}

export function assessRemainingCapacity(input: {
  remainingOperatingMinutes: number;
  expectedRotationMinutes: number;
  activeAircraftSeats: readonly number[];
  openTickets: number;
  reservedSeats?: number;
  predictionQuality: PredictionQuality;
  warningThreshold: number;
  criticalThreshold: number;
}): CapacityAssessment {
  const cycles = Math.max(
    0,
    Math.floor(input.remainingOperatingMinutes / Math.max(1, input.expectedRotationMinutes)),
  );
  const rawProjectedSeats =
    cycles *
    input.activeAircraftSeats
      .filter((seats) => Number.isInteger(seats) && seats > 0)
      .reduce((sum, seats) => sum + seats, 0);
  const qualityFactor = predictionQualityFactor(input.predictionQuality);
  const projectedSeats = Math.max(
    0,
    Math.floor(rawProjectedSeats * qualityFactor) - Math.max(0, input.reservedSeats ?? 0),
  );
  const remainingSellableSeats = Math.max(0, projectedSeats - Math.max(0, input.openTickets));
  const status = capacityStatus({
    remainingSellableSeats,
    predictionQuality: input.predictionQuality,
    warningThreshold: input.warningThreshold,
    criticalThreshold: input.criticalThreshold,
  });
  return {
    remainingSellableSeats,
    projectedSeats,
    status,
    saleRecommended: status === "AVAILABLE" || status === "LIMITED",
  };
}

function withoutCapacityLane(
  availability: QueueAvailabilityState,
  laneId: string,
): QueueAvailabilityState {
  return createQueueAvailability({
    activeAircraft: 0,
    busyAircraftMinutes: [],
    lanes: availability.lanes
      .filter((lane) => lane.laneId !== laneId)
      .map((lane) => ({
        laneId: lane.laneId,
        ...(lane.aircraftId === undefined ? {} : { aircraftId: lane.aircraftId }),
        passengerSeats: lane.passengerSeats,
        lowerMinutes: lane.lowerMinutes,
        expectedMinutes: lane.expectedMinutes,
        upperMinutes: lane.upperMinutes,
        constraints: lane.constraints,
        recurringConstraints: lane.recurringConstraints,
      })),
  });
}

/**
 * Simulates one product's marginal, product-pure batches after the complete open queue has already
 * occupied the shared resource lanes. A seat is sellable only when the conservative upper
 * completion bound remains within operations end.
 */
export function assessMarginalProductCapacity(input: {
  operationsEndMinutes: number;
  availabilityAfterQueue: QueueAvailabilityState;
  duration: DurationEstimate;
  durationByAircraftId?: ReadonlyMap<string, DurationEstimate>;
  compatibleAircraftIds?: ReadonlySet<string>;
  queuedSeatsCompletedByEnd: number;
  openTickets: number;
  predictionQuality: PredictionQuality;
  warningThreshold: number;
  criticalThreshold: number;
}): CapacityAssessment {
  const compatibleLanes = input.availabilityAfterQueue.lanes.filter(
    (lane) =>
      lane.aircraftId === undefined ||
      input.compatibleAircraftIds === undefined ||
      input.compatibleAircraftIds.has(lane.aircraftId),
  );
  let availability = createQueueAvailability({
    activeAircraft: 0,
    busyAircraftMinutes: [],
    lanes: compatibleLanes.map((lane) => ({
      laneId: lane.laneId,
      ...(lane.aircraftId === undefined ? {} : { aircraftId: lane.aircraftId }),
      passengerSeats: lane.passengerSeats,
      lowerMinutes: lane.lowerMinutes,
      expectedMinutes: lane.expectedMinutes,
      upperMinutes: lane.upperMinutes,
      constraints: lane.constraints,
      recurringConstraints: lane.recurringConstraints,
    })),
  });
  let marginalSeats = 0;
  let iterations = 0;
  while (availability.lanes.length > 0 && iterations < 10_000) {
    iterations += 1;
    const reservation = reserveNextQueueWindow(
      availability,
      input.duration,
      input.operationsEndMinutes,
      1,
      input.durationByAircraftId,
    );
    if (!reservation.window || !reservation.selectedLaneId) break;
    const previousLane = availability.lanes.find(
      (lane) => lane.laneId === reservation.selectedLaneId,
    );
    const nextLane = reservation.availability.lanes.find(
      (lane) => lane.laneId === reservation.selectedLaneId,
    );
    if (!previousLane || !nextLane) break;
    if (nextLane.upperMinutes > input.operationsEndMinutes) {
      availability = withoutCapacityLane(availability, reservation.selectedLaneId);
      continue;
    }
    marginalSeats += previousLane.passengerSeats;
    availability = reservation.availability;
  }
  const projectedSeats = Math.max(0, input.queuedSeatsCompletedByEnd + marginalSeats);
  const remainingSellableSeats = Math.max(0, projectedSeats - Math.max(0, input.openTickets));
  const status = capacityStatus({
    remainingSellableSeats,
    predictionQuality: input.predictionQuality,
    warningThreshold: input.warningThreshold,
    criticalThreshold: input.criticalThreshold,
  });
  return {
    projectedSeats,
    remainingSellableSeats,
    status,
    saleRecommended: status === "AVAILABLE" || status === "LIMITED",
  };
}
