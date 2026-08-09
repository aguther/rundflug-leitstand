import { describe, expect, it } from "vitest";
import projectionSource from "./fids-board-projection.ts?raw";

describe("FIDS action priority", () => {
  it("orders BOARDING, GO TO GATE, PREPARE and WAITING before departed rows", () => {
    const order = projectionSource.slice(
      projectionSource.indexOf("CASE"),
      projectionSource.indexOf("const projectionBindings"),
    );
    expect(order).toContain("rg.status = 'ACTIVE'");
    expect(order).toContain("r.status = 'CALLED'");
    expect(order).toContain("fg.precalled_at IS NOT NULL");
    expect(order).toContain("fg.precall_decision_status = 'PREPARE'");
    expect(order).toContain("CASE WHEN status = 'DRAFT' THEN dispatch_order END");
    expect(order.indexOf("r.status = 'CALLED' THEN 0")).toBeLessThan(
      order.indexOf("fg.precalled_at IS NOT NULL THEN 1"),
    );
    expect(order.indexOf("fg.precalled_at IS NOT NULL THEN 1")).toBeLessThan(
      order.indexOf("fg.precall_decision_status = 'PREPARE' THEN 2"),
    );
    expect(order).not.toContain("sort_order");
  });
});
