import { assertRoleMayExecute, DomainRuleError } from "@rundflug/domain";
import { describe, expect, it } from "vitest";

describe("V1.7.0 Flight-Line aircraft states", () => {
  it("authorizes Flight Line state changes while restricting pilot assignment", () => {
    expect(() =>
      assertRoleMayExecute("FLIGHT_LINE", "SET_AIRCRAFT_OPERATIONAL_STATE"),
    ).not.toThrow();
    expect(() =>
      assertRoleMayExecute("FLIGHT_DIRECTOR", "SET_AIRCRAFT_OPERATIONAL_STATE"),
    ).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "ASSIGN_AIRCRAFT_PILOT")).toThrow(
      DomainRuleError,
    );
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "ASSIGN_AIRCRAFT_PILOT")).not.toThrow();
  });
});
