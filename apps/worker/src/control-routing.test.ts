import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

const privateEventRoutes = [
  ["GET", "/operations"],
  ["GET", "/history"],
  ["GET", "/history/operations"],
  ["GET", "/history/forecasts"],
  ["GET", "/history/resources"],
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

  it("keeps the performance export contextual and aggregate-only", () => {
    expect(workerSource).toContain("average_turnaround_minutes");
    expect(workerSource).toContain("passengerSeatCounts");
  });
});
