import { describe, expect, it, vi } from "vitest";
import {
  isRealtimeStateChange,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  realtimeStateChangeVersion,
  sendRealtimeHeartbeat,
} from "./realtime-heartbeat";

describe("realtime heartbeat", () => {
  it("keeps an open websocket active without refreshing on pong", () => {
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };

    expect(sendRealtimeHeartbeat(socket)).toBe(true);
    expect(socket.send).toHaveBeenCalledWith("ping");
    expect(socket.close).not.toHaveBeenCalled();
    expect(isRealtimeStateChange(JSON.stringify({ type: "pong" }))).toBe(false);
    expect(REALTIME_HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it("closes a socket that is no longer open so reconnect can take over", () => {
    const socket = { readyState: 3, send: vi.fn(), close: vi.fn() };

    expect(sendRealtimeHeartbeat(socket)).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("refreshes for state changes and unknown compatible messages", () => {
    const stateChange = JSON.stringify({ type: "event-state-changed", eventVersion: 17 });
    expect(isRealtimeStateChange(stateChange)).toBe(true);
    expect(realtimeStateChangeVersion(stateChange)).toBe(17);
    expect(realtimeStateChangeVersion(JSON.stringify({ type: "event-state-changed" }))).toBeNull();
    expect(
      realtimeStateChangeVersion(JSON.stringify({ type: "forecast-updated", eventVersion: 17 })),
    ).toBeNull();
    expect(isRealtimeStateChange("future-compatible-message")).toBe(true);
    expect(isRealtimeStateChange(new ArrayBuffer(0))).toBe(true);
  });
});
