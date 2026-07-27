import { describe, expect, it } from "vitest";
import { assertRoleMayExecute, DomainRuleError } from "./index";
import {
  recurringProgressIncrement,
  recurringRuleIsDue,
  validateRecurringOperationalRule,
} from "./recurring-operational-rule";

const validRule = {
  scopeType: "AIRCRAFT" as const,
  scopeId: "aircraft-1",
  kind: "REFUELING" as const,
  triggerMetric: "COMPLETED_ROTATIONS" as const,
  intervalValue: 5,
  progressValue: 2,
  minimumDurationMinutes: 8,
  typicalDurationMinutes: 12,
  maximumDurationMinutes: 18,
};

describe("recurring operational rules", () => {
  it("accepts a valid aircraft refueling rule", () => {
    expect(validateRecurringOperationalRule(validRule)).toEqual([]);
  });

  it("rejects refueling for a pilot", () => {
    expect(validateRecurringOperationalRule({ ...validRule, scopeType: "PILOT" })).toContain(
      "Tanken kann nur für ein Flugzeug geplant werden.",
    );
  });

  it("uses confirmed rotations or rounded operating minutes as progress", () => {
    expect(
      recurringProgressIncrement({
        triggerMetric: "COMPLETED_ROTATIONS",
        operatingMinutes: 22.4,
      }),
    ).toBe(1);
    expect(
      recurringProgressIncrement({
        triggerMetric: "OPERATING_MINUTES",
        operatingMinutes: 22.6,
      }),
    ).toBe(23);
  });

  it("is only due when an active rule reaches its threshold", () => {
    expect(recurringRuleIsDue({ ...validRule, status: "ACTIVE", progressValue: 5 })).toBe(true);
    expect(recurringRuleIsDue({ ...validRule, status: "DISABLED", progressValue: 5 })).toBe(false);
  });

  it("allows only Flight Director and Administration to maintain rules", () => {
    for (const command of [
      "UPSERT_RECURRING_OPERATIONAL_RULE",
      "DISABLE_RECURRING_OPERATIONAL_RULE",
    ] as const) {
      expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", command)).not.toThrow();
      expect(() => assertRoleMayExecute("ADMIN", command)).not.toThrow();
      for (const role of ["CASHIER", "FLIGHT_LINE", "DISPLAY"] as const) {
        expect(() => assertRoleMayExecute(role, command)).toThrow(DomainRuleError);
      }
    }
  });
});
