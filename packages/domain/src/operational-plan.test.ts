import { describe, expect, it } from "vitest";
import {
  deriveOperationalPlanStatus,
  type PlannedOperationalConstraint,
  validateOperationalPlan,
} from "./operational-plan";

const basePlan: PlannedOperationalConstraint = {
  id: "plan-1",
  scopeType: "AIRCRAFT",
  scopeId: "aircraft-1",
  kind: "PAUSE",
  effectMode: "BLOCKING",
  durationMultiplierPercent: null,
  startMode: "TIME_WINDOW",
  earliestStartAt: "2026-07-22T10:00:00.000Z",
  latestStartAt: "2026-07-22T10:15:00.000Z",
  afterRotationId: null,
  minimumDurationMinutes: 10,
  typicalDurationMinutes: 20,
  maximumDurationMinutes: 30,
  status: "PLANNED",
};

describe("operational planning", () => {
  it("marks an elapsed start window as due without activating it", () => {
    expect(deriveOperationalPlanStatus(basePlan, "2026-07-22T10:16:00.000Z")).toBe("DUE");
    expect(basePlan.status).toBe("PLANNED");
  });

  it("keeps active, cleared, and canceled states explicit", () => {
    expect(
      deriveOperationalPlanStatus({ ...basePlan, status: "ACTIVE" }, "2026-07-22T10:16:00.000Z"),
    ).toBe("ACTIVE");
  });

  it("validates approximate durations and mutually exclusive start modes", () => {
    const { status: _status, ...validPlan } = basePlan;
    expect(validateOperationalPlan(validPlan)).toEqual([]);
    expect(
      validateOperationalPlan({
        ...validPlan,
        minimumDurationMinutes: 30,
        typicalDurationMinutes: 20,
      }),
    ).toContain("Die Dauer muss als aufsteigendes Minimum, Typisch und Maximum angegeben werden.");
  });

  it("accepts only a bounded factor for delayed operation", () => {
    const { status: _status, ...validPlan } = basePlan;
    expect(
      validateOperationalPlan({
        ...validPlan,
        effectMode: "SLOWDOWN",
        durationMultiplierPercent: 150,
      }),
    ).toEqual([]);
    expect(
      validateOperationalPlan({
        ...validPlan,
        effectMode: "SLOWDOWN",
        durationMultiplierPercent: 301,
      }),
    ).toContain("Ein verzögerter Betrieb benötigt einen Faktor zwischen 110 und 300 Prozent.");
  });

  it("rejects effect configurations that contradict their mode", () => {
    const { status: _status, ...validPlan } = basePlan;
    expect(validateOperationalPlan({ ...validPlan, durationMultiplierPercent: 150 })).toContain(
      "Ein verzögerter Betrieb benötigt einen Faktor zwischen 110 und 300 Prozent.",
    );
    expect(
      validateOperationalPlan({
        ...validPlan,
        effectMode: "SLOWDOWN",
        durationMultiplierPercent: null,
      }),
    ).toContain("Ein verzögerter Betrieb benötigt einen Faktor zwischen 110 und 300 Prozent.");
  });

  it("validates every start-mode invariant", () => {
    const { status: _status, ...validPlan } = basePlan;
    expect(
      validateOperationalPlan({
        ...validPlan,
        earliestStartAt: null,
        afterRotationId: "rotation-1",
      }),
    ).toEqual(
      expect.arrayContaining([
        "Das Startzeitfenster ist unvollständig oder ungültig.",
        "Ein Zeitfenster darf nicht zugleich an einen Umlauf gebunden sein.",
      ]),
    );
    expect(
      validateOperationalPlan({
        ...validPlan,
        startMode: "AFTER_CURRENT_ROTATION",
        earliestStartAt: null,
        latestStartAt: null,
        afterRotationId: null,
      }),
    ).toContain("Für 'nach aktuellem Umlauf' muss ein Umlauf angegeben werden.");
    expect(
      validateOperationalPlan({
        ...validPlan,
        startMode: "AFTER_CURRENT_ROTATION",
        afterRotationId: "rotation-1",
      }),
    ).toContain("Ein umlaufgebundener Beginn darf kein festes Startzeitfenster enthalten.");
  });

  it("rejects non-integral, non-positive, and descending durations", () => {
    const { status: _status, ...validPlan } = basePlan;
    for (const invalidDuration of [
      { minimumDurationMinutes: 0 },
      { typicalDurationMinutes: 20.5 },
      { maximumDurationMinutes: 19 },
    ]) {
      expect(validateOperationalPlan({ ...validPlan, ...invalidDuration })).toContain(
        "Die Dauer muss als aufsteigendes Minimum, Typisch und Maximum angegeben werden.",
      );
    }
  });
});
