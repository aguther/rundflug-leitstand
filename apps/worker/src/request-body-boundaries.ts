import { bodyLimit } from "hono/body-limit";
import type { MiddlewareHandler } from "hono/types";

export const API_BODY_LIMIT_BYTES = 1_250_000;

export const limitApiBody = bodyLimit({
  maxSize: API_BODY_LIMIT_BYTES,
  onError: (context) =>
    context.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Anfrage ist zu groß." } }, 413),
});

export const requireValidJsonBody: MiddlewareHandler = async (context, next) => {
  const contentType = context.req.header("content-type")?.toLowerCase() ?? "";
  const methodMayHaveBody = !["GET", "HEAD", "OPTIONS"].includes(context.req.method);
  if (methodMayHaveBody && contentType.includes("application/json")) {
    try {
      await context.req.raw.clone().json();
    } catch {
      return context.json(
        { error: { code: "INVALID_JSON", message: "JSON-Anfrage ist ungültig." } },
        400,
      );
    }
  }
  await next();
};
