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
