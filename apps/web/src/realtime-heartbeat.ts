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
  if (typeof data !== "string") return true;
  try {
    return JSON.parse(data)?.type === "event-state-changed";
  } catch {
    return true;
  }
}
