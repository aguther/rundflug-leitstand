import { describe, expect, it } from "vitest";
import {
  type CoordinatorRealtimeContext,
  CoordinatorRealtimeService,
} from "./coordinator-realtime-service";

interface SocketCall {
  code: number;
  reason: string;
}

function fakeSocket(options: { failSend?: boolean } = {}): {
  socket: WebSocket;
  sent: string[];
  closed: SocketCall[];
} {
  const sent: string[] = [];
  const closed: SocketCall[] = [];
  const socket = {
    send(message: string) {
      if (options.failSend) throw new Error("synthetic send failure");
      sent.push(message);
    },
    close(code: number, reason: string) {
      closed.push({ code, reason });
    },
  } as unknown as WebSocket;
  return { socket, sent, closed };
}

function serviceWithSockets(sockets: WebSocket[]): CoordinatorRealtimeService {
  const context: CoordinatorRealtimeContext = {
    acceptWebSocket() {},
    getWebSockets: () => sockets,
  };
  return new CoordinatorRealtimeService(context, () => new Date("2026-08-08T10:00:00.000Z"));
}

describe("coordinator realtime transport", () => {
  it("preserves the command and board refresh message shapes", () => {
    const first = fakeSocket();
    const second = fakeSocket();
    const service = serviceWithSockets([first.socket, second.socket]);

    service.broadcastStateChanged(41);
    service.broadcastStateChanged(42, "AIRCRAFT_ASSIST_CLAIM_ACQUIRED");

    for (const socket of [first, second]) {
      expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
        { type: "event-state-changed", eventVersion: 41 },
        {
          type: "event-state-changed",
          eventType: "AIRCRAFT_ASSIST_CLAIM_ACQUIRED",
          eventVersion: 42,
        },
      ]);
      expect(socket.closed).toEqual([]);
    }
  });

  it("isolates failed broadcasts and closes the affected socket", () => {
    const failed = fakeSocket({ failSend: true });
    const healthy = fakeSocket();
    const service = serviceWithSockets([failed.socket, healthy.socket]);

    service.broadcastStateChanged(43);

    expect(failed.closed).toEqual([{ code: 1011, reason: "Broadcast fehlgeschlagen" }]);
    expect(healthy.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "event-state-changed", eventVersion: 43 },
    ]);
  });

  it("handles heartbeat, errors, and reset shutdown without domain state", () => {
    const client = fakeSocket();
    const service = serviceWithSockets([client.socket]);

    service.handleMessage(client.socket, "ignored");
    service.handleMessage(client.socket, new ArrayBuffer(1));
    service.handleMessage(client.socket, "ping");
    expect(client.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "pong", timestamp: "2026-08-08T10:00:00.000Z" },
    ]);

    service.handleError(client.socket);
    service.closeAllForReset();
    expect(client.closed).toEqual([
      { code: 1011, reason: "Verbindung beendet" },
      { code: 1012, reason: "System wird neu eingerichtet" },
    ]);
  });
});
