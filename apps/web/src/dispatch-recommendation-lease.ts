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
  const requestEpochRef = useRef(0);
  const releaseBarrierRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    expectedVersionRef.current = expectedVersion;
  }, [expectedVersion]);
  useEffect(() => {
    onReservedRef.current = onReserved;
  }, [onReserved]);

  const queueRelease = useCallback(
    (lease: DispatchRecommendationLease): Promise<void> => {
      const releasePromise = releaseBarrierRef.current.then(async () => {
        try {
          await releaseDispatchRecommendationLease(eventId, lease.leaseId, deviceId, deviceToken);
        } catch {
          // Expiry remains the server-side safety net if an explicit release cannot be delivered.
        }
      });
      releaseBarrierRef.current = releasePromise;
      return releasePromise;
    },
    [deviceId, deviceToken, eventId],
  );

  const release = useCallback(async () => {
    requestEpochRef.current += 1;
    const lease = stateRef.current.lease;
    stateRef.current = idleState;
    setState(idleState);
    if (lease) await queueRelease(lease);
    else await releaseBarrierRef.current;
  }, [queueRelease]);

  const acquire = useCallback(
    async (
      aircraftId: string,
      expectedVersionOverride: number | undefined,
      forceReload: boolean,
    ) => {
      const current = stateRef.current;
      const targetEventVersion = expectedVersionOverride ?? expectedVersionRef.current;
      if (!forceReload && current.mode === "RESERVED" && current.lease?.aircraftId === aircraftId) {
        return current.lease;
      }
      const requestEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = requestEpoch;
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
      try {
        if (current.lease) await queueRelease(current.lease);
        else await releaseBarrierRef.current;
        const lease = await acquireDispatchRecommendationLease(eventId, deviceId, deviceToken, {
          commandId: crypto.randomUUID(),
          aircraftId,
          expectedVersion: targetEventVersion,
        });
        if (requestEpochRef.current !== requestEpoch) {
          void queueRelease(lease);
          return null;
        }
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
        if (requestEpochRef.current !== requestEpoch) return null;
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
      }
    },
    [deviceId, deviceToken, eventId, queueRelease],
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

  const switchToManual = useCallback(async () => {
    await release();
    const manual: DispatchRecommendationLeaseState = {
      mode: "MANUAL",
      lease: null,
      reservedEventVersion: null,
      serverClockOffsetMs: 0,
      error: null,
    };
    stateRef.current = manual;
    setState(manual);
  }, [release]);

  const markExpired = useCallback(() => {
    const lease = stateRef.current.lease;
    if (!lease || stateRef.current.mode !== "RESERVED") return;
    const expired: DispatchRecommendationLeaseState = {
      ...stateRef.current,
      mode: "EXPIRED",
      reservedEventVersion: null,
      error: null,
    };
    stateRef.current = expired;
    setState(expired);
    void queueRelease(lease);
  }, [queueRelease]);

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
    stateRef.current = idleState;
    setState(idleState);
  }, []);

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
