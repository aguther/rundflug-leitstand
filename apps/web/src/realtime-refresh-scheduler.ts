export type RealtimeRefreshTarget = "operational" | "public";

export interface RealtimeRefreshRequest {
  eventVersion: number | null;
  forceFollowUp: boolean;
  isCurrent(): boolean;
}

export interface RealtimeRefreshTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface RealtimeRefreshScheduler {
  schedule(eventVersion: number | null): void;
  refreshNow(): Promise<void>;
  dispose(): void;
}

export interface RealtimeRefreshSchedulerOptions {
  target: RealtimeRefreshTarget;
  refresh(request: RealtimeRefreshRequest): Promise<void>;
  delaySource?: (target: RealtimeRefreshTarget) => number;
  timer?: RealtimeRefreshTimer;
  onError?: (cause: unknown) => void;
}

const REFRESH_DELAY_RANGES: Record<
  RealtimeRefreshTarget,
  { minimumMs: number; maximumMs: number }
> = {
  operational: { minimumMs: 25, maximumMs: 200 },
  public: { minimumMs: 150, maximumMs: 750 },
};

function normalizedOffset(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function createTabRefreshDelaySource(
  random: () => number = Math.random,
): (target: RealtimeRefreshTarget) => number {
  const offset = normalizedOffset(random());
  return (target) => {
    const range = REFRESH_DELAY_RANGES[target];
    return Math.round(range.minimumMs + offset * (range.maximumMs - range.minimumMs));
  };
}

const tabRefreshDelaySource = createTabRefreshDelaySource();

const browserTimer: RealtimeRefreshTimer = {
  schedule(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  cancel(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

interface PendingRefresh {
  eventVersion: number | null;
  forceFollowUp: boolean;
  generation: number;
}

export function createRealtimeRefreshScheduler(
  options: RealtimeRefreshSchedulerOptions,
): RealtimeRefreshScheduler {
  const delaySource = options.delaySource ?? tabRefreshDelaySource;
  const timer = options.timer ?? browserTimer;
  let activeRefresh: PendingRefresh | null = null;
  let pendingRefresh: PendingRefresh | null = null;
  let delayHandle: unknown = null;
  let generation = 0;
  let completedGeneration = 0;
  let drainPromise: Promise<void> | null = null;
  let disposed = false;

  const queueRefresh = (eventVersion: number | null, forceFollowUp: boolean): number | null => {
    if (disposed) return null;
    if (!forceFollowUp && eventVersion !== null) {
      const coveredVersion = Math.max(
        activeRefresh?.eventVersion ?? -1,
        pendingRefresh?.eventVersion ?? -1,
      );
      if (eventVersion <= coveredVersion) return null;
    }
    generation += 1;
    const pendingEventVersion = pendingRefresh?.eventVersion ?? null;
    pendingRefresh = {
      eventVersion:
        eventVersion === null
          ? pendingEventVersion
          : pendingEventVersion === null
            ? eventVersion
            : Math.max(eventVersion, pendingEventVersion),
      forceFollowUp: forceFollowUp || (pendingRefresh?.forceFollowUp ?? false),
      generation,
    };
    return generation;
  };

  const drain = async () => {
    while (!disposed && pendingRefresh) {
      const request = pendingRefresh;
      pendingRefresh = null;
      activeRefresh = request;
      try {
        await options.refresh({
          eventVersion: request.eventVersion,
          forceFollowUp: request.forceFollowUp,
          isCurrent: () => !disposed && generation === request.generation,
        });
      } catch (cause) {
        options.onError?.(cause);
      } finally {
        completedGeneration = Math.max(completedGeneration, request.generation);
        activeRefresh = null;
      }
    }
  };

  const startDrain = (): Promise<void> => {
    if (drainPromise) return drainPromise;
    const currentDrain = drain();
    drainPromise = currentDrain;
    void currentDrain.finally(() => {
      if (drainPromise === currentDrain) drainPromise = null;
      if (!disposed && pendingRefresh && delayHandle === null) void startDrain();
    });
    return currentDrain;
  };

  const waitForGeneration = async (requestedGeneration: number) => {
    while (!disposed && completedGeneration < requestedGeneration) {
      await startDrain();
    }
  };

  return {
    schedule(eventVersion) {
      const requestedGeneration = queueRefresh(eventVersion, eventVersion === null);
      if (requestedGeneration === null || activeRefresh || delayHandle !== null) return;
      delayHandle = timer.schedule(() => {
        delayHandle = null;
        void startDrain();
      }, delaySource(options.target));
    },
    refreshNow() {
      const requestedGeneration = queueRefresh(null, false);
      if (requestedGeneration === null) return Promise.resolve();
      if (delayHandle !== null) {
        timer.cancel(delayHandle);
        delayHandle = null;
      }
      void startDrain();
      return waitForGeneration(requestedGeneration);
    },
    dispose() {
      disposed = true;
      pendingRefresh = null;
      completedGeneration = generation;
      if (delayHandle !== null) timer.cancel(delayHandle);
      delayHandle = null;
    },
  };
}
