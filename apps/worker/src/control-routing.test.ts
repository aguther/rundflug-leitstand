import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

const privateEventRoutes = [
  ["GET", "/operations"],
  ["GET", "/devices"],
  ["GET", "/live"],
  ["POST", "/commands"],
] as const;

describe("content-blocker-neutral private event routing (T-020)", () => {
  it("maps the private API only to the canonical neutral prefix", () => {
    expect(workerSource).toContain("`/api/control/:eventId$" + "{suffix}`");
    expect(workerSource).not.toContain("`/api/events/:eventId$" + "{suffix}`");
    expect(workerSource).toContain("return [controlPath]");
  });

  it.each(privateEventRoutes)(
    "registers %s %s under /api/control on the canonical handler",
    (method, suffix) => {
      expect(workerSource).toContain(`app.on("${method}", eventRoutes("${suffix}")`);
    },
  );
});
