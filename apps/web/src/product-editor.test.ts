import { describe, expect, it } from "vitest";
import {
  formatEuroInput,
  parseEuroToCents,
  productPositionOptions,
  setWeightCaptureMode,
  toggleWeightClass,
  weightCaptureEnabled,
} from "./product-editor";

describe("product editor values", () => {
  it("formats cents for German operators and parses comma or point exactly", () => {
    expect(formatEuroInput(4550)).toBe("45,50 €");
    expect(parseEuroToCents("45,50 €")).toBe(4550);
    expect(parseEuroToCents("45.5")).toBe(4550);
    expect(parseEuroToCents("1.234,56 €")).toBe(123456);
    expect(parseEuroToCents("45,555")).toBeNull();
  });

  it("keeps the no-capture state exclusive from weight classes", () => {
    expect(weightCaptureEnabled(["NOT_CAPTURED"])).toBe(false);
    expect(setWeightCaptureMode(true)).toEqual(["NORMAL"]);
    expect(toggleWeightClass(["NOT_CAPTURED"], "CHILD", true)).toEqual(["CHILD"]);
    expect(toggleWeightClass(["CHILD", "NORMAL"], "CHILD", false)).toEqual(["NORMAL"]);
    expect(setWeightCaptureMode(false)).toEqual(["NOT_CAPTURED"]);
  });

  it("describes a product position without exposing sort-order internals", () => {
    expect(
      productPositionOptions(
        [
          { id: "short", name: "Kurzflug", sortOrder: 10 },
          { id: "panorama", name: "Panorama", sortOrder: 20 },
        ],
        "new",
      ).map((option) => option.label),
    ).toEqual(["Ganz vorne", "Nach „Kurzflug“", "Nach „Panorama“"]);
  });
});
