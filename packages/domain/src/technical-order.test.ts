import { describe, expect, it } from "vitest";
import { compareTechnicalStrings } from "./technical-order";

describe("compareTechnicalStrings", () => {
  it("orders technical identifiers by stable UTF-16 code units", () => {
    expect(["group-10", "group-2", "GROUP-1"].sort(compareTechnicalStrings)).toEqual([
      "GROUP-1",
      "group-10",
      "group-2",
    ]);
  });

  it("returns zero only for identical strings", () => {
    expect(compareTechnicalStrings("ACTIVE", "ACTIVE")).toBe(0);
    expect(compareTechnicalStrings("ACTIVE", "active")).toBeLessThan(0);
    expect(compareTechnicalStrings("active", "ACTIVE")).toBeGreaterThan(0);
  });
});
