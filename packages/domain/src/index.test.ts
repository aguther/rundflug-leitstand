import { describe, expect, it } from "vitest";
import {
  assertGroupIsNotAutomaticallySplit,
  assertPublicTicketCode,
  assertRoleMayExecute,
  assertSaleAllowed,
  assertSingleActiveResourceGroup,
  DomainRuleError,
  transitionAircraft,
  transitionRotation,
} from "./index";

describe("aircraft lifecycle", () => {
  it("requires a separate post-landing completion path", () => {
    expect(transitionAircraft("IN_FLIGHT", "LANDED")).toBe("LANDED");
    expect(() => transitionAircraft("LANDED", "AVAILABLE")).toThrow(DomainRuleError);
    expect(transitionAircraft("LANDED", "TURNAROUND")).toBe("TURNAROUND");
    expect(transitionAircraft("TURNAROUND", "AVAILABLE")).toBe("AVAILABLE");
  });
});

describe("command authorization", () => {
  it("allows a cashier to sell", () => {
    expect(() => assertRoleMayExecute("CASHIER", "SELL_TICKET_GROUP")).not.toThrow();
  });

  it("rejects a display device for operational commands", () => {
    expect(() => assertRoleMayExecute("DISPLAY", "CALL_NEXT")).toThrowError(/darf CALL_NEXT nicht/);
  });

  it("reserves live product sales configuration for administrators", () => {
    expect(() => assertRoleMayExecute("CASHIER", "CONFIGURE_PRODUCT_SALES")).toThrowError(
      /darf CONFIGURE_PRODUCT_SALES nicht/,
    );
    expect(() => assertRoleMayExecute("ADMIN", "CONFIGURE_PRODUCT_SALES")).not.toThrow();
  });

  it("reserves device pairing and revocation for administrators", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "PAIR_DEVICE")).toThrowError(
      /darf PAIR_DEVICE nicht/,
    );
    expect(() => assertRoleMayExecute("ADMIN", "PAIR_DEVICE")).not.toThrow();
    expect(() => assertRoleMayExecute("ADMIN", "REVOKE_DEVICE")).not.toThrow();
  });

  it("separates refuel planning from capacity-removing fleet states", () => {
    expect(() => assertRoleMayExecute("FLIGHT_LINE", "SCHEDULE_AIRCRAFT_REFUEL")).not.toThrow();
    expect(() =>
      assertRoleMayExecute("FLIGHT_LINE", "SET_AIRCRAFT_OPERATIONAL_STATE"),
    ).toThrowError(/darf SET_AIRCRAFT_OPERATIONAL_STATE nicht/);
    expect(() =>
      assertRoleMayExecute("FLIGHT_LINE_LEAD", "SET_AIRCRAFT_OPERATIONAL_STATE"),
    ).not.toThrow();
  });

  it("reserves anonymous pilot-code administration for administrators", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "UPSERT_PILOT")).toThrowError(
      /darf UPSERT_PILOT nicht/,
    );
    expect(() => assertRoleMayExecute("ADMIN", "UPSERT_PILOT")).not.toThrow();
  });

  it("allows flight direction to trigger but not clear emergency mode", () => {
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "TRIGGER_EMERGENCY")).not.toThrow();
    expect(() => assertRoleMayExecute("FLIGHT_DIRECTOR", "CLEAR_EMERGENCY")).toThrowError(
      /darf CLEAR_EMERGENCY nicht/,
    );
  });
});

describe("sale guard", () => {
  it("allows sales only in an active normal operating state", () => {
    expect(() =>
      assertSaleAllowed({
        productSaleEnabled: true,
        resourceGroupStatus: "ACTIVE",
        emergencyMode: false,
        saleClosingReached: false,
      }),
    ).not.toThrow();
  });

  it("blocks sales in emergency mode", () => {
    expect(() =>
      assertSaleAllowed({
        productSaleEnabled: true,
        resourceGroupStatus: "ACTIVE",
        emergencyMode: true,
        saleClosingReached: false,
      }),
    ).toThrowError(/Notfallmodus/);
  });
});

describe("public ticket codes", () => {
  it("normalizes a sufficiently long non-ambiguous code", () => {
    expect(assertPublicTicketCode("abcde2345678")).toBe("ABCDE2345678");
  });

  it("rejects short enumerable codes", () => {
    expect(() => assertPublicTicketCode("1234")).toThrow(DomainRuleError);
  });
});

describe("resource group invariant", () => {
  it("rejects two active memberships for one aircraft", () => {
    expect(() =>
      assertSingleActiveResourceGroup(
        [
          {
            aircraftId: "D-EABC",
            resourceGroupId: "standard",
            activeFrom: "2026-07-11",
            activeUntil: null,
          },
          {
            aircraftId: "D-EABC",
            resourceGroupId: "special",
            activeFrom: "2026-07-11",
            activeUntil: null,
          },
        ],
        "D-EABC",
      ),
    ).toThrowError(/nur einer aktiven Ressourcengruppe/);
  });
});

describe("group protection", () => {
  it("rejects an unconfirmed automatic split", () => {
    expect(() =>
      assertGroupIsNotAutomaticallySplit({
        groupSize: 3,
        selectedPassengers: 2,
        explicitlyConfirmedByHuman: false,
      }),
    ).toThrowError(/niemals automatisch getrennt/);
  });
});

describe("rotation lifecycle", () => {
  it("does not equate landed with completed", () => {
    expect(transitionRotation("IN_FLIGHT", "LANDED")).toBe("LANDED");
    expect(transitionRotation("LANDED", "COMPLETED")).toBe("COMPLETED");
  });
});
