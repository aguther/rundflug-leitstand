export type AircraftOperationalState =
  | "AVAILABLE"
  | "BOARDING"
  | "IN_FLIGHT"
  | "LANDED"
  | "TURNAROUND"
  | "REFUELING"
  | "PAUSED"
  | "INACTIVE";

export class DomainRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainRuleError";
    this.code = code;
  }
}

const allowedAircraftTransitions: Readonly<
  Record<AircraftOperationalState, readonly AircraftOperationalState[]>
> = {
  AVAILABLE: ["BOARDING", "REFUELING", "PAUSED", "INACTIVE"],
  BOARDING: ["IN_FLIGHT", "AVAILABLE", "PAUSED"],
  IN_FLIGHT: ["LANDED"],
  LANDED: ["TURNAROUND"],
  TURNAROUND: ["AVAILABLE", "REFUELING", "PAUSED"],
  REFUELING: ["AVAILABLE", "PAUSED"],
  PAUSED: ["AVAILABLE", "INACTIVE"],
  INACTIVE: ["AVAILABLE"],
};

export function transitionAircraft(
  current: AircraftOperationalState,
  next: AircraftOperationalState,
): AircraftOperationalState {
  if (!allowedAircraftTransitions[current].includes(next)) {
    throw new DomainRuleError(
      "AIRCRAFT_TRANSITION_NOT_ALLOWED",
      `Übergang ${current} → ${next} ist nicht zulässig.`,
    );
  }
  return next;
}

export interface ResourceGroupMembership {
  aircraftId: string;
  resourceGroupId: string;
  activeFrom: string;
  activeUntil: string | null;
}

export function assertSingleActiveResourceGroup(
  memberships: readonly ResourceGroupMembership[],
  aircraftId: string,
): void {
  const active = memberships.filter(
    (membership) => membership.aircraftId === aircraftId && membership.activeUntil === null,
  );
  if (active.length > 1) {
    throw new DomainRuleError(
      "AIRCRAFT_MULTIPLE_ACTIVE_RESOURCE_GROUPS",
      "Ein Flugzeug darf nur einer aktiven Ressourcengruppe zugeordnet sein.",
    );
  }
}

export function assertGroupIsNotAutomaticallySplit(input: {
  groupSize: number;
  selectedPassengers: number;
  explicitlyConfirmedByHuman: boolean;
}): void {
  const isSplit = input.selectedPassengers > 0 && input.selectedPassengers < input.groupSize;
  if (isSplit && !input.explicitlyConfirmedByHuman) {
    throw new DomainRuleError(
      "AUTOMATIC_GROUP_SPLIT_FORBIDDEN",
      "Gruppen dürfen niemals automatisch getrennt werden.",
    );
  }
}

export type RotationState = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";

const allowedRotationTransitions: Readonly<Record<RotationState, readonly RotationState[]>> = {
  DRAFT: ["CALLED"],
  CALLED: ["IN_FLIGHT", "DRAFT"],
  IN_FLIGHT: ["LANDED"],
  LANDED: ["COMPLETED"],
  COMPLETED: [],
};

export function transitionRotation(current: RotationState, next: RotationState): RotationState {
  if (!allowedRotationTransitions[current].includes(next)) {
    throw new DomainRuleError(
      "ROTATION_TRANSITION_NOT_ALLOWED",
      `Übergang ${current} → ${next} ist nicht zulässig.`,
    );
  }
  return next;
}
