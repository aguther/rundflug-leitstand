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
    const { container } = render(
      <ForecastTimeline
        currentMs={currentMs}
        onSelectRotation={onSelectRotation}
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
    const queueGroup = screen.getByRole("button", { name: "103Gate B" });
    fireEvent.mouseEnter(queueGroup);
    expect(screen.getByText(/Rohprognose Boarding/).textContent).toContain("nicht freigegeben");
    expect(screen.getByText(/Rohprognose Boarding/).textContent).toContain(
      "keine aktive Kapazität",
    );
    expect(screen.getByText(/GO TO GATE/).textContent).toContain("systemseitig");
    expect(screen.getByText("Qualität unsicher")).not.toBeNull();
    expect(screen.getByText("Boarding (Ist) noch offen")).not.toBeNull();
    expect(screen.getByRole("tooltip").parentElement?.className).toContain("sim-timeline-panel");
    expect(container.querySelectorAll(".sim-future-mask")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Fluggruppe 102, IN_FLIGHT" }));
    fireEvent.click(queueGroup);
    expect(onSelectRotation.mock.calls).toEqual([["rotation-flight"], ["rotation-queue"]]);
    expect(container.querySelector(".sim-selection-summary")).toBeNull();
  });

  it("supports keyboard scrolling without rendering the removed selection strip", () => {
    const { container } = render(
      <ForecastTimeline
        currentMs={Date.parse("2026-07-24T08:00:00.000Z")}
        onSelectRotation={vi.fn()}
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
    expect(screen.queryByText(/Fluggruppe auswählen/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Verlauf anzeigen" })).toBeNull();
    expect(container.querySelector(".sim-plan-lane")).toBeNull();
  });

  it("starts on the full day and follows playback only after explicit activation", () => {
    const renderTimeline = (playbackTime: number) => (
      <ForecastTimeline
        currentMs={playbackTime}
        onSelectRotation={vi.fn()}
        result={result}
        selectedRotationId="rotation-queue"
      />
    );
    const { container, rerender } = render(renderTimeline(currentMs));
    const viewport = container.querySelector<HTMLElement>(".sim-timeline-viewport");
    const headingRange = () =>
      container.querySelector(".sim-timeline-heading span")?.textContent ?? "";
    expect(viewport).not.toBeNull();
    if (!viewport) return;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 1_000 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 100, right: 1_100, width: 1_000 }),
      },
    });

    const zoomGroup = screen.getByRole("group", { name: "Diagramm-Zoom" });
    expect(zoomGroup.querySelectorAll("button")).toHaveLength(3);
    expect(screen.queryByText("Gesamt")).toBeNull();
    expect(screen.getByRole("button", { name: "Aktuell folgen" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "Aktuell folgen" }).hasAttribute("disabled")).toBe(
      false,
    );
    const initialRange = headingRange();
    expect(initialRange).toContain("10:00");
    expect(initialRange).toContain("16:00");
    rerender(renderTimeline(currentMs + 30 * 60_000));
    expect(headingRange()).toBe(initialRange);

    fireEvent.click(screen.getByRole("button", { name: "Aktuell folgen" }));
    expect(headingRange()).not.toBe(initialRange);
    expect(screen.getByRole("button", { name: "Aktuell folgen" }).hasAttribute("disabled")).toBe(
      true,
    );

    rerender(renderTimeline(Date.parse(result.runWindow.endAt)));
    expect(headingRange()).toContain("13:00");
    expect(headingRange()).toContain("16:00");
    fireEvent.click(screen.getByRole("button", { name: "Gesamten Zeitverlauf anzeigen" }));
    expect(headingRange()).toContain("10:00");
    expect(headingRange()).toContain("16:00");
    expect(screen.getByRole("button", { name: "Aktuell folgen" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("keeps the overall-zoom end marker inside the plot boundary", () => {
    const { container } = render(
      <ForecastTimeline
        currentMs={Date.parse(result.runWindow.endAt)}
        onSelectRotation={vi.fn()}
        result={result}
        selectedRotationId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Gesamten Zeitverlauf anzeigen" }));

    const lanes = screen.getByRole("region", { name: "Tagesplan und Flugzeuge" });
    const marker = container.querySelector<HTMLElement>(".sim-now-line");
    expect(marker?.style.left).toBe("100%");
    expect(marker?.dataset.edge).toBe("end");
    expect(lanes.dataset.horizontalOverflow).toBe("clipped");
  });

  it("shows tooltip details on keyboard focus, including available actual boarding", () => {
    render(
      <ForecastTimeline
        currentMs={currentMs}
        onSelectRotation={vi.fn()}
        result={result}
        selectedRotationId="rotation-completed"
      />,
    );

    const rotation = screen.getByRole("button", { name: "Fluggruppe 101, COMPLETED" });
    fireEvent.focus(rotation);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Fluggruppe 101");
    expect(tooltip.textContent).toContain("Boarding (Ist) 11:30");
    expect(tooltip.textContent).toContain("GO TO GATE 11:20 · systemseitig");
    fireEvent.blur(rotation);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("labels an unavailable boarding forecast without presenting snapshot quality", () => {
    const unavailableResult = {
      ...result,
      snapshots: result.snapshots.map((snapshot) =>
        snapshot.rotationId === "rotation-queue" &&
        snapshot.capturedAt === "2026-07-24T10:39:00.000Z"
          ? { ...snapshot, forecastState: "UNAVAILABLE" as const }
          : snapshot,
      ),
    };
    render(
      <ForecastTimeline
        currentMs={currentMs}
        onSelectRotation={vi.fn()}
        result={unavailableResult}
        selectedRotationId="rotation-queue"
      />,
    );

    fireEvent.focus(screen.getByRole("button", { name: "103Gate B" }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Boardingprognose nicht verfügbar");
    expect(tooltip.textContent).toContain("Qualität nicht verfügbar");
  });
});
