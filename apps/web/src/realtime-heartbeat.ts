export const REALTIME_HEARTBEAT_INTERVAL_MS = 30_000;

interface RealtimeSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
}

export function sendRealtimeHeartbeat(socket: RealtimeSocket | null): boolean {
  if (!socket) return false;
  if (socket.readyState !== 1) {
    socket.close();
    return false;
  }
  try {
    socket.send("ping");
    return true;
  } catch {
    socket.close();
    return false;
  }
}

export function isRealtimeStateChange(data: unknown): boolean {
  return realtimeStateChangeVersion(data) !== false;
}

export function realtimeStateChangeVersion(data: unknown): number | null | false {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as { type?: unknown; eventVersion?: unknown };
    if (parsed.type === "forecast-updated") return null;
    if (parsed.type !== "event-state-changed") return false;
    return typeof parsed.eventVersion === "number" &&
      Number.isInteger(parsed.eventVersion) &&
      parsed.eventVersion >= 0
      ? parsed.eventVersion
      : null;
  } catch {
    return null;
  }
}
