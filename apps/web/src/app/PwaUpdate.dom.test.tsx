// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announcePwaUpdate,
  PwaUpdateNotice,
  registerUpdateBlocker,
  resetPwaUpdateStateForTests,
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
});
