export type AircraftOperationalState =
  | "AVAILABLE"
  | "BOARDING"
  | "IN_FLIGHT"
  | "LANDED"
  | "TURNAROUND"
  | "REFUELING"
  | "PAUSED"
  | "INACTIVE";

export type AircraftDisplayState = AircraftOperationalState | "INTERRUPTED";

export const aircraftOperationalStateLabels: Readonly<Record<AircraftDisplayState, string>> = {
  AVAILABLE: "Verfügbar",
  BOARDING: "Boarding",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  TURNAROUND: "Turnaround",
  REFUELING: "Tanken",
  PAUSED: "Pause",
  INTERRUPTED: "Nicht verfügbar",
  INACTIVE: "Nicht verfügbar",
};

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

export function assertTicketNoShowAllowed(input: {
  rotationState: RotationState;
  calledAt: string | null;
  attendanceStatus: "NOT_CHECKED_IN" | "CHECKED_IN";
  noShowAfterMinutes: number;
  now: string;
}): void {
  if (input.rotationState !== "CALLED" || !input.calledAt) {
    throw new DomainRuleError(
      "TICKET_NO_SHOW_NOT_CALLED",
      "No-Show ist nur für aufgerufene Tickets zulässig.",
    );
  }
  if (input.attendanceStatus === "CHECKED_IN") {
    throw new DomainRuleError(
      "TICKET_PRESENT",
      "Ein als anwesend bestätigtes Ticket kann nicht als No-Show markiert werden.",
    );
  }
  if (Date.parse(input.now) - Date.parse(input.calledAt) < input.noShowAfterMinutes * 60_000) {
    throw new DomainRuleError(
      "NO_SHOW_DEADLINE_NOT_REACHED",
      "Die konfigurierte No-Show-Frist ist noch nicht erreicht.",
    );
  }
}

export type RotationState = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED" | "CANCELED";

export const rotationStateLabels: Readonly<Record<RotationState, string>> = {
  DRAFT: "Wartend",
  CALLED: "Boarding",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
  CANCELED: "Storniert",
};

const allowedRotationTransitions: Readonly<Record<RotationState, readonly RotationState[]>> = {
  DRAFT: ["CALLED"],
  CALLED: ["IN_FLIGHT", "DRAFT", "CANCELED"],
  IN_FLIGHT: ["LANDED"],
  LANDED: ["COMPLETED"],
  COMPLETED: [],
  CANCELED: [],
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

export function assertTechnicalRotationAbortAllowed(current: RotationState): void {
  if (current !== "CALLED" && current !== "IN_FLIGHT") {
    throw new DomainRuleError(
      "TECHNICAL_ROTATION_ABORT_NOT_ALLOWED",
      "Ein technischer Umlaufabbruch ist nur während Boarding oder nach Off-Block zulässig.",
    );
  }
}

export function planTechnicalRotationAbortQueueBlock(
  entries: ReadonlyArray<{ id: string; queueSequence: number; assignedAt: string }>,
): Array<{ id: string; queueSequence: number }> {
  if (entries.length === 0) {
    throw new DomainRuleError(
      "ROTATION_WITHOUT_TICKETS",
      "Der Umlauf enthält keine rückstellbare Buchungsgruppe.",
    );
  }
  return [...entries]
    .sort(
      (left, right) =>
        left.queueSequence - right.queueSequence ||
        left.assignedAt.localeCompare(right.assignedAt) ||
        left.id.localeCompare(right.id),
    )
    .map((entry, index) => ({ id: entry.id, queueSequence: index + 1 }));
}

export type DeviceRole = "CASHIER" | "FLIGHT_LINE" | "FLIGHT_DIRECTOR" | "ADMIN" | "DISPLAY";

export type OperationalCommandType =
  | "SET_OPERATIONAL_NOTE"
  | "SET_ROTATION_NOTE"
  | "SET_ROTATION_CAPACITY"
  | "SELL_TICKET_GROUP"
  | "ASSIGN_AIRCRAFT_PILOT"
  | "CALL_NEXT"
  | "MARK_OFF_BLOCK"
  | "MARK_ON_BLOCK"
  | "COMPLETE_TURNAROUND"
  | "CANCEL_ROTATION"
  | "CANCEL_TICKET_GROUP"
  | "DEFER_TICKET_GROUP"
  | "MARK_NO_SHOW"
  | "MOVE_TICKET_GROUP"
  | "CORRECT_ROTATION_MANIFEST"
  | "TRIGGER_EMERGENCY"
  | "CLEAR_EMERGENCY"
  | "SET_RESOURCE_GROUP_STATUS"
  | "SET_EVENT_INTERRUPTION"
  | "SET_PILOT_PAUSE"
  | "CONFIGURE_PRODUCT_SALES"
  | "PAIR_DEVICE"
  | "REVOKE_DEVICE"
  | "SET_AIRCRAFT_OPERATIONAL_STATE"
  | "SCHEDULE_AIRCRAFT_REFUEL"
  | "UPSERT_PILOT"
  | "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD"
  | "SET_RESOURCE_GROUP_NOTICE"
  | "REVOKE_CALL"
  | "ABORT_ROTATION"
  | "ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE"
  | "SET_TICKET_ATTENDANCE"
  | "SET_TICKET_GROUP_ATTENDANCE"
  | "MARK_TICKET_GROUP_MISSING"
  | "RECALL_TICKET_GROUP"
  | "MARK_TICKET_NO_SHOW"
  | "CONFIRM_ATTENDANCE_DECISION"
  | "CONFIGURE_EVENT_PARAMETERS"
  | "UPSERT_GATE"
  | "UPSERT_PRODUCT"
  | "UPSERT_RESOURCE_GROUP"
  | "UPSERT_AIRCRAFT"
  | "ASSIGN_AIRCRAFT_RESOURCE_GROUP"
  | "DELETE_MASTER_DATA"
  | "SET_EVENT_LIFECYCLE"
  | "STAGE_OUTAGE_RECOVERY"
  | "APPROVE_OUTAGE_RECOVERY"
  | "APPLY_OUTAGE_RECOVERY";

const commandRoles: Readonly<Record<OperationalCommandType, readonly DeviceRole[]>> = {
  SET_OPERATIONAL_NOTE: ["FLIGHT_DIRECTOR", "ADMIN"],
  SET_ROTATION_NOTE: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  SET_ROTATION_CAPACITY: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  SELL_TICKET_GROUP: ["CASHIER", "ADMIN"],
  ASSIGN_AIRCRAFT_PILOT: ["FLIGHT_DIRECTOR", "ADMIN"],
  CALL_NEXT: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  MARK_OFF_BLOCK: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  MARK_ON_BLOCK: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  COMPLETE_TURNAROUND: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  CANCEL_ROTATION: ["FLIGHT_DIRECTOR", "ADMIN"],
  CANCEL_TICKET_GROUP: ["CASHIER", "ADMIN"],
  DEFER_TICKET_GROUP: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  MARK_NO_SHOW: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  MOVE_TICKET_GROUP: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  CORRECT_ROTATION_MANIFEST: ["ADMIN"],
  TRIGGER_EMERGENCY: ["FLIGHT_DIRECTOR", "ADMIN"],
  CLEAR_EMERGENCY: ["ADMIN"],
  SET_RESOURCE_GROUP_STATUS: ["FLIGHT_DIRECTOR", "ADMIN"],
  SET_EVENT_INTERRUPTION: ["FLIGHT_DIRECTOR", "ADMIN"],
  SET_PILOT_PAUSE: ["FLIGHT_DIRECTOR", "ADMIN"],
  CONFIGURE_PRODUCT_SALES: ["ADMIN"],
  PAIR_DEVICE: ["ADMIN"],
  REVOKE_DEVICE: ["ADMIN"],
  SET_AIRCRAFT_OPERATIONAL_STATE: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  SCHEDULE_AIRCRAFT_REFUEL: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  UPSERT_PILOT: ["ADMIN"],
  CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD: ["ADMIN"],
  SET_RESOURCE_GROUP_NOTICE: ["FLIGHT_DIRECTOR", "ADMIN"],
  REVOKE_CALL: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  ABORT_ROTATION: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE: [
    "FLIGHT_LINE",
    "FLIGHT_DIRECTOR",
    "ADMIN",
  ],
  SET_TICKET_ATTENDANCE: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  SET_TICKET_GROUP_ATTENDANCE: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  MARK_TICKET_GROUP_MISSING: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  RECALL_TICKET_GROUP: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  MARK_TICKET_NO_SHOW: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  CONFIRM_ATTENDANCE_DECISION: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  CONFIGURE_EVENT_PARAMETERS: ["ADMIN"],
  UPSERT_GATE: ["ADMIN"],
  UPSERT_PRODUCT: ["ADMIN"],
  UPSERT_RESOURCE_GROUP: ["ADMIN"],
  UPSERT_AIRCRAFT: ["ADMIN"],
  ASSIGN_AIRCRAFT_RESOURCE_GROUP: ["ADMIN"],
  DELETE_MASTER_DATA: ["ADMIN"],
  SET_EVENT_LIFECYCLE: ["ADMIN"],
  STAGE_OUTAGE_RECOVERY: ["CASHIER", "FLIGHT_DIRECTOR", "ADMIN"],
  APPROVE_OUTAGE_RECOVERY: ["ADMIN"],
  APPLY_OUTAGE_RECOVERY: ["ADMIN"],
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
  eventStatus: "PREPARATION" | "ACTIVE" | "CLOSED" | "ARCHIVED";
  productSaleEnabled: boolean;
  resourceGroupStatus: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
  emergencyMode: boolean;
  eventInterrupted: boolean;
  saleClosingReached: boolean;
}): void {
  if (input.eventStatus !== "ACTIVE") {
    throw new DomainRuleError(
      "SALE_BLOCKED_EVENT_STATUS",
      "Die Veranstaltung ist nicht für den Verkauf aktiv.",
    );
  }
  if (input.emergencyMode) {
    throw new DomainRuleError("SALE_BLOCKED_EMERGENCY", "Verkauf ist im Notfallmodus gesperrt.");
  }
  if (input.eventInterrupted) {
    throw new DomainRuleError(
      "SALE_BLOCKED_INTERRUPTION",
      "Verkauf ist während der Betriebsunterbrechung gesperrt.",
    );
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

export * from "./capacity";
export * from "./communication-labels";
export * from "./forecast";
export * from "./outage-recovery";
export * from "./precall";
export * from "./public-status";
export * from "./queue";
