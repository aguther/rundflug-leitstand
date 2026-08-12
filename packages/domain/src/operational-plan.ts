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

type OperationalPlanInput = Omit<PlannedOperationalConstraint, "status">;

function hasInvalidEffectConfiguration(plan: OperationalPlanInput): boolean {
  if (plan.effectMode === "BLOCKING") return plan.durationMultiplierPercent !== null;
  return (
    !Number.isInteger(plan.durationMultiplierPercent) ||
    (plan.durationMultiplierPercent ?? 0) < 110 ||
    (plan.durationMultiplierPercent ?? 0) > 300
  );
}

function hasInvalidDuration(plan: OperationalPlanInput): boolean {
  const { minimumDurationMinutes: minimum } = plan;
  const { typicalDurationMinutes: typical } = plan;
  const { maximumDurationMinutes: maximum } = plan;
  return (
    !Number.isInteger(minimum) ||
    !Number.isInteger(typical) ||
    !Number.isInteger(maximum) ||
    minimum < 1 ||
    minimum > typical ||
    typical > maximum
  );
}

function validateStartConfiguration(plan: OperationalPlanInput): string[] {
  if (plan.startMode === "TIME_WINDOW") {
    const earliest = plan.earliestStartAt ? Date.parse(plan.earliestStartAt) : Number.NaN;
    const latest = plan.latestStartAt ? Date.parse(plan.latestStartAt) : Number.NaN;
    return [
      ...(!Number.isFinite(earliest) || !Number.isFinite(latest) || earliest > latest
        ? ["Das Startzeitfenster ist unvollständig oder ungültig."]
        : []),
      ...(plan.afterRotationId !== null
        ? ["Ein Zeitfenster darf nicht zugleich an einen Umlauf gebunden sein."]
        : []),
    ];
  }
  return [
    ...(plan.afterRotationId === null
      ? ["Für 'nach aktuellem Umlauf' muss ein Umlauf angegeben werden."]
      : []),
    ...(plan.earliestStartAt !== null || plan.latestStartAt !== null
      ? ["Ein umlaufgebundener Beginn darf kein festes Startzeitfenster enthalten."]
      : []),
  ];
}

export function validateOperationalPlan(plan: OperationalPlanInput): string[] {
  const errors: string[] = [];
  if (hasInvalidEffectConfiguration(plan)) {
    errors.push("Ein verzögerter Betrieb benötigt einen Faktor zwischen 110 und 300 Prozent.");
  }
  if (hasInvalidDuration(plan)) {
    errors.push("Die Dauer muss als aufsteigendes Minimum, Typisch und Maximum angegeben werden.");
  }
  errors.push(...validateStartConfiguration(plan));
  return errors;
}
