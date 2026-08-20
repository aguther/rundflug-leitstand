// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIME_DIAGRAM_MINIMUM_VISIBLE_SPAN_MS,
  timeAtRatio,
  timeDiagramAxisTickValues,
  timeDiagramZoomLevelsForSpan,
  useTimeDiagramViewport,
  zoomTimeDomain,
} from "./time-diagram-viewport";

const HOUR_MS = 60 * 60_000;

function DiagramViewportHarness({
  domainUntil = 24 * HOUR_MS,
  followFrom,
  followUntil,
  freezeDomainWhileZoomed = false,
  initialView,
  resetKey = "one",
}: {
  domainUntil?: number;
  followFrom?: number;
  followUntil?: number;
  freezeDomainWhileZoomed?: boolean;
  initialView?: "follow" | "full";
  resetKey?: string;
}) {
  const viewport = useTimeDiagramViewport({
    domain: { from: 0, until: domainUntil },
    ...(followFrom === undefined || followUntil === undefined
      ? {}
      : { followDomain: { from: followFrom, until: followUntil } }),
    freezeDomainWhileZoomed,
    ...(initialView === undefined ? {} : { initialView }),
    insets: { left: 40, right: 20 },
    resetKey,
  });
  return (
    <>
      <button onClick={() => viewport.changeZoom(3)} type="button">
        Zoom
      </button>
      <button onClick={viewport.reset} type="button">
        Gesamt
      </button>
      <button onClick={viewport.resumeFollowing} type="button">
        Aktuell folgen
      </button>
      <output aria-label="Zoom">{viewport.zoom}</output>
      <output aria-label="Von">{viewport.visibleDomain.from}</output>
      <output aria-label="Bis">{viewport.visibleDomain.until}</output>
      <output aria-label="Drag">{String(viewport.dragging)}</output>
      <output aria-label="Folgt">{String(viewport.following)}</output>
      <div
        data-testid="viewport"
        onClickCapture={viewport.onClickCapture}
        onPointerCancel={viewport.onPointerCancel}
        onPointerDown={viewport.onPointerDown}
        onPointerMove={viewport.onPointerMove}
        onPointerUp={viewport.onPointerUp}
        ref={viewport.setViewportRef}
      />
    </>
  );
}

function prepareViewport() {
  const viewport = screen.getByTestId("viewport");
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 320 },
    clientWidth: { configurable: true, value: 660 },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ left: 100, right: 760, width: 660 }),
    },
  });
  Object.assign(viewport, {
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
    setPointerCapture: vi.fn(),
  });
  return viewport;
}

function dispatchWheel(viewport: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  fireEvent(viewport, event);
  return event;
}

function renderedDomain() {
  return {
    from: Number(screen.getByLabelText("Von").textContent),
    until: Number(screen.getByLabelText("Bis").textContent),
  };
}

describe("time diagram viewport", () => {
  afterEach(cleanup);

  it.each([12, 24, 48])(
    "limits a %s-hour domain once at most 15 minutes remain visible",
    (hours) => {
      const levels = timeDiagramZoomLevelsForSpan(hours * HOUR_MS);
      const maximumZoom = levels.at(-1) ?? 1;
      expect((hours * HOUR_MS) / maximumZoom).toBeLessThanOrEqual(
        DEFAULT_TIME_DIAGRAM_MINIMUM_VISIBLE_SPAN_MS,
      );
      expect(new Set(levels).size).toBe(levels.length);
      expect(levels.every((level, index) => index === 0 || level > (levels[index - 1] ?? 0))).toBe(
        true,
      );
    },
  );

  it("resolves a maximally zoomed time axis to whole minutes, but never seconds", () => {
    const from = Date.parse("2026-07-24T08:00:20.000Z");
    const ticks = timeDiagramAxisTickValues({
      domain: { from, until: from + 15 * 60_000 },
      pixelWidth: 720,
    });

    expect(ticks.length).toBeGreaterThan(10);
    expect(ticks.every((tick) => tick % 60_000 === 0)).toBe(true);
    expect(ticks.slice(1).every((tick, index) => tick - (ticks[index] ?? 0) === 60_000)).toBe(true);
  });

  it.each([0.2, 0.5, 0.8])("keeps the time at ratio %s stable while zooming", (ratio) => {
    const currentDomain = { from: 2 * HOUR_MS, until: 10 * HOUR_MS };
    const anchorTime = timeAtRatio(currentDomain, ratio);
    const nextDomain = zoomTimeDomain({
      anchorRatio: ratio,
      baseDomain: { from: 0, until: 24 * HOUR_MS },
      currentDomain,
      nextZoom: 6,
    });
    expect(timeAtRatio(nextDomain, ratio)).toBe(anchorTime);
  });

  it("clamps the visible domain at the full-domain edges", () => {
    expect(
      zoomTimeDomain({
        anchorRatio: 0,
        baseDomain: { from: 0, until: 24 * HOUR_MS },
        currentDomain: { from: 0, until: 24 * HOUR_MS },
        nextZoom: 4,
      }),
    ).toEqual({ from: 0, until: 6 * HOUR_MS });
    expect(
      zoomTimeDomain({
        anchorRatio: 1,
        baseDomain: { from: 0, until: 24 * HOUR_MS },
        currentDomain: { from: 0, until: 24 * HOUR_MS },
        nextZoom: 4,
      }),
    ).toEqual({ from: 18 * HOUR_MS, until: 24 * HOUR_MS });
  });

  it("uses current refs for rapid wheel bursts before another render", () => {
    render(<DiagramViewportHarness />);
    const viewport = prepareViewport();
    const cursorClientX = 140 + 600 * 0.75;

    dispatchWheel(viewport, { clientX: cursorClientX, ctrlKey: true, deltaY: -1 });
    const firstDomain = renderedDomain();
    const firstAnchor = timeAtRatio(firstDomain, 0.75);
    dispatchWheel(viewport, { clientX: cursorClientX, ctrlKey: true, deltaY: -1 });
    const secondDomain = renderedDomain();

    expect(screen.getByLabelText("Zoom").textContent).toBe("2");
    expect(timeAtRatio(secondDomain, 0.75)).toBe(firstAnchor);
  });

  it("zooms only with Ctrl and always suppresses browser zoom", () => {
    render(<DiagramViewportHarness />);
    const viewport = prepareViewport();
    const unmodifiedWheel = dispatchWheel(viewport, { clientX: 440, deltaY: -1 });
    const shiftedWheel = dispatchWheel(viewport, { clientX: 440, deltaY: -1, shiftKey: true });

    expect(unmodifiedWheel.defaultPrevented).toBe(false);
    expect(shiftedWheel.defaultPrevented).toBe(false);
    expect(screen.getByLabelText("Zoom").textContent).toBe("1");

    const ctrlWheel = dispatchWheel(viewport, { clientX: 440, ctrlKey: true, deltaY: -1 });
    expect(ctrlWheel.defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Zoom").textContent).toBe("1.5");

    for (let index = 0; index < 20; index += 1) {
      dispatchWheel(viewport, { clientX: 440, ctrlKey: true, deltaY: -1 });
    }
    const maximumZoom = screen.getByLabelText("Zoom").textContent;
    const wheelAtLimit = dispatchWheel(viewport, { clientX: 440, ctrlKey: true, deltaY: -1 });
    expect(wheelAtLimit.defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Zoom").textContent).toBe(maximumZoom);
  });

  it("pans a zoomed time axis with the unmodified wheel", () => {
    render(<DiagramViewportHarness />);
    const viewport = prepareViewport();
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    const beforePan = renderedDomain();

    const panWheel = dispatchWheel(viewport, { deltaY: 80 });

    expect(panWheel.defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Zoom").textContent).toBe("3");
    expect(renderedDomain().from).toBeGreaterThan(beforePan.from);
  });

  it("releases the unmodified wheel when the time axis cannot pan farther", () => {
    render(<DiagramViewportHarness />);
    const viewport = prepareViewport();
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));

    const wheelToEdge = dispatchWheel(viewport, { deltaY: 100_000 });
    const wheelAtEdge = dispatchWheel(viewport, { deltaY: 80 });

    expect(wheelToEdge.defaultPrevented).toBe(true);
    expect(wheelAtEdge.defaultPrevented).toBe(false);
    expect(renderedDomain().until).toBe(24 * HOUR_MS);
  });

  it("resets zoom and domain when the reset key changes", () => {
    const { rerender } = render(<DiagramViewportHarness resetKey="one" />);
    prepareViewport();
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    expect(screen.getByLabelText("Zoom").textContent).toBe("3");

    rerender(<DiagramViewportHarness domainUntil={12 * HOUR_MS} resetKey="two" />);

    expect(screen.getByLabelText("Zoom").textContent).toBe("1");
    expect(renderedDomain()).toEqual({ from: 0, until: 12 * HOUR_MS });
  });

  it("follows a rolling domain until the first manual pan and resumes on demand", () => {
    const { rerender } = render(
      <DiagramViewportHarness followFrom={6 * HOUR_MS} followUntil={9 * HOUR_MS} />,
    );
    const viewport = prepareViewport();

    expect(renderedDomain()).toEqual({ from: 6 * HOUR_MS, until: 9 * HOUR_MS });
    expect(screen.getByLabelText("Folgt").textContent).toBe("true");

    rerender(<DiagramViewportHarness followFrom={7 * HOUR_MS} followUntil={10 * HOUR_MS} />);
    expect(renderedDomain()).toEqual({ from: 7 * HOUR_MS, until: 10 * HOUR_MS });

    dispatchWheel(viewport, { deltaY: -100_000 });
    expect(renderedDomain()).toEqual({ from: 0, until: 3 * HOUR_MS });
    expect(screen.getByLabelText("Folgt").textContent).toBe("false");

    rerender(<DiagramViewportHarness followFrom={8 * HOUR_MS} followUntil={11 * HOUR_MS} />);
    expect(renderedDomain()).toEqual({ from: 0, until: 3 * HOUR_MS });

    fireEvent.click(screen.getByRole("button", { name: "Aktuell folgen" }));
    expect(renderedDomain()).toEqual({ from: 8 * HOUR_MS, until: 11 * HOUR_MS });
    expect(screen.getByLabelText("Folgt").textContent).toBe("true");

    rerender(<DiagramViewportHarness followFrom={9 * HOUR_MS} followUntil={12 * HOUR_MS} />);
    expect(renderedDomain()).toEqual({ from: 9 * HOUR_MS, until: 12 * HOUR_MS });

    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 500,
      pointerId: 9,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(viewport, {
      clientX: 560,
      pointerId: 9,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(viewport, { clientX: 560, pointerId: 9, pointerType: "mouse" });
    expect(screen.getByLabelText("Folgt").textContent).toBe("false");
    expect(renderedDomain().from).toBeLessThan(9 * HOUR_MS);
  });

  it("can start on the full domain while retaining an explicit follow action", () => {
    const { rerender } = render(
      <DiagramViewportHarness
        followFrom={6 * HOUR_MS}
        followUntil={9 * HOUR_MS}
        initialView="full"
        resetKey="one"
      />,
    );

    expect(renderedDomain()).toEqual({ from: 0, until: 24 * HOUR_MS });
    expect(screen.getByLabelText("Zoom").textContent).toBe("1");
    expect(screen.getByLabelText("Folgt").textContent).toBe("false");

    rerender(
      <DiagramViewportHarness
        followFrom={7 * HOUR_MS}
        followUntil={10 * HOUR_MS}
        initialView="full"
        resetKey="one"
      />,
    );
    expect(renderedDomain()).toEqual({ from: 0, until: 24 * HOUR_MS });

    fireEvent.click(screen.getByRole("button", { name: "Aktuell folgen" }));
    expect(renderedDomain()).toEqual({ from: 7 * HOUR_MS, until: 10 * HOUR_MS });
    expect(screen.getByLabelText("Folgt").textContent).toBe("true");

    rerender(
      <DiagramViewportHarness
        followFrom={8 * HOUR_MS}
        followUntil={11 * HOUR_MS}
        initialView="full"
        resetKey="two"
      />,
    );
    expect(renderedDomain()).toEqual({ from: 0, until: 24 * HOUR_MS });
    expect(screen.getByLabelText("Folgt").textContent).toBe("false");
  });

  it("stops rolling following when a zoom control changes the viewport", () => {
    render(<DiagramViewportHarness followFrom={6 * HOUR_MS} followUntil={9 * HOUR_MS} />);
    prepareViewport();

    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));

    expect(screen.getByLabelText("Folgt").textContent).toBe("false");
    expect(screen.getByLabelText("Zoom").textContent).toBe("3");
  });

  it("clamps manual navigation and resumed following to both full-day edges", () => {
    const { rerender } = render(
      <DiagramViewportHarness followFrom={10 * HOUR_MS} followUntil={13 * HOUR_MS} />,
    );
    const viewport = prepareViewport();

    dispatchWheel(viewport, { deltaY: 100_000 });
    expect(renderedDomain()).toEqual({ from: 21 * HOUR_MS, until: 24 * HOUR_MS });

    rerender(<DiagramViewportHarness followFrom={23 * HOUR_MS} followUntil={26 * HOUR_MS} />);
    fireEvent.click(screen.getByRole("button", { name: "Aktuell folgen" }));
    expect(renderedDomain()).toEqual({ from: 21 * HOUR_MS, until: 24 * HOUR_MS });

    fireEvent.click(screen.getByRole("button", { name: "Gesamt" }));
    expect(renderedDomain()).toEqual({ from: 0, until: 24 * HOUR_MS });
    expect(screen.getByLabelText("Folgt").textContent).toBe("false");
  });

  it("reactivates rolling following for a new reset key", () => {
    const { rerender } = render(
      <DiagramViewportHarness followFrom={6 * HOUR_MS} followUntil={9 * HOUR_MS} resetKey="one" />,
    );
    const viewport = prepareViewport();
    dispatchWheel(viewport, { deltaY: -100_000 });
    expect(screen.getByLabelText("Folgt").textContent).toBe("false");

    rerender(
      <DiagramViewportHarness followFrom={9 * HOUR_MS} followUntil={12 * HOUR_MS} resetKey="two" />,
    );
    expect(renderedDomain()).toEqual({ from: 9 * HOUR_MS, until: 12 * HOUR_MS });
    expect(screen.getByLabelText("Folgt").textContent).toBe("true");
  });

  it("freezes a zoomed domain until reset and then follows the latest full domain", () => {
    const { rerender } = render(
      <DiagramViewportHarness domainUntil={24 * HOUR_MS} freezeDomainWhileZoomed />,
    );
    prepareViewport();
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    const frozenDomain = renderedDomain();

    rerender(<DiagramViewportHarness domainUntil={30 * HOUR_MS} freezeDomainWhileZoomed />);
    expect(renderedDomain()).toEqual(frozenDomain);

    fireEvent.click(screen.getByRole("button", { name: "Gesamt" }));
    expect(renderedDomain()).toEqual({ from: 0, until: 30 * HOUR_MS });
  });

  it("pans a zoomed domain and resets dragging", () => {
    render(<DiagramViewportHarness />);
    const viewport = prepareViewport();
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    const beforeDrag = renderedDomain();

    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 500,
      pointerId: 7,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(viewport, {
      clientX: 440,
      pointerId: 7,
      pointerType: "mouse",
    });
    expect(screen.getByLabelText("Drag").textContent).toBe("true");
    expect(renderedDomain().from).toBeGreaterThan(beforeDrag.from);

    fireEvent.pointerUp(viewport, { clientX: 440, pointerId: 7, pointerType: "mouse" });
    expect(screen.getByLabelText("Drag").textContent).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Gesamt" }));
    expect(screen.getByLabelText("Zoom").textContent).toBe("1");
    expect(renderedDomain()).toEqual({ from: 0, until: 24 * HOUR_MS });
  });
});
