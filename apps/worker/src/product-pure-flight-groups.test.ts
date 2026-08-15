import { describe, expect, it } from "vitest";
import { applyDemoSeed, createMigratedTestDatabase } from "../test-support/migrated-database";

describe("product-pure flight groups", () => {
  it("blocks an active rotation assignment from another product", () => {
    const database = createMigratedTestDatabase();
    applyDemoSeed(database);
    database.exec(`
      INSERT INTO flight_groups
        (id, operation_day_id, resource_group_id, product_id, communication_number, status,
         created_at, updated_at)
      VALUES ('flight-group-20', 'demo-2026', 'rg-panorama', 'panorama-20', 201, 'DRAFT',
              '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
      INSERT INTO rotations
        (id, operation_day_id, flight_group_id, status, created_at, updated_at)
      VALUES ('rotation-20', 'demo-2026', 'flight-group-20', 'DRAFT',
              '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
      INSERT INTO ticket_groups
        (id, operation_day_id, product_id, queue_sequence, status, sold_at)
      VALUES ('ticket-group-30', 'demo-2026', 'panorama-30', 1, 'QUEUED',
              '2026-08-15T08:00:00Z');
      INSERT INTO tickets
        (id, ticket_group_id, public_code_hash, status, weight_class, price_cents, created_at)
      VALUES ('ticket-30', 'ticket-group-30', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              'QUEUED', 'NOT_CAPTURED', 6500, '2026-08-15T08:00:00Z');
    `);

    expect(() =>
      database.exec(`
        INSERT INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
        VALUES ('rotation-20', 'ticket-30', '2026-08-15T08:01:00Z');
      `),
    ).toThrow(/active rotation ticket product mismatch/);
    database.close();
  });

  it("keeps completed historical rotations with no product readable", () => {
    const database = createMigratedTestDatabase();
    applyDemoSeed(database);
    database.exec(`
      INSERT INTO flight_groups
        (id, operation_day_id, resource_group_id, communication_number, status, created_at, updated_at)
      VALUES ('legacy-flight-group', 'demo-2026', 'rg-panorama', 202, 'COMPLETED',
              '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
      INSERT INTO rotations
        (id, operation_day_id, flight_group_id, status, created_at, updated_at)
      VALUES ('legacy-rotation', 'demo-2026', 'legacy-flight-group', 'COMPLETED',
              '2026-08-15T08:00:00Z', '2026-08-15T08:00:00Z');
    `);

    expect(
      database
        .prepare(
          `SELECT fg.product_id, r.status
             FROM rotations r
             JOIN flight_groups fg ON fg.id = r.flight_group_id
            WHERE r.id = 'legacy-rotation'`,
        )
        .get(),
    ).toEqual({ product_id: null, status: "COMPLETED" });
    database.close();
  });
});
