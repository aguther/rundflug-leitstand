// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminAuthorization } from "./useAdminAuthorization";

const mocks = vi.hoisted(() => ({ verifyAdminPin: vi.fn() }));

vi.mock("../../api", () => ({ verifyAdminPin: mocks.verifyAdminPin }));
vi.mock("../../operation-workspace", () => ({
  ADMIN_DEVICE_ID: "synthetic-admin-device",
  EVENT_ID: "synthetic-event",
  deviceTokenFor: () => "synthetic-device-token",
}));

function renderAuthorization({
  accountIsAdministrator = false,
  administrator = true,
}: {
  accountIsAdministrator?: boolean;
  administrator?: boolean;
} = {}) {
  const onMessage = vi.fn();
  const hook = renderHook(() =>
    useAdminAuthorization({ accountIsAdministrator, administrator, onMessage }),
  );
  return { ...hook, onMessage };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin authorization state", () => {
  it("keeps an administrator account unlocked without an extra challenge", async () => {
    const action = vi.fn(async () => undefined);
    const { result } = renderAuthorization({ accountIsAdministrator: true });

    expect(result.current.modeUnlocked).toBe(true);
    expect(result.current.getPin()).toBe("000000");
    await act(() => result.current.requestAction(action));

    expect(action).toHaveBeenCalledOnce();
    expect(result.current.dialogMode).toBeNull();
  });

  it("rejects changes without an administrator session", () => {
    const action = vi.fn(async () => undefined);
    const { result, onMessage } = renderAuthorization({ administrator: false });

    act(() => result.current.requestAction(action));

    expect(action).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith(
      "Für diese Änderung wird ein Administrationskonto benötigt.",
    );
  });

  it("verifies a delegated action and clears its temporary pin", async () => {
    mocks.verifyAdminPin.mockResolvedValue(undefined);
    const action = vi.fn(async () => undefined);
    const { result } = renderAuthorization();

    act(() => result.current.requestAction(action));
    expect(result.current.dialogMode).toBe("action");
    act(() => result.current.setPin("123456"));
    await act(() => result.current.confirmDialog());

    expect(mocks.verifyAdminPin).toHaveBeenCalledWith(
      "synthetic-event",
      "synthetic-admin-device",
      "synthetic-device-token",
      "123456",
    );
    expect(action).toHaveBeenCalledOnce();
    expect(result.current.dialogMode).toBeNull();
    expect(result.current.pin).toBe("");
  });

  it("retains a failed challenge for correction", async () => {
    mocks.verifyAdminPin.mockRejectedValue(new Error("Synthetic PIN failure"));
    const { result } = renderAuthorization();

    act(() => result.current.requestModeUnlock());
    act(() => result.current.setPin("123456"));
    await act(() => result.current.confirmDialog());

    await waitFor(() => expect(result.current.error).toBe("Synthetic PIN failure"));
    expect(result.current.dialogMode).toBe("unlock");
    expect(result.current.busy).toBe(false);
  });
});
