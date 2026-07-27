export const RECURRING_OPERATIONAL_RULE_SCOPES = ["AIRCRAFT", "PILOT"] as const;
export type RecurringOperationalRuleScope = (typeof RECURRING_OPERATIONAL_RULE_SCOPES)[number];

export const RECURRING_OPERATIONAL_RULE_KINDS = ["PAUSE", "REFUELING"] as const;
export type RecurringOperationalRuleKind = (typeof RECURRING_OPERATIONAL_RULE_KINDS)[number];

export const RECURRING_OPERATIONAL_RULE_TRIGGERS = [
  "COMPLETED_ROTATIONS",
  "OPERATING_MINUTES",
] as const;
export type RecurringOperationalRuleTrigger = (typeof RECURRING_OPERATIONAL_RULE_TRIGGERS)[number];

export type RecurringOperationalRuleStatus = "ACTIVE" | "DISABLED";

export interface RecurringOperationalRule {
  id: string;
  operationDayId: string;
  scopeType: RecurringOperationalRuleScope;
  scopeId: string;
  kind: RecurringOperationalRuleKind;
  triggerMetric: RecurringOperationalRuleTrigger;
  intervalValue: number;
  progressValue: number;
  minimumDurationMinutes: number;
  typicalDurationMinutes: number;
  maximumDurationMinutes: number;
  status: RecurringOperationalRuleStatus;
  sequenceNumber: number;
  version: number;
  openPlannedOperationId: string | null;
  reason: string | null;
  lastResetAt: string;
  createdAt: string;
  updatedAt: string;
}

export function validateRecurringOperationalRule(
  rule: Pick<
    RecurringOperationalRule,
    | "scopeType"
    | "scopeId"
    | "kind"
    | "triggerMetric"
    | "intervalValue"
    | "progressValue"
    | "minimumDurationMinutes"
    | "typicalDurationMinutes"
    | "maximumDurationMinutes"
  >,
): string[] {
  const errors: string[] = [];
  if (rule.scopeId.trim().length === 0) {
    errors.push("Für die Regel muss ein Ziel ausgewählt werden.");
  }
  if (rule.kind === "REFUELING" && rule.scopeType !== "AIRCRAFT") {
    errors.push("Tanken kann nur für ein Flugzeug geplant werden.");
  }
  if (!Number.isInteger(rule.intervalValue) || rule.intervalValue < 1) {
    errors.push("Das Intervall muss eine positive ganze Zahl sein.");
  }
  if (!Number.isInteger(rule.progressValue) || rule.progressValue < 0) {
    errors.push("Der bestätigte Fortschritt darf nicht negativ sein.");
  }
  if (
    !Number.isInteger(rule.minimumDurationMinutes) ||
    !Number.isInteger(rule.typicalDurationMinutes) ||
    !Number.isInteger(rule.maximumDurationMinutes) ||
    rule.minimumDurationMinutes < 1 ||
    rule.minimumDurationMinutes > rule.typicalDurationMinutes ||
    rule.typicalDurationMinutes > rule.maximumDurationMinutes
  ) {
    errors.push("Die Dauer muss als aufsteigendes Minimum, Typisch und Maximum angegeben werden.");
  }
  return errors;
}

export function recurringProgressIncrement(input: {
  triggerMetric: RecurringOperationalRuleTrigger;
  operatingMinutes: number;
}): number {
  if (input.triggerMetric === "COMPLETED_ROTATIONS") return 1;
  return Math.max(0, Math.round(input.operatingMinutes));
}

export function recurringRuleIsDue(
  rule: Pick<RecurringOperationalRule, "intervalValue" | "progressValue" | "status">,
): boolean {
  return rule.status === "ACTIVE" && rule.progressValue >= rule.intervalValue;
}
