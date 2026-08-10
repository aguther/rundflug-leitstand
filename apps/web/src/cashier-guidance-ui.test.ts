import { describe, expect, it } from "vitest";
import adminSource from "./admin-view.tsx?raw";
import cashierSource from "./cashier-view.tsx?raw";

describe("cashier operational weight suspension", () => {
  it("keeps weight capture out of cashier and product management", () => {
    expect(cashierSource).not.toContain("Gewichtsklasse (pro Person)");
    expect(cashierSource).not.toContain("ticketDetails,");
    expect(adminSource).not.toContain('label="Gewichtserfassung"');
  });
});
