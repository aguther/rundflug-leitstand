import type { DispatchRecommendationLease } from "@rundflug/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { acquireDispatchRecommendationLease, releaseDispatchRecommendationLease } from "./api";

export type DispatchRecommendationLeaseMode =
  | "IDLE"
  | "ACQUIRING"
  | "REFRESHING"
  | "RESERVED"
  | "MANUAL"
  | "EXPIRED"
  | "INVALIDATED"
  | "ERROR";

export interface DispatchRecommendationLeaseState {
  mode: DispatchRecommendationLeaseMode;
  lease: DispatchRecommendationLease | null;
  reservedEventVersion: number | null;
  serverClockOffsetMs: number;
  error: string | null;
}

export interface DispatchRecommendationLeaseController extends DispatchRecommendationLeaseState {
  reserve(
    aircraftId: string,
    expectedVersionOverride?: number,
  ): Promise<DispatchRecommendationLease | null>;
  reloadLatest(
    aircraftId: string,
    expectedVersionOverride?: number,
  ): Promise<DispatchRecommendationLease | null>;
  release(): Promise<void>;
  switchToManual(): Promise<void>;
  markExpired(): void;
  markInvalidated(message?: string): void;
  consume(): void;
}

interface LeaseHookOptions {
  eventId: string;
  deviceId: string;
  deviceToken: string;
  expectedVersion: number;
  onReserved(groupIds: string[]): void;
}

const idleState: DispatchRecommendationLeaseState = {
  mode: "IDLE",
  lease: null,
  reservedEventVersion: null,
  serverClockOffsetMs: 0,
  error: null,
};

export function dispatchLeaseRemainingSeconds(
  expiresAt: string,
  serverClockOffsetMs: number,
  clientNowMs: number,
): number {
  return Math.max(
    0,
    Math.ceil((Date.parse(expiresAt) - clientNowMs - serverClockOffsetMs) / 1_000),
  );
}

export function formatDispatchLeaseCountdown(remainingSeconds: number): string {
  const seconds = Math.max(0, Math.floor(remainingSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function useDispatchRecommendationLease({
  eventId,
  deviceId,
  deviceToken,
  expectedVersion,
  onReserved,
}: LeaseHookOptions): DispatchRecommendationLeaseController {
  const [state, setState] = useState<DispatchRecommendationLeaseState>(idleState);
  const stateRef = useRef(state);
  const expectedVersionRef = useRef(expectedVersion);
  const onReservedRef = useRef(onReserved);
  const transitionGenerationRef = useRef(0);
  const transitionTailRef = useRef<Promise<void>>(Promise.resolve());
  const serverLeaseRef = useRef<DispatchRecommendationLease | null>(null);
  const pendingAcquireRef = useRef<{
    aircraftId: string;
    generation: number;
    promise: Promise<DispatchRecommendationLease | null>;
  } | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    expectedVersionRef.current = expectedVersion;
  }, [expectedVersion]);
  useEffect(() => {
    onReservedRef.current = onReserved;
  }, [onReserved]);

  const enqueueTransition = useCallback(<Result>(task: () => Promise<Result>): Promise<Result> => {
    const result = transitionTailRef.current.then(task, task);
    transitionTailRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const releaseServerLease = useCallback(async () => {
    const lease = serverLeaseRef.current;
    if (!lease) return;
    serverLeaseRef.current = null;
    try {
      await releaseDispatchRecommendationLease(eventId, lease.leaseId, deviceId, deviceToken);
    } catch {
      // Expiry remains the server-side safety net if an explicit release cannot be delivered.
    }
  }, [deviceId, deviceToken, eventId]);

  const release = useCallback(() => {
    transitionGenerationRef.current += 1;
    pendingAcquireRef.current = null;
    stateRef.current = idleState;
    setState(idleState);
    return enqueueTransition(releaseServerLease);
  }, [enqueueTransition, releaseServerLease]);

  const acquire = useCallback(
    (aircraftId: string, expectedVersionOverride: number | undefined, forceReload: boolean) => {
      const current = stateRef.current;
      const targetEventVersion = expectedVersionOverride ?? expectedVersionRef.current;
      if (!forceReload && current.mode === "RESERVED" && current.lease?.aircraftId === aircraftId) {
        return Promise.resolve(current.lease);
      }
      if (pendingAcquireRef.current?.aircraftId === aircraftId) {
        return pendingAcquireRef.current.promise;
      }
      const generation = transitionGenerationRef.current + 1;
      transitionGenerationRef.current = generation;
      const previewLease = current.lease?.aircraftId === aircraftId ? current.lease : null;
      const acquiring: DispatchRecommendationLeaseState = {
        mode: previewLease ? "REFRESHING" : "ACQUIRING",
        lease: previewLease,
        reservedEventVersion: current.reservedEventVersion,
        serverClockOffsetMs: previewLease ? current.serverClockOffsetMs : 0,
        error: null,
      };
      stateRef.current = acquiring;
      setState(acquiring);
      const promise = enqueueTransition(async () => {
        try {
          await releaseServerLease();
          const lease = await acquireDispatchRecommendationLease(eventId, deviceId, deviceToken, {
            commandId: crypto.randomUUID(),
            aircraftId,
            expectedVersion: targetEventVersion,
          });
          serverLeaseRef.current = lease;
          if (transitionGenerationRef.current !== generation) return null;
          const reserved: DispatchRecommendationLeaseState = {
            mode: "RESERVED",
            lease,
            reservedEventVersion: targetEventVersion,
            serverClockOffsetMs: Date.parse(lease.serverNow) - Date.now(),
            error: null,
          };
          stateRef.current = reserved;
          setState(reserved);
          onReservedRef.current(lease.groupIds);
          return lease;
        } catch (reason) {
          if (transitionGenerationRef.current !== generation) return null;
          const failed: DispatchRecommendationLeaseState = {
            mode: "ERROR",
            lease: null,
            reservedEventVersion: null,
            serverClockOffsetMs: 0,
            error:
              reason instanceof Error
                ? reason.message
                : "Belegungsvorschlag konnte nicht reserviert werden.",
          };
          stateRef.current = failed;
          setState(failed);
          return null;
        } finally {
          if (pendingAcquireRef.current?.generation === generation) {
            pendingAcquireRef.current = null;
          }
        }
      });
      pendingAcquireRef.current = { aircraftId, generation, promise };
      return promise;
    },
    [deviceId, deviceToken, enqueueTransition, eventId, releaseServerLease],
  );

  const reserve = useCallback(
    (aircraftId: string, expectedVersionOverride?: number) =>
      acquire(aircraftId, expectedVersionOverride, false),
    [acquire],
  );

  const reloadLatest = useCallback(
    (aircraftId: string, expectedVersionOverride?: number) =>
      acquire(aircraftId, expectedVersionOverride, true),
    [acquire],
  );

  const switchToManual = useCallback(() => {
    transitionGenerationRef.current += 1;
    pendingAcquireRef.current = null;
    const manual: DispatchRecommendationLeaseState = {
      mode: "MANUAL",
      lease: null,
      reservedEventVersion: null,
      serverClockOffsetMs: 0,
      error: null,
    };
    stateRef.current = manual;
    setState(manual);
    return enqueueTransition(releaseServerLease);
  }, [enqueueTransition, releaseServerLease]);

  const markExpired = useCallback(() => {
    const lease = stateRef.current.lease;
    if (!lease || stateRef.current.mode !== "RESERVED") return;
    transitionGenerationRef.current += 1;
    pendingAcquireRef.current = null;
    const expired: DispatchRecommendationLeaseState = {
      ...stateRef.current,
      mode: "EXPIRED",
      reservedEventVersion: null,
      error: null,
    };
    stateRef.current = expired;
    setState(expired);
    enqueueTransition(releaseServerLease);
  }, [enqueueTransition, releaseServerLease]);

  const markInvalidated = useCallback((message?: string) => {
    const current = stateRef.current;
    if (!current.lease) return;
    const invalidated: DispatchRecommendationLeaseState = {
      ...current,
      mode: "INVALIDATED",
      error:
        message ??
        "Die reservierte Belegung ist nicht mehr verfügbar. Bitte aktuellen Vorschlag laden.",
    };
    stateRef.current = invalidated;
    setState(invalidated);
  }, []);

  const consume = useCallback(() => {
    transitionGenerationRef.current += 1;
    pendingAcquireRef.current = null;
    serverLeaseRef.current = null;
    stateRef.current = idleState;
    setState(idleState);
    enqueueTransition(releaseServerLease);
  }, [enqueueTransition, releaseServerLease]);

  return {
    ...state,
    reserve,
    reloadLatest,
    release,
    switchToManual,
    markExpired,
    markInvalidated,
    consume,
  };
}
