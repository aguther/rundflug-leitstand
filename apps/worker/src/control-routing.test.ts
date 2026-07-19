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
  it("maps the neutral and legacy prefixes to one typed route pair", () => {
    expect(workerSource).toContain("`/api/control/:eventId$" + "{suffix}`");
    expect(workerSource).toContain("`/api/events/:eventId$" + "{suffix}`");
    expect(workerSource).toContain("return [controlPath, legacyPath]");
  });

  it.each(
    privateEventRoutes,
  )("registers %s %s under /api/control with a legacy alias on the same handler", (method, suffix) => {
    expect(workerSource).toContain(`app.on("${method}", eventRoutes("${suffix}")`);
  });
});
