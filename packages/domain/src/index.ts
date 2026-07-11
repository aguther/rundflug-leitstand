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

export type DeviceRole = "CASHIER" | "FLIGHT_LINE" | "FLIGHT_LINE_LEAD" | "ADMIN" | "DISPLAY";

export type OperationalCommandType =
  | "SELL_TICKET_GROUP"
  | "CALL_NEXT"
  | "MARK_IN_FLIGHT"
  | "MARK_LANDED"
  | "MARK_COMPLETED";

const commandRoles: Readonly<Record<OperationalCommandType, readonly DeviceRole[]>> = {
  SELL_TICKET_GROUP: ["CASHIER", "ADMIN"],
  CALL_NEXT: ["FLIGHT_LINE", "FLIGHT_LINE_LEAD", "ADMIN"],
  MARK_IN_FLIGHT: ["FLIGHT_LINE", "FLIGHT_LINE_LEAD", "ADMIN"],
  MARK_LANDED: ["FLIGHT_LINE", "FLIGHT_LINE_LEAD", "ADMIN"],
  MARK_COMPLETED: ["FLIGHT_LINE", "FLIGHT_LINE_LEAD", "ADMIN"],
};

export function assertRoleMayExecute(role: DeviceRole, command: OperationalCommandType): void {
  if (!commandRoles[command].includes(role)) {
    throw new DomainRuleError(
      "ROLE_NOT_AUTHORIZED",
      `Die Geräterolle ${role} darf ${command} nicht ausführen.`,
    );
  }
}

export function assertSaleAllowed(input: {
  productSaleEnabled: boolean;
  resourceGroupStatus: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
  emergencyMode: boolean;
  saleClosingReached: boolean;
}): void {
  if (input.emergencyMode) {
    throw new DomainRuleError("SALE_BLOCKED_EMERGENCY", "Verkauf ist im Notfallmodus gesperrt.");
  }
  if (!input.productSaleEnabled) {
    throw new DomainRuleError("SALE_BLOCKED_PRODUCT", "Das Produkt ist nicht verkaufbar.");
  }
  if (input.resourceGroupStatus !== "ACTIVE") {
    throw new DomainRuleError(
      "SALE_BLOCKED_RESOURCE_GROUP",
      "Die Ressourcengruppe ist nicht aktiv verkaufbar.",
    );
  }
  if (input.saleClosingReached) {
    throw new DomainRuleError("SALE_BLOCKED_CLOSING", "Der Verkaufsschluss ist erreicht.");
  }
}

export function assertPublicTicketCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{12,32}$/.test(normalized)) {
    throw new DomainRuleError(
      "PUBLIC_TICKET_CODE_INVALID",
      "Ticketcode muss nicht erratbar und formal gültig sein.",
    );
  }
  return normalized;
}
