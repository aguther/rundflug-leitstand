import { describe, expect, it } from "vitest";
import { validateProductSalesUpdate } from "./product-sales-policy";

describe("product sales policy", () => {
  it("permits closing-time-only updates during preparation", () => {
    expect(validateProductSalesUpdate("PREPARATION", true, true)).toBeNull();
    expect(validateProductSalesUpdate("PREPARATION", false, false)).toBeNull();
  });

  it("rejects live sales changes before release", () => {
    expect(validateProductSalesUpdate("PREPARATION", true, false)).toBe(
      "PRODUCT_LIVE_SALES_NOT_AVAILABLE",
    );
    expect(validateProductSalesUpdate("PREPARATION", false, true)).toBe(
      "PRODUCT_LIVE_SALES_NOT_AVAILABLE",
    );
  });

  it("permits live changes during operations and rejects all changes afterwards", () => {
    expect(validateProductSalesUpdate("ACTIVE", true, false)).toBeNull();
    expect(validateProductSalesUpdate("CLOSED", true, true)).toBe("PRODUCT_SALES_EVENT_READ_ONLY");
    expect(validateProductSalesUpdate("ARCHIVED", false, false)).toBe(
      "PRODUCT_SALES_EVENT_READ_ONLY",
    );
  });
});
