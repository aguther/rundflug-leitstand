// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MasterDataCategory } from "../../../admin-ux";
import { useAdminMasterEditorState } from "./useAdminMasterEditorState";

function createEditors() {
  function editor(prefix: string) {
    const state = {
      select: vi.fn((id: string) => {
        state.snapshot = `${prefix}-${id}`;
        return state.snapshot;
      }),
      snapshot: `${prefix}-new`,
    };
    return state;
  }
  return {
    aircraft: editor("aircraft"),
    gates: editor("gate"),
    pilots: editor("pilot"),
    products: editor("product"),
    resourceGroups: editor("group"),
  };
}

afterEach(cleanup);

describe("admin master editor state", () => {
  it("opens the selected editor with a fresh submission and general tab", () => {
    const editors = createEditors();
    const view = renderHook(() => useAdminMasterEditorState({ category: "products", editors }));
    act(() => {
      view.result.current.setSubmitAttempted(true);
      view.result.current.setTab("details");
      view.result.current.selectProduct("product-a");
    });

    expect(editors.products.select).toHaveBeenCalledWith("product-a");
    expect(view.result.current.open).toBe(true);
    expect(view.result.current.submitAttempted).toBe(false);
    expect(view.result.current.tab).toBe("general");
    expect(view.result.current.dirty).toBe(false);
  });

  it("guards a dirty editor and supports continuing or discarding", () => {
    const editors = createEditors();
    const view = renderHook(() => useAdminMasterEditorState({ category: "products", editors }));
    act(() => view.result.current.selectProduct("new"));
    editors.products.snapshot = "product-changed";
    view.rerender();

    expect(view.result.current.dirty).toBe(true);
    act(() => view.result.current.requestClose());
    expect(view.result.current.open).toBe(false);
    expect(view.result.current.discardChangesOpen).toBe(true);

    act(() => view.result.current.continueEditing());
    expect(view.result.current.open).toBe(true);
    expect(view.result.current.discardChangesOpen).toBe(false);

    act(() => view.result.current.discardChanges());
    expect(view.result.current.open).toBe(false);
    expect(view.result.current.discardChangesOpen).toBe(false);
    expect(view.result.current.dirty).toBe(false);
  });

  it("starts a new entry for each selected category including the legacy assignment alias", () => {
    const editors = createEditors();
    const { result, rerender } = renderHook(
      ({ category }: { category: MasterDataCategory }) =>
        useAdminMasterEditorState({ category, editors }),
      { initialProps: { category: "gates" } },
    );

    act(() => result.current.startNewEntry());
    expect(editors.gates.select).toHaveBeenCalledWith("new");

    rerender({ category: "assignments" });
    act(() => result.current.startNewEntry());
    expect(editors.aircraft.select).toHaveBeenCalledWith("new");
  });

  it("resets editor state when the event step changes", () => {
    const editors = createEditors();
    const view = renderHook(() => useAdminMasterEditorState({ category: "pilots", editors }));
    act(() => {
      view.result.current.selectPilot("new");
      view.result.current.setSubmitAttempted(true);
    });

    act(() => view.result.current.resetForStepChange());

    expect(view.result.current.open).toBe(false);
    expect(view.result.current.submitAttempted).toBe(false);
    expect(view.result.current.discardChangesOpen).toBe(false);
  });
});
