import { describe, expect, it } from "vitest";
import workerSource from "./index.ts?raw";

describe("FIDS action priority", () => {
  it("orders BOARDING, GO TO GATE, PREPARE and WAITING before departed rows", () => {
    const route = workerSource.slice(
      workerSource.indexOf('app.get("/api/public/events/:eventId/board"'),
      workerSource.indexOf('app.all("/api/public/events/:eventId/live"'),
    );
    const order = route.slice(route.indexOf("ORDER BY CASE"), route.indexOf("LIMIT 20"));
    expect(order).toContain("rg.status = 'ACTIVE'");
    expect(order).toContain("r.status = 'CALLED'");
    expect(order).toContain("fg.precalled_at IS NOT NULL");
    expect(order).toContain("fg.precall_decision_status = 'PREPARE'");
    expect(order).toContain("CASE WHEN r.status = 'DRAFT' THEN r.dispatch_order END");
    expect(order.indexOf("r.status = 'CALLED' THEN 0")).toBeLessThan(
      order.indexOf("fg.precalled_at IS NOT NULL THEN 1"),
    );
    expect(order.indexOf("fg.precalled_at IS NOT NULL THEN 1")).toBeLessThan(
      order.indexOf("fg.precall_decision_status = 'PREPARE' THEN 2"),
    );
    expect(order).not.toContain("sort_order");
  });

  it("exposes server-side projection timing for remote read-only SLO checks", () => {
    const route = workerSource.slice(
      workerSource.indexOf('app.get("/api/public/events/:eventId/board"'),
      workerSource.indexOf('app.all("/api/public/events/:eventId/live"'),
    );
    expect(route).toContain("const requestStartedAt = performance.now()");
    expect(route).toContain("public-board;dur=");
    expect(route).toContain("performance.now() - requestStartedAt");
  });
});
