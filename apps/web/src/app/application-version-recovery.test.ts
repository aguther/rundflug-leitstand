import { describe, expect, it, vi } from "vitest";
import { recoverApplicationVersion } from "./application-version-recovery";

class SyntheticServiceWorker extends EventTarget {
  public state: ServiceWorkerState;

  public readonly postMessage = vi.fn();

  public constructor(state: ServiceWorkerState) {
    super();
    this.state = state;
  }

  public transitionTo(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function registrationWith(
  worker: SyntheticServiceWorker | null,
  update: () => Promise<void> = async () => undefined,
): ServiceWorkerRegistration {
  return {
    get installing() {
      return null;
    },
    get waiting() {
      return worker as ServiceWorker | null;
    },
    update,
  } as unknown as ServiceWorkerRegistration;
}

describe("application version recovery", () => {
  it("activates a waiting service worker before reloading", async () => {
    const worker = new SyntheticServiceWorker("installed");
    const reload = vi.fn();
    const registration = registrationWith(worker);
    worker.postMessage.mockImplementation(() => {
      expect(reload).not.toHaveBeenCalled();
      worker.transitionTo("activated");
    });

    await recoverApplicationVersion({
      activationTimeoutMs: 100,
      reload,
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
      },
    });

    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("still reloads when the service-worker update check fails", async () => {
    const reload = vi.fn();
    const registration = registrationWith(null, async () => {
      throw new Error("synthetic update failure");
    });

    await recoverApplicationVersion({
      reload,
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
      },
    });

    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads directly when no service worker is registered", async () => {
    const reload = vi.fn();

    await recoverApplicationVersion({
      reload,
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(reload).toHaveBeenCalledOnce();
  });
});
