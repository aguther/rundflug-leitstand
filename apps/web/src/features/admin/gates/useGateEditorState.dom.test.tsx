// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useGateEditorState } from "./useGateEditorState";

const gate = {
  id: "gate-a",
  label: "Halle West",
  gateType: "BOARDING",
  active: false,
  sortOrder: 30,
  travelLeadMinutes: 4,
  displayFilter: {
    productIds: ["product-a"],
    rotationStatuses: ["CALLED", "BOARDING"],
  },
} as OperationBoard["gates"][number];

afterEach(cleanup);

describe("gate editor state", () => {
  it("starts with the approved new-gate defaults", () => {
    const view = renderHook(() => useGateEditorState([gate]));

    expect(view.result.current).toMatchObject({
      active: true,
      displayProductIds: [],
      displayRotationStatuses: [],
      editorId: "new",
      gateType: "FLIGHT_LINE",
      label: "",
      sortOrder: 10,
      travelLeadMinutes: 0,
    });
  });

  it("loads an existing gate and returns its stable initial snapshot", () => {
    const view = renderHook(() => useGateEditorState([gate]));
    let initialSnapshot = "";

    act(() => {
      initialSnapshot = view.result.current.select("gate-a");
    });

    expect(view.result.current).toMatchObject({
      active: false,
      displayProductIds: ["product-a"],
      displayRotationStatuses: ["CALLED", "BOARDING"],
      editorId: "gate-a",
      gateType: "BOARDING",
      label: "Halle West",
      sortOrder: 30,
      travelLeadMinutes: 4,
    });
    expect(view.result.current.snapshot).toBe(initialSnapshot);
  });

  it("tracks form changes without mutating the selected source gate", () => {
    const view = renderHook(() => useGateEditorState([gate]));
    let initialSnapshot = "";
    act(() => {
      initialSnapshot = view.result.current.select("gate-a");
    });

    act(() => {
      view.result.current.setLabel("Halle Ost");
      view.result.current.setDisplayProductIds(["product-b"]);
      view.result.current.setDisplayRotationStatuses(["COMPLETED"]);
    });

    expect(view.result.current.snapshot).not.toBe(initialSnapshot);
    expect(view.result.current.displayFilter).toEqual({
      productIds: ["product-b"],
      rotationStatuses: ["COMPLETED"],
    });
    expect(gate.label).toBe("Halle West");
    expect(gate.displayFilter.productIds).toEqual(["product-a"]);
  });

  it("restores all defaults when a new gate is selected", () => {
    const view = renderHook(() => useGateEditorState([gate]));
    act(() => {
      view.result.current.select("gate-a");
      view.result.current.select("new");
    });

    expect(view.result.current).toMatchObject({
      active: true,
      displayProductIds: [],
      displayRotationStatuses: [],
      editorId: "new",
      gateType: "FLIGHT_LINE",
      label: "",
      sortOrder: 10,
      travelLeadMinutes: 0,
    });
  });

  it("clears the same fields as the existing post-save flow", () => {
    const view = renderHook(() => useGateEditorState([gate]));
    act(() => view.result.current.select("gate-a"));
    act(() => view.result.current.resetAfterSave());

    expect(view.result.current.editorId).toBe("new");
    expect(view.result.current.label).toBe("");
    expect(view.result.current.travelLeadMinutes).toBe(0);
    expect(view.result.current.gateType).toBe("BOARDING");
  });
});
