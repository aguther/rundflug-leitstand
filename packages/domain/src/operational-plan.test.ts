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
});
