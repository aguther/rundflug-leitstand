// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForecastTimeline } from "./ForecastTimeline";
import type { SimulationResult } from "./model";

const currentMs = Date.parse("2026-07-24T10:40:00.000Z");

const result = {
  runWindow: {
    startAt: "2026-07-24T08:00:00.000Z",
    endAt: "2026-07-24T14:00:00.000Z",
  },
  aircraft: [
    { id: "aircraft-1", registration: "D-ESYA", aircraftType: "C172", capacity: 3 },
    { id: "aircraft-2", registration: "D-ESYB", aircraftType: "PA28", capacity: 3 },
  ],
  rotations: [
    {
      id: "rotation-completed",
      communicationNumber: 101,
      productCode: "K",
      createdAt: "2026-07-24T08:30:00.000Z",
      calledAt: "2026-07-24T09:30:00.000Z",
      departedAt: "2026-07-24T09:40:00.000Z",
      landedAt: "2026-07-24T10:00:00.000Z",
      completedAt: "2026-07-24T10:10:00.000Z",
      aircraftId: "aircraft-1",
      precalledAt: "2026-07-24T09:20:00.000Z",
      gateLabel: "Gate A",
    },
    {
      id: "rotation-flight",
      communicationNumber: 102,
      productCode: "L",
      createdAt: "2026-07-24T09:00:00.000Z",
      calledAt: "2026-07-24T10:20:00.000Z",
      departedAt: "2026-07-24T10:30:00.000Z",
      landedAt: "2026-07-24T10:55:00.000Z",
      completedAt: "2026-07-24T11:05:00.000Z",
      aircraftId: "aircraft-2",
      precalledAt: null,
      gateLabel: null,
    },
    {
      id: "rotation-queue",
      communicationNumber: 103,
      productCode: "P",
      createdAt: "2026-07-24T10:00:00.000Z",
      calledAt: null,
      departedAt: null,
      landedAt: null,
      completedAt: null,
      aircraftId: null,
      precalledAt: "2026-07-24T10:35:00.000Z",
      gateLabel: "Gate B",
    },
  ],
  snapshots: [
    {
      snapshotId: "snapshot-future",
      rotationId: "rotation-queue",
      capturedAt: "2026-07-24T10:45:00.000Z",
      predictedBoardingAt: "2026-07-24T11:30:00.000Z",
      quality: "STABLE",
      uncertaintyReasons: [],
    },
    {
      snapshotId: "snapshot-current",
      rotationId: "rotation-queue",
      capturedAt: "2026-07-24T10:39:00.000Z",
      predictedBoardingAt: "2026-07-24T11:15:00.000Z",
      quality: "UNCERTAIN",
      uncertaintyReasons: ["NO_ACTIVE_CAPACITY"],
    },
  ],
  events: [
    {
      id: "plan-start",
      type: "PLANNED_OPERATION_STARTED",
      occurredAt: "2026-07-24T09:20:00.000Z",
      aircraftId: null,
      rotationId: null,
      plannedOperationId: "event-plan",
      details: "event plan started",
      forecastRecalculatedAt: "2026-07-24T09:20:00.000Z",
    },
    {
      id: "event-interruption",
      type: "EVENT_INTERRUPTED",
      occurredAt: "2026-07-24T10:05:00.000Z",
      aircraftId: null,
      rotationId: null,
      details: "wind",
      forecastRecalculatedAt: "2026-07-24T10:05:00.000Z",
    },
    {
      id: "event-resumed",
      type: "EVENT_RESUMED",
      occurredAt: "2026-07-24T10:15:00.000Z",
      aircraftId: null,
      rotationId: null,
      details: "wind cleared",
      forecastRecalculatedAt: "2026-07-24T10:15:00.000Z",
    },
    {
      id: "aircraft-plan-start",
      type: "PLANNED_OPERATION_STARTED",
      occurredAt: "2026-07-24T10:10:00.000Z",
      aircraftId: "aircraft-2",
      rotationId: null,
      plannedOperationId: "aircraft-plan",
      details: "aircraft plan started",
      forecastRecalculatedAt: "2026-07-24T10:10:00.000Z",
    },
    {
      id: "refueling",
      type: "REFUELING_STARTED",
      occurredAt: "2026-07-24T10:15:00.000Z",
      aircraftId: "aircraft-1",
      rotationId: null,
      details: "fuel service",
      forecastRecalculatedAt: "2026-07-24T10:15:00.000Z",
    },
  ],
  plannedOperations: [
    {
      key: "event-plan",
      kind: "SLOWDOWN",
      scopeType: "EVENT",
      scopeId: "event-synthetic",
      publicNote: "reduced throughput",
    },
    {
      key: "aircraft-plan",
      kind: "GROUNDING",
      scopeType: "AIRCRAFT",
      scopeId: "aircraft-2",
      publicNote: null,
    },
    {
      key: "outside-plan",
      kind: "SLOWDOWN",
      scopeType: "EVENT",
      scopeId: "event-synthetic",
      publicNote: null,
    },
  ],
} as unknown as SimulationResult;

afterEach(cleanup);

describe("forecast timeline", () => {
  it("renders planned operations, interruptions, rotations, and the live queue", () => {
    const onSelectRotation = vi.fn();
    const onShowHistory = vi.fn();
    const { container } = render(
      <ForecastTimeline
        currentMs={currentMs}
        onSelectRotation={onSelectRotation}
        onShowHistory={onShowHistory}
        result={result}
        selectedRotationId="rotation-queue"
      />,
    );

    expect(screen.getByText("D-ESYA")).not.toBeNull();
    expect(screen.getByText("D-ESYB")).not.toBeNull();
    expect(screen.getByText("SLOWDOWN").getAttribute("title")).toContain("reduced throughput");
    expect(screen.getByText("GROUNDING")).not.toBeNull();
    expect(screen.getByText("Betrieb unterbrochen").getAttribute("title")).toContain("wind");
    expect(screen.getByText("Tanken").getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("button", { name: "Fluggruppe 101, COMPLETED" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Fluggruppe 102, IN_FLIGHT" })).not.toBeNull();
    expect(screen.getByText("Gate B")).not.toBeNull();
    expect(screen.getByText(/Rohprognose Boarding/).textContent).toContain("nicht freigegeben");
    expect(screen.getByText(/Rohprognose Boarding/).textContent).toContain(
      "keine aktive Kapazität",
    );
    expect(screen.getByText(/GO TO GATE/).textContent).toContain("systemseitig");
    expect(screen.getByText("Qualität unsicher")).not.toBeNull();
    expect(container.querySelectorAll(".sim-future-mask")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Fluggruppe 102, IN_FLIGHT" }));
    fireEvent.click(screen.getByRole("button", { name: "103Gate B" }));
    expect(onSelectRotation.mock.calls).toEqual([["rotation-flight"], ["rotation-queue"]]);
    fireEvent.click(screen.getByRole("button", { name: "Verlauf anzeigen" }));
    expect(onShowHistory).toHaveBeenCalledOnce();
  });

  it("supports keyboard scrolling and the unselected empty summary", () => {
    const { container } = render(
      <ForecastTimeline
        currentMs={Date.parse("2026-07-24T08:00:00.000Z")}
        onSelectRotation={vi.fn()}
        onShowHistory={vi.fn()}
        result={{ ...result, events: [], plannedOperations: [], rotations: [] }}
        selectedRotationId={null}
      />,
    );
    const lanes = screen.getByRole("region", { name: "Tagesplan und Flugzeuge" });
    const scrollBy = vi.fn();
    const scrollTo = vi.fn();
    Object.defineProperties(lanes, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 900 },
      scrollBy: { configurable: true, value: scrollBy },
      scrollTo: { configurable: true, value: scrollTo },
    });

    fireEvent.keyDown(lanes, { key: "PageDown" });
    fireEvent.keyDown(lanes, { key: "PageUp" });
    fireEvent.keyDown(lanes, { key: "Home" });
    fireEvent.keyDown(lanes, { key: "End" });
    fireEvent.keyDown(lanes, { key: "ArrowDown" });

    expect(scrollBy.mock.calls).toEqual([[{ top: 80 }], [{ top: -80 }]]);
    expect(scrollTo.mock.calls).toEqual([[{ top: 0 }], [{ top: 900 }]]);
    expect(screen.getByText("Keine wartenden Gruppen")).not.toBeNull();
    expect(screen.getByText(/Fluggruppe auswählen/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Verlauf anzeigen" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(container.querySelector(".sim-plan-lane")).toBeNull();
  });
});
