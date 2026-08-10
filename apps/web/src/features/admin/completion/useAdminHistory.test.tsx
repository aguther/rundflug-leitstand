// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminHistory } from "./useAdminHistory";

const apiMocks = vi.hoisted(() => ({
  getAuditHistory: vi.fn(),
  getForecastHistory: vi.fn(),
  getOperationalHistory: vi.fn(),
}));

vi.mock("../../../api", () => apiMocks);
vi.mock("../../../operation-workspace", () => ({
  ADMIN_DEVICE_ID: "synthetic-admin-device",
  EVENT_ID: "synthetic-event",
  deviceTokenFor: () => "synthetic-token",
}));

beforeEach(() => {
  apiMocks.getAuditHistory.mockResolvedValue({ entries: [] });
  apiMocks.getForecastHistory.mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });
  apiMocks.getOperationalHistory.mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useAdminHistory", () => {
  it("loads audit and operational history with the active filters", async () => {
    const { result } = renderHook(() =>
      useAdminHistory({
        activeArea: "events",
        activeEventStep: "completion",
        onError: vi.fn(),
        timeZone: "Europe/Berlin",
      }),
    );

    await waitFor(() => expect(apiMocks.getOperationalHistory).toHaveBeenCalled());
    expect(apiMocks.getAuditHistory).toHaveBeenCalled();
    expect(apiMocks.getOperationalHistory.mock.calls.at(-1)?.[3]).toMatchObject({
      limit: 50,
      offset: 0,
    });

    act(() => result.current.changeFilter("communicationNumber", "12"));
    await waitFor(() =>
      expect(apiMocks.getOperationalHistory.mock.calls.at(-1)?.[3]).toMatchObject({
        communicationNumber: 12,
      }),
    );
  });

  it("retains separate filters when switching between history views", async () => {
    const { result } = renderHook(() =>
      useAdminHistory({
        activeArea: "events",
        activeEventStep: "completion",
        onError: vi.fn(),
      }),
    );
    await waitFor(() => expect(apiMocks.getOperationalHistory).toHaveBeenCalled());

    act(() => {
      result.current.changeFilter("communicationNumber", "17");
    });
    act(() => result.current.changeView("FORECASTS"));
    expect(result.current.filters.communicationNumber).toBe("");
    act(() => result.current.changeFilter("aircraftId", "aircraft-a"));
    await waitFor(() => expect(apiMocks.getForecastHistory).toHaveBeenCalled());

    act(() => result.current.changeView("OPERATIONS"));
    expect(result.current.filters.communicationNumber).toBe("17");
    expect(result.current.filters.aircraftId).toBe("");
  });

  it("leaves the audit view when navigating outside administration events", async () => {
    const onError = vi.fn();
    const { result, rerender } = renderHook(
      ({ activeArea }) =>
        useAdminHistory({
          activeArea,
          activeEventStep: "completion",
          onError,
        }),
      { initialProps: { activeArea: "events" as "events" | "users" } },
    );
    act(() => result.current.changeView("AUDIT"));
    expect(result.current.view).toBe("AUDIT");

    rerender({ activeArea: "users" });
    await waitFor(() => expect(result.current.view).toBe("OPERATIONS"));
  });

  it("reports history loading failures without discarding local filters", async () => {
    const onError = vi.fn();
    apiMocks.getOperationalHistory.mockRejectedValueOnce(new Error("Synthetic history failure"));
    const { result } = renderHook(() =>
      useAdminHistory({
        activeArea: "events",
        activeEventStep: "completion",
        onError,
      }),
    );

    act(() => result.current.changeFilter("ticketId", "ticket-a"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Synthetic history failure"));
    expect(result.current.filters.ticketId).toBe("ticket-a");
  });
});
