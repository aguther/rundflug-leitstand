import type { Hono } from "hono";
import { type AdminEventDeletionInput, deleteAdminEvent } from "./admin-event-deletion-service";
import type { SessionActor } from "./auth";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

const defaultDependencies = { deleteAdminEvent };

type AdminEventDeletionRouteDependencies = typeof defaultDependencies;

export function registerAdminEventDeletionRoutes(
  app: WorkerApp,
  dependencies: AdminEventDeletionRouteDependencies = defaultDependencies,
): void {
  app.delete("/api/admin/events/:eventId", async (context) => {
    const eventId = context.req.param("eventId");
    const sourceEventId = context.req.header("x-event-id")?.trim() || eventId;
    const rawInput = (await context.req.json().catch(() => null)) as {
      commandId?: string;
      expectedVersion?: number;
      confirmation?: string;
      reason?: string;
    } | null;
    const reason = rawInput?.reason?.trim() ?? "";
    if (
      !rawInput?.commandId ||
      !Number.isInteger(rawInput.expectedVersion) ||
      (rawInput.expectedVersion ?? -1) < 0 ||
      rawInput.confirmation !== eventId ||
      reason.length < 3
    ) {
      return context.json(
        {
          error: {
            code: "EVENT_DELETE_CONFIRMATION_INVALID",
            message:
              "Kommando-ID, Version, Veranstaltungs-ID und Begründung müssen bestätigt werden.",
          },
        },
        400,
      );
    }

    const input: AdminEventDeletionInput = {
      commandId: rawInput.commandId,
      expectedVersion: rawInput.expectedVersion as number,
      confirmation: rawInput.confirmation,
      reason,
    };
    const result = await dependencies.deleteAdminEvent(
      context.env,
      eventId,
      sourceEventId,
      input,
      context.req.raw,
    );
    switch (result.status) {
      case 202:
        return context.json(result.body, 202);
      case 403:
        return context.json(result.body, 403);
      case 404:
        return context.json(result.body, 404);
      case 409:
        return context.json(result.body, 409);
      default:
        return context.json(result.body);
    }
  });
}
