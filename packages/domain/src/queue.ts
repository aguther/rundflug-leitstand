import { DomainRuleError } from "./index";

export interface QueueGroup {
  id: string;
  size: number;
  queueSequence: number;
  productId: string;
  standby: boolean;
}

export interface QueueAircraft {
  id: string;
  capacity: number;
  compatibleProductIds: readonly string[];
  available: boolean;
}

export interface QueueAssignment {
  aircraftId: string;
  groupIds: string[];
  occupiedSeats: number;
}

export interface QueuePlan {
  assignments: QueueAssignment[];
  unassigned: Array<{ groupId: string; reason: "NO_CAPACITY" | "GROUP_TOO_LARGE" }>;
}

export interface BookingGroupSplitPlan {
  slotSizes: number[];
  splitAcknowledged: boolean;
}

export function deriveResourceGroupCapacity(passengerSeats: readonly number[]): number {
  return passengerSeats.reduce(
    (maximum, seats) =>
      Number.isInteger(seats) && seats > 0 ? Math.max(maximum, seats) : maximum,
    0,
  );
}

export function planBookingGroupSplit(input: {
  groupSize: number;
  referenceCapacity: number;
  splitAcknowledged: boolean;
}): BookingGroupSplitPlan {
  if (!Number.isInteger(input.groupSize) || input.groupSize <= 0) {
    throw new DomainRuleError("BOOKING_GROUP_SIZE_INVALID", "Gruppengröße muss positiv sein.");
  }
  if (!Number.isInteger(input.referenceCapacity) || input.referenceCapacity <= 0) {
    throw new DomainRuleError("REFERENCE_CAPACITY_INVALID", "Referenzkapazität muss positiv sein.");
  }
  const requiredFlightGroupCount = Math.ceil(input.groupSize / input.referenceCapacity);
  if (requiredFlightGroupCount > 1 && !input.splitAcknowledged) {
    throw new DomainRuleError(
      "OVERSIZE_GROUP_SPLIT_CONFIRMATION_REQUIRED",
      "Die Buchungsgruppe passt nicht in einen Umlauf. Die Aufteilung auf unmittelbar folgende Fluggruppen muss ausdrücklich bestätigt werden.",
    );
  }
  return {
    slotSizes: Array.from({ length: requiredFlightGroupCount }, (_, index) =>
      Math.min(input.referenceCapacity, input.groupSize - index * input.referenceCapacity),
    ),
    splitAcknowledged: requiredFlightGroupCount > 1,
  };
}

export function planNextRotations(input: {
  groups: readonly QueueGroup[];
  aircraft: readonly QueueAircraft[];
  standbyPriority: boolean;
}): QueuePlan {
  for (const group of input.groups) {
    if (!Number.isInteger(group.size) || group.size <= 0) {
      throw new DomainRuleError("QUEUE_GROUP_SIZE_INVALID", "Gruppengröße muss positiv sein.");
    }
  }

  const orderedGroups = [...input.groups].sort((left, right) => {
    if (input.standbyPriority && left.standby !== right.standby) return left.standby ? -1 : 1;
    return left.queueSequence - right.queueSequence;
  });
  const availableAircraft = input.aircraft
    .filter((aircraft) => aircraft.available)
    .sort((left, right) => left.capacity - right.capacity || left.id.localeCompare(right.id));
  const assignments = availableAircraft.map<QueueAssignment>((aircraft) => ({
    aircraftId: aircraft.id,
    groupIds: [],
    occupiedSeats: 0,
  }));
  const unassigned: QueuePlan["unassigned"] = [];

  for (const group of orderedGroups) {
    const compatibleAircraft = availableAircraft.filter((aircraft) =>
      aircraft.compatibleProductIds.includes(group.productId),
    );
    if (compatibleAircraft.every((aircraft) => aircraft.capacity < group.size)) {
      unassigned.push({ groupId: group.id, reason: "GROUP_TOO_LARGE" });
      continue;
    }
    const assignment = assignments.find((candidate) => {
      const aircraft = compatibleAircraft.find((entry) => entry.id === candidate.aircraftId);
      return aircraft !== undefined && candidate.occupiedSeats + group.size <= aircraft.capacity;
    });
    if (!assignment) {
      unassigned.push({ groupId: group.id, reason: "NO_CAPACITY" });
      continue;
    }
    assignment.groupIds.push(group.id);
    assignment.occupiedSeats += group.size;
  }

  return { assignments, unassigned };
}

export function assertQueueMutationAllowed(input: {
  rotationState: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
  action: "CANCEL" | "REBOOK" | "DEFER" | "NO_SHOW";
}): void {
  if (
    input.rotationState === "IN_FLIGHT" ||
    input.rotationState === "LANDED" ||
    input.rotationState === "COMPLETED"
  ) {
    throw new DomainRuleError(
      "QUEUE_MUTATION_TOO_LATE",
      `${input.action} ist nach IM FLUG nicht mehr zulässig.`,
    );
  }
}

export function assertManualGroupMoveAllowed(input: {
  sourceStates: readonly ("DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED")[];
  targetState: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
  sameResourceGroup: boolean;
  sameProduct: boolean;
  groupSize: number;
  targetOccupiedSeats: number;
  targetCapacity: number;
}): void {
  if (
    input.sourceStates.some((state) => ["IN_FLIGHT", "LANDED", "COMPLETED"].includes(state)) ||
    ["IN_FLIGHT", "LANDED", "COMPLETED"].includes(input.targetState)
  ) {
    throw new DomainRuleError(
      "MANUAL_GROUP_MOVE_TOO_LATE",
      "Fluggruppen dürfen nach IM FLUG nicht mehr operativ umbesetzt werden.",
    );
  }
  if (!input.sameResourceGroup) {
    throw new DomainRuleError(
      "MANUAL_GROUP_MOVE_RESOURCE_MISMATCH",
      "Quelle und Ziel müssen derselben Ressourcengruppe angehören.",
    );
  }
  if (!input.sameProduct) {
    throw new DomainRuleError(
      "MANUAL_GROUP_MOVE_PRODUCT_MISMATCH",
      "Eine manuelle Umbesetzung darf keine Produkte in einem Umlauf vermischen.",
    );
  }
  if (input.targetOccupiedSeats + input.groupSize > input.targetCapacity) {
    throw new DomainRuleError(
      "MANUAL_GROUP_MOVE_CAPACITY_EXCEEDED",
      "Die gesamte Buchungsgruppe passt nicht in den Zielumlauf.",
    );
  }
}

export interface CapacityReductionSegment {
  ticketGroupId: string;
  size: number;
}

export function planRotationCapacityReduction(input: {
  rotationState: "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";
  called: boolean;
  baselineCapacity: number;
  currentUsableCapacity: number | null;
  requestedUsableCapacity: number;
  segments: readonly CapacityReductionSegment[];
}): { keptGroupIds: string[]; evictedGroupIds: string[]; occupiedSeats: number } {
  if (input.rotationState !== "DRAFT" || input.called) {
    throw new DomainRuleError(
      "ROTATION_CAPACITY_CHANGE_TOO_LATE",
      "Die nutzbare Kapazität darf nur vor dem Aufruf geändert werden.",
    );
  }
  if (
    !Number.isInteger(input.requestedUsableCapacity) ||
    input.requestedUsableCapacity <= 0 ||
    input.requestedUsableCapacity > input.baselineCapacity
  ) {
    throw new DomainRuleError(
      "ROTATION_CAPACITY_INVALID",
      "Die nutzbare Kapazität muss positiv sein und darf die Basiskapazität nicht überschreiten.",
    );
  }
  if (input.currentUsableCapacity === input.requestedUsableCapacity) {
    throw new DomainRuleError(
      "ROTATION_CAPACITY_UNCHANGED",
      "Die nutzbare Kapazität ist bereits so eingestellt.",
    );
  }
  const keptGroupIds: string[] = [];
  const evictedGroupIds: string[] = [];
  let occupiedSeats = 0;
  let queueCutReached = false;
  for (const segment of input.segments) {
    if (!Number.isInteger(segment.size) || segment.size <= 0) {
      throw new DomainRuleError(
        "ROTATION_CAPACITY_SEGMENT_INVALID",
        "Eine zugeordnete Buchungsgruppe besitzt keine gültige Größe.",
      );
    }
    if (!queueCutReached && occupiedSeats + segment.size <= input.requestedUsableCapacity) {
      keptGroupIds.push(segment.ticketGroupId);
      occupiedSeats += segment.size;
    } else {
      queueCutReached = true;
      evictedGroupIds.push(segment.ticketGroupId);
    }
  }
  return { keptGroupIds, evictedGroupIds, occupiedSeats };
}
