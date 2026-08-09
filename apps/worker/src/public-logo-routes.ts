import type { EventLogoTheme } from "@rundflug/contracts";
import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { parseEventLogoTheme } from "./event-logo";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

interface PublicEventLogoRow {
  logo_object_key: string | null;
  logo_media_type: string | null;
  logo_dark_object_key: string | null;
  logo_dark_media_type: string | null;
}

function eventLogoColumns(theme: EventLogoTheme): {
  key: "logo_object_key" | "logo_dark_object_key";
  mediaType: "logo_media_type" | "logo_dark_media_type";
} {
  return theme === "dark"
    ? { key: "logo_dark_object_key", mediaType: "logo_dark_media_type" }
    : { key: "logo_object_key", mediaType: "logo_media_type" };
}

export function registerPublicLogoRoutes(app: WorkerApp) {
  app.get("/api/public/events/:eventId/logo", async (context) => {
    const eventId = context.req.param("eventId");
    const requestedTheme = parseEventLogoTheme(context.req.query("theme") ?? null);
    if (!requestedTheme) {
      return context.json(
        { error: { code: "EVENT_LOGO_THEME_INVALID", message: "Logo-Theme ist ungültig." } },
        400,
      );
    }
    const event = await context.env.DB.prepare(
      `SELECT logo_object_key, logo_media_type,
              logo_dark_object_key, logo_dark_media_type
         FROM operation_days WHERE id = ?1`,
    )
      .bind(eventId)
      .first<PublicEventLogoRow>();
    if (!event) return context.body(null, 404);

    const fallbackTheme: EventLogoTheme = requestedTheme === "light" ? "dark" : "light";
    for (const resolvedTheme of [requestedTheme, fallbackTheme]) {
      const columns = eventLogoColumns(resolvedTheme);
      const objectKey = event[columns.key];
      const mediaType = event[columns.mediaType];
      if (!objectKey || !mediaType) continue;
      const object = await context.env.BACKUPS.get(objectKey);
      if (!object) continue;
      return new Response(object.body, {
        headers: {
          "content-type": mediaType,
          "cache-control": "public, max-age=300",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "x-content-type-options": "nosniff",
          "x-event-logo-theme": resolvedTheme,
        },
      });
    }
    return context.body(null, 404);
  });
}
