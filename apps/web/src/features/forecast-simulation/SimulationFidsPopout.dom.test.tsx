// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runSimulation } from "./engine";
import type { SimulationResult } from "./model";
import { simulationConfigForPreset } from "./model";
import { SimulationFidsPopout, type SimulationFidsPopoutHandle } from "./SimulationFidsPopout";

const mocks = vi.hoisted(() => ({
  createDataSource: vi.fn(() => ({ kind: "synthetic-data-source" })),
  createLocationAdapter: vi.fn(() => ({ kind: "synthetic-location-adapter" })),
}));

vi.mock("../../design-system/theme", () => ({
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("../../fids-display", () => ({
  FidsDisplay: ({ simulationBanner, subtitle }: { simulationBanner: string; subtitle: string }) => (
    <section aria-label="Simuliertes FIDS">
      <span>{simulationBanner}</span>
      <span>{subtitle}</span>
    </section>
  ),
}));
vi.mock("../fids/fids-location", () => ({
  createFidsLocationAdapter: mocks.createLocationAdapter,
}));
vi.mock("../fids/simulation-fids-data-source", () => ({
  createSimulationFidsDataSource: mocks.createDataSource,
}));

let result: SimulationResult;

beforeAll(() => {
  result = runSimulation(simulationConfigForPreset("NORMAL"));
});

beforeEach(() => {
  window.history.replaceState(null, "", "/simulation?page=2&setup=wall");
});

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("[data-popup-test-source]").forEach((element) => {
    element.remove();
  });
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function createPopup(
  readyState: DocumentReadyState = "complete",
  pathname = "/simulation/fids",
): Window {
  const popupDocument = document.implementation.createHTMLDocument("Synthetic popup");
  Object.defineProperty(popupDocument, "readyState", { configurable: true, value: readyState });
  const events = new EventTarget();
  return {
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    document: popupDocument,
    history: { replaceState: vi.fn() },
    location: { pathname },
    closed: false,
    focus: vi.fn(),
    close: vi.fn(),
  } as unknown as Window;
}

function renderPopout(onWindowError = vi.fn()) {
  const ref = createRef<SimulationFidsPopoutHandle>();
  const rendered = render(
    <SimulationFidsPopout
      clockMs={Date.parse("2026-07-22T10:00:00.000Z")}
      onWindowError={onWindowError}
      ref={ref}
      result={result}
      speed={10}
      visibleAt={Date.parse(result.runWindow.startAt)}
    />,
  );
  return { ...rendered, onWindowError, ref };
}

describe("simulation FIDS popout", () => {
  it("reports a blocked popup without rendering a board", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { onWindowError, ref } = renderPopout();

    act(() => ref.current?.open());

    expect(open).toHaveBeenCalledWith(
      "/simulation/fids",
      "rundflug-simulation-fids",
      "popup=yes,width=1600,height=900,resizable=yes,scrollbars=no",
    );
    expect(onWindowError).toHaveBeenCalledWith(expect.stringContaining("Pop-ups"));
    expect(screen.queryByRole("region", { name: "Simuliertes FIDS" })).toBeNull();
  });

  it("prepares and reuses an open popup while preserving supported URL parameters", async () => {
    const viewport = document.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width";
    viewport.dataset.popupTestSource = "true";
    document.head.append(viewport);
    const baseStyles = document.createElement("style");
    baseStyles.dataset.viteDevId = "C:\\synthetic\\design-system\\base.css";
    baseStyles.dataset.popupTestSource = "true";
    baseStyles.textContent = ":root { color: black; }";
    document.head.append(baseStyles);
    const unrelatedStyles = document.createElement("style");
    unrelatedStyles.dataset.viteDevId = "C:\\synthetic\\forecast.css";
    unrelatedStyles.dataset.popupTestSource = "true";
    document.head.append(unrelatedStyles);
    const popup = createPopup();
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    const { onWindowError, ref } = renderPopout();

    act(() => ref.current?.open());

    await waitFor(() => {
      expect(popup.document.querySelector("#simulation-fids-root")).toBeTruthy();
    });
    expect(popup.document.documentElement.lang).toBe("de");
    expect(popup.document.querySelector('meta[name="viewport"]')).toBeTruthy();
    expect(popup.document.querySelectorAll("style")).toHaveLength(1);
    expect(popup.document.title).toBe("Simuliertes FIDS · Rundflug-Leitstand");
    expect(popup.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/simulation/fids?page=2&setup=wall",
    );
    expect(popup.document.body.textContent).toContain("Nur Simulation – keine Betriebsdaten");
    expect(mocks.createDataSource).toHaveBeenCalled();
    expect(mocks.createLocationAdapter).toHaveBeenCalledWith(popup);

    act(() => ref.current?.open());
    expect(open).toHaveBeenCalledOnce();
    expect(popup.focus).toHaveBeenCalledTimes(2);
    expect(onWindowError).toHaveBeenLastCalledWith(null);
  });

  it("waits for a loading popup and disconnects the portal when the page is hidden", async () => {
    const popup = createPopup("loading", "/opening");
    vi.spyOn(window, "open").mockReturnValue(popup);
    const { ref } = renderPopout();

    act(() => ref.current?.open());
    expect(popup.document.querySelector("#simulation-fids-root")).toBeNull();

    act(() => popup.dispatchEvent(new Event("load")));
    await waitFor(() => {
      expect(popup.document.body.textContent).toContain("Nur Simulation – keine Betriebsdaten");
    });

    act(() => popup.dispatchEvent(new Event("pagehide")));
    await waitFor(() => {
      expect(popup.document.body.textContent).not.toContain("Nur Simulation – keine Betriebsdaten");
    });
  });

  it("closes its popup on unmount and reports preparation failures", () => {
    const popup = createPopup();
    vi.spyOn(popup.document.head, "replaceChildren").mockImplementation(() => {
      throw new Error("synthetic cross-origin failure");
    });
    vi.spyOn(window, "open").mockReturnValue(popup);
    const { onWindowError, ref, unmount } = renderPopout();

    act(() => ref.current?.open());

    expect(popup.close).toHaveBeenCalledOnce();
    expect(onWindowError).toHaveBeenLastCalledWith(
      "Das FIDS-Fenster konnte nicht vorbereitet werden.",
    );
    unmount();
  });
});
