import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announcePwaUpdate,
  deferPwaUpdate,
  getPwaUpdateSnapshot,
  registerUpdateBlocker,
  requestPwaUpdate,
  resetPwaUpdateStateForTests,
} from "./PwaUpdate";

describe("PWA update coordination", () => {
  beforeEach(resetPwaUpdateStateForTests);
  afterEach(resetPwaUpdateStateForTests);

  it("never applies an available update without an explicit request", async () => {
    const updateServiceWorker = vi.fn().mockResolvedValue(undefined);

    announcePwaUpdate(updateServiceWorker);

    expect(getPwaUpdateSnapshot().status).toBe("available");
    expect(updateServiceWorker).not.toHaveBeenCalled();

    await requestPwaUpdate();

    expect(updateServiceWorker).toHaveBeenCalledWith(true);
    expect(getPwaUpdateSnapshot().status).toBe("applying");
  });

  it("defers a consciously requested update until every blocker is released", async () => {
    const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
    const releaseDirty = registerUpdateBlocker("dirty", "form-a");
    const releasePending = registerUpdateBlocker("pending", "command-a");
    announcePwaUpdate(updateServiceWorker);

    await requestPwaUpdate();

    expect(getPwaUpdateSnapshot()).toMatchObject({
      applyRequested: true,
      dirtyCount: 1,
      pendingCount: 1,
      status: "blocked",
    });
    expect(updateServiceWorker).not.toHaveBeenCalled();

    releaseDirty();
    expect(updateServiceWorker).not.toHaveBeenCalled();
    releasePending();

    await vi.waitFor(() => expect(updateServiceWorker).toHaveBeenCalledWith(true));
    expect(getPwaUpdateSnapshot().status).toBe("applying");
  });

  it("keeps the application usable after deferral or an update failure", async () => {
    const updateServiceWorker = vi.fn().mockRejectedValue(new Error("synthetic failure"));
    announcePwaUpdate(updateServiceWorker);
    deferPwaUpdate();
    expect(getPwaUpdateSnapshot().status).toBe("idle");

    announcePwaUpdate(updateServiceWorker);
    await requestPwaUpdate();

    expect(getPwaUpdateSnapshot().status).toBe("failed");
  });
});
