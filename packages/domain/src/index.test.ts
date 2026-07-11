import { describe, expect, it } from "vitest";
import {
  assertGroupIsNotAutomaticallySplit,
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
