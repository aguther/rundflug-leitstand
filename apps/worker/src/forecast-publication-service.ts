import type { Env } from "./types";
import { queueEligiblePreparationNotifications } from "./web-push";

export class ForecastPublicationService {
  constructor(
    private readonly env: Env,
    private readonly getWebSockets: () => WebSocket[],
    private readonly scheduleFollowUp: (request: {
      eventId: string;
      triggerEventType: string;
    }) => void,
  ) {}

  async queuePreparationNotifications(eventId: string): Promise<void> {
    await queueEligiblePreparationNotifications(this.env, eventId);
  }

  publishForecastUpdated(input: {
    eventId: string;
    eventVersion: number;
    updatedAt: string;
    triggerEventType: string;
  }): void {
    const message = JSON.stringify({
      type: "forecast-updated",
      eventId: input.eventId,
      eventVersion: input.eventVersion,
      updatedAt: input.updatedAt,
    });
    for (const socket of this.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "Prognose-Broadcast fehlgeschlagen");
      }
    }
    if (
      input.triggerEventType === "PLANNED_SLOWDOWN_STARTED" ||
      input.triggerEventType === "PLANNED_SLOWDOWN_ENDED"
    ) {
      this.scheduleFollowUp({
        eventId: input.eventId,
        triggerEventType: `${input.triggerEventType}_FOLLOW_UP`,
      });
    }
  }
}
