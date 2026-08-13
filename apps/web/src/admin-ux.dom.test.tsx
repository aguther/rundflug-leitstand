// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminNavigation,
  MasterDataNavigation,
  SetupProgress,
  type SetupStep,
  ValidationHint,
} from "./admin-ux";

const setupSteps: SetupStep[] = [
  { complete: true, id: "event", label: "Veranstaltung" },
  { category: "aircraft", complete: false, id: "aircraft", label: "Flugzeuge" },
  { complete: false, id: "operations", label: "Betrieb" },
];

describe("admin navigation contracts", () => {
  afterEach(() => cleanup());

  it("marks and changes the active administration area", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdminNavigation activeArea="events" onChange={onChange} />);

    expect(
      screen.getByRole("button", { name: "Veranstaltungen" }).getAttribute("aria-current"),
    ).toBe("page");
    await user.click(screen.getByRole("button", { name: "Sicherung & Reset" }));
    expect(onChange).toHaveBeenCalledWith("backup");
  });

  it("presents master-data counts and selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MasterDataNavigation
        activeCategory="aircraft"
        counts={{
          aircraft: 3,
          assignments: 0,
          gates: 2,
          pilots: 4,
          products: 5,
          "resource-groups": 1,
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Flugzeuge3" }).getAttribute("aria-current")).toBe(
      "page",
    );
    await user.click(screen.getByRole("button", { name: "Produkte5" }));
    expect(onChange).toHaveBeenCalledWith("products");
  });

  it("exposes validation severity through accessible live roles", () => {
    const { rerender } = render(<ValidationHint>Hinweistext</ValidationHint>);
    expect(screen.getByRole("status").textContent).toContain("Hinweistext");

    rerender(<ValidationHint tone="warning">Warnung</ValidationHint>);
    expect(screen.getByRole("status").textContent).toContain("Warnung");

    rerender(<ValidationHint tone="error">Fehler</ValidationHint>);
    expect(screen.getByRole("alert").textContent).toContain("Fehler");
  });
});

describe("setup progress keyboard and overflow contracts", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  beforeEach(() => {
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
  });

  afterEach(() => {
    cleanup();
    globalThis.ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it("selects the first incomplete step and supports cyclic arrow navigation", () => {
    const onSelect = vi.fn();
    render(<SetupProgress onSelect={onSelect} steps={setupSteps} />);

    const aircraft = screen.getByRole("tab", { name: "Flugzeuge" });
    expect(aircraft.getAttribute("aria-current")).toBe("step");
    expect(aircraft.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(aircraft, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith(setupSteps[2]);
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Betrieb" }));

    fireEvent.keyDown(screen.getByRole("tab", { name: "Betrieb" }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith(setupSteps[0]);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Veranstaltung" }), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith(setupSteps[2]);
  });

  it("supports home, end, click, and an explicitly requested current step", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SetupProgress currentStepId="event" onSelect={onSelect} steps={setupSteps} />);

    const event = screen.getByRole("tab", { name: "Veranstaltung" });
    expect(event.getAttribute("aria-current")).toBe("step");
    fireEvent.keyDown(event, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith(setupSteps[2]);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Betrieb" }), { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith(setupSteps[0]);
    fireEvent.keyDown(event, { key: "Enter" });
    await user.click(screen.getByRole("tab", { name: "Flugzeuge" }));
    expect(onSelect).toHaveBeenLastCalledWith(setupSteps[1]);
  });

  it("uses the final step after completion and scrolls an overflowing progress strip", async () => {
    const scrollTo = vi.fn();
    const scrollBy = vi.fn();
    const observe = vi.fn();
    const disconnect = vi.fn();
    globalThis.ResizeObserver = class {
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    };

    const allComplete = setupSteps.map((step) => ({ ...step, complete: true }));
    const { container } = render(<SetupProgress onSelect={vi.fn()} steps={allComplete} />);
    const strip = container.querySelector<HTMLElement>(".setup-progress");
    expect(strip).not.toBeNull();
    if (!strip) return;
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 300 },
      scrollBy: { configurable: true, value: scrollBy },
      scrollLeft: { configurable: true, value: 120, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
      scrollWidth: { configurable: true, value: 900 },
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Vorherige Einrichtungsschritte anzeigen" }).hidden,
      ).toBe(false),
    );
    expect(screen.getByRole("tab", { name: "Betrieb" }).getAttribute("aria-current")).toBe("step");
    fireEvent.scroll(strip);
    await userEvent.click(
      screen.getByRole("button", { name: "Vorherige Einrichtungsschritte anzeigen" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Weitere Einrichtungsschritte anzeigen" }),
    );
    expect(scrollBy).toHaveBeenNthCalledWith(1, { behavior: "smooth", left: -220 });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { behavior: "smooth", left: 220 });
    expect(observe).toHaveBeenCalledWith(strip);
    expect(scrollTo).toHaveBeenCalled();
  });

  it("falls back to direct scroll offsets without browser scrolling APIs", async () => {
    window.requestAnimationFrame = undefined as unknown as typeof window.requestAnimationFrame;
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    const { container } = render(<SetupProgress onSelect={vi.fn()} steps={setupSteps} />);
    const strip = container.querySelector<HTMLElement>(".setup-progress");
    expect(strip).not.toBeNull();
    if (!strip) return;
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 400 },
      scrollBy: { configurable: true, value: undefined },
      scrollLeft: { configurable: true, value: 100, writable: true },
      scrollTo: { configurable: true, value: undefined },
      scrollWidth: { configurable: true, value: 800 },
    });
    fireEvent(window, new Event("resize"));

    const forward = await screen.findByRole("button", {
      name: "Weitere Einrichtungsschritte anzeigen",
    });
    await waitFor(() => expect(forward.hidden).toBe(false));
    await userEvent.click(forward);
    expect(strip.scrollLeft).toBe(288);
  });
});
