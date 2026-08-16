// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFactoryResetClientState, useAdminFactoryReset } from "./useAdminFactoryReset";

const mocks = vi.hoisted(() => ({
  clearOfflineOperationBoards: vi.fn(),
  factoryReset: vi.fn(),
}));

vi.mock("../../api", () => ({ factoryReset: mocks.factoryReset }));
vi.mock("../../offline-store", () => ({
  clearOfflineOperationBoards: mocks.clearOfflineOperationBoards,
}));
vi.mock("../operations/operation-identity", () => ({
  useAdminOperationIdentity: () => ({
    eventId: "synthetic-event",
    deviceId: "synthetic-admin-device",
    deviceToken: "synthetic-device-token",
  }),
}));

function renderFactoryReset() {
  const onMessage = vi.fn();
  const onResetComplete = vi.fn(async () => undefined);
  const hook = renderHook(() => useAdminFactoryReset({ onMessage, onResetComplete }));
  return { ...hook, onMessage, onResetComplete };
}

function enterValidAuthorization(result: ReturnType<typeof renderFactoryReset>["result"]) {
  act(() => {
    result.current.setReason("  Synthetic factory reset  ");
    result.current.setPin("123456");
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin factory reset state", () => {
  it("opens with safe defaults and keeps backup choices mutually exclusive", () => {
    const { result, onMessage } = renderFactoryReset();

    act(() => result.current.openDialog());
    expect(result.current.open).toBe(true);
    expect(result.current.retainRecoveryBackup).toBe(true);
    expect(result.current.deleteAllBackups).toBe(false);
    expect(onMessage).toHaveBeenCalledWith(null);

    act(() => result.current.setDeleteAllBackups(true));
    expect(result.current.deleteAllBackups).toBe(true);
    expect(result.current.retainRecoveryBackup).toBe(false);
    act(() => result.current.setRetainRecoveryBackup(true));
    expect(result.current.deleteAllBackups).toBe(false);
  });

  it("submits an authenticated reset and delegates client cleanup", async () => {
    mocks.factoryReset.mockResolvedValue({ resetComplete: true });
    const { result, onResetComplete } = renderFactoryReset();
    act(() => result.current.openDialog());
    enterValidAuthorization(result);

    await act(() => result.current.performReset());

    expect(mocks.factoryReset).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        adminPin: "123456",
        deleteAllBackups: false,
        reason: "Synthetic factory reset",
        retainRecoveryBackup: true,
      }),
    );
    expect(onResetComplete).toHaveBeenCalledOnce();
  });

  it("retains reset failures and releases the busy state", async () => {
    mocks.factoryReset.mockRejectedValue(new Error("Synthetic reset failure"));
    const { result } = renderFactoryReset();
    enterValidAuthorization(result);

    await act(() => result.current.performReset());

    await waitFor(() => expect(result.current.error).toBe("Synthetic reset failure"));
    expect(result.current.busy).toBe(false);
  });

  it("does not submit incomplete authorization", async () => {
    const { result } = renderFactoryReset();

    await act(() => result.current.performReset());

    expect(mocks.factoryReset).not.toHaveBeenCalled();
  });

  it("clears client state and navigates without a service worker registration", async () => {
    const navigate = vi.fn();
    const clearLocalStorage = vi.spyOn(Storage.prototype, "clear");
    mocks.clearOfflineOperationBoards.mockResolvedValue(undefined);

    await clearFactoryResetClientState({
      getRegistration: async () => undefined,
      navigate,
    });

    expect(mocks.clearOfflineOperationBoards).toHaveBeenCalledOnce();
    expect(clearLocalStorage).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/setup");
  });
});
