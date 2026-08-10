// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useResourceGroupEditorState } from "./useResourceGroupEditorState";

const resourceGroup = {
  id: "group-a",
  name: "Panorama queue",
  shortCode: "PA",
  gateId: "gate-b",
  automaticPrecallEnabled: false,
  referenceCapacity: 4,
} as OperationBoard["resourceGroups"][number];

const board = {
  resourceGroups: [resourceGroup],
  gates: [
    { id: "gate-inactive", active: false },
    { id: "gate-a", active: true },
    { id: "gate-b", active: true },
  ],
} as OperationBoard;

afterEach(cleanup);

describe("resource group editor state", () => {
  it("starts with neutral values before an explicit selection", () => {
    const view = renderHook(() => useResourceGroupEditorState(board));

    expect(view.result.current).toMatchObject({
      automaticPrecall: true,
      currentGroup: undefined,
      editorId: "new",
      gateId: "",
      name: "",
      shortCode: "",
    });
  });

  it("loads an existing group and returns its stable initial snapshot", () => {
    const view = renderHook(() => useResourceGroupEditorState(board));
    let initialSnapshot = "";

    act(() => {
      initialSnapshot = view.result.current.select("group-a");
    });

    expect(view.result.current).toMatchObject({
      automaticPrecall: false,
      currentGroup: resourceGroup,
      editorId: "group-a",
      gateId: "gate-b",
      name: "Panorama queue",
      shortCode: "PA",
    });
    expect(view.result.current.snapshot).toBe(initialSnapshot);
  });

  it("normalizes short codes while tracking a changed snapshot", () => {
    const view = renderHook(() => useResourceGroupEditorState(board));
    let initialSnapshot = "";
    act(() => {
      initialSnapshot = view.result.current.select("group-a");
    });

    act(() => {
      view.result.current.setShortCode("pa west!");
      view.result.current.setAutomaticPrecall(true);
    });

    expect(view.result.current.shortCode).toBe("PAWEST");
    expect(view.result.current.automaticPrecall).toBe(true);
    expect(view.result.current.snapshot).not.toBe(initialSnapshot);
  });

  it("uses the first active gate for a new group", () => {
    const view = renderHook(() => useResourceGroupEditorState(board));
    act(() => view.result.current.select("group-a"));
    act(() => view.result.current.select("new"));

    expect(view.result.current).toMatchObject({
      automaticPrecall: true,
      currentGroup: undefined,
      editorId: "new",
      gateId: "gate-a",
      name: "",
      shortCode: "",
    });
  });

  it("does not mutate the selected source group", () => {
    const view = renderHook(() => useResourceGroupEditorState(board));
    act(() => view.result.current.select("group-a"));
    act(() => {
      view.result.current.setName("Updated queue");
      view.result.current.setGateId("gate-a");
    });

    expect(resourceGroup.name).toBe("Panorama queue");
    expect(resourceGroup.gateId).toBe("gate-b");
  });
});
