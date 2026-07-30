import { describe, expect, it } from "vitest";
import { cashierProductOrderChanged, moveCashierProduct } from "./cashier-product-order";

describe("cashier product order", () => {
  it("moves a product to a bounded target position without mutating the source", () => {
    const source = ["short", "panorama", "long"];
    expect(moveCashierProduct(source, "long", 0)).toEqual(["long", "short", "panorama"]);
    expect(moveCashierProduct(source, "short", 99)).toEqual(["panorama", "long", "short"]);
    expect(source).toEqual(["short", "panorama", "long"]);
  });

  it("detects only actual order changes", () => {
    expect(cashierProductOrderChanged(["short", "panorama"], ["short", "panorama"])).toBe(false);
    expect(cashierProductOrderChanged(["short", "panorama"], ["panorama", "short"])).toBe(true);
  });
});
