// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminShellState } from "./useAdminShellState";

const mocks = vi.hoisted(() => ({
  getPushConfiguration: vi.fn(),
  getSetupStatus: vi.fn(),
}));

vi.mock("../../api", () => mocks);

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin shell state", () => {
  it("loads push readiness and reports an uninitialized system without a board", async () => {
    mocks.getPushConfiguration.mockResolvedValue({ configured: true });
    mocks.getSetupStatus.mockResolvedValue({ setupRequired: true });
    const { result } = renderHook(() =>
      useAdminShellState({ boardAvailable: false, logout: vi.fn() }),
    );

    await waitFor(() => expect(result.current.pushConfigurationStatus).toBe("configured"));
    await waitFor(() => expect(result.current.setupRequired).toBe(true));
  });

  it("clears setup guidance as soon as a board becomes available", async () => {
    mocks.getPushConfiguration.mockResolvedValue({ configured: false });
    mocks.getSetupStatus.mockResolvedValue({ setupRequired: true });
    const { result, rerender } = renderHook(
      ({ boardAvailable }) => useAdminShellState({ boardAvailable, logout: vi.fn() }),
      { initialProps: { boardAvailable: false } },
    );
    await waitFor(() => expect(result.current.setupRequired).toBe(true));

    rerender({ boardAvailable: true });

    await waitFor(() => expect(result.current.setupRequired).toBe(false));
  });

  it("serializes action state and reloads only after logout succeeds", async () => {
    mocks.getPushConfiguration.mockResolvedValue({ configured: false });
    mocks.getSetupStatus.mockResolvedValue({ setupRequired: false });
    const action = vi.fn().mockResolvedValue(undefined);
    const logout = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useAdminShellState({ boardAvailable: true, logout, reload }),
    );

    await act(() => result.current.runBusyAction("synthetic-action", action));
    await act(() => result.current.logoutAndReload());

    expect(action).toHaveBeenCalledOnce();
    expect(result.current.busyActionKey).toBeNull();
    expect(logout).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(result.current.logoutBusy).toBe(false);
  });
});
