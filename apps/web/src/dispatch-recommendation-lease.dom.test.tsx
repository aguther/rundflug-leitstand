// @vitest-environment jsdom

import type { DispatchRecommendationLease } from "@rundflug/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  acquireDispatchRecommendationLease: vi.fn(),
  releaseDispatchRecommendationLease: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

import { useDispatchRecommendationLease } from "./dispatch-recommendation-lease";

function lease(
  leaseId: string,
  groupIds: string[],
  serverNow = "2026-08-04T08:00:00.000Z",
): DispatchRecommendationLease {
  return {
    leaseId,
    aircraftId: "aircraft-a",
    planRevision: `plan-${leaseId}`,
    batchId: `batch-${leaseId}`,
    dispatchOrder: 1,
    groupIds,
    occupiedSeats: groupIds.length,
    availableSeats: 3 - groupIds.length,
    decisionReasons: ["CAPACITY_OPTIMIZED"],
    acquiredAt: serverNow,
    expiresAt: "2026-08-04T08:01:30.000Z",
    serverNow,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("dispatch recommendation lease lifecycle", () => {
  it("keeps a valid lease stable across event versions and reloads only after an explicit action", async () => {
    const firstLease = lease("00000000-0000-4000-8000-000000000001", ["group-a"]);
    const secondLease = lease("00000000-0000-4000-8000-000000000002", ["group-b"]);
    let resolveRelease: (() => void) | undefined;
    apiMocks.acquireDispatchRecommendationLease
      .mockResolvedValueOnce(firstLease)
      .mockResolvedValueOnce(secondLease);
    apiMocks.releaseDispatchRecommendationLease.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRelease = resolve;
        }),
    );
    const onReserved = vi.fn();

    const { result, rerender } = renderHook(
      ({ expectedVersion }: { expectedVersion: number }) =>
        useDispatchRecommendationLease({
          eventId: "event-a",
          deviceId: "device-a",
          deviceToken: "synthetic-token",
          expectedVersion,
          onReserved,
        }),
      { initialProps: { expectedVersion: 4 } },
    );

    await act(async () => {
      await result.current.reserve("aircraft-a");
    });
    expect(result.current.mode).toBe("RESERVED");
    expect(result.current.reservedEventVersion).toBe(4);
    expect(onReserved).toHaveBeenLastCalledWith(["group-a"]);

    rerender({ expectedVersion: 5 });
    await waitFor(() => expect(result.current.mode).toBe("RESERVED"));
    expect(result.current.lease).toBe(firstLease);
    expect(result.current.reservedEventVersion).toBe(4);
    expect(apiMocks.acquireDispatchRecommendationLease).toHaveBeenCalledTimes(1);
    expect(apiMocks.releaseDispatchRecommendationLease).not.toHaveBeenCalled();

    let reloadPromise: Promise<DispatchRecommendationLease | null> | undefined;
    act(() => {
      reloadPromise = result.current.reloadLatest("aircraft-a", 5);
    });
    await waitFor(() => expect(result.current.mode).toBe("REFRESHING"));
    expect(apiMocks.acquireDispatchRecommendationLease).toHaveBeenCalledTimes(1);
    await act(async () => resolveRelease?.());
    await act(async () => {
      await reloadPromise;
    });
    await waitFor(() => expect(result.current.mode).toBe("RESERVED"));
    expect(result.current.lease).toBe(secondLease);
    expect(result.current.reservedEventVersion).toBe(5);
    expect(onReserved).toHaveBeenLastCalledWith(["group-b"]);
    expect(apiMocks.acquireDispatchRecommendationLease).toHaveBeenLastCalledWith(
      "event-a",
      "device-a",
      "synthetic-token",
      expect.objectContaining({ aircraftId: "aircraft-a", expectedVersion: 5 }),
    );
  });

  it("coalesces concurrent acquisitions for the same aircraft", async () => {
    const pendingLease = deferred<DispatchRecommendationLease>();
    const reservedLease = lease("00000000-0000-4000-8000-000000000010", ["group-a"]);
    apiMocks.acquireDispatchRecommendationLease.mockReturnValueOnce(pendingLease.promise);
    const onReserved = vi.fn();
    const { result } = renderHook(() =>
      useDispatchRecommendationLease({
        eventId: "event-a",
        deviceId: "device-a",
        deviceToken: "synthetic-token",
        expectedVersion: 4,
        onReserved,
      }),
    );

    let first = Promise.resolve<DispatchRecommendationLease | null>(null);
    let second = Promise.resolve<DispatchRecommendationLease | null>(null);
    act(() => {
      first = result.current.reserve("aircraft-a");
      second = result.current.reserve("aircraft-a");
    });
    expect(first).toBe(second);
    expect(apiMocks.acquireDispatchRecommendationLease).toHaveBeenCalledTimes(0);

    await act(async () => {
      pendingLease.resolve(reservedLease);
      await Promise.all([first, second]);
    });

    expect(apiMocks.acquireDispatchRecommendationLease).toHaveBeenCalledTimes(1);
    expect(apiMocks.releaseDispatchRecommendationLease).not.toHaveBeenCalled();
    expect(result.current.lease).toBe(reservedLease);
    expect(onReserved).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent reloads behind one release", async () => {
    const firstLease = lease("00000000-0000-4000-8000-000000000013", ["group-a"]);
    const nextLease = lease("00000000-0000-4000-8000-000000000014", ["group-b"]);
    const pendingReload = deferred<DispatchRecommendationLease>();
    apiMocks.acquireDispatchRecommendationLease
      .mockResolvedValueOnce(firstLease)
      .mockReturnValueOnce(pendingReload.promise);
    apiMocks.releaseDispatchRecommendationLease.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDispatchRecommendationLease({
        eventId: "event-a",
        deviceId: "device-a",
        deviceToken: "synthetic-token",
        expectedVersion: 4,
        onReserved: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.reserve("aircraft-a");
    });

    let firstReload = Promise.resolve<DispatchRecommendationLease | null>(null);
    let secondReload = Promise.resolve<DispatchRecommendationLease | null>(null);
    act(() => {
      firstReload = result.current.reloadLatest("aircraft-a", 5);
      secondReload = result.current.reloadLatest("aircraft-a", 5);
    });
    expect(firstReload).toBe(secondReload);

    await act(async () => {
      pendingReload.resolve(nextLease);
      await Promise.all([firstReload, secondReload]);
    });

    expect(apiMocks.acquireDispatchRecommendationLease).toHaveBeenCalledTimes(2);
    expect(apiMocks.releaseDispatchRecommendationLease).toHaveBeenCalledTimes(1);
    expect(result.current.lease).toBe(nextLease);
  });

  it("releases exactly once when the dialog closes during acquisition", async () => {
    const pendingLease = deferred<DispatchRecommendationLease>();
    const acquiredLease = lease("00000000-0000-4000-8000-000000000011", ["group-a"]);
    apiMocks.acquireDispatchRecommendationLease.mockReturnValueOnce(pendingLease.promise);
    apiMocks.releaseDispatchRecommendationLease.mockResolvedValue(undefined);
    const onReserved = vi.fn();
    const { result } = renderHook(() =>
      useDispatchRecommendationLease({
        eventId: "event-a",
        deviceId: "device-a",
        deviceToken: "synthetic-token",
        expectedVersion: 4,
        onReserved,
      }),
    );

    let acquisition = Promise.resolve<DispatchRecommendationLease | null>(null);
    let closing = Promise.resolve();
    act(() => {
      acquisition = result.current.reserve("aircraft-a");
      closing = result.current.release();
    });
    expect(result.current.mode).toBe("IDLE");

    await act(async () => {
      pendingLease.resolve(acquiredLease);
      await Promise.all([acquisition, closing]);
    });

    expect(result.current.mode).toBe("IDLE");
    expect(onReserved).not.toHaveBeenCalled();
    expect(apiMocks.releaseDispatchRecommendationLease).toHaveBeenCalledTimes(1);
    expect(apiMocks.releaseDispatchRecommendationLease).toHaveBeenCalledWith(
      "event-a",
      acquiredLease.leaseId,
      "device-a",
      "synthetic-token",
    );
  });

  it("waits for close release before an immediate reopen and never deletes the adopted lease", async () => {
    const firstAcquisition = deferred<DispatchRecommendationLease>();
    const firstRelease = deferred<void>();
    const reusedLease = lease("00000000-0000-4000-8000-000000000012", ["group-a"]);
    apiMocks.acquireDispatchRecommendationLease
      .mockReturnValueOnce(firstAcquisition.promise)
      .mockResolvedValueOnce(reusedLease);
    apiMocks.releaseDispatchRecommendationLease.mockReturnValueOnce(firstRelease.promise);
    const onReserved = vi.fn();
    const { result } = renderHook(() =>
      useDispatchRecommendationLease({
        eventId: "event-a",
        deviceId: "device-a",
        deviceToken: "synthetic-token",
        expectedVersion: 4,
        onReserved,
      }),
    );

    let initial = Promise.resolve<DispatchRecommendationLease | null>(null);
    let closing = Promise.resolve();
    let reopening = Promise.resolve<DispatchRecommendationLease | null>(null);
    act(() => {
      initial = result.current.reserve("aircraft-a");
      closing = result.current.release();
      reopening = result.current.reserve("aircraft-a");
    });

    await act(async () => {
      firstAcquisition.resolve(reusedLease);
      await initial;
    });
    await waitFor(() =>
      expect(apiMocks.releaseDispatchRecommendationLease).toHaveBeenCalledTimes(1),
    );
    expect(apiMocks.acquireDispatchRecommendationLease).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRelease.resolve();
      await Promise.all([closing, reopening]);
    });

    expect(apiMocks.acquireDispatchRecommendationLease).toHaveBeenCalledTimes(2);
    expect(apiMocks.releaseDispatchRecommendationLease).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe("RESERVED");
    expect(result.current.lease).toBe(reusedLease);
    expect(onReserved).toHaveBeenCalledTimes(1);
  });
});
