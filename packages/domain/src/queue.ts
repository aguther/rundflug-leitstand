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
    .sort((left, right) => left.id.localeCompare(right.id));
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
