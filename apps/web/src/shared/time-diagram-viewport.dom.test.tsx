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
  freezeDomainWhileZoomed = false,
  resetKey = "one",
}: {
  domainUntil?: number;
  freezeDomainWhileZoomed?: boolean;
  resetKey?: string;
}) {
  const viewport = useTimeDiagramViewport({
    domain: { from: 0, until: domainUntil },
    freezeDomainWhileZoomed,
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
      <output aria-label="Zoom">{viewport.zoom}</output>
      <output aria-label="Von">{viewport.visibleDomain.from}</output>
      <output aria-label="Bis">{viewport.visibleDomain.until}</output>
      <output aria-label="Drag">{String(viewport.dragging)}</output>
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

    fireEvent.wheel(viewport, { clientX: cursorClientX, deltaY: -1 });
    const firstDomain = renderedDomain();
    const firstAnchor = timeAtRatio(firstDomain, 0.75);
    fireEvent.wheel(viewport, { clientX: cursorClientX, deltaY: -1 });
    const secondDomain = renderedDomain();

    expect(screen.getByLabelText("Zoom").textContent).toBe("2");
    expect(timeAtRatio(secondDomain, 0.75)).toBe(firstAnchor);
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
