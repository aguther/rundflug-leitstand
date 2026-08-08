export interface CoordinatorRealtimeContext {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
}

export class CoordinatorRealtimeService {
  constructor(
    private readonly context: CoordinatorRealtimeContext,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getWebSockets(): WebSocket[] {
    return this.context.getWebSockets();
  }

  openWebSocket(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.context.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "connected", timestamp: this.now().toISOString() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  handleMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === "string" && message === "ping") {
      socket.send(JSON.stringify({ type: "pong", timestamp: this.now().toISOString() }));
    }
  }

  handleClose(): void {
    // The runtime acknowledges close frames for the configured compatibility date.
  }

  handleError(socket: WebSocket): void {
    socket.close(1011, "Verbindung beendet");
  }

  closeAllForReset(): void {
    for (const socket of this.context.getWebSockets()) {
      socket.close(1012, "System wird neu eingerichtet");
    }
  }

  broadcastStateChanged(eventVersion: number, eventType?: string): void {
    const broadcast = JSON.stringify({
      type: "event-state-changed",
      ...(eventType ? { eventType } : {}),
      eventVersion,
    });
    for (const socket of this.context.getWebSockets()) {
      try {
        socket.send(broadcast);
      } catch {
        socket.close(1011, "Broadcast fehlgeschlagen");
      }
    }
  }
}
