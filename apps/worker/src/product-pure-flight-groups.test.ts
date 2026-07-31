// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/0056_product_pure_flight_groups.sql", import.meta.url),
  "utf8",
);
const coordinator = readFileSync(new URL("./event-coordinator.ts", import.meta.url), "utf8");

describe("product-pure flight groups", () => {
  it("persists the product on flight groups and blocks mismatched active assignments", () => {
    expect(migration).toContain(
      "ALTER TABLE flight_groups ADD COLUMN product_id TEXT REFERENCES products(id)",
    );
    expect(migration).toContain("rotation_tickets_product_pure_insert");
    expect(migration).toContain("rotation_tickets_product_pure_reactivate");
    expect(migration).toContain("fg.product_id <> tg.product_id");
  });

  it("keeps historical rotations readable while requiring product IDs on new flight groups", () => {
    expect(migration).toContain("r.status NOT IN ('COMPLETED', 'CANCELED')");
    expect(coordinator).toContain("product_id, communication_number");
    expect(coordinator).toContain("PRODUCT_MISMATCH");
    expect(coordinator).toContain("assertProductPureSelection");
  });

  it("requires and audits a reason when an earlier group of another product is skipped", () => {
    expect(coordinator).toContain("QUEUE_DEVIATION_REASON_REQUIRED");
    expect(coordinator).toContain("queueDeviationReason");
    expect(coordinator).toContain("skippedTicketGroupIds");
  });
});
