// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFidsBoard,
  getFidsFilterOptions,
  getFidsPreferences,
  updateFidsPreferences,
} from "../../api";
import { REALTIME_HEARTBEAT_INTERVAL_MS } from "../../realtime-heartbeat";
import { createLiveFidsDataSource } from "./live-fids-data-source";

vi.mock("../../api", () => ({
  getFidsBoard: vi.fn(),
  getFidsFilterOptions: vi.fn(),
  getFidsPreferences: vi.fn(),
  updateFidsPreferences: vi.fn(),
}));

type SocketEvent = "open" | "message" | "close" | "error";

class TestWebSocket {
  static instances: TestWebSocket[] = [];

  readonly listeners = new Map<SocketEvent, Array<(event: MessageEvent) => void>>();
  readonly send = vi.fn();
  readonly close = vi.fn();
  readyState = 1;

  constructor(readonly url: string) {
    TestWebSocket.instances.push(this);
  }

  addEventListener(type: SocketEvent, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: SocketEvent, data?: string) {
    const event = { data } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function socketAt(index: number): TestWebSocket {
  const socket = TestWebSocket.instances[index];
  if (!socket) throw new Error(`Expected WebSocket instance ${index}.`);
  return socket;
}

describe("live FIDS data source", () => {
  beforeEach(() => {
    TestWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", TestWebSocket);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("delegates preferences, filters, boards and versioned preference writes", async () => {
    const preferences = { version: 7 } as never;
    const filters = { products: [], gates: [] } as never;
    const board = { groups: [] } as never;
    vi.mocked(getFidsPreferences).mockResolvedValue(preferences);
    vi.mocked(getFidsFilterOptions).mockResolvedValue(filters);
    vi.mocked(getFidsBoard).mockResolvedValue(board);
    vi.mocked(updateFidsPreferences).mockResolvedValue(preferences);
    const source = createLiveFidsDataSource("event-2026");
    const signal = new AbortController().signal;

    await expect(source.loadPreferences()).resolves.toBe(preferences);
    await expect(source.loadFilterOptions()).resolves.toBe(filters);
    await expect(source.loadBoard({ page: 2, lowerPage: 1, signal })).resolves.toBe(board);
    await expect(source.savePreferences({ visibleRows: 8 } as never, 7)).resolves.toBe(preferences);

    expect(source.kind).toBe("live");
    expect(source.initialConnection).toEqual({
      connected: false,
      label: "OFFLINE",
      tone: "offline",
    });
    expect(getFidsPreferences).toHaveBeenCalledWith("event-2026");
    expect(getFidsFilterOptions).toHaveBeenCalledWith("event-2026");
    expect(getFidsBoard).toHaveBeenCalledWith("event-2026", { page: 2, lowerPage: 1 }, signal);
    expect(updateFidsPreferences).toHaveBeenCalledWith("event-2026", {
      visibleRows: 8,
      commandId: "00000000-0000-4000-8000-000000000001",
      expectedVersion: 7,
    });
  });

  it("publishes connection changes, realtime versions, heartbeat and polling refreshes", () => {
    const refresh = vi.fn();
    const connectionChanged = vi.fn();
    const source = createLiveFidsDataSource("event / 2026");
    const unsubscribe = source.subscribe(refresh, connectionChanged);
    const firstSocket = socketAt(0);

    expect(firstSocket.url).toBe("ws://localhost:3000/api/control/event%20%2F%202026/live");

    firstSocket.emit("close");
    expect(connectionChanged).toHaveBeenLastCalledWith({
      connected: false,
      label: "OFFLINE",
      tone: "offline",
    });
    vi.advanceTimersByTime(1_000);

    const secondSocket = socketAt(1);
    secondSocket.emit("close");
    vi.advanceTimersByTime(2_000);

    const connectedSocket = socketAt(2);
    connectedSocket.emit("open");
    expect(connectionChanged).toHaveBeenLastCalledWith({
      connected: true,
      label: "VERBUNDEN",
      tone: "connected",
    });
    expect(refresh).toHaveBeenLastCalledWith({ mode: "immediate" });

    connectedSocket.emit(
      "message",
      JSON.stringify({ type: "event-state-changed", eventVersion: 12 }),
    );
    expect(refresh).toHaveBeenLastCalledWith({ mode: "realtime", eventVersion: 12 });

    const refreshCount = refresh.mock.calls.length;
    connectedSocket.emit("message", JSON.stringify({ type: "unrelated" }));
    expect(refresh).toHaveBeenCalledTimes(refreshCount);

    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenLastCalledWith({ mode: "immediate" });
    vi.advanceTimersByTime(REALTIME_HEARTBEAT_INTERVAL_MS - 15_000);
    expect(connectedSocket.send).toHaveBeenCalledWith("ping");

    connectedSocket.emit("error");
    expect(connectedSocket.close).toHaveBeenCalled();

    unsubscribe();
    connectedSocket.emit("close");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a secure socket and can stop before any reconnect is scheduled", () => {
    const secureTarget = {
      location: { host: "fids.example.test", protocol: "https:" },
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    } as unknown as Window;
    const source = createLiveFidsDataSource("event-2026", secureTarget);
    const unsubscribe = source.subscribe(vi.fn(), vi.fn());

    expect(socketAt(0).url).toBe("wss://fids.example.test/api/control/event-2026/live");

    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });
});
