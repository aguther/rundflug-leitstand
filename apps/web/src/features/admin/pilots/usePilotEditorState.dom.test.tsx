// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePilotEditorState } from "./usePilotEditorState";

const pilot = {
  id: "pilot-a",
  operationalCode: "P-17",
  operationalNote: "Morning shift",
  active: true,
  paused: false,
  currentCommunicationNumber: 23,
} as OperationBoard["pilots"][number];

afterEach(cleanup);

describe("pilot editor state", () => {
  it("starts with the approved anonymous-code defaults", () => {
    const view = renderHook(() => usePilotEditorState([pilot]));

    expect(view.result.current).toMatchObject({
      code: "P-01",
      currentPilot: undefined,
      editorId: "new",
      note: "",
    });
  });

  it("loads an existing pilot and returns its stable initial snapshot", () => {
    const view = renderHook(() => usePilotEditorState([pilot]));
    let initialSnapshot = "";

    act(() => {
      initialSnapshot = view.result.current.select("pilot-a");
    });

    expect(view.result.current).toMatchObject({
      code: "P-17",
      currentPilot: pilot,
      editorId: "pilot-a",
      note: "Morning shift",
    });
    expect(view.result.current.snapshot).toBe(initialSnapshot);
  });

  it("normalizes code edits without mutating the selected source pilot", () => {
    const view = renderHook(() => usePilotEditorState([pilot]));
    let initialSnapshot = "";
    act(() => {
      initialSnapshot = view.result.current.select("pilot-a");
    });

    act(() => {
      view.result.current.setCode("p-18");
      view.result.current.setNote("Afternoon shift");
    });

    expect(view.result.current.code).toBe("P-18");
    expect(view.result.current.note).toBe("Afternoon shift");
    expect(view.result.current.snapshot).not.toBe(initialSnapshot);
    expect(pilot.operationalCode).toBe("P-17");
    expect(pilot.operationalNote).toBe("Morning shift");
  });

  it("restores defaults when a new pilot is selected", () => {
    const view = renderHook(() => usePilotEditorState([pilot]));
    act(() => view.result.current.select("pilot-a"));
    act(() => view.result.current.select("new"));

    expect(view.result.current).toMatchObject({
      code: "P-01",
      currentPilot: undefined,
      editorId: "new",
      note: "",
    });
  });

  it("resets the complete draft after a successful save", () => {
    const view = renderHook(() => usePilotEditorState([pilot]));
    act(() => view.result.current.select("pilot-a"));
    act(() => view.result.current.resetAfterSave());

    expect(view.result.current).toMatchObject({
      code: "P-01",
      currentPilot: undefined,
      editorId: "new",
      note: "",
    });
  });
});
