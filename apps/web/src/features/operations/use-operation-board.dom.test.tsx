// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOperationBoard } from "./use-operation-board";

const api = vi.hoisted(() => ({
  getOperationBoard: vi.fn(),
}));

const store = vi.hoisted(() => ({
  loadOperationBoard: vi.fn(),
  saveOperationBoard: vi.fn(),
}));

const scheduler = vi.hoisted(() => ({
  dispose: vi.fn(),
  options: null as {
    refresh: (request: { eventVersion: number | null; forceFollowUp: boolean }) => Promise<void>;
  } | null,
  refreshNow: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock("../../api", () => ({ getOperationBoard: api.getOperationBoard }));
vi.mock("../../offline-store", () => ({
  loadOperationBoard: store.loadOperationBoard,
  saveOperationBoard: store.saveOperationBoard,
}));
vi.mock("../../app/realtime-refresh-scheduler", () => ({
  createRealtimeRefreshScheduler: (options: typeof scheduler.options) => {
    scheduler.options = options;
    scheduler.refreshNow.mockImplementation(() =>
      options?.refresh({ eventVersion: null, forceFollowUp: false }),
    );
    scheduler.schedule.mockImplementation((eventVersion: number | null) =>
      options?.refresh({ eventVersion, forceFollowUp: eventVersion === null }),
    );
    return {
      dispose: scheduler.dispose,
      refreshNow: scheduler.refreshNow,
      schedule: scheduler.schedule,
    };
  },
}));

interface SocketHarness {
  close: ReturnType<typeof vi.fn>;
  dispatch(type: string, event?: unknown): void;
  listeners: Map<string, (event: unknown) => void>;
  send: ReturnType<typeof vi.fn>;
  url: string;
}

const sockets: SocketHarness[] = [];

class SyntheticWebSocket {
  close = vi.fn();
  listeners = new Map<string, (event: unknown) => void>();
  send = vi.fn();
  url: string;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, listener);
  }

  dispatch(type: string, event: unknown = {}) {
    this.listeners.get(type)?.(event);
  }
}

function board(version: number, label = `Board ${version}`): OperationBoard {
  return {
    aircraft: [],
    assistClaims: [],
    currentDeviceRole: "FLIGHT_LINE",
    event: {
      emergencyMode: false,
      eventId: "event-1",
      name: label,
      noShowAfterMinutes: 10,
      operationalInterrupted: false,
      operationalNote: null,
      status: "ACTIVE",
      timeZone: "Europe/Berlin",
      version,
    },
    pilots: [],
    plannedOperations: [],
    products: [],
    queueGroups: [],
    recurringOperationalRules: [],
    resourceGroups: [],
    rotations: [],
  } as unknown as OperationBoard;
}

const identity = {
  eventId: "event 1",
  deviceId: "device-1",
  deviceToken: "token-1",
  role: "FLIGHT_LINE" as const,
};

beforeEach(() => {
  sockets.length = 0;
  api.getOperationBoard.mockReset();
  store.loadOperationBoard.mockReset().mockResolvedValue(null);
  store.saveOperationBoard.mockReset().mockResolvedValue(undefined);
  scheduler.dispose.mockReset();
  scheduler.refreshNow.mockReset();
  scheduler.schedule.mockReset();
  scheduler.options = null;
  vi.stubGlobal("WebSocket", SyntheticWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useOperationBoard", () => {
  it("loads a confirmed board, caches it, and opens the event-scoped realtime channel", async () => {
    const confirmed = board(7);
    api.getOperationBoard.mockResolvedValue(confirmed);

    const { result, unmount } = renderHook(() => useOperationBoard(identity));

    await waitFor(() => expect(result.current.board).toBe(confirmed));
    expect(result.current.backendConfirmed).toBe(true);
    expect(result.current.error).toBeNull();
    expect(api.getOperationBoard).toHaveBeenCalledWith("event 1", "device-1", "token-1");
    expect(store.saveOperationBoard).toHaveBeenCalledWith(
      "event 1",
      "device-1",
      confirmed,
      expect.any(String),
    );
    expect(sockets[0]?.url).toBe("ws://localhost:3000/api/control/event%201/live");

    unmount();
    expect(scheduler.dispose).toHaveBeenCalledOnce();
    expect(sockets[0]?.close).toHaveBeenCalledOnce();
  });

  it("restores a cached board while retaining a failed backend refresh as an error", async () => {
    const cached = board(4, "Cached board");
    store.loadOperationBoard.mockResolvedValue({
      board: cached,
      savedAt: "2026-08-11T08:00:00.000Z",
    });
    api.getOperationBoard.mockRejectedValue(new Error("Synthetic backend unavailable"));

    const { result } = renderHook(() => useOperationBoard(identity));

    await waitFor(() => expect(result.current.board).toBe(cached));
    expect(result.current.backendConfirmed).toBe(false);
    expect(result.current.lastConfirmedAt).toBe("2026-08-11T08:00:00.000Z");
    expect(result.current.error).toBe("Synthetic backend unavailable");
  });

  it("returns the confirmed board from manual refresh and clears refreshing afterwards", async () => {
    const initial = board(3);
    const refreshed = board(5);
    api.getOperationBoard.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
    const { result } = renderHook(() => useOperationBoard(identity));
    await waitFor(() => expect(result.current.board).toBe(initial));

    let returned: OperationBoard | null = null;
    await act(async () => {
      returned = await result.current.refreshAndGet(5, true);
    });

    expect(returned).toBe(refreshed);
    expect(result.current.board).toBe(refreshed);
    expect(result.current.refreshing).toBe(false);
  });

  it("applies only newer command confirmations to the local board", async () => {
    api.getOperationBoard.mockResolvedValue(board(8));
    const { result } = renderHook(() => useOperationBoard(identity));
    await waitFor(() => expect(result.current.board?.event.version).toBe(8));

    act(() => {
      result.current.confirmEvent({ ...result.current.board?.event, version: 7 } as never);
    });
    expect(result.current.board?.event.version).toBe(8);

    act(() => {
      result.current.confirmEvent({ ...result.current.board?.event, version: 9 } as never);
    });
    expect(result.current.board?.event.version).toBe(9);
    expect(result.current.backendConfirmed).toBe(true);
  });

  it("refreshes on open and newer messages while ignoring invalid and stale versions", async () => {
    api.getOperationBoard.mockResolvedValue(board(10));
    const { result } = renderHook(() => useOperationBoard(identity));
    await waitFor(() => expect(result.current.board?.event.version).toBe(10));
    scheduler.refreshNow.mockClear();
    scheduler.schedule.mockClear();
    const socket = sockets[0];
    if (!socket) throw new Error("Expected a realtime socket.");

    act(() => socket.dispatch("open"));
    expect(scheduler.refreshNow).toHaveBeenCalledOnce();

    act(() => socket.dispatch("message", { data: "not-json" }));
    expect(scheduler.schedule).toHaveBeenCalledWith(null);
    scheduler.schedule.mockClear();
    act(() =>
      socket.dispatch("message", {
        data: JSON.stringify({ type: "event-state-changed", eventVersion: 10 }),
      }),
    );
    expect(scheduler.schedule).not.toHaveBeenCalled();

    act(() =>
      socket.dispatch("message", {
        data: JSON.stringify({ type: "event-state-changed", eventVersion: 11 }),
      }),
    );
    expect(scheduler.schedule).toHaveBeenCalledWith(11);
  });

  it("closes errored sockets and suppresses reconnect work after unmount", async () => {
    api.getOperationBoard.mockResolvedValue(board(2));
    const { result, unmount } = renderHook(() => useOperationBoard(identity));
    await waitFor(() => expect(result.current.board).not.toBeNull());
    const socket = sockets[0];
    if (!socket) throw new Error("Expected a realtime socket.");

    act(() => socket.dispatch("error"));
    expect(socket.close).toHaveBeenCalledOnce();

    unmount();
    const socketCount = sockets.length;
    act(() => socket.dispatch("close"));
    expect(sockets).toHaveLength(socketCount);
  });
});
