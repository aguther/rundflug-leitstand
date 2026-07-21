import { describe, expect, it } from "vitest";
import adminSource from "./admin-view.tsx?raw";
import cashierSource from "./cashier-view.tsx?raw";

describe("cashier operational weight suspension", () => {
  it("removes weight capture from cashier and product management without deleting payload storage", () => {
    expect(cashierSource).not.toContain("Gewichtsklasse (pro Person)");
    expect(cashierSource).not.toContain("ticketDetails,");
    expect(adminSource).not.toContain('label="Gewichtserfassung"');
    expect(adminSource).toContain("weightClasses: productWeightClasses");
    expect(adminSource).toContain("childCompanionRequired: productChildCompanion");
  });
});
