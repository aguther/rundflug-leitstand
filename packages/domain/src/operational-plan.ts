export const OPERATIONAL_PLAN_SCOPES = ["EVENT", "RESOURCE_GROUP", "AIRCRAFT", "PILOT"] as const;
export type OperationalPlanScope = (typeof OPERATIONAL_PLAN_SCOPES)[number];

export const OPERATIONAL_PLAN_KINDS = [
  "PAUSE",
  "REFUELING",
  "FLIGHT_SHOW",
  "WEATHER",
  "TECHNICAL",
  "OTHER",
] as const;
export type OperationalPlanKind = (typeof OPERATIONAL_PLAN_KINDS)[number];

export type OperationalPlanStartMode = "TIME_WINDOW" | "AFTER_CURRENT_ROTATION";
export type OperationalPlanEffectMode = "BLOCKING" | "SLOWDOWN";
export type StoredOperationalPlanStatus = "PLANNED" | "ACTIVE" | "CLEARED" | "CANCELED";
export type OperationalPlanStatus = StoredOperationalPlanStatus | "DUE";

export interface PlannedOperationalConstraint {
  id: string;
  scopeType: OperationalPlanScope;
  scopeId: string;
  kind: OperationalPlanKind;
  effectMode: OperationalPlanEffectMode;
  durationMultiplierPercent: number | null;
  startMode: OperationalPlanStartMode;
  earliestStartAt: string | null;
  latestStartAt: string | null;
  afterRotationId: string | null;
  minimumDurationMinutes: number;
  typicalDurationMinutes: number;
  maximumDurationMinutes: number;
  status: StoredOperationalPlanStatus;
}

export function deriveOperationalPlanStatus(
  plan: Pick<PlannedOperationalConstraint, "status" | "latestStartAt">,
  now: string,
): OperationalPlanStatus {
  if (
    plan.status === "PLANNED" &&
    plan.latestStartAt !== null &&
    Date.parse(plan.latestStartAt) <= Date.parse(now)
  ) {
    return "DUE";
  }
  return plan.status;
}

export function validateOperationalPlan(
  plan: Omit<PlannedOperationalConstraint, "status">,
): string[] {
  const errors: string[] = [];
  const minimum = plan.minimumDurationMinutes;
  const typical = plan.typicalDurationMinutes;
  const maximum = plan.maximumDurationMinutes;
  if (
    (plan.effectMode === "BLOCKING" && plan.durationMultiplierPercent !== null) ||
    (plan.effectMode === "SLOWDOWN" &&
      (!Number.isInteger(plan.durationMultiplierPercent) ||
        (plan.durationMultiplierPercent ?? 0) < 110 ||
        (plan.durationMultiplierPercent ?? 0) > 300))
  ) {
    errors.push("Ein verzögerter Betrieb benötigt einen Faktor zwischen 110 und 300 Prozent.");
  }
  if (
    !Number.isInteger(minimum) ||
    !Number.isInteger(typical) ||
    !Number.isInteger(maximum) ||
    minimum < 1 ||
    minimum > typical ||
    typical > maximum
  ) {
    errors.push("Die Dauer muss als aufsteigendes Minimum, Typisch und Maximum angegeben werden.");
  }
  if (plan.startMode === "TIME_WINDOW") {
    const earliest = plan.earliestStartAt ? Date.parse(plan.earliestStartAt) : Number.NaN;
    const latest = plan.latestStartAt ? Date.parse(plan.latestStartAt) : Number.NaN;
    if (!Number.isFinite(earliest) || !Number.isFinite(latest) || earliest > latest) {
      errors.push("Das Startzeitfenster ist unvollständig oder ungültig.");
    }
    if (plan.afterRotationId !== null) {
      errors.push("Ein Zeitfenster darf nicht zugleich an einen Umlauf gebunden sein.");
    }
  } else {
    if (plan.afterRotationId === null) {
      errors.push("Für 'nach aktuellem Umlauf' muss ein Umlauf angegeben werden.");
    }
    if (plan.earliestStartAt !== null || plan.latestStartAt !== null) {
      errors.push("Ein umlaufgebundener Beginn darf kein festes Startzeitfenster enthalten.");
    }
  }
  return errors;
}
