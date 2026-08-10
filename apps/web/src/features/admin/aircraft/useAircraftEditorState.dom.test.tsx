// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAircraftEditorState } from "./useAircraftEditorState";

const aircraft = {
  id: "aircraft-a",
  registration: "D-EXYZ",
  aircraftType: "Cessna 172",
  passengerSeats: 3,
  maximumPassengerPayloadKg: 245,
  operationalState: "AVAILABLE",
  resourceGroupName: "Panorama queue",
} as OperationBoard["aircraft"][number];

const board = {
  aircraft: [aircraft],
} as OperationBoard;

afterEach(cleanup);

describe("aircraft editor state", () => {
  it("starts with neutral values before an explicit selection", () => {
    const view = renderHook(() => useAircraftEditorState(board));

    expect(view.result.current).toMatchObject({
      currentAircraft: undefined,
      editorId: "new",
      maximumPassengerPayloadKg: "",
      passengerSeats: 3,
      registration: "",
      type: "",
    });
  });

  it("loads an existing aircraft and returns its stable initial snapshot", () => {
    const view = renderHook(() => useAircraftEditorState(board));
    let initialSnapshot = "";

    act(() => {
      initialSnapshot = view.result.current.select("aircraft-a");
    });

    expect(view.result.current).toMatchObject({
      currentAircraft: aircraft,
      editorId: "aircraft-a",
      maximumPassengerPayloadKg: "245",
      passengerSeats: 3,
      registration: "D-EXYZ",
      type: "Cessna 172",
    });
    expect(view.result.current.snapshot).toBe(initialSnapshot);
  });

  it("normalizes registrations while tracking a changed snapshot", () => {
    const view = renderHook(() => useAircraftEditorState(board));
    let initialSnapshot = "";
    act(() => {
      initialSnapshot = view.result.current.select("aircraft-a");
    });

    act(() => {
      view.result.current.setRegistration("d-efgh");
      view.result.current.setPassengerSeats(4);
    });

    expect(view.result.current.registration).toBe("D-EFGH");
    expect(view.result.current.passengerSeats).toBe(4);
    expect(view.result.current.snapshot).not.toBe(initialSnapshot);
  });

  it("restores defaults for a new aircraft", () => {
    const view = renderHook(() => useAircraftEditorState(board));
    act(() => view.result.current.select("aircraft-a"));
    act(() => view.result.current.select("new"));

    expect(view.result.current).toMatchObject({
      currentAircraft: undefined,
      editorId: "new",
      maximumPassengerPayloadKg: "",
      passengerSeats: 3,
      registration: "",
      type: "",
    });
  });

  it("does not mutate the selected source aircraft", () => {
    const view = renderHook(() => useAircraftEditorState(board));
    act(() => view.result.current.select("aircraft-a"));
    act(() => {
      view.result.current.setType("Piper PA-28");
      view.result.current.setMaximumPassengerPayloadKg("210");
    });

    expect(aircraft.aircraftType).toBe("Cessna 172");
    expect(aircraft.maximumPassengerPayloadKg).toBe(245);
  });
});
