import type { OperationBoard } from "@rundflug/contracts";
import { describe, expect, it } from "vitest";
import { cashierCapacityGuidance } from "./CashierViewPresentation";

type CashierProduct = OperationBoard["products"][number];

function product(
  capacityStatus: CashierProduct["capacityStatus"],
  saleRecommended: boolean,
): CashierProduct {
  return {
    capacityStatus,
    saleEnabled: true,
    saleRecommended,
  } as CashierProduct;
}

describe("cashier capacity guidance", () => {
  it("presents the most restrictive status without turning a recommendation into a hard guard", () => {
    expect(
      cashierCapacityGuidance([product("AVAILABLE", true), product("MANUAL_REVIEW", false)]),
    ).toEqual({
      label: "Kapazität manuell prüfen",
      recommendation: "Verkauf derzeit nicht empfohlen · bewusster Verkauf bleibt möglich",
      tone: "warning",
    });
  });

  it("reserves stable copy while capacity is loading", () => {
    expect(cashierCapacityGuidance(undefined)).toEqual({
      label: "Kapazität wird geladen",
      recommendation: "Verkaufsempfehlung wird ermittelt",
      tone: "loading",
    });
  });
});
