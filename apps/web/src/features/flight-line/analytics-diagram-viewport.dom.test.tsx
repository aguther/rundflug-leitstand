// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAnalyticsDiagramViewport } from "./analytics-diagram-viewport";

function DiagramViewportHarness({ resetKey }: { resetKey: string }) {
  const [opened, setOpened] = useState(0);
  const viewport = useAnalyticsDiagramViewport(resetKey);
  return (
    <>
      <button onClick={() => viewport.changeZoom(3)} type="button">
        Zoom
      </button>
      <button onClick={viewport.reset} type="button">
        Gesamt
      </button>
      <output aria-label="Zoom">{viewport.zoom}</output>
      <output aria-label="Drag">{String(viewport.dragging)}</output>
      <output aria-label="Opened">{opened}</output>
      <div
        data-testid="viewport"
        onClickCapture={viewport.onClickCapture}
        onPointerCancel={viewport.onPointerCancel}
        onPointerDown={viewport.onPointerDown}
        onPointerMove={viewport.onPointerMove}
        onPointerUp={viewport.onPointerUp}
        ref={viewport.setViewportRef}
      >
        <button onClick={() => setOpened((value) => value + 1)} type="button">
          Prognose öffnen
        </button>
      </div>
    </>
  );
}

function prepareViewport() {
  const viewport = screen.getByTestId("viewport");
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 600 },
    scrollWidth: { configurable: true, value: 1_800 },
  });
  Object.assign(viewport, {
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
    setPointerCapture: vi.fn(),
  });
  return viewport;
}

describe("analytics diagram viewport", () => {
  afterEach(() => cleanup());

  it("resets state, ref, horizontal scroll and dragging when resetKey changes", () => {
    const { rerender } = render(<DiagramViewportHarness resetKey="aircraft:one" />);
    const viewport = prepareViewport();

    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    viewport.scrollLeft = 240;
    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 200,
      pointerId: 7,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(viewport, {
      clientX: 180,
      pointerId: 7,
      pointerType: "mouse",
    });
    expect(screen.getByLabelText("Zoom").textContent).toBe("3");
    expect(screen.getByLabelText("Drag").textContent).toBe("true");

    rerender(<DiagramViewportHarness resetKey="aircraft:two" />);

    expect(screen.getByLabelText("Zoom").textContent).toBe("1");
    expect(screen.getByLabelText("Drag").textContent).toBe("false");
    expect(viewport.scrollLeft).toBe(0);
    fireEvent.wheel(viewport, { clientX: 300, deltaY: -1 });
    expect(screen.getByLabelText("Zoom").textContent).toBe("1.5");
  });

  it("lets Gesamt reset zoom, scroll and an active drag", () => {
    render(<DiagramViewportHarness resetKey="pilot:one" />);
    const viewport = prepareViewport();
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    viewport.scrollLeft = 200;
    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 200,
      pointerId: 8,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(viewport, {
      clientX: 180,
      pointerId: 8,
      pointerType: "mouse",
    });

    fireEvent.click(screen.getByRole("button", { name: "Gesamt" }));

    expect(screen.getByLabelText("Zoom").textContent).toBe("1");
    expect(screen.getByLabelText("Drag").textContent).toBe("false");
    expect(viewport.scrollLeft).toBe(0);
  });

  it("opens a resource on a click but suppresses the click following a drag", () => {
    render(<DiagramViewportHarness resetKey="aircraft:one" />);
    const viewport = prepareViewport();
    const openButton = screen.getByRole("button", { name: "Prognose öffnen" });

    fireEvent.click(openButton);
    expect(screen.getByLabelText("Opened").textContent).toBe("1");

    fireEvent.pointerDown(openButton, {
      button: 0,
      clientX: 200,
      pointerId: 9,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(viewport, {
      clientX: 180,
      pointerId: 9,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(viewport, {
      clientX: 180,
      pointerId: 9,
      pointerType: "mouse",
    });
    fireEvent.click(openButton);

    expect(screen.getByLabelText("Opened").textContent).toBe("1");
  });
});
