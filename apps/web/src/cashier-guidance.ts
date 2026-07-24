export type CashierWeightClass = "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL";

export function requiresChildCompanionWarning(
  childCompanionRequired: boolean,
  weightClasses: CashierWeightClass[],
): boolean {
  if (!childCompanionRequired || !weightClasses.includes("CHILD")) return false;
  return weightClasses.every((weightClass) => weightClass === "CHILD");
}

export type CashierTicketCompletionIndicator = "NONE" | "IN_PROGRESS" | "COMPLETED";

const PROGRESSED_ROTATION_STATUSES = new Set(["CALLED", "IN_FLIGHT", "LANDED", "COMPLETED"]);

export function cashierTicketCompletionIndicator(
  groupStatus: string,
  rotationStatuses: readonly string[],
): CashierTicketCompletionIndicator {
  if (groupStatus === "CANCELED" || rotationStatuses.length === 0) return "NONE";
  if (rotationStatuses.every((status) => status === "COMPLETED")) return "COMPLETED";
  return rotationStatuses.some((status) => PROGRESSED_ROTATION_STATUSES.has(status))
    ? "IN_PROGRESS"
    : "NONE";
}
