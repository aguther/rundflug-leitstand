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
  release(): Promise<void>;
  switchToManual(): Promise<void>;
  markExpired(): void;
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

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    expectedVersionRef.current = expectedVersion;
  }, [expectedVersion]);
  useEffect(() => {
    onReservedRef.current = onReserved;
  }, [onReserved]);

  const release = useCallback(async () => {
    requestEpochRef.current += 1;
    const lease = stateRef.current.lease;
    stateRef.current = idleState;
    setState(idleState);
    if (!lease) return;
    try {
      await releaseDispatchRecommendationLease(eventId, lease.leaseId, deviceId, deviceToken);
    } catch {
      // Expiry remains the server-side safety net if an explicit release cannot be delivered.
    }
  }, [deviceId, deviceToken, eventId]);

  const reserve = useCallback(
    async (aircraftId: string, expectedVersionOverride?: number) => {
      const current = stateRef.current;
      const targetEventVersion = expectedVersionOverride ?? expectedVersionRef.current;
      if (
        current.mode === "RESERVED" &&
        current.lease?.aircraftId === aircraftId &&
        current.reservedEventVersion === targetEventVersion
      ) {
        return current.lease;
      }
      const requestEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = requestEpoch;
      const previewLease = current.lease?.aircraftId === aircraftId ? current.lease : null;
      const acquiring: DispatchRecommendationLeaseState = {
        mode: previewLease ? "REFRESHING" : "ACQUIRING",
        lease: previewLease,
        reservedEventVersion: null,
        serverClockOffsetMs: previewLease ? current.serverClockOffsetMs : 0,
        error: null,
      };
      stateRef.current = acquiring;
      setState(acquiring);
      try {
        if (current.lease) {
          await releaseDispatchRecommendationLease(
            eventId,
            current.lease.leaseId,
            deviceId,
            deviceToken,
          ).catch(() => undefined);
        }
        const lease = await acquireDispatchRecommendationLease(eventId, deviceId, deviceToken, {
          commandId: crypto.randomUUID(),
          aircraftId,
          expectedVersion: targetEventVersion,
        });
        if (requestEpochRef.current !== requestEpoch) {
          void releaseDispatchRecommendationLease(
            eventId,
            lease.leaseId,
            deviceId,
            deviceToken,
          ).catch(() => undefined);
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
          lease: previewLease,
          reservedEventVersion: null,
          serverClockOffsetMs: previewLease ? current.serverClockOffsetMs : 0,
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
    [deviceId, deviceToken, eventId],
  );

  useEffect(() => {
    const current = stateRef.current;
    if (
      current.mode !== "RESERVED" ||
      !current.lease ||
      current.reservedEventVersion === expectedVersion
    ) {
      return;
    }
    void reserve(current.lease.aircraftId, expectedVersion);
  }, [expectedVersion, reserve]);

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
    void releaseDispatchRecommendationLease(eventId, lease.leaseId, deviceId, deviceToken).catch(
      () => undefined,
    );
  }, [deviceId, deviceToken, eventId]);

  const consume = useCallback(() => {
    stateRef.current = idleState;
    setState(idleState);
  }, []);

  return { ...state, reserve, release, switchToManual, markExpired, consume };
}
