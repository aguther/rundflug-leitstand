import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

const privateEventRoutes = [
  ["GET", "/snapshot"],
  ["PUT", "/assist-claims/:aircraftId"],
  ["DELETE", "/assist-claims/:aircraftId"],
  ["GET", "/operations"],
  ["GET", "/tickets/search"],
  ["GET", "/ticket-groups/:ticketGroupId/print-data"],
  ["GET", "/history"],
  ["GET", "/history/operations"],
  ["GET", "/history/forecasts"],
  ["GET", "/devices"],
  ["GET", "/reports/daily.csv"],
  ["GET", "/exports/performance-profile.json"],
  ["GET", "/exports/tickets.csv"],
  ["GET", "/reports/daily.pdf"],
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
