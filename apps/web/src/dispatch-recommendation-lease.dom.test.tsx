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
});
