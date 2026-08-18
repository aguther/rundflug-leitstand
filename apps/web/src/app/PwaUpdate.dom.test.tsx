// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announcePwaUpdate,
  PwaUpdateNotice,
  registerUpdateBlocker,
  resetPwaUpdateStateForTests,
  setPwaUpdateReloadForTests,
} from "./PwaUpdate";

describe("PwaUpdateNotice", () => {
  beforeEach(() => {
    resetPwaUpdateStateForTests();
    delete window.rundflugPwaUpdateServiceWorker;
  });

  afterEach(() => {
    cleanup();
    resetPwaUpdateStateForTests();
    delete window.rundflugPwaUpdateServiceWorker;
    vi.useRealTimers();
  });

  it("waits for a conscious action before applying an available update", async () => {
    const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
    render(<PwaUpdateNotice />);

    act(() => announcePwaUpdate(updateServiceWorker));

    expect(screen.getByText("Update verfügbar")).toBeTruthy();
    expect(updateServiceWorker).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Jetzt aktualisieren" }));

    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledWith(true));
    expect(screen.getByText("Aktualisierung wird vorbereitet …")).toBeTruthy();
    const applyingButton = screen.getByRole("button", {
      name: "Aktualisierung wird vorbereitet",
    });
    expect(applyingButton.getAttribute("aria-busy")).toBe("true");
    expect(applyingButton.querySelector(".ds-busy-indicator")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Später" })).toBeNull();
  });

  it("shows the deferred action until dirty work has finished", async () => {
    const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
    const releaseDirty = registerUpdateBlocker("dirty", "cashier-order");
    render(<PwaUpdateNotice />);

    act(() => announcePwaUpdate(updateServiceWorker));

    const deferredAction = screen.getByRole("button", { name: "Nach Abschluss" });
    expect(deferredAction.hasAttribute("disabled")).toBe(false);
    fireEvent.click(deferredAction);

    expect(screen.getByText("Nach Abschluss aktualisieren")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nach Abschluss" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(updateServiceWorker).not.toHaveBeenCalled();

    act(releaseDirty);

    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledWith(true));
  });

  it("keeps the current screen when the update is deferred", () => {
    const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
    render(<PwaUpdateNotice />);
    act(() => announcePwaUpdate(updateServiceWorker));

    fireEvent.click(screen.getByRole("button", { name: "Später" }));

    expect(screen.queryByText("Update verfügbar")).toBeNull();
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it("reloads as soon as the new service worker controls the page", async () => {
    vi.useFakeTimers();
    const serviceWorker = new EventTarget();
    const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
    const reload = vi.fn();
    const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
    setPwaUpdateReloadForTests(reload);
    render(<PwaUpdateNotice />);

    act(() => announcePwaUpdate(updateServiceWorker));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Jetzt aktualisieren" }));
      await Promise.resolve();
    });
    expect(updateServiceWorker).toHaveBeenCalledWith(true);

    act(() => serviceWorker.dispatchEvent(new Event("controllerchange")));

    expect(reload).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(reload).toHaveBeenCalledOnce();
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });
});
