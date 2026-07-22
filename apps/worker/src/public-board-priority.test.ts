import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("FIDS action priority", () => {
  it("places active GO TO GATE and BOARDING rows in one stable queue-ordered block", () => {
    const route = workerSource.slice(
      workerSource.indexOf('app.get("/api/public/events/:eventId/board"'),
      workerSource.indexOf('app.all("/api/public/events/:eventId/live"'),
    );
    const order = route.slice(route.indexOf("ORDER BY CASE"), route.indexOf("LIMIT 20"));
    expect(order).toContain("rg.status = 'ACTIVE'");
    expect(order).toContain("r.status = 'CALLED'");
    expect(order).toContain("fg.precalled_at IS NOT NULL");
    expect(order).toContain("THEN COALESCE(fg.queue_position, fg.communication_number)");
    expect(order.indexOf("rg.status = 'ACTIVE'")).toBeLessThan(
      order.indexOf("WHEN r.status = 'DRAFT' THEN 1"),
    );
  });
});
