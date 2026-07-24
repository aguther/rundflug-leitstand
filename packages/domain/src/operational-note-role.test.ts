import { describe, expect, it } from "vitest";
import { assertRoleMayExecute, DomainRuleError } from "./index";

describe("event-wide operational note authorization", () => {
  it("allows Flight Director and Admin", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "SET_OPERATIONAL_NOTE")).not.toThrow();
    expect(() => assertRoleMayExecute("ADMIN", "SET_OPERATIONAL_NOTE")).not.toThrow();
  });

  it("rejects cashier, flight line and display roles", () => {
    for (const role of ["CASHIER", "FLIGHT_LINE", "DISPLAY"] as const) {
      expect(() => assertRoleMayExecute(role, "SET_OPERATIONAL_NOTE")).toThrow(DomainRuleError);
    }
  });
});
