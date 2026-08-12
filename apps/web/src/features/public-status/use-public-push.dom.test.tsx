// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicPush } from "./use-public-push";

const api = vi.hoisted(() => ({
  getPushConfiguration: vi.fn(),
  registerGroupPush: vi.fn(),
  registerTicketPush: vi.fn(),
  revokeGroupPush: vi.fn(),
  revokeTicketPush: vi.fn(),
}));

vi.mock("../../api", () => api);

interface SyntheticSubscription {
  endpoint: string;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const notification = {
  permission: "default" as NotificationPermission,
  requestPermission: vi.fn<() => Promise<NotificationPermission>>(),
};

let currentSubscription: SyntheticSubscription | null;
const subscribe = vi.fn();
const getSubscription = vi.fn();

function installPushEnvironment() {
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: class SyntheticPushManager {},
  });
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: notification,
  });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: notification,
  });
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription,
          subscribe,
        },
      }),
    },
  });
}

describe("public push subscription", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Win32",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 0,
    });
    currentSubscription = null;
    getSubscription.mockReset().mockImplementation(() => Promise.resolve(currentSubscription));
    subscribe.mockReset();
    notification.permission = "default";
    notification.requestPermission.mockReset().mockResolvedValue("granted");
    Object.values(api).forEach((mock) => {
      mock.mockReset();
    });
    api.getPushConfiguration.mockResolvedValue({ configured: true, publicKey: "synthetic-key" });
    api.registerGroupPush.mockResolvedValue(undefined);
    api.registerTicketPush.mockResolvedValue(undefined);
    api.revokeGroupPush.mockResolvedValue(undefined);
    api.revokeTicketPush.mockResolvedValue(undefined);
    installPushEnvironment();
  });

  afterEach(() => cleanup());

  it("restores a locally enabled group subscription and revokes it explicitly", async () => {
    currentSubscription = {
      endpoint: "https://push.example.test/group",
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    window.localStorage.setItem("group-push:SYN-GROUP", "1");

    const { result } = renderHook(() => usePublicPush("group", "SYN-GROUP"));
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(() => result.current.change(false));

    expect(api.revokeGroupPush).toHaveBeenCalledWith(
      "SYN-GROUP",
      "https://push.example.test/group",
    );
    expect(api.revokeTicketPush).not.toHaveBeenCalled();
    expect(currentSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("group-push:SYN-GROUP")).toBeNull();
    expect(result.current.enabled).toBe(false);
    expect(result.current.message).toBe("Benachrichtigungen wurden deaktiviert.");
  });

  it("requests permission, creates and registers a ticket subscription", async () => {
    const createdSubscription = {
      endpoint: "https://push.example.test/ticket",
      unsubscribe: vi.fn(),
    };
    subscribe.mockResolvedValue(createdSubscription);

    const { result } = renderHook(() => usePublicPush("ticket", "SYN-TICKET"));
    await waitFor(() => expect(result.current.disabled).toBe(false));

    await act(() => result.current.change(true));

    expect(notification.requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith({
      applicationServerKey: "synthetic-key",
      userVisibleOnly: true,
    });
    expect(api.registerTicketPush).toHaveBeenCalledWith("SYN-TICKET", createdSubscription);
    expect(api.registerGroupPush).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("ticket-push:SYN-TICKET")).toBe("1");
    expect(result.current.enabled).toBe(true);
    expect(result.current.message).toBe("Benachrichtigungen sind für dieses Ticket aktiviert.");
  });

  it("reports denied permission without registering or persisting consent", async () => {
    notification.permission = "denied";

    const { result } = renderHook(() => usePublicPush("ticket", "DENIED"));
    await waitFor(() => expect(result.current.disabled).toBe(false));
    expect(result.current.message).toMatch(/Systemeinstellungen/);

    await act(() => result.current.change(true));

    expect(subscribe).not.toHaveBeenCalled();
    expect(api.registerTicketPush).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("ticket-push:DENIED")).toBeNull();
    expect(result.current.enabled).toBe(false);
    expect(result.current.message).toMatch(/Systemeinstellungen/);
  });

  it("distinguishes an unconfigured event from a transient configuration failure", async () => {
    api.getPushConfiguration.mockResolvedValueOnce({ configured: false });
    const unconfigured = renderHook(() => usePublicPush("group", "UNCONFIGURED"));
    await waitFor(() =>
      expect(unconfigured.result.current.message).toBe(
        "Benachrichtigungen sind für diese Veranstaltung noch nicht eingerichtet.",
      ),
    );
    expect(unconfigured.result.current.disabled).toBe(true);
    unconfigured.unmount();

    api.getPushConfiguration.mockRejectedValueOnce(new Error("network unavailable"));
    const unavailable = renderHook(() => usePublicPush("group", "UNAVAILABLE"));
    await waitFor(() =>
      expect(unavailable.result.current.message).toBe(
        "Benachrichtigungen sind momentan nicht verfügbar.",
      ),
    );
    expect(unavailable.result.current.disabled).toBe(true);
  });
});
