import type { DeviceRole } from "@rundflug/domain";

export type PlannedOperationAuditAction = "CREATE" | "UPDATE" | "CANCEL";
export type PlannedOperationKind =
  | "PAUSE"
  | "REFUELING"
  | "FLIGHT_SHOW"
  | "WEATHER"
  | "TECHNICAL"
  | "OTHER";
export type PlannedOperationScope = "EVENT" | "RESOURCE_GROUP" | "AIRCRAFT" | "PILOT";

const ROLE_LABELS: Record<DeviceRole, string> = {
  CASHIER: "Kasse",
  FLIGHT_LINE: "Flight Line",
  FLIGHT_DIRECTOR: "Flight Director",
  ADMIN: "Administration",
  DISPLAY: "Anzeige",
};

const ACTION_LABELS: Record<PlannedOperationAuditAction, string> = {
  CREATE: "eingeplant",
  UPDATE: "bearbeitet",
  CANCEL: "abgesagt",
};

const KIND_LABELS: Record<PlannedOperationKind, string> = {
  PAUSE: "Pause",
  REFUELING: "Tankpause",
  FLIGHT_SHOW: "Flugshow",
  WEATHER: "Wetterunterbrechung",
  TECHNICAL: "technische Unterbrechung",
  OTHER: "sonstige Einschränkung",
};

const SCOPE_LABELS: Record<PlannedOperationScope, string> = {
  EVENT: "die gesamte Veranstaltung",
  RESOURCE_GROUP: "eine Ressourcengruppe",
  AIRCRAFT: "ein Flugzeug",
  PILOT: "einen Pilotencode",
};

export function plannedOperationAuditReason(input: {
  role: DeviceRole;
  action: PlannedOperationAuditAction;
  kind: PlannedOperationKind;
  scopeType: PlannedOperationScope;
}): string {
  return `${ROLE_LABELS[input.role]}: ${KIND_LABELS[input.kind]} für ${SCOPE_LABELS[input.scopeType]} ${ACTION_LABELS[input.action]}.`;
}
