// @ts-expect-error Vitest runs in Node; the Worker production config intentionally excludes Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/0056_product_pure_flight_groups.sql", import.meta.url),
  "utf8",
);

describe("product-pure flight groups", () => {
  it("persists the product on flight groups and blocks mismatched active assignments", () => {
    expect(migration).toContain(
      "ALTER TABLE flight_groups ADD COLUMN product_id TEXT REFERENCES products(id)",
    );
    expect(migration).toContain("rotation_tickets_product_pure_insert");
    expect(migration).toContain("rotation_tickets_product_pure_reactivate");
    expect(migration).toContain("AND EXISTS (");
    expect(migration).toContain("SELECT RAISE(ABORT, 'active rotation ticket product mismatch')");
    expect(migration).not.toContain("SELECT CASE WHEN EXISTS");
    expect(migration).toContain("fg.product_id <> tg.product_id");
  });

  it("keeps historical rotations readable while requiring product IDs on new flight groups", () => {
    expect(migration).toContain("r.status NOT IN ('COMPLETED', 'CANCELED')");
  });
});
