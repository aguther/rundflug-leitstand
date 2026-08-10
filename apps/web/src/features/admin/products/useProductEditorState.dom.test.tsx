// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useProductEditorState } from "./useProductEditorState";

const product = {
  id: "product-a",
  name: "Panorama",
  code: "PAN20",
  publicDescription: "Scenic round flight",
  resourceGroupId: "group-b",
  gateId: "gate-b",
  priceCents: 12950,
  referenceDurationMinutes: 24,
  promisedFlightMinutes: 20,
  plannedBoardingMinutesOverride: 7,
  plannedDeboardingMinutesOverride: 4,
  plannedBufferMinutesOverride: 2,
  childCompanionRequired: true,
  weightClasses: ["NOT_CAPTURED", "CHILD"],
} as OperationBoard["products"][number];

const board = {
  products: [product],
  resourceGroups: [{ id: "group-a" }, { id: "group-b" }],
  gates: [
    { id: "gate-inactive", active: false },
    { id: "gate-a", active: true },
    { id: "gate-b", active: true },
  ],
} as OperationBoard;

afterEach(cleanup);

describe("product editor state", () => {
  it("starts with neutral values before an explicit selection", () => {
    const view = renderHook(() => useProductEditorState(board));

    expect(view.result.current).toMatchObject({
      code: "",
      editorId: "new",
      gateId: "",
      name: "",
      priceCents: 0,
      priceInput: "0,00 €",
      promisedFlightMinutes: 20,
      referenceDuration: 20,
      resourceGroupId: "",
      weightClasses: ["NOT_CAPTURED"],
    });
  });

  it("loads all fields from an existing product and returns its initial snapshot", () => {
    const view = renderHook(() => useProductEditorState(board));
    let initialSnapshot = "";

    act(() => {
      initialSnapshot = view.result.current.select("product-a");
    });

    expect(view.result.current).toMatchObject({
      boardingOverride: "7",
      bufferOverride: "2",
      childCompanion: true,
      code: "PAN20",
      deboardingOverride: "4",
      description: "Scenic round flight",
      editorId: "product-a",
      gateId: "gate-b",
      name: "Panorama",
      priceCents: 12950,
      priceInput: "129,50 €",
      promisedFlightMinutes: 20,
      referenceDuration: 24,
      resourceGroupId: "group-b",
      weightClasses: ["NOT_CAPTURED", "CHILD"],
    });
    expect(view.result.current.snapshot).toBe(initialSnapshot);
  });

  it("normalizes code and price edits while tracking a changed snapshot", () => {
    const view = renderHook(() => useProductEditorState(board));
    let initialSnapshot = "";
    act(() => {
      initialSnapshot = view.result.current.select("product-a");
    });

    act(() => {
      view.result.current.setCode("short-10");
      view.result.current.setPriceInput("75,5");
    });
    act(() => view.result.current.normalizePrice());

    expect(view.result.current.code).toBe("SHORT-10");
    expect(view.result.current.priceCents).toBe(7550);
    expect(view.result.current.priceInput).toBe("75,50 €");
    expect(view.result.current.snapshot).not.toBe(initialSnapshot);
  });

  it("uses the first resource group and first active gate for a new product", () => {
    const view = renderHook(() => useProductEditorState(board));
    act(() => view.result.current.select("product-a"));
    act(() => view.result.current.select("new"));

    expect(view.result.current).toMatchObject({
      boardingOverride: "",
      bufferOverride: "",
      childCompanion: false,
      code: "",
      deboardingOverride: "",
      description: "",
      editorId: "new",
      gateId: "gate-a",
      name: "",
      priceCents: 0,
      priceInput: "0,00 €",
      promisedFlightMinutes: 20,
      referenceDuration: 20,
      resourceGroupId: "group-a",
      weightClasses: ["NOT_CAPTURED"],
    });
  });

  it("does not mutate the selected source product", () => {
    const view = renderHook(() => useProductEditorState(board));
    act(() => view.result.current.select("product-a"));
    act(() => {
      view.result.current.setName("Short flight");
      view.result.current.setWeightClasses(["HEAVY"]);
    });

    expect(product.name).toBe("Panorama");
    expect(product.weightClasses).toEqual(["NOT_CAPTURED", "CHILD"]);
  });
});
