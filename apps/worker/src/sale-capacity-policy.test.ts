import { describe, expect, it } from "vitest";
import cashierSource from "../../web/src/cashier-view.tsx?raw";

describe("V1.9.1 sales capacity policy", () => {
  it("does not turn the forecast recommendation into a disabled cashier action", () => {
    const disabledRule = cashierSource.slice(
      cashierSource.indexOf("const saleDisabled ="),
      cashierSource.indexOf("return (", cashierSource.indexOf("const saleDisabled =")),
    );
    expect(disabledRule).not.toContain("saleRecommended");
    expect(disabledRule).not.toContain("remainingSellableSeats");
  });
});
