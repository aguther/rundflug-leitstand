import { describe, expect, it } from "vitest";
import { compareTechnicalStrings } from "./technical-order";

describe("compareTechnicalStrings", () => {
  it("orders technical identifiers without a locale dependency", () => {
    expect(["group-10", "group-2", "GROUP-1"].sort(compareTechnicalStrings)).toEqual([
      "GROUP-1",
      "group-10",
      "group-2",
    ]);
  });
});
