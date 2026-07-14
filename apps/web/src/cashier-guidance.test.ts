import { describe, expect, it } from "vitest";
import { requiresChildCompanionWarning } from "./cashier-guidance";

describe("child companion guidance", () => {
  it("warns for a configured group containing only children", () => {
    expect(requiresChildCompanionWarning(true, ["CHILD"])).toBe(true);
    expect(requiresChildCompanionWarning(true, ["CHILD", "CHILD"])).toBe(true);
  });

  it("does not warn when the group contains a non-child companion", () => {
    expect(requiresChildCompanionWarning(true, ["CHILD", "NORMAL"])).toBe(false);
    expect(requiresChildCompanionWarning(true, ["CHILD", "INDIVIDUAL"])).toBe(false);
  });

  it("does not infer children when the feature or class is not active", () => {
    expect(requiresChildCompanionWarning(false, ["CHILD"])).toBe(false);
    expect(requiresChildCompanionWarning(true, ["NORMAL", "HEAVY"])).toBe(false);
    expect(requiresChildCompanionWarning(true, ["NOT_CAPTURED"])).toBe(false);
  });
});
