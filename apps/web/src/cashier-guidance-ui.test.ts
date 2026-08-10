import { describe, expect, it } from "vitest";
import cashierSource from "./cashier-view.tsx?raw";

describe("cashier operational weight suspension", () => {
  it("keeps weight capture out of cashier", () => {
    expect(cashierSource).not.toContain("Gewichtsklasse (pro Person)");
    expect(cashierSource).not.toContain("ticketDetails,");
  });
});
