export type CashierWeightClass = "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL";

export function requiresChildCompanionWarning(
  childCompanionRequired: boolean,
  weightClasses: CashierWeightClass[],
): boolean {
  if (!childCompanionRequired || !weightClasses.includes("CHILD")) return false;
  return weightClasses.every((weightClass) => weightClass === "CHILD");
}
