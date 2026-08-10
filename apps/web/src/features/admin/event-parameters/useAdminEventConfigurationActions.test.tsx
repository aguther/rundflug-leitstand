// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiCommandError } from "../../../api";
import { useAdminEventConfigurationActions } from "./useAdminEventConfigurationActions";
import type { ValidEventParameterPayload } from "./useEventParametersForm";

const mocks = vi.hoisted(() => ({
  removeEventLogo: vi.fn(),
  sendCommand: vi.fn(),
  uploadEventLogo: vi.fn(),
}));

vi.mock("../../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api")>()),
  removeEventLogo: mocks.removeEventLogo,
  sendCommand: mocks.sendCommand,
  uploadEventLogo: mocks.uploadEventLogo,
}));
vi.mock("../../../operation-workspace", () => ({
  ADMIN_CONFIGURATION_AUDIT_REASON: "Synthetic configuration change",
  ADMIN_DEVICE_ID: "synthetic-admin-device",
  EVENT_ID: "synthetic-event",
  deviceTokenFor: () => "synthetic-device-token",
}));

const board = { event: { version: 41 } } as OperationBoard;

function renderActions() {
  const clearPinWhenLocked = vi.fn();
  const onMessage = vi.fn();
  const refreshBoard = vi.fn(async () => undefined);
  const refreshEvents = vi.fn(async () => undefined);
  const refreshHistory = vi.fn(async () => undefined);
  const requestAdminAction = vi.fn((action: () => Promise<void>) => action());
  const runBusyAction = vi.fn((_key: string, action: () => Promise<void>) => action());
  const hook = renderHook(() =>
    useAdminEventConfigurationActions({
      board,
      clearPinWhenLocked,
      getAdminPin: () => "123456",
      onMessage,
      refreshBoard,
      refreshEvents,
      refreshHistory,
      requestAdminAction,
      runBusyAction,
    }),
  );
  return {
    ...hook,
    clearPinWhenLocked,
    onMessage,
    refreshBoard,
    refreshEvents,
    refreshHistory,
    requestAdminAction,
    runBusyAction,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin event configuration actions", () => {
  it("persists lifecycle changes before refreshing board and event catalog", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const { result, clearPinWhenLocked, refreshBoard, refreshEvents } = renderActions();

    await act(() => result.current.setEventLifecycle("ACTIVE"));

    expect(mocks.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 41,
        type: "SET_EVENT_LIFECYCLE",
        payload: expect.objectContaining({ adminPin: "123456", status: "ACTIVE" }),
      }),
      "synthetic-device-token",
    );
    expect(clearPinWhenLocked).toHaveBeenCalledOnce();
    expect(refreshBoard).toHaveBeenCalledOnce();
    expect(refreshEvents).toHaveBeenCalledOnce();
  });

  it("reports parameter version conflicts through the existing lifecycle", async () => {
    mocks.sendCommand.mockRejectedValue(
      new ApiCommandError("Synthetic version conflict", "EVENT_VERSION_CONFLICT", 409, 52),
    );
    const lifecycle = { onConflict: vi.fn(), onSaved: vi.fn() };
    const { result, refreshBoard } = renderActions();

    act(() =>
      result.current.requestSaveEventParameters({} as ValidEventParameterPayload, lifecycle),
    );

    await waitFor(() => expect(lifecycle.onConflict).toHaveBeenCalledWith(52));
    expect(lifecycle.onSaved).not.toHaveBeenCalled();
    expect(refreshBoard).toHaveBeenCalledOnce();
  });

  it("maps every validated operational parameter into the audited command", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const payload: ValidEventParameterPayload = {
      automaticPrecallEnabled: true,
      childReferenceWeightKg: 40,
      departedVisibilitySeconds: 15,
      heavyReferenceWeightKg: 100,
      maxTicketDeferrals: 2,
      maximumGateWaitMinutes: 20,
      noShowAfterMinutes: 15,
      normalReferenceWeightKg: 80,
      notificationLeadMinutes: 15,
      operationsEndAt: "2026-08-10T18:00:00.000Z",
      operationsStartAt: null,
      plannedBoardingMinutes: 5,
      plannedBufferMinutes: 3,
      plannedDeboardingMinutes: 5,
      precallGateCooldownMinutes: 2,
      precallLeadMinutes: 15,
      precallMinimumQuality: "CHANGING",
      saleOpensAt: null,
    };
    const lifecycle = { onConflict: vi.fn(), onSaved: vi.fn() };
    const { result, clearPinWhenLocked, refreshBoard, refreshHistory } = renderActions();

    act(() => result.current.requestSaveEventParameters(payload, lifecycle));

    await waitFor(() => expect(mocks.sendCommand).toHaveBeenCalledOnce());
    expect(mocks.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 41,
        type: "CONFIGURE_EVENT_PARAMETERS",
        payload: {
          ...payload,
          adminPin: "123456",
          reason: "Synthetic configuration change",
        },
      }),
      "synthetic-device-token",
    );
    expect(lifecycle.onSaved).toHaveBeenCalledOnce();
    expect(clearPinWhenLocked).toHaveBeenCalledOnce();
    expect(refreshBoard).toHaveBeenCalledOnce();
    expect(refreshHistory).toHaveBeenCalledOnce();
  });

  it("routes logo uploads and removals through authenticated busy actions", async () => {
    mocks.uploadEventLogo.mockResolvedValue({});
    mocks.removeEventLogo.mockResolvedValue({});
    const file = new File(["synthetic-logo"], "synthetic-logo.svg", { type: "image/svg+xml" });
    const { result, refreshBoard, requestAdminAction, runBusyAction } = renderActions();

    act(() => result.current.requestSaveEventLogo("light", file));
    await waitFor(() => expect(mocks.uploadEventLogo).toHaveBeenCalledOnce());
    act(() => result.current.requestClearEventLogo("dark"));
    await waitFor(() => expect(mocks.removeEventLogo).toHaveBeenCalledOnce());

    expect(requestAdminAction).toHaveBeenCalledTimes(2);
    expect(runBusyAction).toHaveBeenNthCalledWith(1, "event-logo-light", expect.any(Function));
    expect(runBusyAction).toHaveBeenNthCalledWith(2, "clear-event-logo-dark", expect.any(Function));
    expect(refreshBoard).toHaveBeenCalledTimes(2);
  });
});
